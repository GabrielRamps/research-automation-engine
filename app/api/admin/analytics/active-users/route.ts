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
      logger.warn('Unauthorized active users access attempt');
      return NextResponse.json(
        { error: 'Unauthorized. You must be logged in as an admin.' },
        { status: 401 }
      );
    }

    // Verify admin access
    if (!await isAdmin(user.email || '')) {
      logger.warn('Non-admin attempted to access active users', {
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
        routePath: '/api/admin/analytics/active-users',
        eventDetails: { resource: 'active_users' }
      });
      
      return NextResponse.json(
        { error: 'Forbidden. Admin access required.' },
        { status: 403 }
      );
    }

    // Get active users (last activity within 15 minutes)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    // Use Admin API to list users
    const { data: allUsersData, error: activeError } = await serviceSupabase.auth.admin.listUsers();

    if (activeError) {
      logger.error('Error fetching active users:', activeError);
      return NextResponse.json(
        { error: 'Failed to fetch active users' },
        { status: 500 }
      );
    }

    const allUsers = allUsersData?.users || [];
    
    // Filter for users active in last 15 minutes
    const activeUsers = allUsers
      .filter(u => {
        if (!u.last_sign_in_at) return false;
        const lastSignIn = new Date(u.last_sign_in_at);
        return lastSignIn >= fifteenMinutesAgo;
      })
      .sort((a, b) => {
        const aTime = new Date(a.last_sign_in_at || 0).getTime();
        const bTime = new Date(b.last_sign_in_at || 0).getTime();
        return bTime - aTime; // descending order
      })
      .slice(0, 100) // Limit to 100
      .map(u => ({
        id: u.id,
        email: u.email,
        last_sign_in_at: u.last_sign_in_at
      }));

    // Calculate seconds since activity for each user
    const now = Date.now();
    const usersWithActivity = (activeUsers || []).map(u => ({
      id: u.id,
      email: u.email,
      lastSignInAt: u.last_sign_in_at,
      secondsSinceActivity: u.last_sign_in_at 
        ? Math.round((now - new Date(u.last_sign_in_at).getTime()) / 1000)
        : 0
    }));

    logger.info('Active users accessed', {
      accessedBy: user.email,
      activeUsersCount: usersWithActivity.length
    });

    return NextResponse.json({
      success: true,
      count: usersWithActivity.length,
      users: usersWithActivity,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error in active users endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
