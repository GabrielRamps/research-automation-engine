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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSSRClient();
    const { data: { user: verifiedUser }, error: sessionError } = await supabase.auth.getUser();
    // getUser() checks the login token with Supabase. (getSession() only reads the cookie and can be faked.)
    const session = verifiedUser ? { user: verifiedUser } : null;

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized. You must be logged in as an admin.' }, { status: 401 });
    }

    const adminId = session.user.id;
    const adminEmail = session.user.email;

    const { data: adminConfig } = await serviceSupabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'admin_emails')
      .single();

    const adminEmails = adminConfig?.config_value as string[];

    if (!adminEmails?.includes(adminEmail || '')) {
      logger.warn('Non-admin attempted to restore user access', { adminEmail });
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const body = (await request.json()) as { email?: string };
    const targetEmail = body.email?.trim().toLowerCase();

    if (!targetEmail) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const { data: accessRow, error: fetchError } = await serviceSupabase
      .from('user_access')
      .select('id, email, status, user_id')
      .eq('email', targetEmail)
      .single();

    if (fetchError || !accessRow) {
      return NextResponse.json({ error: 'User not found in platform access records.' }, { status: 404 });
    }

    if (accessRow.status === 'active') {
      return NextResponse.json({ error: 'User access is already active.' }, { status: 400 });
    }

    const { error: updateError } = await serviceSupabase
      .from('user_access')
      .update({ status: 'active' })
      .eq('email', targetEmail);

    if (updateError) {
      logger.error('Failed to restore user access', updateError, { targetEmail });
      throw new Error('Failed to update user access status');
    }

    logger.info('User access restored', {
      action: 'restore_access',
      restoredBy: adminEmail,
      restoredById: adminId,
      targetEmail,
      targetUserId: accessRow.user_id,
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    });

    return NextResponse.json({ success: true, message: `Access restored for ${targetEmail}` });

  } catch (error: any) {
    logger.error('Restore access error:', error);
    return NextResponse.json({ error: 'Failed to restore access', details: error.message }, { status: 500 });
  }
}
