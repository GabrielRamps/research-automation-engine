import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { tavily } from '@tavily/core';
import { decrypt, DecryptionError } from '@/lib/encryption';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { rateLimitMiddleware } from '@/lib/rate-limit';
import { getCachedJson, setCachedJson } from '@/lib/redis-cache';
import {
  KeyHealthSnapshot,
  ProviderHealth,
  Tier,
  TIER_MIN_BALANCE,
  TIER_PROVIDERS,
  PROVIDER_LINKS,
  isHealthBlocking,
  verifyCacheKey,
  VERIFY_CACHE_TTL_SECONDS,
} from '@/lib/key-health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

interface VerifyRequest {
  tier?: Tier;
  /** Force re-check even if cached. Used by the "Retry verification" button. */
  refresh?: boolean;
}

interface VerifyResponse {
  ok: boolean;
  blocking: boolean;
  health: KeyHealthSnapshot;
  /** Whether the response came from Redis cache (true) or live pings (false). */
  cached: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return unauthorizedResponse();

    const rateLimitResp = await rateLimitMiddleware(request, auth.userId);
    if (rateLimitResp) return rateLimitResp;

    const body = (await request.json().catch(() => ({}))) as VerifyRequest;
    const tier: Tier = body.tier ?? 'basic';
    const refresh = body.refresh === true;

    const cacheKey = verifyCacheKey(auth.userId);

    if (!refresh) {
      const cached = await getCachedJson<KeyHealthSnapshot>(cacheKey);
      if (cached) {
        const resp: VerifyResponse = {
          ok: true,
          blocking: isHealthBlocking(cached, tier),
          health: cached,
          cached: true,
        };
        return NextResponse.json(resp);
      }
    }

    const snapshot = await runLiveVerification(auth.userId, tier);

    await setCachedJson(cacheKey, snapshot, VERIFY_CACHE_TTL_SECONDS);

    // Persist to DB (non-blocking; cache is the source of truth for verify)
    supabase
      .from('user_api_keys')
      .update({ health_status: snapshot })
      .eq('user_id', auth.userId)
      .then(({ error }) => {
        if (error) logger.warn('[/api/keys/verify] health_status writeback failed', error);
      });

    const resp: VerifyResponse = {
      ok: true,
      blocking: isHealthBlocking(snapshot, tier),
      health: snapshot,
      cached: false,
    };
    return NextResponse.json(resp);
  } catch (err: any) {
    logger.error('[/api/keys/verify] unhandled error', err);
    return NextResponse.json(
      { ok: false, error: 'Verification failed', details: err?.message },
      { status: 500 }
    );
  }
}

// ============================================================
// Live verification per provider
// ============================================================

async function runLiveVerification(userId: string, tier: Tier): Promise<KeyHealthSnapshot> {
  const { data: keys } = await supabase
    .from('user_api_keys')
    .select(
      'claude_api_key_encrypted, tavily_api_key_encrypted, dataforseo_login_encrypted, dataforseo_password_encrypted'
    )
    .eq('user_id', userId)
    .single();

  const required = new Set(TIER_PROVIDERS[tier]);
  const checks: Array<Promise<[keyof KeyHealthSnapshot, ProviderHealth]>> = [];

  checks.push(
    (async () => {
      if (!required.has('claude')) return ['claude', missing()];
      if (!keys?.claude_api_key_encrypted) return ['claude', missing()];
      return ['claude', await checkClaude(keys.claude_api_key_encrypted)];
    })()
  );

  checks.push(
    (async () => {
      if (!required.has('tavily')) return ['tavily', missing()];
      if (!keys?.tavily_api_key_encrypted) return ['tavily', missing()];
      return ['tavily', await checkTavily(keys.tavily_api_key_encrypted)];
    })()
  );

  checks.push(
    (async () => {
      if (!required.has('dataforseo')) return ['dataforseo', missing()];
      if (!keys?.dataforseo_login_encrypted || !keys?.dataforseo_password_encrypted) {
        return ['dataforseo', missing()];
      }
      return [
        'dataforseo',
        await checkDataForSEO(
          keys.dataforseo_login_encrypted,
          keys.dataforseo_password_encrypted,
          tier
        ),
      ];
    })()
  );

  const results = await Promise.all(checks);

  const snapshot: KeyHealthSnapshot = {
    claude: missing(),
    tavily: missing(),
    dataforseo: missing(),
  };
  for (const [provider, health] of results) snapshot[provider] = health;
  return snapshot;
}

function now(): string {
  return new Date().toISOString();
}

function missing(): ProviderHealth {
  return { status: 'missing', checked_at: now() };
}

