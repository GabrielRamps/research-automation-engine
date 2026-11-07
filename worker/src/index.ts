// Load worker/.env (if present) before any other module reads process.env
import 'dotenv/config';
import { Worker, Job, ConnectionOptions } from 'bullmq';
import { processResearch } from './processor';
import { logger } from './lib/logger';
import { supabase } from './lib/supabase';

// Startup: warn if optional-but-important env vars are missing
if (!process.env.WORKER_CALLBACK_SECRET) {
  logger.warn('[Worker] WORKER_CALLBACK_SECRET not set — per-user queue will not auto-advance after job completion.');
}
if (!process.env.RESEND_API_KEY) {
  logger.warn('[Worker] RESEND_API_KEY not set — completion emails will not be sent.');
}
if (!process.env.NEXT_PUBLIC_SITE_URL) {
  logger.warn('[Worker] NEXT_PUBLIC_SITE_URL not set — worker-to-app callbacks (e.g. queue-next) will fail.');
}

// Track active session IDs so we can mark them failed on shutdown
const activeSessionIds = new Set<string>();

// Parse Redis URL for BullMQ connection
const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
const connection: ConnectionOptions = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port) || 6379,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: {
    rejectUnauthorized: false, // Upstash uses self-signed certs
  },
};

const worker = new Worker(
  'research-jobs',
  async (job: Job) => {
    const { sessionId } = job.data;
    activeSessionIds.add(sessionId);
    logger.info(`[Worker] Processing research for session: ${sessionId}`);
    try {
      await processResearch(sessionId, job);
      logger.info(`[Worker] Successfully completed session: ${sessionId}`);
    } catch (error: any) {
      logger.error(`[Worker] Failed session ${sessionId}:`, error.message);
      throw error;
    } finally {
      activeSessionIds.delete(sessionId);
    }
  },
  {
    connection,
    concurrency: 3,
    limiter: {
      max: 10,
      duration: 1000,
    },
    lockDuration: 60 * 60 * 1000,
    lockRenewTime: 30 * 1000,
    // Self-hosting: check Redis less often while the queue is empty so an idle
    // worker stays inside Upstash's free 500K-commands/month allowance.
    // New jobs still start immediately (BullMQ wakes the worker when one is added).
    drainDelay: 30, // seconds (BullMQ default: 5)
    stalledInterval: 5 * 60 * 1000, // 5 min (default: 30s) - locks last 1 hour anyway
  }
);

worker.on('completed', (job) => {
  logger.debug(`[Worker] Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  logger.error(`[Worker] Job ${job?.id} failed:`, err?.message);
});

worker.on('error', (err) => {
  logger.error('[Worker] Worker error:', err);
});

// Single startup line to stay under Railway 500 logs/sec
console.log('[Worker] Started (concurrency: 3). Set LOG_LEVEL=debug for verbose logs.'); // always shown, so you can tell it's running

/**
 * Mark all currently-processing sessions as failed so the frontend
 * knows the worker died. Sessions with checkpoints can be resumed.
 */
async function markActiveSessionsFailed(reason: string): Promise<void> {
  const ids = Array.from(activeSessionIds);
  if (ids.length === 0) return;

  logger.info(`[Worker] Marking ${ids.length} active session(s) as failed: ${ids.join(', ')}`);

  const failPromises = ids.map(async (sessionId) => {
    try {
      const { data: session } = await supabase
        .from('research_sessions')
        .select('status, error_log, current_phase')
        .eq('id', sessionId)
        .single();

      if (!session || session.status === 'completed' || session.status === 'cancelled') return;

      const errorLog = session.error_log || [];
      errorLog.push({
        phase: session.current_phase || 0,
        error: reason,
        error_type: 'worker_shutdown',
        timestamp: new Date().toISOString(),
      });

      await supabase
        .from('research_sessions')
        .update({
          status: 'failed',
          error_log: errorLog,
          error_type: 'worker_shutdown',
        })
        .eq('id', sessionId);

      logger.info(`[Worker] Session ${sessionId} marked as failed (${reason})`);
    } catch (err: any) {
      logger.error(`[Worker] Failed to update session ${sessionId} on shutdown:`, err?.message);
    }
  });

  await Promise.allSettled(failPromises);
}

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`[Worker] ${signal} received, marking active sessions and closing...`);

  // Mark active sessions as failed before closing the worker.
  // Use a timeout so we don't block Railway's kill deadline.
  const shutdownTimeout = setTimeout(() => {
    logger.warn('[Worker] Shutdown timeout reached, forcing exit');
    process.exit(1);
  }, 8000);

  try {
    await markActiveSessionsFailed(`Worker shutdown (${signal})`);
    await worker.close();
  } catch (err: any) {
    logger.error('[Worker] Error during shutdown:', err?.message);
  } finally {
    clearTimeout(shutdownTimeout);
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason: any) => {
  logger.error('[Worker] Unhandled rejection:', reason?.message || reason);
});

process.on('uncaughtException', async (err) => {
  logger.error('[Worker] Uncaught exception:', err?.message, err?.stack);
  try {
    await markActiveSessionsFailed(`Uncaught exception: ${err?.message}`);
  } catch {
    // Best-effort
  }
  process.exit(1);
});

