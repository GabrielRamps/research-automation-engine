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
      logger.warn('Non-admin attempted to resend magic link', { adminEmail });
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const body = (await request.json()) as { email?: string };
    const targetEmail = body.email?.trim().toLowerCase();

    if (!targetEmail) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    // Verify user exists in platform access
    const { data: accessRow, error: fetchError } = await serviceSupabase
      .from('user_access')
      .select('email, status')
      .eq('email', targetEmail)
      .single();

    if (fetchError || !accessRow) {
      return NextResponse.json({ error: 'User not found in platform access records.' }, { status: 404 });
    }

    if (accessRow.status !== 'active') {
      return NextResponse.json({
        error: `Cannot send magic link: user access is ${accessRow.status}. Restore access first.`
      }, { status: 400 });
    }

    const { data: linkData, error: linkError } = await serviceSupabase.auth.admin.generateLink({
      type: 'magiclink',
      email: targetEmail,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`
      }
    });

    if (linkError) {
      logger.error('Failed to generate magic link', linkError, { targetEmail });
      throw new Error('Failed to generate magic link');
    }

    const magicLink = linkData?.properties?.action_link;

    if (magicLink && resend) {
      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'Research Automation Engine <onboarding@resend.dev>',
        to: targetEmail,
        subject: 'Your Login Link - Research Automation Engine',
        html: `
          <h2>Welcome back!</h2>
          <p>Click the link below to access your Research Automation Engine dashboard:</p>
          <p><a href="${magicLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px;">Access Dashboard</a></p>
          <p>Or copy and paste this link into your browser:</p>
          <p>${magicLink}</p>
          <p><small>This link will expire in 1 hour.</small></p>
        `
      });
    } else if (!resend) {
      return NextResponse.json({ error: 'Email service not configured (RESEND_API_KEY missing).' }, { status: 500 });
    }

    logger.info('Magic link resent by admin', {
      action: 'admin_resend_link',
      sentBy: adminEmail,
      sentById: adminId,
      targetEmail,
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    });

    return NextResponse.json({ success: true, message: `Magic link sent to ${targetEmail}.` });

  } catch (error: any) {
    logger.error('Resend magic link error:', error);
    return NextResponse.json({ error: 'Failed to send magic link', details: error.message }, { status: 500 });
  }
}
