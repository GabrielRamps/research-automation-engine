import { createClient } from '@supabase/supabase-js';
import { decrypt } from './encryption';
import { logApiKeyUsage, createAuditLog, type AuditLogData } from './audit-logger';
import { NextRequest } from 'next/server';

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

export interface UserApiKeys {
  claude: string;
  tavily: string;
}

export interface LoadApiKeysOptions {
  phase?: number;
  sessionId?: string;
  request?: NextRequest;
  logUsage?: boolean; // Whether to log audit entries (default: true)
}

/**
 * Load and decrypt user's API keys from database
 * Optionally logs audit entries for accountability
 */
export async function loadUserApiKeys(
  userId: string,
  options?: LoadApiKeysOptions
): Promise<UserApiKeys> {
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('claude_api_key_encrypted, tavily_api_key_encrypted')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    // Log failed attempt
    if (options?.logUsage !== false) {
      logApiKeyUsage({
        userId,
        action: 'decrypt_failed',
        success: false,
        errorMessage: error?.message || 'API keys not found',
        ipAddress: options?.request ? getIpAddress(options.request) : undefined,
        userAgent: options?.request ? getUserAgent(options.request) : undefined,
        phase: options?.phase,
        sessionId: options?.sessionId
      });
    }
    throw new Error('API keys not found. Please configure your API keys.');
  }

  const keys: UserApiKeys = {
    claude: await decrypt(data.claude_api_key_encrypted),
    tavily: await decrypt(data.tavily_api_key_encrypted)
  };

  // Log successful decryption (async, non-blocking)
  if (options?.logUsage !== false && options?.phase) {
    // Log each service that will be used
    // Note: We log here when keys are loaded, but individual service usage
    // will be logged separately when each service is actually called
    logApiKeyUsage({
      userId,
      action: `keys_decrypted_for_phase${options.phase}`,
      phase: options.phase,
      sessionId: options?.sessionId,
      ipAddress: options?.request ? getIpAddress(options.request) : undefined,
      userAgent: options?.request ? getUserAgent(options.request) : undefined,
      success: true
    });
  }

  return keys;
}

/**
 * Helper to extract IP address from NextRequest
 */
function getIpAddress(request: NextRequest): string | undefined {
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
 * Helper to extract user agent from NextRequest
 */
function getUserAgent(request: NextRequest): string | undefined {
  return request.headers.get('user-agent') || undefined;
}

/**
 * Log when a specific API service is used (e.g., Tavily, Claude)
 * Call this right before making the API call
 */
export function logServiceUsage(
  userId: string,
  service: 'claude' | 'tavily',
  phase: number,
  sessionId?: string,
  request?: NextRequest
): void {
  logApiKeyUsage(createAuditLog(userId, service, phase, sessionId, request));
}

