import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/secure-logger';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

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

// Helper to get authenticated user
async function getAuthenticatedUser(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        }
      }
    }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    return null;
  }

  return user;
}

// Helper to check if user is admin
async function isAdmin(email: string): Promise<boolean> {
  const { data: adminConfig } = await serviceSupabase
    .from('admin_config')
    .select('config_value')
    .eq('config_key', 'admin_emails')
    .single();

  const adminEmails = adminConfig?.config_value as string[];
  return adminEmails?.includes(email || '');
}

export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const user = await getAuthenticatedUser(request);
    
    if (!user) {
      logger.warn('Unauthorized analytics access attempt');
      return NextResponse.json(
        { error: 'Unauthorized. You must be logged in as an admin.' },
        { status: 401 }
      );
    }

    // Verify admin access
    if (!await isAdmin(user.email || '')) {
      logger.warn('Non-admin attempted to access research analytics', {
        userId: user.id,
        userEmail: user.email,
        ipAddress: logger.getIpFromHeaders(request.headers)
      });
      
      // Log security event
      await logger.logSecurityEvent({
        eventType: 'unauthorized_admin_access',
        severity: 'medium',
        userId: user.id,
        userEmail: user.email || undefined,
        ipAddress: logger.getIpFromHeaders(request.headers),
        userAgent: request.headers.get('user-agent') || undefined,
        routePath: '/api/admin/analytics/research',
        eventDetails: { resource: 'research_analytics' }
      });
      
      return NextResponse.json(
        { error: 'Forbidden. Admin access required.' },
        { status: 403 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '24h';
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    // Calculate date range
    const now = new Date();
    let dateFilterStart: string | undefined;
    let dateFilterEnd: string | undefined;
    
    if (period === 'custom' && startDate && endDate) {
      // Validate custom range (max 1 year)
      const start = new Date(startDate);
      const end = new Date(endDate);
      const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      
      if (daysDiff > 365) {
        return NextResponse.json(
          { error: 'Date range cannot exceed 1 year' },
          { status: 400 }
        );
      }
      
      dateFilterStart = start.toISOString();
      dateFilterEnd = end.toISOString();
    } else if (period !== 'all') {
      const hoursAgo = 
        period === '7d' ? 24 * 7 :
        period === '30d' ? 24 * 30 :
        24;
      
      const cutoff = new Date(now.getTime() - (hoursAgo * 60 * 60 * 1000));
      dateFilterStart = cutoff.toISOString();
    }

    // Query total research sessions
    let totalQuery = serviceSupabase
      .from('research_sessions')
      .select('*', { count: 'exact', head: true });

    if (dateFilterStart) {
      totalQuery = totalQuery.gte('created_at', dateFilterStart);
    }
    if (dateFilterEnd) {
      totalQuery = totalQuery.lte('created_at', dateFilterEnd);
    }

    const { count: totalResearch, error: totalError } = await totalQuery;

    if (totalError) {
      logger.error('Error fetching total research:', totalError);
    }

    // Query completed research
    let completedQuery = serviceSupabase
      .from('research_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed');

    if (dateFilterStart) {
      completedQuery = completedQuery.gte('created_at', dateFilterStart);
    }
    if (dateFilterEnd) {
      completedQuery = completedQuery.lte('created_at', dateFilterEnd);
    }

    const { count: completedResearch, error: completedError } = await completedQuery;

    if (completedError) {
      logger.error('Error fetching completed research:', completedError);
    }

    // Query failed research
    let failedQuery = serviceSupabase
      .from('research_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed');

    if (dateFilterStart) {
      failedQuery = failedQuery.gte('created_at', dateFilterStart);
    }
    if (dateFilterEnd) {
      failedQuery = failedQuery.lte('created_at', dateFilterEnd);
    }

    const { count: failedResearch, error: failedError } = await failedQuery;

    if (failedError) {
      logger.error('Error fetching failed research:', failedError);
    }

    // Query in-progress research
    let inProgressQuery = serviceSupabase
      .from('research_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'in_progress');

    if (dateFilterStart) {
      inProgressQuery = inProgressQuery.gte('created_at', dateFilterStart);
    }
    if (dateFilterEnd) {
      inProgressQuery = inProgressQuery.lte('created_at', dateFilterEnd);
    }

    const { count: inProgressResearch, error: inProgressError } = await inProgressQuery;

    if (inProgressError) {
      logger.error('Error fetching in-progress research:', inProgressError);
    }

    // Query cancelled research
    let cancelledQuery = serviceSupabase
      .from('research_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'cancelled');

    if (dateFilterStart) {
      cancelledQuery = cancelledQuery.gte('created_at', dateFilterStart);
    }
    if (dateFilterEnd) {
      cancelledQuery = cancelledQuery.lte('created_at', dateFilterEnd);
    }

    const { count: cancelledResearch, error: cancelledError } = await cancelledQuery;

    if (cancelledError) {
      logger.error('Error fetching cancelled research:', cancelledError);
    }

    // Calculate average completion time for completed research
    let avgTimeQuery = serviceSupabase
      .from('research_sessions')
      .select('total_generation_time')
      .eq('status', 'completed')
      .not('total_generation_time', 'is', null);

    if (dateFilterStart) {
      avgTimeQuery = avgTimeQuery.gte('created_at', dateFilterStart);
    }
    if (dateFilterEnd) {
      avgTimeQuery = avgTimeQuery.lte('created_at', dateFilterEnd);
    }

    const { data: timeData, error: timeError } = await avgTimeQuery;

    let averageCompletionTime = 0;
    if (!timeError && timeData && timeData.length > 0) {
      const totalTime = timeData.reduce((sum: number, item: any) => {
        return sum + (item.total_generation_time || 0);
      }, 0);
      averageCompletionTime = Math.round(totalTime / timeData.length);
    }

    logger.info('Research analytics accessed', {
      accessedBy: user.email,
      period
    });

    return NextResponse.json({
      success: true,
      period,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      data: {
        totalResearch: totalResearch || 0,
        completedResearch: completedResearch || 0,
        failedResearch: failedResearch || 0,
        inProgressResearch: inProgressResearch || 0,
        cancelledResearch: cancelledResearch || 0,
        averageCompletionTime // in milliseconds
      }
    });

  } catch (error) {
    logger.error('Error in research analytics endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
