import { createClient, PostgrestSingleResponse, PostgrestResponse } from '@supabase/supabase-js';
import { logger } from './logger';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'x-client-info': 'research-worker' } },
  }
);

/**
 * Detect if a Supabase error is actually a Cloudflare/proxy HTML response
 * (e.g. 521 Web server is down, 502, 503, etc.).
 */
function isTransientSupabaseError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message || '';
  return (
    msg.includes('<!DOCTYPE') ||
    msg.includes('<html') ||
    msg.includes('Web server is down') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('fetch failed') ||
    msg.includes('network error') ||
    error.code === 'PGRST301' ||
    error.code === undefined
  );
}

const DEFAULT_RETRIES = 3;
const INITIAL_DELAY_MS = 2000;

/**
 * Execute a Supabase query with automatic retry on transient failures
 * (Cloudflare 521, network resets, timeouts).
 *
 * Usage:
 *   const { data, error } = await supabaseWithRetry(() =>
 *     supabase.from('table').select('*').eq('id', id).single()
 *   );
 */
export async function supabaseWithRetry<T>(
  queryFn: () => PromiseLike<PostgrestSingleResponse<T>>,
  label?: string,
  maxRetries?: number,
): Promise<PostgrestSingleResponse<T>>;
export async function supabaseWithRetry<T>(
  queryFn: () => PromiseLike<PostgrestResponse<T>>,
  label?: string,
  maxRetries?: number,
): Promise<PostgrestResponse<T>>;
export async function supabaseWithRetry<T>(
  queryFn: () => PromiseLike<PostgrestSingleResponse<T> | PostgrestResponse<T>>,
  label = 'query',
  maxRetries = DEFAULT_RETRIES,
): Promise<PostgrestSingleResponse<T> | PostgrestResponse<T>> {
  let lastResult: PostgrestSingleResponse<T> | PostgrestResponse<T>;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastResult = await queryFn();

    if (!lastResult.error || !isTransientSupabaseError(lastResult.error)) {
      return lastResult;
    }

    if (attempt < maxRetries) {
      const delay = INITIAL_DELAY_MS * Math.pow(2, attempt);
      logger.warn(
        `[Supabase] Transient error on ${label} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${lastResult.error.code ?? 'no-code'} — ${(lastResult.error.message || '').slice(0, 120)}`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  logger.error(
    `[Supabase] ${label} failed after ${maxRetries + 1} attempts: ${lastResult!.error?.code ?? 'no-code'} — ${(lastResult!.error?.message || '').slice(0, 200)}`
  );
  return lastResult!;
}
