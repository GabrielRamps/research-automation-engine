/**
 * Basic SEO Pipeline
 * 
 * Wraps the existing phase1 → phase2 → phase3 → phase4 flow.
 * Uses Tavily + Claude ONLY (no DataForSEO).
 * 
 * IMPORTANT: All phases are called with { skipDataForSEO: true } to ensure
 * no DataForSEO API calls are made, even if the user has DataForSEO credentials.
 * DataForSEO is reserved for intermediate and advanced tiers.
 * 
 * Preserves the original determineStartPhase logic for checkpoint-based resumption.
 */

import { Job } from 'bullmq';
import { supabase, supabaseWithRetry } from './supabase';
import { logger } from './logger';
import { processPhase1 } from '../phases/phase1';
import { processPhase2 } from '../phases/phase2';
import { processPhase3 } from '../phases/phase3';
import { processPhase4 } from '../phases/phase4';
import { determineStartPhase } from '../processor';

export async function runBasicPipeline(sessionId: string, job: Job) {
  logger.debug(`[BasicPipeline] Starting Basic tier pipeline for session ${sessionId}`);

  const { data: sessionMeta, error: sessionError } = await supabaseWithRetry(
    () => supabase
      .from('research_sessions')
      .select('id, user_id, tier, status, current_phase')
      .eq('id', sessionId)
      .single(),
    'BasicPipeline load session',
  );

  if (sessionError || !sessionMeta) {
    throw new Error(`[BasicPipeline] Session not found: ${sessionId}`);
  }

  // Load phase completion status from dedicated tables for resume detection
  const session: any = { ...sessionMeta };
  const { data: phaseRows } = await supabaseWithRetry(
    () => supabase
      .from('research_session_phase_data')
      .select('phase, summary')
      .eq('session_id', sessionId),
    'BasicPipeline load phase data',
  );

  for (const row of (phaseRows || [])) {
    session[`phase${row.phase}_summary`] = row.summary;
  }

  // Check Phase 4 completion
  const { data: p4Data } = await supabase
    .from('research_session_phase4')
    .select('phase4_synthesis')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (p4Data?.phase4_synthesis) {
    session.phase4_synthesis = p4Data.phase4_synthesis;
  }

  const startPhase = determineStartPhase(session);
  logger.debug(`[BasicPipeline] Starting from Phase ${startPhase}`);

  // Basic tier: Tavily + Claude ONLY — no DataForSEO
  // Phases 1-3 accept skipDataForSEO option to prevent DataForSEO calls
  // Phase 4 is pure Claude synthesis (no DataForSEO API calls)
  const phases: Array<{ num: number; run: (sid: string) => Promise<void> }> = [
    { num: 1, run: (sid) => processPhase1(sid, { skipDataForSEO: true }) },
    { num: 2, run: (sid) => processPhase2(sid, { skipDataForSEO: true }) },
    { num: 3, run: (sid) => processPhase3(sid, { skipDataForSEO: true }) },
    { num: 4, run: (sid) => processPhase4(sid) },
  ];

  // Process phases sequentially, starting from the determined start phase
  for (let i = startPhase - 1; i < phases.length; i++) {
    const phase = phases[i];

    // Check if session has been cancelled before starting this phase
    const isCancelled = await checkIfCancelled(sessionId);
    if (isCancelled) {
      logger.debug(`[BasicPipeline] Session ${sessionId} has been cancelled. Stopping execution.`);
      throw new Error('Research cancelled by user');
    }

    logger.debug(`[BasicPipeline] Starting Phase ${phase.num} for ${sessionId}`);

    // Update job progress (4 phases = 25% each)
    await job.updateProgress((phase.num - 1) * 25);

    // Update session status
    await supabase
      .from('research_sessions')
      .update({ current_phase: phase.num, status: 'in_progress' })
      .eq('id', sessionId);

    // Execute phase
    await phase.run(sessionId);

    logger.debug(`[BasicPipeline] Completed Phase ${phase.num} for ${sessionId}`);
  }

  logger.debug(`[BasicPipeline] ✅ All phases completed for session ${sessionId}`);
}

async function checkIfCancelled(sessionId: string): Promise<boolean> {
  try {
    const { data: session, error } = await supabase
      .from('research_sessions')
      .select('status')
      .eq('id', sessionId)
      .single();

    if (error) {
      logger.error(`[BasicPipeline] Error checking cancellation status:`, error);
      return false;
    }

    return session?.status === 'cancelled';
  } catch (error) {
    logger.error(`[BasicPipeline] Exception checking cancellation:`, error);
    return false;
  }
}
