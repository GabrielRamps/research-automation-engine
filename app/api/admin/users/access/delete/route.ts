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
      logger.warn('Non-admin attempted to delete user', { adminEmail });
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const body = (await request.json()) as { email?: string; confirm?: boolean };
    const targetEmail = body.email?.trim().toLowerCase();

    if (!targetEmail) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    // Require explicit confirmation to prevent accidental deletes
    if (!body.confirm) {
      return NextResponse.json({ error: 'Deletion requires confirm: true in request body.' }, { status: 400 });
    }

    // Prevent self-deletion
    if (targetEmail === adminEmail?.toLowerCase()) {
      return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
    }

    // Prevent deleting other admins (must revoke admin first)
    if (adminEmails?.includes(targetEmail)) {
      return NextResponse.json({
        error: 'Cannot delete an admin account. Revoke their admin access first via Manage Admins.'
      }, { status: 400 });
    }

    // Fetch the access record
    const { data: accessRow, error: fetchError } = await serviceSupabase
      .from('user_access')
      .select('id, email, user_id')
      .eq('email', targetEmail)
      .single();

    if (fetchError || !accessRow) {
      return NextResponse.json({ error: 'User not found in platform access records.' }, { status: 404 });
    }

    // Delete user_access row first
    const { error: deleteAccessError } = await serviceSupabase
      .from('user_access')
      .delete()
      .eq('email', targetEmail);

    if (deleteAccessError) {
      logger.error('Failed to delete user_access row', deleteAccessError, { targetEmail });
      throw new Error('Failed to delete user access record');
    }

    // Delete auth user if we have their ID
    if (accessRow.user_id) {
      const { error: deleteAuthError } = await serviceSupabase.auth.admin.deleteUser(accessRow.user_id);
      if (deleteAuthError) {
        // Log but don't fail — user_access is already gone, which blocks access
        logger.warn('Failed to delete auth user (access record already deleted)', {
          targetEmail,
          userId: accessRow.user_id,
          error: deleteAuthError.message,
        });
      }
    } else {
      // No user_id — try to find auth user by email
      const { data: authData } = await serviceSupabase.auth.admin.listUsers();
      const authUser = authData?.users?.find(u => u.email?.toLowerCase() === targetEmail);
      if (authUser) {
        const { error: deleteAuthError } = await serviceSupabase.auth.admin.deleteUser(authUser.id);
        if (deleteAuthError) {
          logger.warn('Failed to delete auth user by email lookup', {
            targetEmail,
            userId: authUser.id,
            error: deleteAuthError.message,
          });
        }
      }
    }

    logger.info('User permanently deleted', {
      action: 'delete_user',
      deletedBy: adminEmail,
      deletedById: adminId,
      targetEmail,
      targetUserId: accessRow.user_id,
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    });

    return NextResponse.json({ success: true, message: `User ${targetEmail} permanently deleted.` });

  } catch (error: any) {
    logger.error('Delete user error:', error);
    return NextResponse.json({ error: 'Failed to delete user', details: error.message }, { status: 500 });
  }
}
