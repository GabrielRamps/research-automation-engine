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
      logger.warn('Non-admin attempted to access user analytics', {
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
        routePath: '/api/admin/analytics/users',
        eventDetails: { resource: 'user_analytics' }
      });
      
      return NextResponse.json(
        { error: 'Forbidden. Admin access required.' },
        { status: 403 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '24h'; // 24h, 7d, 30d, all, custom
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    // Calculate date range
    let dateFilter = '';
    const now = new Date();
    
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
      
      dateFilter = `created_at >= '${start.toISOString()}' AND created_at <= '${end.toISOString()}'`;
    } else {
      // Preset periods
      let hoursAgo = 24; // default
      switch (period) {
        case '7d':
          hoursAgo = 24 * 7;
          break;
        case '30d':
          hoursAgo = 24 * 30;
          break;
        case 'all':
          hoursAgo = 0;
          break;
      }
      
      if (hoursAgo > 0) {
        const cutoff = new Date(now.getTime() - (hoursAgo * 60 * 60 * 1000));
        dateFilter = `created_at >= '${cutoff.toISOString()}'`;
      }
    }

    // Use Admin API to list users (proper way to access auth.users)
    const { data: allUsers, error: listError } = await serviceSupabase.auth.admin.listUsers();

    if (listError) {
      logger.error('Error fetching users:', listError);
      return NextResponse.json(
        { error: 'Failed to fetch user data' },
        { status: 500 }
      );
    }

    const users = allUsers?.users || [];
    
    // Calculate metrics based on the period
    let cutoffDate: Date | null = null;
    
    if (period === 'custom' && startDate && endDate) {
      cutoffDate = new Date(startDate);
    } else if (period !== 'all') {
      const hoursAgo = 
        period === '7d' ? 24 * 7 :
        period === '30d' ? 24 * 30 :
        24;
      cutoffDate = new Date(now.getTime() - (hoursAgo * 60 * 60 * 1000));
    }

    // Total users
    const totalUsers = users.length;

    // New users in period
    let newUsers = 0;
    if (period === 'all') {
      newUsers = totalUsers;
    } else if (cutoffDate) {
      newUsers = users.filter(u => {
        const createdAt = new Date(u.created_at);
        if (period === 'custom' && endDate) {
          return createdAt >= cutoffDate && createdAt <= new Date(endDate);
        }
        return createdAt >= cutoffDate;
      }).length;
    }

    // Active users (signed in during period)
    let activeUsers = 0;
    if (period === 'all') {
      activeUsers = users.filter(u => u.last_sign_in_at).length;
    } else if (cutoffDate) {
      activeUsers = users.filter(u => {
        if (!u.last_sign_in_at) return false;
        const lastSignIn = new Date(u.last_sign_in_at);
        if (period === 'custom' && endDate) {
          return lastSignIn >= cutoffDate && lastSignIn <= new Date(endDate);
        }
        return lastSignIn >= cutoffDate;
      }).length;
    }

    logger.info('User analytics accessed', {
      accessedBy: user.email,
      period
    });

    return NextResponse.json({
      success: true,
      period,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      data: {
        totalUsers: totalUsers || 0,
        newUsers: newUsers || 0,
        activeUsers: activeUsers || 0
      }
    });

  } catch (error) {
    logger.error('Error in user analytics endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
