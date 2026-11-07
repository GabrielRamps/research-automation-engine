import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/secure-logger';
import { createClient as createServiceClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Validate redirect URL to prevent open redirect vulnerabilities
 */
function validateRedirectUrl(redirectPath: string | null): string | null {
  if (!redirectPath) {
    return null;
  }

  try {
    // Must not contain protocol or domain (prevent absolute URLs)
    if (redirectPath.includes('://') || redirectPath.startsWith('//')) {
      logger.warn('Auth callback: Invalid redirect - contains protocol', { redirectPath });
      return null;
    }

    // Must start with / (relative path)
    if (!redirectPath.startsWith('/')) {
      logger.warn('Auth callback: Invalid redirect - not relative path', { redirectPath });
      return null;
    }

    // Whitelist allowed paths (security measure)
    const allowedPrefixes = ['/results/', '/dashboard', '/generate'];
    const isAllowed = allowedPrefixes.some(prefix => redirectPath.startsWith(prefix));
    
    if (!isAllowed) {
      logger.warn('Auth callback: Invalid redirect - not in whitelist', { redirectPath });
      return null;
    }

    return redirectPath;
  } catch (error) {
    logger.error('Auth callback: Error validating redirect URL', error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const token = requestUrl.searchParams.get('token');
  const type = requestUrl.searchParams.get('type');
  const redirectParam = requestUrl.searchParams.get('redirect');
  const origin = requestUrl.origin;

  // Validate and use redirect parameter if provided, otherwise default to dashboard
  const validatedRedirect = validateRedirectUrl(redirectParam);
  const redirectUrl = validatedRedirect ? `${origin}${validatedRedirect}` : `${origin}/dashboard`;

  logger.info('Auth callback: Processing request', {
    hasCode: !!code,
    hasToken: !!token,
    type,
    redirectParam,
    validatedRedirect,
    finalRedirectUrl: redirectUrl
  });

  // Create response object first so we can set cookies
  let response = NextResponse.redirect(redirectUrl);

  // Create Supabase client with proper cookie handling for the response
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // Set cookie in both request and response
          request.cookies.set({
            name,
            value,
            ...options,
          });
          response = NextResponse.redirect(redirectUrl);
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          // Remove cookie from both request and response
          request.cookies.set({
            name,
            value: '',
            ...options,
          });
          response = NextResponse.redirect(redirectUrl);
          response.cookies.set({
            name,
            value: '',
            ...options,
          });
        },
      },
    }
  );

  let session = null;
  let error = null;

  // Handle OAuth code (PKCE flow)
  if (code) {
    const { data, error: codeError } = await supabase.auth.exchangeCodeForSession(code);
    session = data?.session;
    error = codeError;
    
    if (!codeError && session) {
      logger.info('Auth callback: code exchange successful', {
        userId: session.user.id,
        email: session.user.email
      });
    }
  }
  // Handle magic link token
  else if (token && (type === 'magiclink' || type === 'signup' || type === 'email')) {
    const { data, error: otpError } = await supabase.auth.verifyOtp({
      token_hash: token,
      type: type === 'signup' ? 'signup' : 'magiclink'
    });
    session = data?.session;
    error = otpError;
    
    if (!otpError && session) {
      logger.info('Auth callback: OTP verification successful', {
        userId: session.user.id,
        email: session.user.email
      });
    }
  }
  else {
    logger.warn('Auth callback: no valid auth parameters', {
      hasCode: !!code,
      hasToken: !!token,
      type
    });
    return NextResponse.redirect(`${origin}/?error=${encodeURIComponent('Invalid authentication link.')}`);
  }

  // If authentication failed, redirect to error page
  if (error) {
    logger.error('Auth callback error:', error);
    return NextResponse.redirect(`${origin}/?error=${encodeURIComponent('Authentication failed. Please request a new magic link.')}`);
  }

  // Ensure we have a session
  if (!session) {
    logger.error('Auth callback: no session created');
    return NextResponse.redirect(`${origin}/?error=${encodeURIComponent('Failed to create session. Please try again.')}`);
  }

  logger.info('Auth callback: Session created successfully', {
    userId: session.user.id,
    email: session.user.email,
    hasAccessToken: !!session.access_token,
    hasRefreshToken: !!session.refresh_token
  });

  // CRITICAL: Call getSession() to ensure cookies are set in the response
  // This triggers the cookie.set() handlers which write to the response object
  await supabase.auth.getSession();

  // Update user_access table with user_id if authentication succeeded
  const email = session.user.email;
  if (email) {
    try {
      // Use service role client for user_access update (bypasses RLS)
      const serviceSupabase = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      );

      await serviceSupabase
        .from('user_access')
        .update({
          user_id: session.user.id,
          activated_at: new Date().toISOString()
        })
        .eq('email', email)
        .is('user_id', null); // Only update if user_id is null
      
      logger.info('User access record updated', { email, userId: session.user.id });
    } catch (err) {
      logger.error('Failed to update user_access', err);
      // Don't fail the auth flow if this fails
    }
  }

  logger.info('Auth callback: Redirecting user', {
    userId: session.user.id,
    redirectUrl: redirectUrl,
    customRedirect: !!validatedRedirect
  });

  // Redirect to validated redirect URL (or dashboard if none provided)
  return response;
}
