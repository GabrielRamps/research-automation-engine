/**
 * Secure Logger Utility
 * 
 * Automatically redacts sensitive information (API keys, tokens, secrets) 
 * from all log output to prevent security leaks.
 * 
 * Also provides database logging for security events.
 */

import { createClient } from '@supabase/supabase-js';

// Security event types
export type SecurityEventType = 
  | 'unauthorized_admin_access' 
  | 'api_rate_limit' 
  | 'auth_failure' 
  | 'privilege_escalation';

export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SecurityEventData {
  eventType: SecurityEventType;
  severity: SecuritySeverity;
  userId?: string;
  userEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  routePath?: string;
  eventDetails?: Record<string, any>;
}

// Patterns that indicate sensitive data
const SENSITIVE_PATTERNS = [
  /sk-ant-[a-zA-Z0-9-]+/gi,           // Anthropic API keys
  /pplx-[a-zA-Z0-9-]+/gi,              // Perplexity API keys
  /AIza[0-9A-Za-z-_]{35}/gi,           // Google/Gemini API keys
  /sk-[a-zA-Z0-9]{32,}/gi,             // Generic OpenAI-style keys
  /Bearer\s+[A-Za-z0-9\-._~+/]+/gi,    // Bearer tokens
  /[A-Za-z0-9]{32,}/gi,                 // Long alphanumeric strings (potential keys)
];

// Field names that should always be redacted
const SENSITIVE_FIELDS = [
  'apiKey',
  'api_key',
  'apikey',
  'authorization',
  'auth',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'password',
  'passwd',
  'pwd',
  'credential',
  'credentials',
  'key',
  'private_key',
  'public_key',
  'secret_key',
  'encryption_key',
  'x-api-key',
  'x-api-token',
];

// Redaction placeholder
const REDACTED = '***REDACTED***';

/**
 * Check if a string contains sensitive patterns
 */
function containsSensitivePattern(value: string): boolean {
  if (typeof value !== 'string') return false;
  
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Redact sensitive patterns from a string
 */
function redactString(value: string): string {
  let redacted = value;
  
  SENSITIVE_PATTERNS.forEach(pattern => {
    redacted = redacted.replace(pattern, REDACTED);
  });
  
  return redacted;
}

/**
 * Check if a field name indicates sensitive data
 */
function isSensitiveField(fieldName: string): boolean {
  const lowerField = fieldName.toLowerCase();
  return SENSITIVE_FIELDS.some(field => lowerField.includes(field));
}

/**
 * Recursively redact sensitive data from an object
 */
function redactObject(obj: any, depth = 0): any {
  // Prevent infinite recursion
  if (depth > 10) return '[Max depth reached]';
  
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  // Handle strings
  if (typeof obj === 'string') {
    if (containsSensitivePattern(obj)) {
      return redactString(obj);
    }
    return obj;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => redactObject(item, depth + 1));
  }
  
  // Handle objects
  if (typeof obj === 'object') {
    const redacted: any = {};
    
    for (const [key, value] of Object.entries(obj)) {
      // Redact entire field if it's a sensitive field name
      if (isSensitiveField(key)) {
        redacted[key] = REDACTED;
        continue;
      }
      
      // Redact value if it contains sensitive patterns
      if (typeof value === 'string' && containsSensitivePattern(value)) {
        redacted[key] = redactString(value);
      } else if (typeof value === 'object') {
        redacted[key] = redactObject(value, depth + 1);
      } else {
        redacted[key] = value;
      }
    }
    
    return redacted;
  }
  
  return obj;
}

/**
 * Redact sensitive data from error objects
 */
function redactError(error: any): any {
  if (!error) return error;
  
  // Create a safe error representation
  const safeError: any = {
    name: error.name || 'Error',
    message: error.message ? redactString(String(error.message)) : undefined,
  };
  
  // Only include stack in development, and redact it
  if (process.env.NODE_ENV === 'development' && error.stack) {
    safeError.stack = redactString(String(error.stack));
  }
  
  // Redact any additional properties
  if (typeof error === 'object') {
    Object.keys(error).forEach(key => {
      if (!['name', 'message', 'stack'].includes(key)) {
        const value = error[key];
        if (isSensitiveField(key)) {
          safeError[key] = REDACTED;
        } else if (typeof value === 'string') {
          safeError[key] = redactString(value);
        } else {
          safeError[key] = redactObject(value);
        }
      }
    });
  }
  
  return safeError;
}

