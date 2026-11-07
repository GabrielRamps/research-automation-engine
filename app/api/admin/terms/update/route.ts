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
      logger.warn('Unauthorized terms update attempt');
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
      logger.warn('Non-admin attempted to update terms', { userId, userEmail });
      return NextResponse.json(
        { error: 'Forbidden. Admin access required.' },
        { status: 403 }
      );
    }

    const body = (await request.json()) as { content?: unknown };
    const { content } = body;
    
    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json(
        { error: 'Invalid terms content' },
        { status: 400 }
      );
    }

    // Get the current active terms to determine next version number
    const { data: currentTerms } = await serviceSupabase
      .from('terms_and_conditions')
      .select('version')
      .eq('is_active', true)
      .single();

    const nextVersion = currentTerms ? currentTerms.version + 1 : 1;

    // Deactivate all current terms
    await serviceSupabase
      .from('terms_and_conditions')
      .update({ is_active: false })
      .eq('is_active', true);

    // Insert new terms version
    const { data: newTerms, error: insertError } = await serviceSupabase
      .from('terms_and_conditions')
      .insert({
        version: nextVersion,
        content: content.trim(),
        is_active: true,
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      logger.error('Failed to create new terms version', insertError, {
        userId,
        nextVersion,
        errorCode: insertError.code
      });
      throw new Error('Failed to create new terms version');
    }

    logger.info('Terms & Conditions updated', {
      userId,
      userEmail,
      oldVersion: currentTerms?.version || 0,
      newVersion: nextVersion,
      termsId: newTerms.id
    });

    return NextResponse.json({
      success: true,
      message: 'Terms & Conditions updated successfully',
      version: nextVersion,
      id: newTerms.id
    });

  } catch (error: any) {
    logger.error('Terms update error:', error);
    return NextResponse.json(
      { error: 'Failed to update terms', details: error.message },
      { status: 500 }
    );
  }
}

