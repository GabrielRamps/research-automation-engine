import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/secure-logger'

/**
 * Generate a cryptographically secure nonce for CSP
 * Using Web Crypto API for Edge runtime compatibility
 */
function generateNonce(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Buffer.from(array).toString('base64')
}

/**
 * Add security headers to protect against common web vulnerabilities
 */
function addSecurityHeaders(response: NextResponse, request: NextRequest, nonce?: string): NextResponse {
  const headers = response.headers
  const isDev = process.env.NODE_ENV === 'development'
  const isHttps = new URL(request.url).protocol === 'https:'

  // Content Security Policy - prevents XSS and injection attacks
  // Using nonce-based CSP for better security
  const cspDirectives = [
    "default-src 'self'",
    // script-src: Use nonce for inline scripts, removed unsafe-eval and unsafe-inline
    // ('unsafe-eval' is added only in `npm run dev`, which Next.js needs for hot reloading)
    nonce 
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`
      : `script-src 'self'${isDev ? " 'unsafe-eval'" : ''}`,
    // style-src: Keep unsafe-inline for CSS (lower risk than scripts, needed for Tailwind and CSS-in-JS)
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    // connect-src: Wildcards are necessary for Supabase (project-specific) and Upstash (region-specific) subdomains
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.upstash.io https://api.anthropic.com https://api.perplexity.ai https://generativelanguage.googleapis.com",
    "frame-src 'self'",
    "frame-ancestors 'none'", // Prevent clickjacking
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'", // Disable plugins
    // Trusted Types: Prevent DOM-based XSS by enforcing typed values for dangerous DOM sinks
    "require-trusted-types-for 'script'",
    "trusted-types default nextjs nextjs#bundler webpack dompurify"
  ]

  // Upgrade HTTP to HTTPS - only when the site is actually served over HTTPS,
  // so the app still works when you run it on your own computer (http://localhost)
  if (isHttps) {
    cspDirectives.push('upgrade-insecure-requests')
  }

  // Enable CSP reporting in production (optional but recommended)
  if (process.env.NEXT_PUBLIC_CSP_REPORT_URI) {
    cspDirectives.push(`report-uri ${process.env.NEXT_PUBLIC_CSP_REPORT_URI}`)
  }
  
  // Use Report-Only mode if CSP_REPORT_ONLY is set (for testing CSP changes)
  const cspHeader = process.env.CSP_REPORT_ONLY === 'true' 
    ? 'Content-Security-Policy-Report-Only' 
    : 'Content-Security-Policy'
  
  headers.set(cspHeader, cspDirectives.join('; '))

  // Prevent clickjacking - deny all framing
  headers.set('X-Frame-Options', 'DENY')

  // Prevent MIME type sniffing
  headers.set('X-Content-Type-Options', 'nosniff')

  // NOTE: X-XSS-Protection is deprecated and removed (can introduce vulnerabilities)
  // We rely on Content Security Policy (CSP) for XSS protection instead

  // Control referrer information
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  // COOP: Use same-origin-allow-popups to allow Supabase magic link redirects
  // while still preventing other windows from getting a reference to ours
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')

  // Restrict browser features and APIs - explicit deny for all privacy-sensitive features
  // Using 'self' for features we might need, () for complete denial
  const permissionsPolicy = [
    'camera=()',           // Block camera access completely
    'microphone=()',       // Block microphone access completely  
    'geolocation=()',      // Block geolocation access completely
    'payment=()',          // Block payment API completely
    'usb=()',             // Block USB access
    'magnetometer=()',    // Block magnetometer
    'gyroscope=()',       // Block gyroscope
    'accelerometer=()',   // Block accelerometer
    'ambient-light-sensor=()', // Block ambient light sensor
    'autoplay=()',        // Block autoplay
    'encrypted-media=()', // Block encrypted media
    'picture-in-picture=()', // Block picture-in-picture
    'fullscreen=(self)',  // Allow fullscreen only on our domain
    'screen-wake-lock=()' // Block screen wake lock
  ].join(', ')
  
  headers.set('Permissions-Policy', permissionsPolicy)

  // HSTS - force HTTPS (only set in production with HTTPS)
  const isProduction = process.env.NODE_ENV === 'production'
  const url = new URL(request.url)
  if (isProduction && url.protocol === 'https:') {
    headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    )
  }

  // Prevent DNS prefetching to reduce privacy leaks
  headers.set('X-DNS-Prefetch-Control', 'off')

  // Disable client-side caching for sensitive pages
  if (request.nextUrl.pathname.startsWith('/dashboard') ||
      request.nextUrl.pathname.startsWith('/api/')) {
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    headers.set('Pragma', 'no-cache')
    headers.set('Expires', '0')
  }

  // Note: X-Powered-By is removed via next.config.js (poweredByHeader: false)
  // The Server header is set by Vercel platform and requires vercel.json configuration

  return response
}

export async function middleware(request: NextRequest) {
  try {
    const pathname = request.nextUrl.pathname
    
    // DEBUG: Log every request to trace the redirect loop
    logger.info(`🔍 Middleware: ${request.method} ${pathname}`)
    
    // Generate nonce for this request
    const nonce = generateNonce()
  
  // CRITICAL: Always allow these routes (no Terms check)
  const publicRoutes = [
    '/',                    // Login page
    '/terms',               // Terms page (MUST be accessible!)
    '/no-access',           // Access denied page
    '/setup',               // Setup page
    '/unauthorized',        // Unauthorized access warning page
    '/api/auth/callback',   // Auth callback
    '/api/terms/accept',    // Terms acceptance API (must work!)
    '/api/terms/check',     // Terms check API
    '/api/csp-report',      // CSP violation reporting endpoint
  ]
  
  // If it's a public route OR starts with /api/auth/, skip Terms check
  if (publicRoutes.includes(pathname) || pathname.startsWith('/api/auth/')) {
    // Still need to handle auth session for Supabase
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-nonce', nonce)
    
    let response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return request.cookies.get(name)?.value
          },
          set(name: string, value: string, options: CookieOptions) {
            request.cookies.set({
              name,
              value,
              ...options,
            })
            response = NextResponse.next({
              request: {
                headers: requestHeaders,
              },
            })
            response.cookies.set({
              name,
              value,
              ...options,
            })
          },
          remove(name: string, options: CookieOptions) {
            request.cookies.set({
              name,
              value: '',
              ...options,
            })
            response = NextResponse.next({
              request: {
                headers: requestHeaders,
              },
            })
            response.cookies.set({
              name,
              value: '',
              ...options,
            })
          },
        },
      }
    )

    await supabase.auth.getSession()
    // SECURITY FIX: Add security headers to public route responses
    return addSecurityHeaders(response, request, nonce)
  }

  // Fast path: high-frequency / long-poll routes that must respond within Vercel's 25s initial response.
  // Skip middleware auth/terms here; the API route or page fetch will enforce auth.
  const sessionStatusFastPath =
    /^\/api\/sessions\/[^/]+\/status$/.test(pathname)
  const researchPage = /^\/research\/[^/]+$/.test(pathname)
  if (sessionStatusFastPath || researchPage) {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-nonce', nonce)
    const fastResponse = NextResponse.next({
      request: { headers: requestHeaders },
    })
    return addSecurityHeaders(fastResponse, request, nonce)
  }

  // For protected routes, check Terms acceptance
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  
  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: requestHeaders,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: requestHeaders,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // ADMIN ROUTE PROTECTION: Check if accessing admin routes
  if (pathname.startsWith('/admin')) {
    // Must be authenticated to access admin routes
    if (!user) {
      return addSecurityHeaders(NextResponse.redirect(new URL('/', request.url)), request, nonce)
    }

    // Check if user is admin
    try {
      const serviceSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      )

      const { data: adminConfig } = await serviceSupabase
        .from('admin_config')
        .select('config_value')
        .eq('config_key', 'admin_emails')
        .single()

      const adminEmails = adminConfig?.config_value as string[]
      const isAdmin = adminEmails?.includes(user.email || '')

      if (!isAdmin) {
        // Count recent unauthorized attempts by this user (last 24 hours)
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: recentAttempts } = await serviceSupabase
          .from('security_events')
          .select('id')
          .eq('user_id', user.id)
          .eq('event_type', 'unauthorized_admin_access')
          .gte('created_at', twentyFourHoursAgo);

        const attemptCount = (recentAttempts?.length || 0) + 1;

        // Determine severity based on attempt count
        const severity = 
          attemptCount >= 5 ? 'critical' as const :
          attemptCount >= 3 ? 'high' as const :
          'medium' as const;

        logger.warn('Non-admin attempted to access admin route', {
          userId: user.id,
          userEmail: user.email,
          pathname,
          attemptCount,
          severity
        })
        
        // Log security event to database
        await logger.logSecurityEvent({
          eventType: 'unauthorized_admin_access',
          severity,
          userId: user.id,
          userEmail: user.email || undefined,
          ipAddress: logger.getIpFromHeaders(request.headers),
          userAgent: request.headers.get('user-agent') || undefined,
          routePath: pathname,
          eventDetails: {
            method: request.method,
            timestamp: new Date().toISOString(),
            attemptCount,
            consecutiveAttempts: attemptCount >= 3,
            last24Hours: true
          }
        })

        // Auto-suspend user if 5+ attempts in 24 hours
        if (attemptCount >= 5) {
          logger.error('User exceeded security threshold - initiating auto-suspend', {
            userId: user.id,
            userEmail: user.email,
            attemptCount
          });

          // Update user_access to suspended (fail gracefully if error)
          try {
            await serviceSupabase
              .from('user_access')
              .update({ status: 'suspended' })
              .eq('user_id', user.id);
          } catch (suspendError) {
            logger.error('Failed to auto-suspend user:', suspendError);
          }
        }
        
        // Redirect to warning page with attempt count
        const warningUrl = new URL('/unauthorized', request.url);
        warningUrl.searchParams.set('route', pathname);
        warningUrl.searchParams.set('attempts', attemptCount.toString());
        
        return addSecurityHeaders(NextResponse.redirect(warningUrl), request, nonce)
      }
    } catch (error) {
      logger.error('Admin check error:', error)
      const errorResponse = NextResponse.json(
        { error: 'Unable to verify admin access.' },
        { status: 503 }
      )
      return addSecurityHeaders(errorResponse, request, nonce)
    }
  }

  // Only check Terms for authenticated users on protected routes.
  // Skip terms DB check for high-frequency read-only API routes to avoid middleware >25s timeout
  // (user already accepted terms to reach dashboard and create session; route still verifies ownership).
  const skipTermsCheckForSessionApis =
    /^\/api\/sessions\/[^/]+\/status$/.test(pathname);

  if (user && !skipTermsCheckForSessionApis) {
    try {
      // Use service role to check terms (bypasses RLS)
      const serviceSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      )

      // Get current active terms version
      const { data: activeTerms } = await serviceSupabase
        .from('terms_and_conditions')
        .select('version')
        .eq('is_active', true)
        .single()

      if (activeTerms) {
        // Check if user has accepted this version
        // Use maybeSingle() to avoid errors when no acceptance exists
        const { data: acceptance, error: acceptanceError } = await serviceSupabase
          .from('user_terms_acceptance')
          .select('terms_version')
          .eq('user_id', user.id)
          .eq('terms_version', activeTerms.version)
          .maybeSingle()

        // If not accepted, redirect to terms page
        if (!acceptance) {
          logger.warn('⚠️  Terms not accepted - redirecting to /terms', {
            userId: user.id,
            userEmail: user.email,
            requiredVersion: activeTerms.version,
            pathname,
            acceptanceError: acceptanceError?.message
          })
          const termsUrl = new URL('/terms', request.url)
          termsUrl.searchParams.set('redirect', pathname) // Preserve intended destination
          // SECURITY FIX: Add security headers to redirect responses
          return addSecurityHeaders(NextResponse.redirect(termsUrl), request, nonce)
        } else {
          logger.info('✅ Terms accepted', {
            userId: user.id,
            version: acceptance.terms_version
          })
        }
      }
    } catch (error) {
      // SECURITY FIX: Fail closed - deny access if we can't verify terms acceptance
      logger.error('Terms check error:', error)
      const errorResponse = NextResponse.json(
        {
          error: 'Unable to verify terms acceptance. Please try again later.',
          details: 'If this problem persists, please contact support.'
        },
        { status: 503 }
      )
      return addSecurityHeaders(errorResponse, request, nonce)
    }
  }

    // SECURITY FIX: Add security headers to all responses
    return addSecurityHeaders(response, request, nonce)
  } catch (error) {
    // Catch any unhandled errors in middleware to prevent crashes
    logger.error('Middleware error:', error)
    
    // Generate a basic nonce for the error response
    const errorNonce = generateNonce()
    
    // Return a generic response with security headers
    const errorResponse = NextResponse.next({
      request: {
        headers: new Headers(request.headers),
      },
    })
    
    return addSecurityHeaders(errorResponse, request, errorNonce)
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

