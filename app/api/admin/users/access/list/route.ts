import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSRClient } from '@/lib/supabase-server';
import { logger } from '@/lib/secure-logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSSRClient();
    const { data: { user: verifiedUser }, error: sessionError } = await supabase.auth.getUser();
    // getUser() checks the login token with Supabase. (getSession() only reads the cookie and can be faked.)
    const session = verifiedUser ? { user: verifiedUser } : null;

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized. You must be logged in as an admin.' }, { status: 401 });
    }

    const userEmail = session.user.email;

    const { data: adminConfig } = await serviceSupabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'admin_emails')
      .single();

    const adminEmails = adminConfig?.config_value as string[];

    if (!adminEmails?.includes(userEmail || '')) {
      logger.warn('Non-admin attempted to list user access', { userEmail });
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    // Get all user_access rows (source of truth for platform users)
    const { data: accessRows, error: accessError } = await serviceSupabase
      .from('user_access')
      .select('id, user_id, email, status, highlevel_contact_id, created_at, activated_at')
      .order('created_at', { ascending: false });

    if (accessError) {
      logger.error('Failed to fetch user_access rows', accessError);
      throw new Error('Failed to retrieve user access records');
    }

    // Get auth users for last_sign_in_at
    const { data: authData, error: authError } = await serviceSupabase.auth.admin.listUsers();

    if (authError) {
      logger.error('Failed to list auth users', authError);
      throw new Error('Failed to retrieve auth users');
    }

    const authMap = new Map(authData.users.map(u => [u.id, u]));
    const authEmailMap = new Map(authData.users.map(u => [u.email?.toLowerCase(), u]));

    const users = (accessRows ?? []).map(row => {
      const authUser = (row.user_id ? authMap.get(row.user_id) : null)
        ?? authEmailMap.get(row.email?.toLowerCase());
      return {
        id: row.id,
        user_id: row.user_id,
        email: row.email,
        status: row.status as 'active' | 'suspended' | 'cancelled',
        highlevel_contact_id: row.highlevel_contact_id,
        created_at: row.created_at,
        activated_at: row.activated_at,
        last_sign_in_at: authUser?.last_sign_in_at ?? null,
        isAdmin: adminEmails?.includes(row.email),
      };
    });

    return NextResponse.json({ success: true, users, adminEmails });

  } catch (error: any) {
    logger.error('User access list error:', error);
    return NextResponse.json({ error: 'Failed to list users', details: error.message }, { status: 500 });
  }
}
