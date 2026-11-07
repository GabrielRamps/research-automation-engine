/**
 * Checkpoint Manager
 * 
 * Manages granular progress checkpoints for research phases to enable
 * resuming from exact failure points without re-doing completed work.
 */

import { supabase } from './supabase';
import { logger } from './logger';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface Phase1Checkpoint {
  completed_prompts: string[]; // Array of prompt IDs that have been completed
  last_prompt_index: number;
  total_prompts: number;
}

export interface Phase2Checkpoint {
  completed_prompts: string[];
  last_prompt_index: number;
  total_prompts: number;
}

export interface Phase3Checkpoint {
  completed_prompts: string[];
  last_prompt_index: number;
  total_prompts: number;
}

export interface Phase4Checkpoint {
  completed_subphases: string[]; // ['4.1', '4.2', '4.3', '4.4', '4.5']
  completed_pages_prompts: string[]; // ['Homepage', 'About', ...]
  last_page_prompt_index: number;
  total_pages: number;
}

export interface CheckpointData {
  phase1?: Phase1Checkpoint;
  phase2?: Phase2Checkpoint;
  phase3?: Phase3Checkpoint;
  phase4?: Phase4Checkpoint;
}

// ─────────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────────

const STATEMENT_TIMEOUT_CODE = '57014';
const MAX_CHECKPOINT_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function isTransientError(err: { code?: string; message?: string }): boolean {
  if (err?.code === STATEMENT_TIMEOUT_CODE) return true;
  const msg = (typeof err?.message === 'string' ? err.message : '').toLowerCase();
  return msg.includes('canceling statement') ||
    msg.includes('statement timeout') ||
    msg.includes('fetch failed') ||
    msg.includes('headers timeout') ||
    msg.includes('und_err_headers_timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network error') ||
    msg.includes('aborted');
}

const CHECKPOINTS_TABLE = 'research_session_checkpoints';

/**
 * Load checkpoint data for a session (retries on transient errors).
 * Reads from research_session_checkpoints; falls back to research_sessions for backfill.
 */
