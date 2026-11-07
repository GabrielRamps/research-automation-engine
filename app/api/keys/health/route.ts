import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decrypt, DecryptionError } from '@/lib/encryption';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { KeyHealthSnapshot, ProviderHealth, isHealthSnapshotFresh } from '@/lib/key-health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/**
 * Lightweight health check for the persistent dashboard banner.
 *
 * - No provider pings (fast, free)
 * - Tries to decrypt each saved key locally
 * - Returns the same KeyHealthSnapshot shape as /api/keys/verify, but the only
 *   non-healthy state it can return is `needs_reentry` (decrypt failed) or
 *   `missing` (no saved key)
 *
 * For full live verification (including balance + provider availability),
 * the form gate should call /api/keys/verify instead.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);
  if (!auth) return unauthorizedResponse();

  const { data: keys } = await supabase
    .from('user_api_keys')
    .select(
      'claude_api_key_encrypted, tavily_api_key_encrypted, dataforseo_login_encrypted, dataforseo_password_encrypted, health_status'
    )
    .eq('user_id', auth.userId)
    .single();

  // If verify has run recently and persisted a fresh snapshot, prefer that
  // fuller picture. Stale snapshots (e.g., flags written by an older worker
  // run, or by an admin SQL backfill) are ignored — they can lie about the
  // current state of keys the user has since re-saved.
  if (keys?.health_status && isHealthSnapshotFresh(keys.health_status)) {
    return NextResponse.json({ ok: true, health: keys.health_status, source: 'cached' });
  }

  const ts = new Date().toISOString();
  const probe = async (encrypted: string | null | undefined): Promise<ProviderHealth> => {
    if (!encrypted) return { status: 'missing', checked_at: ts };
    try {
      await decrypt(encrypted);
      return { status: 'healthy', checked_at: ts };
    } catch (err) {
      if (!(err instanceof DecryptionError)) {
        logger.warn('[/api/keys/health] unexpected decrypt error', err);
      }
      return {
        status: 'needs_reentry',
        reason: 'Your saved key cannot be read. Re-enter it.',
        checked_at: ts,
      };
    }
  };

  const [claude, tavily, dataforseoLogin, dataforseoPassword] = await Promise.all([
    probe(keys?.claude_api_key_encrypted),
    probe(keys?.tavily_api_key_encrypted),
    probe(keys?.dataforseo_login_encrypted),
    probe(keys?.dataforseo_password_encrypted),
  ]);

  // For DataForSEO, treat as broken if either half can't be read.
  const dataforseo: ProviderHealth =
    dataforseoLogin.status === 'missing' && dataforseoPassword.status === 'missing'
      ? { status: 'missing', checked_at: ts }
      : dataforseoLogin.status === 'needs_reentry' || dataforseoPassword.status === 'needs_reentry'
      ? {
          status: 'needs_reentry',
          reason: 'Your saved DataForSEO credentials cannot be read. Re-enter them.',
          checked_at: ts,
        }
      : { status: 'healthy', checked_at: ts };

  const health: KeyHealthSnapshot = { claude, tavily, dataforseo };
  return NextResponse.json({ ok: true, health, source: 'live' });
}
