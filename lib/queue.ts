import { Queue, QueueEvents, ConnectionOptions } from 'bullmq';
import { logger } from './secure-logger';

// Lazy connection getter - only creates connection when actually needed (runtime, not build time)
function getConnection(): ConnectionOptions {
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL environment variable is not set');
  }
  
  const redisUrl = new URL(process.env.REDIS_URL);
  return {
    host: redisUrl.hostname,
    port: parseInt(redisUrl.port) || 6379,
    password: redisUrl.password || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: {
      rejectUnauthorized: false, // Upstash uses self-signed certs
    },
  };
}

// Lazy queue initialization - won't run during build, only at runtime
let _researchQueue: Queue | null = null;

function getResearchQueue(): Queue {
  if (!_researchQueue) {
    _researchQueue = new Queue('research-jobs', {
      connection: getConnection(),
      defaultJobOptions: {
        // One automatic retry with backoff for transient failures (e.g. Anthropic overload).
        // Worker uses checkpoints so retried job resumes from last phase; no duplicate work.
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 60000, // 1 min then 2 min before retry
        },
        removeOnComplete: {
          age: 24 * 3600, // Keep completed jobs for 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Keep failed jobs for 7 days
        },
      },
    });
  }
  return _researchQueue;
}

// Export queue getter (backwards compatible)
export const researchQueue = {
  get add() { return getResearchQueue().add.bind(getResearchQueue()); },
  get getJob() { return getResearchQueue().getJob.bind(getResearchQueue()); },
  get getWaitingCount() { return getResearchQueue().getWaitingCount.bind(getResearchQueue()); },
  get getActiveCount() { return getResearchQueue().getActiveCount.bind(getResearchQueue()); },
  get getCompletedCount() { return getResearchQueue().getCompletedCount.bind(getResearchQueue()); },
  get getFailedCount() { return getResearchQueue().getFailedCount.bind(getResearchQueue()); },
};

export async function queueResearchJob(sessionId: string, tier: string = 'basic') {
  try {
    const queue = getResearchQueue();
    // Higher priority number = processed first in BullMQ
    const priority = tier === 'advanced' ? 1 : tier === 'intermediate' ? 5 : 10;
    const job = await queue.add(
      'process-research',
      { sessionId, timestamp: Date.now() },
      { jobId: sessionId, priority }
    );
    logger.info(`[Queue] Job queued successfully: ${sessionId} (tier: ${tier}, priority: ${priority})`);
    return job.id;
  } catch (error: any) {
    logger.error('[Queue] Failed to queue job:', error);
    throw new Error(`Failed to queue research job: ${error.message}`);
  }
}

/** Queue a job that runs only DataForSEO waves + compile (no Tavily, no Phase 4). For admin testing. */
export async function queueSEOOnlyJob(sessionId: string) {
  try {
    const queue = getResearchQueue();
    const jobId = `seo-only-${sessionId}`;
    const job = await queue.add(
      'process-research',
      { sessionId, seoOnly: true, timestamp: Date.now() },
      { jobId }
    );
    logger.info(`[Queue] SEO-only job queued: ${jobId}`);
    return job.id;
  } catch (error: any) {
    logger.error('[Queue] Failed to queue SEO-only job:', error);
    throw new Error(`Failed to queue SEO-only job: ${error.message}`);
  }
}

// Get job status
export async function getJobStatus(jobId: string) {
  const queue = getResearchQueue();
  const job = await queue.getJob(jobId);
  if (!job) return null;
  
  const state = await job.getState();
  const progress = job.progress;
  
  return { state, progress, data: job.data };
}

/** Queue stats for health checks and admin dashboard. */
export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}> {
  const queue = getResearchQueue();
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);
  return { waiting, active, completed, failed };
}

