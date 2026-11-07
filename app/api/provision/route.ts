import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { logger } from '@/lib/secure-logger';
import { handleApiError, handleDatabaseError } from '@/lib/error-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function POST(request: NextRequest) {
  try {
    // SECURITY FIX: Verify webhook secret is configured (required, not optional)
    if (!process.env.HIGHLEVEL_WEBHOOK_SECRET) {
      logger.error('CRITICAL: HIGHLEVEL_WEBHOOK_SECRET not configured!');
      return NextResponse.json(
        { error: 'Server misconfiguration' },
        { status: 500 }
      );
    }

    // 1. Verify request authorization (required)
    const authHeader = request.headers.get('authorization');
    const expectedAuth = `Bearer ${process.env.HIGHLEVEL_WEBHOOK_SECRET}`;

    if (authHeader !== expectedAuth) {
      logger.warn('Unauthorized provision attempt', {
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
        hasAuth: !!authHeader
      });
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // 2. Get data from HighLevel
    const body = (await request.json()) as { email?: string; contactId?: string; name?: string };
    const { email, contactId, name } = body;
    
    if (!email) {
      return NextResponse.json(
        { error: 'Email required' }, 
        { status: 400 }
      );
    }
    
    // 3. Check if user already exists
    const { data: existingAccess } = await supabase
      .from('user_access')
      .select('*')
      .eq('email', email)
      .single();
    
    if (existingAccess) {
      // User already has access, just send new magic link
      const { data: linkData, error } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
          redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`
        }
      });
      
      if (error) {
        logger.error('Error generating magic link:', error);
        throw error;
      }
      
      // Send email via Resend
      const magicLink = linkData?.properties?.action_link;
      if (magicLink && resend) {
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'Research Automation Engine <onboarding@resend.dev>',
          to: email,
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
      }
      
      return NextResponse.json({
        success: true,
        message: 'Magic link sent (existing user)',
        email
      });
    }
    
    // 4. Create auth user first (if doesn't exist) for longer-lived magic links
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        source: 'highlevel',
        contactId,
        name
      }
    });
    
    // Handle user creation errors
    let authUserId: string | null = null;
    
    if (userError) {
      if (userError.message.includes('already registered')) {
        // Auth user exists but user_access row was deleted (e.g. refund + repurchase).
        // listUsers() is paginated — scan all pages to find the user by email.
        logger.info('User already registered, fetching existing user ID');
        let page = 1;
        let foundUser: { id: string } | undefined;
        while (!foundUser) {
          const { data: pageData, error: fetchError } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
          if (fetchError) {
            logger.error('Error fetching existing user:', fetchError);
            throw new Error('User already exists but could not fetch user ID');
          }
          foundUser = pageData?.users?.find(u => u.email === email);
          if (!pageData?.users?.length || pageData.users.length < 1000) break;
          page++;
        }
        if (foundUser) {
          authUserId = foundUser.id;
        } else {
          throw new Error('User already exists but could not be found');
        }
      } else {
        // Real error, don't continue
        logger.error('Error creating user:', userError);
        throw new Error(`Failed to create auth user: ${userError.message}`);
      }
    } else {
      // New user created successfully
      authUserId = userData?.user?.id || null;
    }
    
    if (!authUserId) {
      throw new Error('Could not determine auth user ID');
    }
    
    // 5. Create user access entry WITH user_id
    const { error: accessError } = await supabase
      .from('user_access')
      .insert({
        email,
        user_id: authUserId,
        highlevel_contact_id: contactId,
        status: 'active'
      });
    
    if (accessError) {
      logger.error('Error creating access:', accessError);
      throw accessError;
    }
    
    logger.info(`✅ User provisioned: ${email} with user_id: ${authUserId}`);
    
    // 6. Generate and send magic link
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`
      }
    });
    
    if (linkError) {
      logger.error('Error generating magic link:', linkError);
      throw linkError;
    }
    
    // 7. Send email via Resend
    const magicLink = linkData?.properties?.action_link;
    if (magicLink && resend) {
      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'Research Automation Engine <onboarding@resend.dev>',
        to: email,
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
    
    // 7. Return success (NEVER return magicLink for security)
    return NextResponse.json({
      success: true,
      message: 'User provisioned and magic link sent',
      email
    });
    
  } catch (error: any) {
    // SECURITY FIX: Sanitized error - don't expose internal provisioning details
    return handleApiError(error, 'Provision user', 500);
  }
}

// GET endpoint for testing
export async function GET() {
  return NextResponse.json({
    message: 'Provision endpoint is active',
    instructions: 'Send POST request with { "email": "user@example.com", "contactId": "optional_id" }'
  });
}

