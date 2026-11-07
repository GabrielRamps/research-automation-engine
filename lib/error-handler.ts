import { NextResponse } from 'next/server';
import { logger } from './secure-logger';

/**
 * Security-focused error handler that sanitizes error messages
 * Prevents information disclosure by hiding internal error details in production
 */

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Generate a unique error reference ID for support tracking
 */
function generateErrorReference(): string {
  return `ERR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
}

/**
 * Sanitized API error response
 * Logs full error details server-side, returns safe message to client
 */
export function handleApiError(
  error: any,
  operation: string,
  statusCode: number = 500
): NextResponse {
  const errorRef = generateErrorReference();

  // Log full error details server-side (with error reference for correlation)
  logger.error(`[${errorRef}] ${operation} error:`, {
    message: error.message,
    stack: isDevelopment ? error.stack : undefined,
    name: error.name,
    operation,
    timestamp: new Date().toISOString()
  });

  if (isDevelopment) {
    // In development, show more details for debugging
    return NextResponse.json(
      {
        error: `${operation} failed`,
        details: error.message,
        reference: errorRef,
        stack: error.stack?.split('\n').slice(0, 5) // First 5 lines of stack
      },
      { status: statusCode }
    );
  } else {
    // In production, hide internal details
    return NextResponse.json(
      {
        error: `${operation} failed. Please try again.`,
        message: 'If this problem persists, please contact support with the reference ID.',
        reference: errorRef
      },
      { status: statusCode }
    );
  }
}

/**
 * Database error handler (for Supabase errors)
 */
export function handleDatabaseError(
  error: any,
  operation: string
): NextResponse {
  const errorRef = generateErrorReference();

  logger.error(`[${errorRef}] Database error during ${operation}:`, {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint
  });

  if (isDevelopment) {
    return NextResponse.json(
      {
        error: `Database operation failed: ${operation}`,
        code: error.code,
        details: error.message,
        reference: errorRef
      },
      { status: 500 }
    );
  } else {
    // Don't expose database structure or error codes in production
    return NextResponse.json(
      {
        error: 'Database operation failed. Please try again.',
        reference: errorRef
      },
      { status: 500 }
    );
  }
}

/**
 * Validation error handler (4xx errors)
 */
export function handleValidationError(
  message: string,
  field?: string
): NextResponse {
  // Validation errors are safe to show to users
  return NextResponse.json(
    {
      error: 'Validation error',
      message,
      field
    },
    { status: 400 }
  );
}

/**
 * Authentication error handler
 */
export function handleAuthError(
  message: string = 'Authentication required'
): NextResponse {
  // Don't reveal specific auth failure reasons in production
  const safeMessage = isDevelopment
    ? message
    : 'Authentication failed. Please log in and try again.';

  logger.warn('Authentication error:', { message });

  return NextResponse.json(
    {
      error: safeMessage
    },
    { status: 401 }
  );
}

/**
 * Rate limit error handler
 */
export function handleRateLimitError(
  limit: number,
  reset: number
): NextResponse {
  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      message: `You have exceeded the limit of ${limit} requests per minute. Please try again later.`,
      reset: new Date(reset).toISOString()
    },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Reset': reset.toString(),
        'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString()
      }
    }
  );
}

/**
 * External API error handler (for third-party API failures)
 */
export function handleExternalApiError(
  service: string,
  error: any
): NextResponse {
  const errorRef = generateErrorReference();

  logger.error(`[${errorRef}] External API error (${service}):`, {
    message: error.message,
    status: error.status,
    response: isDevelopment ? error.response : undefined
  });

  if (isDevelopment) {
    return NextResponse.json(
      {
        error: `${service} API error`,
        details: error.message,
        reference: errorRef
      },
      { status: 502 }
    );
  } else {
    // Don't expose third-party API details in production
    return NextResponse.json(
      {
        error: 'External service temporarily unavailable',
        message: 'Please try again in a few moments.',
        reference: errorRef
      },
      { status: 502 }
    );
  }
}
