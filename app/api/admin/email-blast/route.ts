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

const BATCH_SIZE = 50;

function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .split(/\n\n+/)
    .map(para => `<p style="color: #374151; line-height: 1.6; margin: 0 0 16px 0;">${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function buildEmailHtml(subject: string, body: string, adminEmail: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${plainTextToHtml(body)}
      <hr style="margin: 32px 0; border: none; border-top: 1px solid #e5e7eb;">
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">
        Sent by Research Automation Engine admin. Questions? Reply to this email or contact ${adminEmail}.
      </p>
    </div>
  `;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSSRClient();
    const { data: { user: verifiedUser }, error: sessionError } = await supabase.auth.getUser();
    // getUser() checks the login token with Supabase. (getSession() only reads the cookie and can be faked.)
    const session = verifiedUser ? { user: verifiedUser } : null;

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const adminId = session.user.id;
    const adminEmail = session.user.email || '';

    const { data: adminConfig } = await serviceSupabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'admin_emails')
      .single();

    const adminEmails = adminConfig?.config_value as string[];
    if (!adminEmails?.includes(adminEmail)) {
      logger.warn('Non-admin attempted email blast', { adminEmail });
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    if (!resend) {
      return NextResponse.json({ error: 'Resend is not configured (missing RESEND_API_KEY).' }, { status: 503 });
    }

    const body = await request.json() as {
      subject?: string;
      htmlBody?: string;
      body?: string;
      recipients: 'all_active' | 'all' | string[];
    };

    const { subject, recipients } = body;
    const messageBody = (body.body ?? body.htmlBody ?? '').trim();

    if (!subject?.trim()) {
      return NextResponse.json({ error: 'Subject is required.' }, { status: 400 });
    }
    if (!messageBody) {
      return NextResponse.json({ error: 'Email body is required.' }, { status: 400 });
    }
    if (!recipients) {
      return NextResponse.json({ error: 'Recipients selection is required.' }, { status: 400 });
    }

    // Resolve recipient email list
    let targetEmails: string[] = [];

    if (recipients === 'all_active' || recipients === 'all') {
      let query = serviceSupabase
        .from('user_access')
        .select('email, status');

      if (recipients === 'all_active') {
        query = query.eq('status', 'active');
      }

      const { data: users, error: usersError } = await query;
      if (usersError) throw new Error('Failed to fetch users: ' + usersError.message);

      targetEmails = (users ?? []).map(u => u.email).filter(Boolean);
    } else if (Array.isArray(recipients)) {
      targetEmails = recipients.filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    }

    if (targetEmails.length === 0) {
      return NextResponse.json({ error: 'No valid recipients found.' }, { status: 400 });
    }

    const htmlContent = buildEmailHtml(subject, messageBody, adminEmail);
    const from = process.env.EMAIL_FROM || 'Research Automation Engine <onboarding@resend.dev>';

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    // Send in batches
    for (let i = 0; i < targetEmails.length; i += BATCH_SIZE) {
      const chunk = targetEmails.slice(i, i + BATCH_SIZE);
      const messages = chunk.map(to => ({
        from,
        to,
        subject: subject.trim(),
        html: htmlContent,
      }));

      try {
        const result = await resend.batch.send(messages);
        if (result.error) {
          failed += chunk.length;
          errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.error.message}`);
        } else {
          sent += chunk.length;
        }
      } catch (batchErr: any) {
        failed += chunk.length;
        errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchErr.message}`);
      }
    }

    logger.info('Admin email blast sent', {
      action: 'admin_email_blast',
      adminEmail,
      adminId,
      subject: subject.trim(),
      recipientMode: Array.isArray(recipients) ? 'selected' : recipients,
      total: targetEmails.length,
      sent,
      failed,
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    });

    return NextResponse.json({
      success: true,
      total: targetEmails.length,
      sent,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error: any) {
    logger.error('Admin email blast error:', error);
    return NextResponse.json({ error: 'Failed to send emails', details: error.message }, { status: 500 });
  }
}
