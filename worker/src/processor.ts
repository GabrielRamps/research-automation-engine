import { Job } from 'bullmq';
import { supabase, supabaseWithRetry } from './lib/supabase';
import { logger } from './lib/logger';
import { runBasicPipeline } from './lib/seo-pipeline-basic';
import { runIntermediatePipeline } from './lib/seo-pipeline-intermediate';
import { runAdvancedPipeline } from './lib/seo-pipeline-advanced';
import { detectBalanceError } from './lib/balance-error-detector';
import { sendCompletionEmail } from './lib/email-notifier';
import { decrypt, DecryptionError } from './lib/encryption';

export async function processResearch(sessionId: string, job: Job) {
  const { data: session, error: sessionError } = await supabaseWithRetry(
    () => supabase
      .from('research_sessions')
      .select('id, user_id, tier, status, current_phase, business_name, created_at, api_costs')
      .eq('id', sessionId)
      .single(),
    'Processor load session',
  );

  if (sessionError || !session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Determine the tier (default to 'basic' for backward compatibility)
  const tier = session.tier || 'basic';
  logger.debug(`[Processor] Session ${sessionId} - Tier: ${tier}, Status: ${session.status}`);

  if (session.status === 'failed' || session.status === 'paused' || session.status === 'cancelled') {
    await supabase
      .from('research_sessions')
      .update({ status: 'in_progress' })
      .eq('id', sessionId);
    
    logger.debug(`[Processor] Session ${sessionId} status reset from ${session.status} to 'in_progress'`);
  }

  // Route: SEO-only test (admin) or normal pipeline by tier
  const seoOnly = !!(job.data && (job.data as { seoOnly?: boolean }).seoOnly);
  try {
    if (seoOnly) {
      logger.info(`[Processor] Running SEO-only test for ${sessionId} (DataForSEO waves + compile, no Tavily/Phase 4)`);
      await runIntermediatePipeline(sessionId, job, { seoOnly: true });
    } else {
      switch (tier) {
        case 'intermediate':
          logger.info(`[Processor] Routing to Intermediate pipeline for ${sessionId}`);
          await runIntermediatePipeline(sessionId, job);
          break;

        case 'advanced':
          logger.info(`[Processor] Routing to Advanced pipeline for ${sessionId}`);
          await runAdvancedPipeline(sessionId, job);
          break;

        case 'basic':
        default:
          logger.info(`[Processor] Routing to Basic pipeline for ${sessionId}`);
          await runBasicPipeline(sessionId, job);
          break;
      }
    }
  } catch (error: any) {
    logger.error(`[Processor] Pipeline error for ${sessionId} (tier: ${tier}, seoOnly: ${seoOnly}):`, error.message);

    // Decryption failures are deterministic — retrying won't help. The user must re-add their keys.
    // Match by class first (preferred), fall back to message for older builds.
    const isDecryptionError =
      error instanceof DecryptionError ||
      (typeof error?.message === 'string' && /Failed to decrypt data/i.test(error.message));

    // Don't mark as failed if cancelled
    if (error.message !== 'Research cancelled by user') {
      // Check if it's a balance error
      const balanceError = detectBalanceError(error);

      // CRITICAL FIX: Re-read current_phase from DB to avoid using stale value
      // The session object was loaded BEFORE phases ran, so its current_phase is outdated
      const { data: freshSession } = await supabase
        .from('research_sessions')
        .select('current_phase')
        .eq('id', sessionId)
        .single();
      const actualPhase = freshSession?.current_phase || session.current_phase || 1;

      if (balanceError) {
        await logBalanceError(sessionId, actualPhase, balanceError);
        logger.debug(`[Processor] Session ${sessionId} marked as PAUSED at phase ${actualPhase} due to balance error`);
        notifyAppToQueueNext(session.user_id).catch((err) => {
          logger.warn(`[Processor] queue-next callback failed for user ${session.user_id}:`, err?.message || err);
        });
      } else if (isDecryptionError) {
        await updateSessionStatus(sessionId, actualPhase, 'failed', error.message, 'decryption_error');
        // Also flag the user's stored keys so the dashboard banner picks it up
        // immediately on next load — without needing to wait for /api/keys/health.
        await markUserKeysUnreadable(session.user_id).catch((e) =>
          logger.warn(`[Processor] markUserKeysUnreadable failed for user ${session.user_id}:`, e?.message || e)
        );
        logger.debug(`[Processor] Session ${sessionId} marked as FAILED (decryption_error) at phase ${actualPhase}. User must re-add API keys.`);
      } else {
        await updateSessionStatus(sessionId, actualPhase, 'failed', error.message);
        logger.debug(`[Processor] Session ${sessionId} marked as FAILED at phase ${actualPhase} due to: ${error.message}`);
      }
    }

    // Per-user queue: allow next pending session to run
    notifyAppToQueueNext(session.user_id).catch((err) => {
      logger.warn(`[Processor] queue-next callback failed for user ${session.user_id}:`, err?.message || err);
    });

    if (isDecryptionError) {
      // Swallow so BullMQ doesn't retry — the keys won't suddenly become decryptable.
      return;
    }
    throw error; // Re-throw to trigger job retry (unless cancelled)
  }

  await job.updateProgress(100);
  await markSessionCompleted(sessionId);

  // Double-check: If somehow status still isn't 'completed', force it
  const { data: finalCheck } = await supabase
    .from('research_sessions')
    .select('status')
    .eq('id', sessionId)
    .single();
  
  if (finalCheck && finalCheck.status !== 'completed') {
    logger.debug(`[Processor] WARNING: Status is '${finalCheck.status}' after completion. Force-setting to 'completed'.`);
    await supabase
      .from('research_sessions')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', sessionId);
  }

  // Per-user queue: tell app to enqueue next pending session for this user
  notifyAppToQueueNext(session.user_id).catch((err) => {
    logger.warn(`[Processor] queue-next callback failed for user ${session.user_id}:`, err?.message || err);
  });
}

/**
 * Notify the app to enqueue the next pending session for this user (per-user queue: one active at a time).
 */
async function notifyAppToQueueNext(userId: string): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const secret = process.env.WORKER_CALLBACK_SECRET;
  if (!baseUrl || !secret) {
    logger.debug('[Processor] queue-next skipped: NEXT_PUBLIC_SITE_URL or WORKER_CALLBACK_SECRET not set');
    return;
  }
  const url = `${baseUrl.replace(/\/$/, '')}/api/sessions/queue-next`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secret}` },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    throw new Error(`queue-next returned ${res.status}`);
  }
}

/**
 * CRITICAL FIX: Determine which phase to start from based on completed data
 * This prevents re-processing completed phases on retry
 * Used by Basic pipeline only (Intermediate/Advanced use wave-based checkpoints)
 */
export function determineStartPhase(session: any): number {
  // Check which phases have completed data
  // A phase is considered complete if it has a summary/synthesis
  
  if (!session.phase1_summary?.content) {
    logger.debug('[Processor] Phase 1 incomplete - starting from Phase 1');
    return 1;
  }
  
  if (!session.phase2_summary?.content) {
    logger.debug('[Processor] Phase 2 incomplete - starting from Phase 2');
    return 2;
  }
  
  if (!session.phase3_summary?.content) {
    logger.debug('[Processor] Phase 3 incomplete - starting from Phase 3');
    return 3;
  }
  
  if (!session.phase4_synthesis?.content) {
    logger.debug('[Processor] Phase 4 incomplete - starting from Phase 4');
    return 4;
  }
  
  // All phases complete - just verify/mark as completed
  logger.debug('[Processor] All phases complete - verifying completion');
  return 4;
}

async function updateSessionStatus(
  sessionId: string,
  phase: number,
  status: 'in_progress' | 'failed' | 'paused',
  error?: string,
  errorType?: string
) {
  const updates: any = {
    current_phase: phase,
    status: status,
  };

  // Set error type for categorization
  if (errorType) {
    updates.error_type = errorType;
  }

  if (error) {
    const { data: session } = await supabase
      .from('research_sessions')
      .select('error_log')
      .eq('id', sessionId)
      .single();

    const errorLog = session?.error_log || [];
    errorLog.push({
      phase,
      error,
      error_type: errorType || 'unknown_error',
      timestamp: new Date().toISOString(),
    });
    updates.error_log = errorLog;
  }

  await supabase
    .from('research_sessions')
    .update(updates)
    .eq('id', sessionId);
}

async function markSessionCompleted(sessionId: string) {
  const { data: session } = await supabaseWithRetry(
    () => supabase
      .from('research_sessions')
      .select('created_at, api_costs, user_id, business_name')
      .eq('id', sessionId)
      .single(),
    'load session for completion',
  );

  if (!session) {
    throw new Error('Session not found for completion');
  }

  const completedAt = new Date();
  const createdAt = new Date(session.created_at);
  const totalTimeMs = completedAt.getTime() - createdAt.getTime();

  // Aggregate API costs from existing data (phases should have already updated this)
  const apiCosts = session.api_costs || {};

  await supabase
    .from('research_sessions')
    .update({
      status: 'completed',
      completed_at: completedAt.toISOString(),
      total_generation_time: totalTimeMs,
      api_costs: apiCosts,
    })
    .eq('id', sessionId);
  
  logger.info(`[Processor] Session ${sessionId} marked completed. Total time: ${Math.round(totalTimeMs / 1000)}s`);

  // Send completion email notification (non-blocking)
  // Don't await - let it run in background so it doesn't delay completion
  sendCompletionEmail(
    sessionId,
    session.user_id,
    session.business_name || 'Your Research'
  ).catch((error) => {
    // Already logged in sendCompletionEmail, just prevent unhandled rejection
    logger.error(`[Processor] Email notification error (non-critical):`, error?.message || error);
  });
}

async function logBalanceError(
  sessionId: string,
  phase: number,
  balanceError: { service: 'claude' | 'tavily' | 'dataforseo'; message: string; instructions: string; link: string }
): Promise<void> {
  try {
    const { data: session } = await supabase
      .from('research_sessions')
      .select('error_log, balance_errors')
      .eq('id', sessionId)
      .single();

    const errorLog = session?.error_log || [];
    const balanceErrors = session?.balance_errors || [];
    
    // Add to error log
    errorLog.push({
      phase,
      error: balanceError.message,
      type: 'balance_error',
      service: balanceError.service,
      timestamp: new Date().toISOString()
    });

    // Add to balance errors array (deduplicate by service)
    const existingBalanceErrors = Array.isArray(balanceErrors) 
      ? balanceErrors.filter(
          (be: any) => be.service !== balanceError.service
        )
      : [];
    
    existingBalanceErrors.push({
      ...balanceError,
      phase,
      timestamp: new Date().toISOString()
    });

    // CRITICAL: Mark as 'paused' (not 'failed') for balance errors
    // This indicates the session can be resumed after adding balance
    await supabase
      .from('research_sessions')
      .update({
        error_log: errorLog,
        balance_errors: existingBalanceErrors,
        status: 'paused', // PAUSED instead of FAILED
        error_type: 'balance_error',
        current_phase: phase
      })
      .eq('id', sessionId);
    
    logger.debug(`[Processor] Session ${sessionId} marked as PAUSED with balance error details`);
  } catch (err) {
    logger.error('[Processor] Error logging balance error:', err);
    // Fallback to regular error logging
    await updateSessionStatus(sessionId, phase, 'paused', balanceError.message, 'balance_error');
  }
}

/**
 * Probe each saved provider key to find which one(s) can't be decrypted, and
 * write a granular health_status snapshot. Only providers that actually fail
 * to decrypt are flagged as needs_reentry — others get accurate healthy/missing
 * states. Existing snapshot fields are preserved when our probe is inconclusive.
 *
 * The /api/keys/save endpoint clears this column on successful re-save.
 */
async function markUserKeysUnreadable(userId: string): Promise<void> {
  const { data: keys } = await supabase
    .from('user_api_keys')
    .select(
      'claude_api_key_encrypted, tavily_api_key_encrypted, dataforseo_login_encrypted, dataforseo_password_encrypted, health_status'
    )
    .eq('user_id', userId)
    .single();

  if (!keys) return;

  const ts = new Date().toISOString();
  const reason = 'Your saved key cannot be read (likely after a security update). Re-enter it.';

  type ProbeResult = { status: 'healthy' | 'needs_reentry' | 'missing'; reason?: string; checked_at: string };

  const probe = (encrypted: string | null | undefined): ProbeResult | null => {
    if (!encrypted) return { status: 'missing', checked_at: ts };
    try {
      decrypt(encrypted);
      return { status: 'healthy', checked_at: ts };
    } catch (err) {
      if (err instanceof DecryptionError) return { status: 'needs_reentry', reason, checked_at: ts };
      // Unexpected error — be conservative and don't overwrite existing state.
      return null;
    }
  };

  const claude = probe(keys.claude_api_key_encrypted);
  const tavily = probe(keys.tavily_api_key_encrypted);
  // DataForSEO is a login+password pair. If either half can't be read, the pair is broken.
  const dfsLogin = probe(keys.dataforseo_login_encrypted);
  const dfsPassword = probe(keys.dataforseo_password_encrypted);
  let dataforseo: ProbeResult | null = dfsLogin;
  if (dfsLogin?.status !== 'needs_reentry' && dfsPassword?.status === 'needs_reentry') {
    dataforseo = dfsPassword;
  }

  const existing = (keys.health_status as Record<string, ProbeResult> | null) ?? null;
  const snapshot = {
    claude: claude ?? existing?.claude ?? { status: 'missing', checked_at: ts },
    tavily: tavily ?? existing?.tavily ?? { status: 'missing', checked_at: ts },
    dataforseo: dataforseo ?? existing?.dataforseo ?? { status: 'missing', checked_at: ts },
  };

  await supabase
    .from('user_api_keys')
    .update({ health_status: snapshot })
    .eq('user_id', userId);
}