async function checkClaude(encrypted: string): Promise<ProviderHealth> {
  let key: string;
  try {
    key = await decrypt(encrypted);
  } catch (err) {
    return reentryFromDecrypt('claude', err);
  }

  try {
    const client = new Anthropic({ apiKey: key });
    await client.messages.create({
      model: process.env.CLAUDE_KEY_CHECK_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { status: 'healthy', checked_at: now() };
  } catch (err: any) {
    return classifyAnthropicError(err);
  }
}

function classifyAnthropicError(err: any): ProviderHealth {
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const msg = (err?.message || '').toString();

  if (status === 401 || /invalid.*api.?key/i.test(msg) || /authentication/i.test(msg)) {
    return {
      status: 'needs_reentry',
      reason: 'Anthropic rejected the API key. Re-enter it.',
      checked_at: now(),
    };
  }
  if (
    status === 402 ||
    /credit|balance|billing|payment|quota/i.test(msg)
  ) {
    return {
      status: 'low_balance',
      reason: 'Anthropic account is out of credits or has no payment method.',
      link: PROVIDER_LINKS.claude.billing,
      checked_at: now(),
    };
  }
  if (status && status >= 500) {
    return {
      status: 'provider_down',
      reason: `Anthropic returned ${status}. This is on their end, not yours.`,
      link: PROVIDER_LINKS.claude.status,
      checked_at: now(),
    };
  }
  // Unknown — treat as provider_down so we don't lock people out on a code we don't recognize.
  return {
    status: 'provider_down',
    reason: msg || 'Could not reach Anthropic.',
    link: PROVIDER_LINKS.claude.status,
    checked_at: now(),
  };
}

async function checkTavily(encrypted: string): Promise<ProviderHealth> {
  let key: string;
  try {
    key = await decrypt(encrypted);
  } catch (err) {
    return reentryFromDecrypt('tavily', err);
  }

  try {
    const client = tavily({ apiKey: key });
    await client.search('ping', { maxResults: 1 });
    return { status: 'healthy', checked_at: now() };
  } catch (err: any) {
    const msg = (err?.message || '').toString();
    if (/unauthorized|invalid.*key|forbidden|401|403/i.test(msg)) {
      return {
        status: 'needs_reentry',
        reason: 'Tavily rejected the API key. Re-enter it.',
        checked_at: now(),
      };
    }
    if (/credit|usage|quota|payment/i.test(msg)) {
      return {
        status: 'low_balance',
        reason: 'Tavily account is out of credits.',
        link: PROVIDER_LINKS.tavily.billing,
        checked_at: now(),
      };
    }
    return {
      status: 'provider_down',
      reason: msg || 'Could not reach Tavily.',
      link: PROVIDER_LINKS.tavily.status,
      checked_at: now(),
    };
  }
}

async function checkDataForSEO(
  encryptedLogin: string,
  encryptedPassword: string,
  tier: Tier
): Promise<ProviderHealth> {
  let login: string;
  let password: string;
  try {
    login = await decrypt(encryptedLogin);
    password = await decrypt(encryptedPassword);
  } catch (err) {
    return reentryFromDecrypt('dataforseo', err);
  }

  try {
    const encoded = Buffer.from(`${login}:${password}`).toString('base64');
    const res = await fetch('https://api.dataforseo.com/v3/appendix/user_data', {
      method: 'GET',
      headers: { Authorization: `Basic ${encoded}` },
    });

    if (res.status === 401 || res.status === 403) {
      return {
        status: 'needs_reentry',
        reason: 'DataForSEO rejected the credentials. Re-enter them.',
        checked_at: now(),
      };
    }
    if (res.status >= 500) {
      return {
        status: 'provider_down',
        reason: `DataForSEO returned ${res.status}. This is on their end, not yours.`,
        link: PROVIDER_LINKS.dataforseo.status,
        checked_at: now(),
      };
    }
    if (!res.ok) {
      return {
        status: 'provider_down',
        reason: `DataForSEO returned status ${res.status}.`,
        link: PROVIDER_LINKS.dataforseo.status,
        checked_at: now(),
      };
    }

    const data = (await res.json()) as {
      tasks?: Array<{ result?: Array<{ money?: { balance?: number } }> }>;
    };
    const balance = data.tasks?.[0]?.result?.[0]?.money?.balance ?? 0;
    const required = TIER_MIN_BALANCE[tier];

    if (balance < required) {
      return {
        status: 'low_balance',
        reason: `DataForSEO balance is $${balance.toFixed(2)} — needs at least $${required.toFixed(2)} for the ${tier} tier.`,
        link: PROVIDER_LINKS.dataforseo.billing,
        balance,
        required_balance: required,
        checked_at: now(),
      };
    }

    return { status: 'healthy', balance, checked_at: now() };
  } catch (err: any) {
    return {
      status: 'provider_down',
      reason: err?.message || 'Could not reach DataForSEO.',
      link: PROVIDER_LINKS.dataforseo.status,
      checked_at: now(),
    };
  }
}

function reentryFromDecrypt(provider: string, err: unknown): ProviderHealth {
  if (err instanceof DecryptionError) {
    logger.info(`[/api/keys/verify] ${provider} decrypt failed — needs re-entry`);
  } else {
    logger.warn(`[/api/keys/verify] ${provider} decrypt threw unexpected error`, err);
  }
  return {
    status: 'needs_reentry',
    reason: 'Your saved key cannot be read (likely after a security update). Re-enter it.',
    checked_at: now(),
  };
}
