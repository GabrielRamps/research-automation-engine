import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSRClient } from '@/lib/supabase-server';
import { logger } from '@/lib/secure-logger';

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
    // Get authenticated user from session
    const supabase = await createSSRClient();
    const { data: { user: verifiedUser }, error: sessionError } = await supabase.auth.getUser();
    // getUser() checks the login token with Supabase. (getSession() only reads the cookie and can be faked.)
    const session = verifiedUser ? { user: verifiedUser } : null;
    
    if (sessionError || !session) {
      logger.warn('Unauthorized user list access attempt');
      return NextResponse.json(
        { error: 'Unauthorized. You must be logged in as an admin.' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const userEmail = session.user.email;

    // Check if user is admin
    const { data: adminConfig } = await serviceSupabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'admin_emails')
      .single();

    const adminEmails = adminConfig?.config_value as string[];
    const isAdmin = adminEmails?.includes(userEmail || '');

    if (!isAdmin) {
      logger.warn('Non-admin attempted to list users', { userId, userEmail });
      return NextResponse.json(
        { error: 'Forbidden. Admin access required.' },
        { status: 403 }
      );
    }

    // Get all auth users using service role
    const { data: authData, error: authError } = await serviceSupabase.auth.admin.listUsers();

    if (authError) {
      logger.error('Failed to list auth users', authError);
      throw new Error('Failed to retrieve users');
    }

    // Map users with admin status
    const users = authData.users.map(user => ({
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
      isAdmin: adminEmails?.includes(user.email || '')
    }));

    // Sort: admins first, then by email
    users.sort((a, b) => {
      if (a.isAdmin && !b.isAdmin) return -1;
      if (!a.isAdmin && b.isAdmin) return 1;
      return (a.email || '').localeCompare(b.email || '');
    });

    logger.info('User list accessed', {
      accessedBy: userEmail,
      totalUsers: users.length,
      adminCount: users.filter(u => u.isAdmin).length
    });

    return NextResponse.json({
      success: true,
      users,
      adminEmails
    });

  } catch (error: any) {
    logger.error('User list error:', error);
    return NextResponse.json(
      { error: 'Failed to list users', details: error.message },
      { status: 500 }
    );
  }
}
