import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSRClient } from '@/lib/supabase-server';
import { Resend } from 'resend';
import { logger } from '@/lib/secure-logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

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
      logger.warn('Non-admin attempted to create user', { adminEmail });
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const body = (await request.json()) as { email?: string; name?: string };
    const rawEmail = body.email?.trim().toLowerCase();
    const name = body.name?.trim() || undefined;

    if (!rawEmail) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(rawEmail)) {
      return NextResponse.json({ error: 'Invalid email format.' }, { status: 400 });
    }

    // Check if user already has access
    const { data: existingAccess } = await serviceSupabase
      .from('user_access')
      .select('email, status')
      .eq('email', rawEmail)
      .single();

    if (existingAccess) {
      return NextResponse.json({
        error: `A user with this email already exists (status: ${existingAccess.status}). Use "Send Magic Link" to resend access.`
      }, { status: 409 });
    }

    // Create auth user (pre-confirmed, same as provision flow)
    let authUserId: string | null = null;

    const { data: userData, error: userError } = await serviceSupabase.auth.admin.createUser({
      email: rawEmail,
      email_confirm: true,
      user_metadata: {
        source: 'admin_created',
        createdByAdmin: adminEmail,
        name,
      }
    });

    if (userError) {
      if (userError.message.includes('already registered')) {
        // Auth user exists but no user_access row — find their ID and proceed
        const { data: authData } = await serviceSupabase.auth.admin.listUsers();
        const existingUser = authData?.users?.find(u => u.email?.toLowerCase() === rawEmail);
        if (existingUser) {
          authUserId = existingUser.id;
        } else {
          throw new Error('Auth user exists but could not be located');
        }
      } else {
        logger.error('Failed to create auth user', userError, { targetEmail: rawEmail });
        throw new Error(`Failed to create user: ${userError.message}`);
      }
    } else {
      authUserId = userData?.user?.id ?? null;
    }

    if (!authUserId) {
      throw new Error('Could not determine auth user ID');
    }

    // Create user_access record
    const { error: accessError } = await serviceSupabase
      .from('user_access')
      .insert({
        email: rawEmail,
        user_id: authUserId,
        status: 'active',
      });

    if (accessError) {
      logger.error('Failed to create user_access record', accessError, { targetEmail: rawEmail });
      // Clean up the auth user we just created to avoid orphans
      await serviceSupabase.auth.admin.deleteUser(authUserId).catch(() => {});
      throw new Error('Failed to create access record');
    }

    // Generate and send magic link
    const { data: linkData, error: linkError } = await serviceSupabase.auth.admin.generateLink({
      type: 'magiclink',
      email: rawEmail,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`
      }
    });

    if (linkError) {
      // User and access record are created — just warn, don't fail
      logger.warn('User created but magic link generation failed', { targetEmail: rawEmail, error: linkError.message });
    }

    const magicLink = linkData?.properties?.action_link;
    if (magicLink && resend) {
      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'Research Automation Engine <onboarding@resend.dev>',
        to: rawEmail,
        subject: 'Welcome to Research Automation Engine!',
        html: `
          <h2>Welcome${name ? `, ${name}` : ''}!</h2>
          <p>Your Research Automation Engine account is ready. Click the link below to get started:</p>
          <p><a href="${magicLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px;">Access Your Dashboard</a></p>
          <p>Or copy and paste this link into your browser:</p>
          <p>${magicLink}</p>
          <p><small>This link will expire in 1 hour.</small></p>
          <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;">
          <p style="color: #6b7280; font-size: 14px;">Need help? Reply to this email or contact support.</p>
        `
      });
    }

    logger.info('User created by admin', {
      action: 'admin_create_user',
      createdBy: adminEmail,
      createdById: adminId,
      targetEmail: rawEmail,
      targetUserId: authUserId,
      magicLinkSent: !!(magicLink && resend),
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    });

    return NextResponse.json({
      success: true,
      message: `User created${magicLink && resend ? ' and magic link sent' : ' (magic link not sent — check Resend config)'}.`,
      email: rawEmail,
    });

  } catch (error: any) {
    logger.error('Admin create user error:', error);
    return NextResponse.json({ error: 'Failed to create user', details: error.message }, { status: 500 });
  }
}
