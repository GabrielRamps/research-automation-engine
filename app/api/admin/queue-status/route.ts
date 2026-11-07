import { NextRequest, NextResponse } from 'next/server';
import { researchQueue } from '@/lib/queue';
import { USE_QUEUE_SYSTEM } from '@/lib/feature-flags';
import { logger } from '@/lib/secure-logger';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSRClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Service role client for bypassing RLS
const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export async function GET(request: NextRequest) {
  try {
    // SECURITY FIX: Authenticate user first
    const supabase = await createSSRClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      logger.warn('Unauthorized queue status access attempt');
      return NextResponse.json(
        { error: 'Unauthorized. You must be logged in as an admin.' },
        { status: 401 }
      );
    }

    const userId = user.id;
    const userEmail = user.email;

    // SECURITY FIX: Verify user is admin
    const { data: adminConfig } = await serviceSupabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'admin_emails')
      .single();

    const adminEmails = adminConfig?.config_value as string[];
    const isAdmin = adminEmails?.includes(userEmail || '');

    if (!isAdmin) {
      logger.warn('Non-admin attempted to access queue status', {
        userId,
        userEmail,
        ipAddress: request.headers.get('x-forwarded-for')
      });
      return NextResponse.json(
        { error: 'Forbidden. Admin access required.' },
        { status: 403 }
      );
    }

    if (!USE_QUEUE_SYSTEM) {
      return NextResponse.json({
        enabled: false,
        message: 'Queue system is not enabled'
      });
    }

    const waiting = await researchQueue.getWaitingCount();
    const active = await researchQueue.getActiveCount();
    const completed = await researchQueue.getCompletedCount();
    const failed = await researchQueue.getFailedCount();

    logger.info('Queue status accessed', {
      accessedBy: userEmail,
      userId
    });

    return NextResponse.json({
      enabled: true,
      waiting,
      active,
      completed,
      failed,
      workers: process.env.WORKER_COUNT || 'unknown',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error('Queue status error:', error);
    return NextResponse.json(
      { error: 'Failed to get queue status', details: error.message },
      { status: 500 }
    );
  }
}

