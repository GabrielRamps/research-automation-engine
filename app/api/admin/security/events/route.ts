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
      logger.warn('Unauthorized security events access attempt');
      return NextResponse.json(
        { error: 'Unauthorized. You must be logged in as an admin.' },
        { status: 401 }
      );
    }

    // Verify admin access
    if (!await isAdmin(user.email || '')) {
      logger.warn('Non-admin attempted to access security events', {
        userId: user.id,
        userEmail: user.email,
        ipAddress: logger.getIpFromHeaders(request.headers)
      });
      
      // Log security event (with rate limiting to prevent recursive logging)
      await logger.logSecurityEvent({
        eventType: 'unauthorized_admin_access',
        severity: 'high',
        userId: user.id,
        userEmail: user.email || undefined,
        ipAddress: logger.getIpFromHeaders(request.headers),
        userAgent: request.headers.get('user-agent') || undefined,
        routePath: '/api/admin/security/events',
        eventDetails: { resource: 'security_events', critical: true }
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
    const severity = searchParams.get('severity'); // low, medium, high, critical
    const eventType = searchParams.get('event_type');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 100); // Max 100 per page

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

    // Build query
    let query = serviceSupabase
      .from('security_events')
      .select('*', { count: 'exact' });

    // Apply filters
    if (dateFilterStart) {
      query = query.gte('created_at', dateFilterStart);
    }
    if (dateFilterEnd) {
      query = query.lte('created_at', dateFilterEnd);
    }
    if (severity) {
      query = query.eq('severity', severity);
    }
    if (eventType) {
      query = query.eq('event_type', eventType);
    }

    // Get total count
    const { count: totalCount } = await query;

    // Apply pagination and ordering
    const offset = (page - 1) * limit;
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: events, error: eventsError } = await query;

    if (eventsError) {
      logger.error('Error fetching security events:', eventsError);
      return NextResponse.json(
        { error: 'Failed to fetch security events' },
        { status: 500 }
      );
    }

    // Get event type summary
    let summaryQuery = serviceSupabase
      .from('security_events')
      .select('event_type, severity');

    if (dateFilterStart) {
      summaryQuery = summaryQuery.gte('created_at', dateFilterStart);
    }
    if (dateFilterEnd) {
      summaryQuery = summaryQuery.lte('created_at', dateFilterEnd);
    }

    const { data: allEvents } = await summaryQuery;

    // Calculate summary statistics
    const summary = {
      byType: {} as Record<string, number>,
      bySeverity: {} as Record<string, number>,
      total: totalCount || 0
    };

    if (allEvents) {
      allEvents.forEach((event: any) => {
        summary.byType[event.event_type] = (summary.byType[event.event_type] || 0) + 1;
        summary.bySeverity[event.severity] = (summary.bySeverity[event.severity] || 0) + 1;
      });
    }

    logger.info('Security events accessed', {
      accessedBy: user.email,
      period,
      filters: { severity, eventType },
      resultCount: events?.length || 0
    });

    return NextResponse.json({
      success: true,
      period,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      filters: {
        severity: severity || undefined,
        eventType: eventType || undefined
      },
      pagination: {
        page,
        limit,
        total: totalCount || 0,
        totalPages: Math.ceil((totalCount || 0) / limit)
      },
      summary,
      events: events || []
    });

  } catch (error) {
    logger.error('Error in security events endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
