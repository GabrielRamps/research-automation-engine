import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { logger } from '@/lib/secure-logger';
import { isUserAdmin } from '@/lib/admin-check';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Service-role client lets us read auth.users to get emails and bypass RLS
// for the cross-user admin view. Admin gating is enforced via isUserAdmin().
const serviceSupabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const STUCK_THRESHOLD_MINUTES = 30;
const RECENT_FAILURE_WINDOW_HOURS = 24;

// ============================================================
// GET — aggregated health view
// ============================================================

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { isAdmin, user } = await isUserAdmin(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  try {
    const stuckCutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    const failedCutoff = new Date(Date.now() - RECENT_FAILURE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    // Parallel queries against research_sessions
    const [stuckRes, failedRes, pausedRes, brokenKeysRes] = await Promise.all([
      // 1. Stuck: in_progress for too long
      serviceSupabase
        .from('research_sessions')
        .select(
          'id, user_id, business_name, tier, current_phase, status, error_log, error_type, created_at'
        )
        .eq('status', 'in_progress')
        .lt('created_at', stuckCutoff)
        .order('created_at', { ascending: false })
        .limit(100),

      // 2. Recently failed
      serviceSupabase
        .from('research_sessions')
        .select(
          'id, user_id, business_name, tier, current_phase, status, error_log, error_type, balance_errors, created_at, completed_at'
        )
        .eq('status', 'failed')
        .gte('created_at', failedCutoff)
        .order('created_at', { ascending: false })
        .limit(100),

      // 3. Paused (balance error — user can fix and resume)
      serviceSupabase
        .from('research_sessions')
        .select(
          'id, user_id, business_name, tier, current_phase, status, balance_errors, error_log, error_type, created_at'
        )
        .eq('status', 'paused')
        .order('created_at', { ascending: false })
        .limit(100),

      // 4. Users with broken keys (from health_status snapshot)
      serviceSupabase
        .from('user_api_keys')
        .select('user_id, health_status, updated_at')
        .not('health_status', 'is', null),
    ]);

    if (stuckRes.error) throw stuckRes.error;
    if (failedRes.error) throw failedRes.error;
    if (pausedRes.error) throw pausedRes.error;
    if (brokenKeysRes.error) throw brokenKeysRes.error;

    // Resolve user emails for every distinct userId we'll show
    const userIds = new Set<string>();
    for (const row of stuckRes.data ?? []) userIds.add(row.user_id);
    for (const row of failedRes.data ?? []) userIds.add(row.user_id);
    for (const row of pausedRes.data ?? []) userIds.add(row.user_id);
    for (const row of brokenKeysRes.data ?? []) userIds.add(row.user_id);

    const emailMap = await resolveEmails(Array.from(userIds));

    // Filter health_status rows to ones that actually have a `needs_reentry`.
    // (The column may have a healthy snapshot from /api/keys/verify too — those
    // shouldn't show up as a problem.)
    const brokenKeyRows = (brokenKeysRes.data ?? [])
      .map((row) => {
        const broken = extractBrokenProviders(row.health_status);
        return broken.length > 0
          ? {
              user_id: row.user_id,
              email: emailMap.get(row.user_id) ?? null,
              providers_broken: broken,
              updated_at: row.updated_at,
            }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const decorate = <T extends { user_id: string; created_at: string }>(rows: T[]) =>
      rows.map((r) => ({
        ...r,
        email: emailMap.get(r.user_id) ?? null,
        minutes_running: Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000),
      }));

    const stuck = decorate(stuckRes.data ?? []);
    const failed = decorate(failedRes.data ?? []);
    const paused = decorate(pausedRes.data ?? []);

    return NextResponse.json({
      ok: true,
      generated_at: new Date().toISOString(),
      stuck,
      failed,
      paused,
      broken_keys: brokenKeyRows,
      summary: {
        stuck: stuck.length,
        failed_recent: failed.length,
        paused: paused.length,
        broken_keys: brokenKeyRows.length,
      },
    });
  } catch (err: any) {
    logger.error('[/api/admin/sessions/health GET] error', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to load session health', details: err?.message },
      { status: 500 }
    );
  }
}

// ============================================================
// POST — admin actions
// ============================================================

interface ActionBody {
  action:
    | 'mark_failed'
    | 'cancel'
    | 'clear_health_status';
  sessionId?: string;
  userId?: string;
  reason?: string;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { isAdmin, user } = await isUserAdmin(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    if (body.action === 'mark_failed') {
      if (!body.sessionId) {
        return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
      }
      // Append an error_log entry so the timeline is honest about the manual step
      const { data: existing } = await serviceSupabase
        .from('research_sessions')
        .select('error_log, current_phase')
        .eq('id', body.sessionId)
        .single();
      const errorLog = (existing?.error_log as any[]) ?? [];
      errorLog.push({
        phase: existing?.current_phase ?? 0,
        error: body.reason ?? 'Marked failed by admin',
        error_type: 'admin_marked_failed',
        timestamp: new Date().toISOString(),
      });
      const { error } = await serviceSupabase
        .from('research_sessions')
        .update({
          status: 'failed',
          error_type: 'admin_marked_failed',
          error_log: errorLog,
        })
        .eq('id', body.sessionId);
      if (error) throw error;
      logger.info(`[admin/sessions/health] Session ${body.sessionId} manually marked failed by ${user.email}`);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'cancel') {
      if (!body.sessionId) {
        return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
      }
      const { error } = await serviceSupabase
        .from('research_sessions')
        .update({ status: 'cancelled' })
        .eq('id', body.sessionId);
      if (error) throw error;
      logger.info(`[admin/sessions/health] Session ${body.sessionId} cancelled by ${user.email}`);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'clear_health_status') {
      if (!body.userId) {
        return NextResponse.json({ error: 'userId required' }, { status: 400 });
      }
      const { error } = await serviceSupabase
        .from('user_api_keys')
        .update({ health_status: null })
        .eq('user_id', body.userId);
      if (error) throw error;
      logger.info(`[admin/sessions/health] Cleared health_status for user ${body.userId} by ${user.email}`);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    logger.error('[/api/admin/sessions/health POST] action failed', err);
    return NextResponse.json(
      { ok: false, error: 'Action failed', details: err?.message },
      { status: 500 }
    );
  }
}

// ============================================================
// Helpers
// ============================================================

async function resolveEmails(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  // listUsers paginates — for an admin observability page over likely <1000 users
  // a single page call (perPage=1000) is fine. Adjust if you grow past that.
  const { data, error } = await serviceSupabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) {
    logger.warn('[admin/sessions/health] auth.admin.listUsers failed', error);
    return map;
  }
  const lookup = new Set(userIds);
  for (const u of data.users ?? []) {
    if (u.id && u.email && lookup.has(u.id)) map.set(u.id, u.email);
  }
  return map;
}

function extractBrokenProviders(healthStatus: unknown): string[] {
  if (!healthStatus || typeof healthStatus !== 'object') return [];
  const s = healthStatus as Record<string, { status?: string }>;
  const broken: string[] = [];
  for (const provider of ['claude', 'tavily', 'dataforseo']) {
    if (s[provider]?.status === 'needs_reentry') broken.push(provider);
  }
  return broken;
}
