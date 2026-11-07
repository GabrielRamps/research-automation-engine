/**
 * Retry helper for API calls with exponential backoff
 */

import { logger } from './secure-logger';

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;
  let delay = opts.initialDelayMs;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on certain errors
      if (isNonRetryableError(error)) {
        throw error;
      }

      // If this was the last attempt, throw
      if (attempt === opts.maxRetries) {
        throw error;
      }

      // Log retry attempt
      logger.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`, {
        error: error.message,
        attempt: attempt + 1,
        maxRetries: opts.maxRetries
      });

      // Wait before retrying
      await sleep(delay);

      // Increase delay for next attempt (exponential backoff)
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Retry failed');
}

/**
 * Check if an error should not be retried
 */
function isNonRetryableError(error: any): boolean {
  // Don't retry on authentication errors
  if (error.status === 401 || error.status === 403) {
    return true;
  }

  // Don't retry on invalid request errors
  if (error.status === 400 || error.status === 422) {
    return true;
  }

  // Don't retry on not found errors
  if (error.status === 404) {
    return true;
  }

  // Check error message for non-retryable patterns
  const errorMessage = error.message?.toLowerCase() || '';
  
  if (
    errorMessage.includes('invalid api key') ||
    errorMessage.includes('authentication') ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('invalid request')
  ) {
    return true;
  }

  // Retry on rate limits, timeouts, and server errors
  return false;
}

/**
 * Retry specifically for AI API calls (Perplexity, Claude, Gemini)
 */
export async function retryAICall<T>(
  fn: () => Promise<T>,
  aiService: 'perplexity' | 'claude' | 'gemini'
): Promise<T> {
  return retryWithBackoff(fn, {
    maxRetries: 3,
    initialDelayMs: 2000, // Start with 2 seconds for AI calls
    maxDelayMs: 30000, // Max 30 seconds
    backoffMultiplier: 2
  });
}