export async function loadCheckpoint(sessionId: string): Promise<CheckpointData> {
  let lastError: { code?: string; message?: string } | null = null;
  for (let attempt = 1; attempt <= MAX_CHECKPOINT_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase
        .from(CHECKPOINTS_TABLE)
        .select('checkpoint_data')
        .eq('session_id', sessionId)
        .maybeSingle();

      if (error) {
        lastError = error;
        if (isTransientError(error) && attempt < MAX_CHECKPOINT_RETRIES) {
          logger.warn(`[Checkpoint] Load timeout (attempt ${attempt}/${MAX_CHECKPOINT_RETRIES}), retrying in ${RETRY_DELAY_MS * attempt}ms...`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
          continue;
        }
        if (isTransientError(error)) {
          throw new Error(`Failed to load checkpoint: ${error.message}`);
        }
        logger.error('[Checkpoint] Error loading checkpoint:', error);
        return {};
      }
      if (data?.checkpoint_data != null) {
        return data.checkpoint_data as CheckpointData;
      }
      // Fallback: read from research_sessions (backfill path)
      const { data: legacy, error: legacyErr } = await supabase
        .from('research_sessions')
        .select('checkpoint_data')
        .eq('id', sessionId)
        .single();
      if (!legacyErr && legacy?.checkpoint_data != null) {
        const cp = legacy.checkpoint_data as CheckpointData;
        await supabase.from(CHECKPOINTS_TABLE).upsert(
          { session_id: sessionId, checkpoint_data: cp, updated_at: new Date().toISOString() },
          { onConflict: 'session_id' }
        ).then(() => {});
        return cp;
      }
      return {};
    } catch (error: any) {
      if (error?.message?.startsWith('Failed to load checkpoint:')) throw error;
      lastError = error;
      logger.error('[Checkpoint] Exception loading checkpoint:', error);
      if (attempt === MAX_CHECKPOINT_RETRIES) return {};
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  return {};
}

/**
 * Save checkpoint data for a session (merges with existing data).
 * Retries on transient errors (DB timeouts, network failures) to avoid losing progress.
 */
export async function saveCheckpoint(
  sessionId: string,
  phaseData: Partial<CheckpointData>
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_CHECKPOINT_RETRIES; attempt++) {
    try {
      const existingCheckpoint = await loadCheckpoint(sessionId);
      const updatedCheckpoint: CheckpointData = {
        ...existingCheckpoint,
        ...phaseData,
      };

      const { error } = await supabase
        .from(CHECKPOINTS_TABLE)
        .upsert(
          {
            session_id: sessionId,
            checkpoint_data: updatedCheckpoint,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'session_id' }
        );

      if (error) {
        if (isTransientError(error) && attempt < MAX_CHECKPOINT_RETRIES) {
          logger.warn(`[Checkpoint] Save timeout (attempt ${attempt}/${MAX_CHECKPOINT_RETRIES}), retrying in ${RETRY_DELAY_MS * attempt}ms...`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
          lastError = new Error(`Failed to save checkpoint: ${error.message}`);
          continue;
        }
        logger.error('[Checkpoint] Error saving checkpoint:', error);
        throw new Error(`Failed to save checkpoint: ${error.message}`);
      }

      logger.debug('[Checkpoint] ✅ Checkpoint saved successfully');
      return;
    } catch (error: any) {
      lastError = error;
      if (isTransientError(error) && attempt < MAX_CHECKPOINT_RETRIES) {
        logger.warn(`[Checkpoint] Save exception (attempt ${attempt}/${MAX_CHECKPOINT_RETRIES}), retrying in ${RETRY_DELAY_MS * attempt}ms...`, error?.message);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }
      logger.error('[Checkpoint] Exception saving checkpoint:', error);
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }
}

/**
 * Get completion percentage for a specific phase
 */
export async function getPhaseProgress(
  sessionId: string,
  phase: number
): Promise<number> {
  try {
    const checkpoint = await loadCheckpoint(sessionId);
    const phaseKey = `phase${phase}` as keyof CheckpointData;
    const phaseCheckpoint = checkpoint[phaseKey];

    if (!phaseCheckpoint) {
      return 0;
    }

    if (phase === 4) {
      const p4 = phaseCheckpoint as Phase4Checkpoint;
      const completedSubphases = p4.completed_subphases?.length || 0;
      const completedPagesPrompts = p4.completed_pages_prompts?.length || 0;
      const totalPages = p4.total_pages || 0;

      // 5 subphases + prompts per page
      const totalItems = 5 + totalPages;
      const completedItems = completedSubphases + completedPagesPrompts;

      if (totalItems === 0) return 0;
      return Math.round((completedItems / totalItems) * 100);
    } else {
      // Phases 1-3
      const p = phaseCheckpoint as Phase1Checkpoint | Phase2Checkpoint | Phase3Checkpoint;
      const completed = p.completed_prompts?.length || 0;
      const total = p.total_prompts || 0;

      if (total === 0) return 0;
      return Math.round((completed / total) * 100);
    }
  } catch (error) {
    logger.error('[Checkpoint] Error calculating progress:', error);
    return 0;
  }
}

/**
 * Check if a phase can resume from checkpoint (has partial progress)
 */
export async function canResumePhase(
  sessionId: string,
  phase: number
): Promise<boolean> {
  try {
    const checkpoint = await loadCheckpoint(sessionId);
    const phaseKey = `phase${phase}` as keyof CheckpointData;
    const phaseCheckpoint = checkpoint[phaseKey];

    if (!phaseCheckpoint) {
      return false;
    }

    if (phase === 4) {
      const p4 = phaseCheckpoint as Phase4Checkpoint;
      return (
        (p4.completed_subphases?.length || 0) > 0 ||
        (p4.completed_pages_prompts?.length || 0) > 0
      );
    } else {
      const p = phaseCheckpoint as Phase1Checkpoint | Phase2Checkpoint | Phase3Checkpoint;
      return (p.completed_prompts?.length || 0) > 0;
    }
  } catch (error) {
    logger.error('[Checkpoint] Error checking resume capability:', error);
    return false;
  }
}

/**
 * Clear checkpoint for a specific phase (when phase completes successfully)
 */
export async function clearPhaseCheckpoint(
  sessionId: string,
  phase: number
): Promise<void> {
  try {
    const checkpoint = await loadCheckpoint(sessionId);
    const phaseKey = `phase${phase}` as keyof CheckpointData;

    // Remove the phase-specific checkpoint
    delete checkpoint[phaseKey];

    // Save updated checkpoint
    const { error } = await supabase
      .from(CHECKPOINTS_TABLE)
      .upsert(
        {
          session_id: sessionId,
          checkpoint_data: checkpoint,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'session_id' }
      );

    if (error) {
      logger.error('[Checkpoint] Error clearing phase checkpoint:', error);
    } else {
      logger.debug(`[Checkpoint] ✅ Phase ${phase} checkpoint cleared`);
    }
  } catch (error) {
    logger.error('[Checkpoint] Exception clearing phase checkpoint:', error);
  }
}

/**
 * Clear all checkpoints for a session (when all phases complete)
 */
export async function clearAllCheckpoints(sessionId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from(CHECKPOINTS_TABLE)
      .upsert(
        {
          session_id: sessionId,
          checkpoint_data: {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'session_id' }
      );

    if (error) {
      logger.error('[Checkpoint] Error clearing all checkpoints:', error);
    } else {
      logger.debug('[Checkpoint] ✅ All checkpoints cleared');
    }
  } catch (error) {
    logger.error('[Checkpoint] Exception clearing all checkpoints:', error);
  }
}

// ─────────────────────────────────────────────────────────────────
// Phase-Specific Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Phase 1-3: Check if a prompt has been completed
 */
export function isPromptCompleted(
  checkpoint: Phase1Checkpoint | Phase2Checkpoint | Phase3Checkpoint | undefined,
  promptId: string
): boolean {
  if (!checkpoint || !checkpoint.completed_prompts) {
    return false;
  }
  return checkpoint.completed_prompts.includes(promptId);
}

/**
 * Phase 4: Check if a subphase has been completed
 */
export function isSubphaseCompleted(
  checkpoint: Phase4Checkpoint | undefined,
  subphase: string
): boolean {
  if (!checkpoint || !checkpoint.completed_subphases) {
    return false;
  }
  return checkpoint.completed_subphases.includes(subphase);
}

/**
 * Phase 4: Check if page prompt has been completed
 */
export function isPagePromptCompleted(
  checkpoint: Phase4Checkpoint | undefined,
  pageName: string
): boolean {
  if (!checkpoint || !checkpoint.completed_pages_prompts) {
    return false;
  }
  return checkpoint.completed_pages_prompts.includes(pageName);
}

/**
 * Get a summary of checkpoint status for logging/debugging
 */
export async function getCheckpointSummary(sessionId: string): Promise<string> {
  try {
    const checkpoint = await loadCheckpoint(sessionId);
    const summary: string[] = [];

    if (checkpoint.phase1) {
      const p1 = checkpoint.phase1;
      summary.push(`Phase 1: ${p1.completed_prompts?.length || 0}/${p1.total_prompts || 0} prompts`);
    }

    if (checkpoint.phase2) {
      const p2 = checkpoint.phase2;
      summary.push(`Phase 2: ${p2.completed_prompts?.length || 0}/${p2.total_prompts || 0} prompts`);
    }

    if (checkpoint.phase3) {
      const p3 = checkpoint.phase3;
      summary.push(`Phase 3: ${p3.completed_prompts?.length || 0}/${p3.total_prompts || 0} prompts`);
    }

    if (checkpoint.phase4) {
      const p4 = checkpoint.phase4;
      summary.push(
        `Phase 4: ${p4.completed_subphases?.length || 0}/5 subphases, ` +
        `${p4.completed_pages_prompts?.length || 0}/${p4.total_pages || 0} pages (prompts)`
      );
    }

    return summary.length > 0 ? summary.join('; ') : 'No checkpoints';
  } catch (error) {
    logger.error('[Checkpoint] Error generating summary:', error);
    return 'Error loading checkpoint summary';
  }
}
