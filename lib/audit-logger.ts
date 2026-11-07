import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { logger } from './secure-logger';

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

/**
 * Audit Logging Utility (The Receipt)
 * 
 * Logs API key usage to user_api_key_audit table for accountability.
 * Runs asynchronously to avoid slowing down research operations.
 */

export interface AuditLogData {
  userId: string;
  action: string; // e.g., 'decrypted_key_for_phase1', 'decrypted_key_for_perplexity', etc.
  service?: 'claude' | 'tavily';
  phase?: number;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorMessage?: string;
}

/**
 * Log API key usage to audit table (async, non-blocking)
 * This function fires and forgets - it won't slow down the main operation
 * 
 * IMPORTANT: In serverless environments, we need to ensure the insert completes
 * before the function exits. We use Promise.resolve().then() instead of setImmediate
 * to ensure it runs in the same event loop but doesn't block.
 */
export async function logApiKeyUsage(data: AuditLogData): Promise<void> {
  // Don't await - fire and forget, but ensure it starts executing
  Promise.resolve().then(async () => {
    try {
      // Convert IP address string to INET format if provided
      // PostgreSQL INET type accepts strings like '192.168.1.1'
      const ipAddress = data.ipAddress || null;
      
      const { error, data: insertData } = await supabase
        .from('user_api_key_audit')
        .insert({
          user_id: data.userId,
          action: data.action,
          ip_address: ipAddress, // PostgreSQL will handle string to INET conversion
          user_agent: data.userAgent || null,
          success: data.success !== false, // Default to true
          error_message: data.errorMessage || null,
          created_at: new Date().toISOString()
        })
        .select(); // Return inserted data for verification

      if (error) {
        // Log error but don't throw - audit logging should never break the app
        logger.error('[Audit Logger] Failed to log API key usage:', error, {
          userId: data.userId,
          action: data.action,
          errorCode: error.code,
          errorMessage: error.message,
          errorDetails: error.details
        });
      } else {
        // Success - log for debugging (can remove in production)
        logger.info('[Audit Logger] Successfully logged audit entry', {
          auditId: insertData?.[0]?.id,
          action: data.action,
          userId: data.userId
        });
      }
    } catch (err: any) {
      // Log unexpected errors - audit logging is important but not critical
      logger.error('[Audit Logger] Unexpected error:', err, {
        userId: data.userId,
        action: data.action,
        errorName: err?.name,
        errorMessage: err?.message
      });
    }
  }).catch((err) => {
    // Catch any errors in the promise chain itself
    logger.error('[Audit Logger] Promise chain error:', err);
  });
}

/**
 * Extract IP address from NextRequest
 */
export function getIpAddress(request: NextRequest): string | undefined {
  // Check various headers for IP address
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  
  return undefined;
}

/**
 * Extract user agent from NextRequest
 */
export function getUserAgent(request: NextRequest): string | undefined {
  return request.headers.get('user-agent') || undefined;
}

/**
 * Create audit log entry for API key decryption
 */
export function createAuditLog(
  userId: string,
  service: 'claude' | 'tavily',
  phase: number,
  sessionId?: string,
  request?: NextRequest
): AuditLogData {
  return {
    userId,
    action: `decrypted_key_for_${service}_phase${phase}`,
    service,
    phase,
    sessionId,
    ipAddress: request ? getIpAddress(request) : undefined,
    userAgent: request ? getUserAgent(request) : undefined,
    success: true
  };
}

