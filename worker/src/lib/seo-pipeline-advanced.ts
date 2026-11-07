/**
 * Advanced SEO Pipeline
 *
 * Same as Intermediate (Tavily + DataForSEO Waves 1–7 + Phase 9 + Phase 10) with
 * backlinks (spec Phase 5) run in parallel inside Wave 1. No separate backlinks step.
 *
 * Intermediate = DataForSEO Phases 0–4, 6–8 (no backlinks).
 * Advanced = same + Phase 5 backlinks in Wave 1.
 *
 * Requires DataForSEO backlinks API access ($100/mo minimum balance).
 */

import { Job } from 'bullmq';
import { supabase, supabaseWithRetry } from './supabase';
import { logger } from './logger';
import { decrypt } from './encryption';
import { DataForSEOClient, DataForSEOCredentials } from './dataforseo-client';
import { runIntermediatePipeline } from './seo-pipeline-intermediate';

/**
 * Run the Advanced tier pipeline.
 * Delegates to Intermediate pipeline; backlinks run inside Wave 1 when tier is advanced.
 */
export async function runAdvancedPipeline(sessionId: string, job: Job): Promise<void> {
  logger.debug(`[AdvancedPipeline] Starting Advanced tier pipeline for session ${sessionId}`);

  const { data: session, error: sessionError } = await supabaseWithRetry(
    () => supabase
      .from('research_sessions')
      .select('id, user_id, tier')
      .eq('id', sessionId)
      .single(),
    'AdvancedPipeline load session',
  );

  if (sessionError || !session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const { data: keys } = await supabaseWithRetry(
    () => supabase
      .from('user_api_keys')
      .select('*')
      .eq('user_id', session.user_id)
      .single(),
    'AdvancedPipeline load API keys',
  );

  if (!keys?.dataforseo_login_encrypted || !keys?.dataforseo_password_encrypted) {
    throw new Error('DataForSEO credentials required for Advanced tier');
  }

  const credentials: DataForSEOCredentials = {
    login: decrypt(keys.dataforseo_login_encrypted),
    password: decrypt(keys.dataforseo_password_encrypted),
  };

  const tempClient = new DataForSEOClient(credentials);
  const validation = await tempClient.validateCredentials();
  if (!validation.valid) {
    throw new Error(`DataForSEO credentials invalid: ${validation.error}`);
  }
  if (validation.balance < 50) {
    logger.warn(`[AdvancedPipeline] Low DataForSEO balance: $${validation.balance}. Backlinks API needs $100/mo.`);
  }

  await runIntermediatePipeline(sessionId, job);
  logger.debug(`[AdvancedPipeline] Complete`);
}
