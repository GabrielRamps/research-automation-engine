import { logger } from './logger';

/**
 * DataForSEO Rate Limiter
 * 
 * Implements semaphore-based concurrency control and per-minute rate limiting
 * for DataForSEO API calls. Categories have different limits:
 * 
 * - Global: 2,000 req/min
 * - labs/backlinks/on_page: 30 max simultaneous
 * - google_ads: 12 req/min (strictest)
 * - serp: 100 req/min
 * - business_data: 100 req/min
 */

export type RateLimitCategory = 
  | 'labs' 
  | 'backlinks' 
  | 'on_page' 
  | 'google_ads' 
  | 'serp' 
  | 'business_data'
  | 'keywords_data'
  | 'appendix';

interface CategoryConfig {
  maxConcurrent: number;
  maxPerMinute: number;
}

const CATEGORY_CONFIGS: Record<RateLimitCategory, CategoryConfig> = {
  labs:              { maxConcurrent: 30,   maxPerMinute: 2000 },
  backlinks:         { maxConcurrent: 30,   maxPerMinute: 2000 },
  on_page:           { maxConcurrent: 30,   maxPerMinute: 2000 },
  google_ads:        { maxConcurrent: 10,   maxPerMinute: 12 },
  serp:              { maxConcurrent: 100,  maxPerMinute: 100 },
  business_data:     { maxConcurrent: 100,  maxPerMinute: 100 },
  keywords_data:     { maxConcurrent: 100,  maxPerMinute: 2000 },
  appendix:          { maxConcurrent: 100,  maxPerMinute: 2000 },
};

const GLOBAL_MAX_PER_MINUTE = 2000;

interface WaitingRequest {
  resolve: () => void;
  category: RateLimitCategory;
  timestamp: number;
}

export class DataForSEORateLimiter {
  // Concurrency tracking per category
  private activeCounts: Map<RateLimitCategory, number> = new Map();
  
  // Per-minute sliding window per category
  private requestTimestamps: Map<RateLimitCategory, number[]> = new Map();
  
  // Global per-minute sliding window
  private globalTimestamps: number[] = [];
  
  // Queue of waiting requests
  private waitingQueue: WaitingRequest[] = [];
  
  // Rate limit remaining from API headers
  private rateLimitRemaining: number | null = null;

  constructor() {
    // Initialize counters for all categories
    for (const category of Object.keys(CATEGORY_CONFIGS) as RateLimitCategory[]) {
      this.activeCounts.set(category, 0);
      this.requestTimestamps.set(category, []);
    }
  }

  /**
   * Detect the rate limit category from a DataForSEO endpoint path
   */
  static categorizeEndpoint(endpoint: string): RateLimitCategory {
    if (endpoint.includes('/dataforseo_labs/')) return 'labs';
    if (endpoint.includes('/backlinks/')) return 'backlinks';
    if (endpoint.includes('/on_page/')) return 'on_page';
    if (endpoint.includes('/keywords_data/google_ads/')) return 'google_ads';
    if (endpoint.includes('/keywords_data/google_trends/')) return 'keywords_data';
    if (endpoint.includes('/serp/')) return 'serp';
    if (endpoint.includes('/business_data/')) return 'business_data';
    if (endpoint.includes('/appendix/')) return 'appendix';
    // Default to a generous category
    return 'keywords_data';
  }

  /**
   * Acquire a slot for the given category. Resolves when the request can proceed.
   */
  async acquire(category: RateLimitCategory): Promise<void> {
    // Clean up old timestamps
    this.cleanupTimestamps(category);
    this.cleanupGlobalTimestamps();

    const config = CATEGORY_CONFIGS[category];
    const activeCount = this.activeCounts.get(category) || 0;
    const categoryTimestamps = this.requestTimestamps.get(category) || [];

    // Check if we can proceed immediately
    const canProceed = 
      activeCount < config.maxConcurrent &&
      categoryTimestamps.length < config.maxPerMinute &&
      this.globalTimestamps.length < GLOBAL_MAX_PER_MINUTE;

    if (canProceed) {
      this.recordRequest(category);
      return;
    }

    // Otherwise, wait in queue
    const waitTime = this.calculateWaitTime(category);
    logger.debug(`[RateLimiter] Category '${category}' at capacity. Waiting ${waitTime}ms...`);

    return new Promise<void>((resolve) => {
      const waiter: WaitingRequest = { resolve, category, timestamp: Date.now() };
      this.waitingQueue.push(waiter);

      // Set a timer to try again
      setTimeout(() => {
        this.processQueue();
      }, waitTime);
    });
  }

