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

/**
 * Extract IP address from request headers
 */
function getIpAddress(request: NextRequest): string | null {
  // Check various headers that might contain the real IP
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  
  return null;
}

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user (using getUser() for security - validates with auth server)
    const supabase = await createSSRClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      logger.warn('Unauthorized terms acceptance attempt - no valid user', {
        error: userError?.message
      });
      return NextResponse.json(
        { error: 'Unauthorized. You must be logged in to accept terms.' },
        { status: 401 }
      );
    }

    const userId = user.id;
    
    // Additional safety check: verify user exists in auth.users
    const { data: authUser, error: authCheckError } = await serviceSupabase.auth.admin.getUserById(userId);
    
    if (authCheckError || !authUser) {
      logger.error('User has session but does not exist in auth.users', {
        userId,
        userEmail: user.email,
        error: authCheckError?.message
      });
      return NextResponse.json(
        { error: 'Account error. Please log out and log in again.' },
        { status: 400 }
      );
    }
    const body = (await request.json()) as { version?: number; userAgent?: string };
    const { version, userAgent } = body;
    
    if (!version || typeof version !== 'number') {
      return NextResponse.json(
        { error: 'Invalid terms version' },
        { status: 400 }
      );
    }

    // Verify that the version exists and is active
    const { data: termsData, error: termsError } = await serviceSupabase
      .from('terms_and_conditions')
      .select('version')
      .eq('version', version)
      .eq('is_active', true)
      .single();

    if (termsError || !termsData) {
      logger.warn('Attempt to accept invalid or inactive terms version', { version, userId });
      return NextResponse.json(
        { error: 'Invalid or inactive terms version' },
        { status: 400 }
      );
    }

    // Get IP address
    const ipAddress = getIpAddress(request);

    // Insert acceptance record using service role (bypasses RLS)
    const { data, error } = await serviceSupabase
      .from('user_terms_acceptance')
      .insert({
        user_id: userId,
        terms_version: version,
        ip_address: ipAddress,
        user_agent: userAgent || null,
        accepted_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      // Check if already accepted (unique constraint violation)
      if (error.code === '23505') {
        logger.info('User attempted to re-accept already accepted terms', { userId, version });
        return NextResponse.json({
          success: true,
          message: 'Terms already accepted',
          data: { version }
        });
      }

      // Enhanced error logging with full details
      logger.error('Failed to record terms acceptance', error, {
        userId,
        version,
        errorCode: error.code,
        errorMessage: error.message,
        errorDetails: error.details,
        errorHint: error.hint,
        fullError: JSON.stringify(error)
      });
      
      // Return detailed error for debugging
      throw new Error(`Failed to record terms acceptance: ${error.message || 'Unknown error'} (code: ${error.code || 'none'})`);
    }

    logger.info('Terms accepted successfully', {
      userId,
      version,
      acceptanceId: data.id
    });

    return NextResponse.json({
      success: true,
      message: 'Terms accepted successfully',
      data: {
        id: data.id,
        version: data.terms_version,
        accepted_at: data.accepted_at
      }
    });

  } catch (error: any) {
    logger.error('Terms acceptance error:', error);
    return NextResponse.json(
      { error: 'Failed to accept terms', details: error.message },
      { status: 500 }
    );
  }
}

