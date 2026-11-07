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

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user from session
    const supabase = await createSSRClient();
    const { data: { user: verifiedUser }, error: sessionError } = await supabase.auth.getUser();
    // getUser() checks the login token with Supabase. (getSession() only reads the cookie and can be faked.)
    const session = verifiedUser ? { user: verifiedUser } : null;
    
    if (sessionError || !session) {
      logger.warn('Unauthorized admin grant attempt');
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
      logger.warn('Non-admin attempted to grant admin access', { 
        userId, 
        userEmail,
        ipAddress: request.headers.get('x-forwarded-for')
      });
      return NextResponse.json(
        { error: 'Forbidden. Admin access required.' },
        { status: 403 }
      );
    }

    // Get and validate request body
    const body = (await request.json()) as { email?: string };
    const { email: targetEmail } = body;

    // Input validation
    if (!targetEmail || typeof targetEmail !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request. Email is required.' },
        { status: 400 }
      );
    }

    const trimmedEmail = targetEmail.trim().toLowerCase();

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return NextResponse.json(
        { error: 'Invalid email format.' },
        { status: 400 }
      );
    }

    // Check if email already has admin access
    if (adminEmails?.includes(trimmedEmail)) {
      return NextResponse.json(
        { error: 'User already has admin access.' },
        { status: 400 }
      );
    }

    // Verify the user exists in auth.users
    const { data: authData, error: authError } = await serviceSupabase.auth.admin.listUsers();
    
    if (authError) {
      logger.error('Failed to verify user existence', authError);
      throw new Error('Failed to verify user');
    }

    const targetUser = authData.users.find(u => u.email?.toLowerCase() === trimmedEmail);
    
    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found. Only existing platform users can be granted admin access.' },
        { status: 404 }
      );
    }

    // Add email to admin list
    const updatedAdminEmails = [...(adminEmails || []), trimmedEmail];

    const { error: updateError } = await serviceSupabase
      .from('admin_config')
      .update({
        config_value: updatedAdminEmails,
        updated_by: userId,
        updated_at: new Date().toISOString()
      })
      .eq('config_key', 'admin_emails');

    if (updateError) {
      logger.error('Failed to grant admin access', updateError, {
        grantedBy: userEmail,
        targetEmail: trimmedEmail
      });
      throw new Error('Failed to update admin configuration');
    }

    // Comprehensive audit logging
    logger.info('Admin access granted', {
      action: 'grant_admin',
      grantedBy: userEmail,
      grantedById: userId,
      grantedTo: trimmedEmail,
      grantedToId: targetUser.id,
      timestamp: new Date().toISOString(),
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
      totalAdmins: updatedAdminEmails.length
    });

    return NextResponse.json({
      success: true,
      message: `Admin access granted to ${trimmedEmail}`,
      email: trimmedEmail
    });

  } catch (error: any) {
    logger.error('Admin grant error:', error);
    return NextResponse.json(
      { error: 'Failed to grant admin access', details: error.message },
      { status: 500 }
    );
  }
}
