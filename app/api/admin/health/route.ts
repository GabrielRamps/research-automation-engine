import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/secure-logger';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getQueueStats } from '@/lib/queue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

async function getAuthenticatedUser(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

async function isAdmin(email: string): Promise<boolean> {
  const { data: adminConfig } = await serviceSupabase
    .from('admin_config')
    .select('config_value')
    .eq('config_key', 'admin_emails')
    .single();

  const adminEmails = (adminConfig?.config_value as string[]) ?? [];
  return adminEmails.includes(email || '');
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized. You must be logged in as an admin.' },
        { status: 401 }
      );
    }

    if (!(await isAdmin(user.email || ''))) {
      await logger.logSecurityEvent({
        eventType: 'unauthorized_admin_access',
        severity: 'medium',
        userId: user.id,
        userEmail: user.email || undefined,
        ipAddress: logger.getIpFromHeaders(request.headers),
        userAgent: request.headers.get('user-agent') || undefined,
        routePath: '/api/admin/health',
        eventDetails: { resource: 'health' },
      });
      return NextResponse.json(
        { error: 'Forbidden. Admin access required.' },
        { status: 403 }
      );
    }

    const timestamp = new Date().toISOString();

    // Queue stats (Redis + BullMQ)
    let queue: { waiting: number; active: number; completed: number; failed: number } | { error: string };
    try {
      queue = await getQueueStats();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error('[Health] Queue stats failed:', { error: message });
      queue = { error: 'unavailable', waiting: 0, active: 0, completed: 0, failed: 0 };
    }

    // Database connectivity + session counts
    let database: {
      status: 'connected' | 'error';
      activeSessionCount?: number;
      pendingSessionCount?: number;
      pausedSessionCount?: number;
      error?: string;
    };
    try {
      const [countInProgress, countPending, countPaused] = await Promise.all([
        serviceSupabase.from('research_sessions').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
        serviceSupabase.from('research_sessions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        serviceSupabase.from('research_sessions').select('id', { count: 'exact', head: true }).eq('status', 'paused'),
      ]);

      database = {
        status: 'connected',
        activeSessionCount: countInProgress.count ?? 0,
        pendingSessionCount: countPending.count ?? 0,
        pausedSessionCount: countPaused.count ?? 0,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error('[Health] Database check failed:', { error: message });
      database = { status: 'error', error: message };
    }

    const queueOk = !('error' in queue && queue.error === 'unavailable');
    const dbOk = database.status === 'connected';
    const waiting = 'error' in queue ? 0 : queue.waiting;
    const failed = 'error' in queue ? 0 : queue.failed;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (!queueOk || !dbOk) status = 'unhealthy';
    else if (waiting >= 25 || failed > 0) status = 'unhealthy';
    else if (waiting >= 10) status = 'degraded';

    return NextResponse.json({
      status,
      queue: 'error' in queue ? { error: queue.error, waiting: 0, active: 0, completed: 0, failed: 0 } : queue,
      database,
      timestamp,
    });
  } catch (error: unknown) {
    logger.error('[Health] Unexpected error:', error);
    return NextResponse.json(
      { status: 'unhealthy', error: 'Health check failed', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
