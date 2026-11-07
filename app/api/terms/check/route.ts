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
      // For unauthenticated users, just return the active terms info
      const { data: activeTerms, error: termsError } = await serviceSupabase
        .from('terms_and_conditions')
        .select('id, version, created_at')
        .eq('is_active', true)
        .single();

      if (termsError || !activeTerms) {
        return NextResponse.json({
          success: true,
          activeVersion: null,
          userAcceptedVersion: null,
          needsAcceptance: false,
          isAuthenticated: false
        });
      }

      return NextResponse.json({
        success: true,
        activeVersion: activeTerms.version,
        userAcceptedVersion: null,
        needsAcceptance: false,
        isAuthenticated: false
      });
    }

    const userId = session.user.id;

    // Get the current active terms version
    const { data: activeTerms, error: termsError } = await serviceSupabase
      .from('terms_and_conditions')
      .select('id, version, created_at')
      .eq('is_active', true)
      .single();

    if (termsError) {
      logger.error('Failed to fetch active terms', termsError);
      throw new Error('Failed to fetch active terms');
    }

    if (!activeTerms) {
      // No active terms configured
      return NextResponse.json({
        success: true,
        activeVersion: null,
        userAcceptedVersion: null,
        needsAcceptance: false,
        isAuthenticated: true
      });
    }

    // Check if user has accepted the current version
    const { data: acceptance, error: acceptanceError } = await serviceSupabase
      .from('user_terms_acceptance')
      .select('terms_version, accepted_at')
      .eq('user_id', userId)
      .eq('terms_version', activeTerms.version)
      .single();

    if (acceptanceError && acceptanceError.code !== 'PGRST116') {
      // PGRST116 = no rows returned (user hasn't accepted)
      logger.error('Failed to check user acceptance', acceptanceError, { userId });
      throw new Error('Failed to check terms acceptance');
    }

    const hasAccepted = !!acceptance;
    const userAcceptedVersion = acceptance ? acceptance.terms_version : null;

    return NextResponse.json({
      success: true,
      activeVersion: activeTerms.version,
      userAcceptedVersion,
      needsAcceptance: !hasAccepted,
      isAuthenticated: true,
      acceptedAt: acceptance?.accepted_at || null
    });

  } catch (error: any) {
    logger.error('Terms check error:', error);
    return NextResponse.json(
      { error: 'Failed to check terms status', details: error.message },
      { status: 500 }
    );
  }
}