  /**
   * Release a slot for the given category
   */
  release(category: RateLimitCategory): void {
    const current = this.activeCounts.get(category) || 0;
    this.activeCounts.set(category, Math.max(0, current - 1));

    // Try to process queued requests
    this.processQueue();
  }

  /**
   * Update rate limit remaining from API response headers
   */
  updateRateLimitRemaining(remaining: number): void {
    this.rateLimitRemaining = remaining;
    if (remaining < 100) {
      logger.warn(`[RateLimiter] DataForSEO rate limit remaining: ${remaining}`);
    }
  }

  /**
   * Get current rate limit remaining
   */
  getRateLimitRemaining(): number | null {
    return this.rateLimitRemaining;
  }

  /**
   * Get current status for logging
   */
  getStatus(): Record<string, { active: number; perMinute: number }> {
    const status: Record<string, { active: number; perMinute: number }> = {};
    for (const category of Object.keys(CATEGORY_CONFIGS) as RateLimitCategory[]) {
      this.cleanupTimestamps(category);
      status[category] = {
        active: this.activeCounts.get(category) || 0,
        perMinute: (this.requestTimestamps.get(category) || []).length,
      };
    }
    return status;
  }

  // ─── Private helpers ──────────────────────────────────────

  private recordRequest(category: RateLimitCategory): void {
    const now = Date.now();
    
    // Increment active count
    const current = this.activeCounts.get(category) || 0;
    this.activeCounts.set(category, current + 1);

    // Record timestamp for per-minute tracking
    const timestamps = this.requestTimestamps.get(category) || [];
    timestamps.push(now);
    this.requestTimestamps.set(category, timestamps);

    // Record global timestamp
    this.globalTimestamps.push(now);
  }

  private cleanupTimestamps(category: RateLimitCategory): void {
    const oneMinuteAgo = Date.now() - 60000;
    const timestamps = this.requestTimestamps.get(category) || [];
    this.requestTimestamps.set(
      category,
      timestamps.filter(t => t > oneMinuteAgo)
    );
  }

  private cleanupGlobalTimestamps(): void {
    const oneMinuteAgo = Date.now() - 60000;
    this.globalTimestamps = this.globalTimestamps.filter(t => t > oneMinuteAgo);
  }

  private calculateWaitTime(category: RateLimitCategory): number {
    const config = CATEGORY_CONFIGS[category];
    const timestamps = this.requestTimestamps.get(category) || [];
    
    if (timestamps.length >= config.maxPerMinute && timestamps.length > 0) {
      // Wait until the oldest timestamp in the window expires
      const oldestInWindow = timestamps[0];
      const waitMs = (oldestInWindow + 60000) - Date.now() + 100; // +100ms buffer
      return Math.max(waitMs, 1000);
    }

    // If it's a concurrency issue, wait a short time and retry
    return 500;
  }

  private processQueue(): void {
    const newQueue: WaitingRequest[] = [];

    for (const waiter of this.waitingQueue) {
      this.cleanupTimestamps(waiter.category);
      this.cleanupGlobalTimestamps();

      const config = CATEGORY_CONFIGS[waiter.category];
      const activeCount = this.activeCounts.get(waiter.category) || 0;
      const categoryTimestamps = this.requestTimestamps.get(waiter.category) || [];

      const canProceed = 
        activeCount < config.maxConcurrent &&
        categoryTimestamps.length < config.maxPerMinute &&
        this.globalTimestamps.length < GLOBAL_MAX_PER_MINUTE;

      if (canProceed) {
        this.recordRequest(waiter.category);
        waiter.resolve();
      } else {
        newQueue.push(waiter);
      }
    }

    this.waitingQueue = newQueue;

    // If there are still waiters, schedule another check
    if (this.waitingQueue.length > 0) {
      setTimeout(() => this.processQueue(), 1000);
    }
  }
}

/**
 * Retry wrapper with exponential backoff
 * Used for transient errors (429, 5xx) from DataForSEO
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    retryableStatusCodes?: number[];
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    retryableStatusCodes = [429, 500, 502, 503, 504],
  } = options;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if error is retryable
      const statusCode = error.statusCode || error.status || 0;
      const isRetryable = retryableStatusCodes.includes(statusCode) || 
                          error.message?.includes('ECONNRESET') ||
                          error.message?.includes('ETIMEDOUT') ||
                          error.message?.includes('timed out');

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // Calculate delay with exponential backoff + jitter
      const baseDelay = initialDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * 500;
      const delay = Math.min(baseDelay + jitter, maxDelayMs);

      logger.debug(
        `[Retry] Attempt ${attempt + 1}/${maxRetries} failed (status: ${statusCode}). ` +
        `Retrying in ${Math.round(delay)}ms...`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
