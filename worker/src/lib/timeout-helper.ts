/**
 * Timeout helper for API calls
 * Prevents indefinite hanging on API requests
 * 
 * NOTE: This is a BACKUP timeout. SDK clients have their own timeouts configured:
 * - Tavily SDK: 120s (2 min)
 * - Anthropic SDK (Claude): 120-300s (2-5 min)
 * 
 * These wrapper timeouts are set HIGHER than SDK timeouts so the SDK fails first
 * with proper error messages. If this wrapper triggers, it means the SDK timeout
 * didn't work (rare edge case).
 */

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  const timeoutPromise = new Promise<T>((_, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${errorMessage} (timeout after ${timeoutMs / 1000}s)`));
    }, timeoutMs);
    
    // Clean up timeout if promise resolves first
    promise.finally(() => clearTimeout(timeoutId));
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Wrapper timeout limits (BACKUP - SDK timeouts should trigger first)
 * 
 * Actual SDK timeouts configured in phase files:
 * - Tavily SDK: 120s client timeout
 * - Claude (Anthropic SDK): 120-300s client timeout  
 */
export const TIMEOUTS = {
  TAVILY: 180000,           // 3 minutes (backup for 2min SDK timeout)
  CLAUDE: 240000,           // 4 minutes (backup for 2-3min SDK timeout)
  CLAUDE_SYNTHESIS: 360000, // 6 minutes (backup for 5min SDK timeout in Phase 4)
  DATABASE: 30000,          // 30 seconds (database operations)
  TOTAL_JOB: 1500000,       // 25 minutes (entire pipeline — extended for 50-page competitor crawls)
} as const;