/**
 * Secure Logger Class
 */
class SecureLogger {
  private supabase: ReturnType<typeof createClient> | null = null;

  constructor() {
    // Initialize Supabase service role client for database logging
    // Only initialize if environment variables are available
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        this.supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          {
            auth: {
              autoRefreshToken: false,
              persistSession: false
            }
          }
        );
      } catch (error) {
        console.error('[LOGGER] Failed to initialize Supabase client:', error);
      }
    }
  }

  /**
   * Log info message (safe for production)
   */
  info(...args: any[]): void {
    const redacted = args.map(arg => redactObject(arg));
    console.log('[INFO]', ...redacted);
  }
  
  /**
   * Log warning message
   */
  warn(...args: any[]): void {
    const redacted = args.map(arg => redactObject(arg));
    console.warn('[WARN]', ...redacted);
  }
  
  /**
   * Log error message (with automatic redaction)
   */
  error(...args: any[]): void {
    const redacted = args.map(arg => {
      if (arg instanceof Error) {
        return redactError(arg);
      }
      return redactObject(arg);
    });
    console.error('[ERROR]', ...redacted);
  }
  
  /**
   * Log debug message (only in development)
   */
  debug(...args: any[]): void {
    if (process.env.NODE_ENV === 'development') {
      const redacted = args.map(arg => redactObject(arg));
      console.debug('[DEBUG]', ...redacted);
    }
  }
  
  /**
   * Log with custom level
   */
  log(level: 'info' | 'warn' | 'error' | 'debug', ...args: any[]): void {
    switch (level) {
      case 'info':
        this.info(...args);
        break;
      case 'warn':
        this.warn(...args);
        break;
      case 'error':
        this.error(...args);
        break;
      case 'debug':
        this.debug(...args);
        break;
    }
  }

  /**
   * Log a security event to both database and application logs
   * This function writes to the security_events table and also logs to console
   */
  async logSecurityEvent(data: SecurityEventData): Promise<void> {
    try {
      // Redact sensitive information from event details
      const sanitizedDetails = data.eventDetails 
        ? redactObject(data.eventDetails) 
        : {};

      // Sanitize user agent (remove detailed version info)
      const sanitizedUserAgent = data.userAgent 
        ? data.userAgent.substring(0, 200) // Limit length
        : undefined;

      // Log to console first (always works)
      this.warn('Security event:', {
        type: data.eventType,
        severity: data.severity,
        userId: data.userId,
        email: data.userEmail,
        ip: data.ipAddress,
        route: data.routePath,
        details: sanitizedDetails
      });

      // Attempt to write to database (fail gracefully if unavailable)
      if (this.supabase) {
        const { error: dbError } = await this.supabase
          .from('security_events' as any)
          .insert({
            event_type: data.eventType,
            severity: data.severity,
            user_id: data.userId || null,
            user_email: data.userEmail || null,
            ip_address: data.ipAddress || null,
            user_agent: sanitizedUserAgent || null,
            route_path: data.routePath || null,
            event_details: sanitizedDetails
          } as any);

        if (dbError) {
          // Log database error but don't throw (fail gracefully)
          this.error('Failed to write security event to database:', dbError);
        }
      }
    } catch (error) {
      // Catch any unexpected errors to prevent security logging from breaking the app
      this.error('Unexpected error in logSecurityEvent:', error);
    }
  }

  /**
   * Helper function to extract IP address from request headers
   */
  getIpFromHeaders(headers: Headers): string | undefined {
    // Check common headers in order of preference
    return (
      headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      headers.get('x-real-ip') ||
      headers.get('cf-connecting-ip') || // Cloudflare
      undefined
    );
  }
}

// Export singleton instance
export const logger = new SecureLogger();

// Export utility functions for advanced use cases
export { redactObject, redactString, redactError, containsSensitivePattern };

