import { NextRequest, NextResponse } from 'next/server'

/**
 * CSP Violation Report Endpoint
 * 
 * This endpoint receives Content Security Policy violation reports from browsers.
 * Browsers automatically POST to this endpoint when CSP violations occur.
 * 
 * Security considerations:
 * - Must be publicly accessible for browsers to send reports
 * - Rate limited to prevent abuse
 * - Validates report structure
 * - Only logs minimal necessary information
 * 
 * To enable: Set NEXT_PUBLIC_CSP_REPORT_URI=/api/csp-report in environment
 */

// Simple in-memory rate limiting (in production, use Redis)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

function rateLimit(ip: string, maxRequests = 10, windowMs = 60000): boolean {
  const now = Date.now()
  const record = rateLimitMap.get(ip)

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs })
    return true
  }

  if (record.count >= maxRequests) {
    return false
  }

  record.count++
  return true
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
    if (!rateLimit(ip)) {
      return new NextResponse(null, { status: 429 })
    }

    // Validate Content-Type
    const contentType = request.headers.get('content-type')
    if (!contentType?.includes('application/json') && !contentType?.includes('application/csp-report')) {
      return new NextResponse(null, { status: 204 })
    }

    // Parse and validate the CSP violation report
    const report = (await request.json()) as { 'csp-report'?: { 'violated-directive'?: string; 'blocked-uri'?: string } }
    
    // Validate report structure (basic validation)
    if (!report || !report['csp-report']) {
      return new NextResponse(null, { status: 204 })
    }

    const cspReport = report['csp-report']
    
    // Only log in development or if explicitly enabled
    if (process.env.NODE_ENV === 'development' || process.env.LOG_CSP_VIOLATIONS === 'true') {
      console.warn('CSP Violation:', {
        timestamp: new Date().toISOString(),
        'violated-directive': cspReport['violated-directive'],
        'blocked-uri': cspReport['blocked-uri']?.substring(0, 100), // Truncate to prevent log spam
      })
    }

    // In production, send to monitoring service (optional)
    // if (process.env.SENTRY_DSN) {
    //   // Send to Sentry or other monitoring
    // }

    // Always return 204 No Content for CSP reports
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    // Silently fail to avoid browser retries and log spam
    return new NextResponse(null, { status: 204 })
  }
}

// GET, PUT, DELETE methods are not allowed
export async function GET() {
  return new NextResponse(null, { status: 405 })
}

export async function PUT() {
  return new NextResponse(null, { status: 405 })
}

export async function DELETE() {
  return new NextResponse(null, { status: 405 })
}
