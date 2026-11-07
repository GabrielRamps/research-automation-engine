import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/encryption';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { handleApiError, handleValidationError } from '@/lib/error-handler';
import { deleteCached } from '@/lib/redis-cache';
import { verifyCacheKey } from '@/lib/key-health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Validate API key format before encryption
 */
function validateApiKey(key: string, provider: 'claude' | 'tavily'): void {
  if (!key || key.length < 10) {
    throw new Error(`Invalid ${provider} API key: too short`);
  }

  // Prefix + character set only. /api/keys/validate makes a live provider call,
  // which is what proves the key works; this just catches paste mistakes.
  const patterns = {
    claude: /^sk-ant-[\w-]{20,}$/,
    tavily: /^tvly-[\w-]{20,}$/
  };
  
  if (!patterns[provider].test(key)) {
    throw new Error(`Invalid ${provider} API key format`);
  }
  
  // Block obvious test keys
  const testPatterns = ['test', 'fake', 'example', 'demo', '12345', 'aaaaa'];
  if (testPatterns.some(pattern => key.toLowerCase().includes(pattern))) {
    throw new Error(`Test/demo keys are not allowed`);
  }
}

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

export async function POST(request: NextRequest) {
  try {
    // SECURITY FIX: Authenticate user first
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return unauthorizedResponse();
    }

    const body = (await request.json()) as {
      claudeKey?: string; tavilyKey?: string; claudeValidated?: boolean; tavilyValidated?: boolean;
      dataforseoLogin?: string; dataforseoPassword?: string; dataforseoValidated?: boolean;
    };
    // Pasted keys often carry a trailing space or newline
    const claudeKey = body.claudeKey?.trim();
    const tavilyKey = body.tavilyKey?.trim();
    const {
      // SECURITY FIX: Removed userId from body - now extracted from auth session
      claudeValidated,
      tavilyValidated,
      dataforseoLogin,
      dataforseoPassword,
      dataforseoValidated
    } = body;
    
    // SECURITY FIX: Use authenticated userId
    const userId = auth.userId;

    // Encrypt the API keys
    const encryptedData: any = {
      user_id: userId,
      updated_at: new Date().toISOString()
    };
    
    if (claudeKey) {
      validateApiKey(claudeKey, 'claude');
      encryptedData.claude_api_key_encrypted = await encrypt(claudeKey);
      encryptedData.claude_validated = claudeValidated || false;
    }
    
    if (tavilyKey) {
      validateApiKey(tavilyKey, 'tavily');
      encryptedData.tavily_api_key_encrypted = await encrypt(tavilyKey);
      encryptedData.tavily_validated = tavilyValidated || false;
    }
    
    // DataForSEO uses login + password (optional)
    if (dataforseoLogin && dataforseoPassword) {
      if (dataforseoLogin.length < 3) {
        throw new Error('Invalid DataForSEO login: too short');
      }
      if (dataforseoPassword.length < 3) {
        throw new Error('Invalid DataForSEO password: too short');
      }
      encryptedData.dataforseo_login_encrypted = await encrypt(dataforseoLogin);
      encryptedData.dataforseo_password_encrypted = await encrypt(dataforseoPassword);
      encryptedData.dataforseo_validated = dataforseoValidated || false;
    }
    
    // CRITICAL: Clear cached health snapshot whenever keys change. Otherwise a
    // user who fixes a broken key would still see "needs_reentry" until the
    // 15-min cache expires.
    encryptedData.health_status = null;

    // Upsert the API keys
    const { data, error } = await supabase
      .from('user_api_keys')
      .upsert(encryptedData, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (error) {
      logger.error('Database error:', error);
      throw new Error('Failed to save API keys');
    }

    // Invalidate Redis verify cache (fire-and-forget; cache write failure
    // is non-fatal — staleness is bounded by the 15-min TTL).
    deleteCached(verifyCacheKey(userId)).catch((e) =>
      logger.warn('[/api/keys/save] verify cache invalidation failed', e)
    );

    return NextResponse.json({
      success: true,
      message: 'API keys saved successfully'
    });
    
  } catch (error: any) {
    // SECURITY FIX: Sanitized error - don't expose validation details
    // Validation errors are safe to show, but internal errors are not
    if (error.message.includes('Invalid') || error.message.includes('not allowed')) {
      return handleValidationError(error.message);
    }
    return handleApiError(error, 'Save API keys', 500);
  }
}

export async function GET(request: NextRequest) {
  try {
    // SECURITY FIX: Authenticate user first
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return unauthorizedResponse();
    }

    // SECURITY FIX: Use authenticated userId (ignore query param)
    const userId = auth.userId;

    // Get the API keys status (not the actual keys)
    const { data, error } = await supabase
      .from('user_api_keys')
      .select('claude_validated, tavily_validated, dataforseo_validated, updated_at')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      logger.error('Database error:', error);
      throw new Error('Failed to fetch API keys status');
    }

    return NextResponse.json({
      success: true,
      data: data || {
        claude_validated: false,
        tavily_validated: false,
        dataforseo_validated: false
      }
    });

  } catch (error: any) {
    // SECURITY FIX: Sanitized error - don't expose database details
    return handleApiError(error, 'Fetch API keys status', 500);
  }
}

