// Shared types for the key-health system.
//
// Three states a provider key can be in. The /api/keys/verify endpoint and
// the worker writeback both produce this shape.

export type Provider = 'claude' | 'tavily' | 'dataforseo';

export type ProviderHealthStatus =
  | 'healthy'           // decrypts AND provider accepts the key
  | 'missing'           // user has not saved a key for this provider
  | 'needs_reentry'     // decrypt failed OR provider returned 401/403/invalid_api_key
  | 'low_balance'       // provider returned 402/billing/quota OR (DataForSEO) balance below tier minimum
  | 'provider_down';    // provider returned 5xx/timeout/network error — not user's fault

export interface ProviderHealth {
  status: ProviderHealthStatus;
  /** Human-readable reason. Surfaced to users for non-healthy states. */
  reason?: string;
  /** ISO timestamp of last check. */
  checked_at: string;
  /** Provider billing/status URL when relevant (low_balance, provider_down). */
  link?: string;
  /** For DataForSEO low_balance, the actual balance in USD. */
  balance?: number;
  /** For low_balance, the minimum required for the requested tier. */
  required_balance?: number;
}

/**
 * Stored in user_api_keys.health_status (jsonb). Returned by /api/keys/verify
 * and /api/keys/health.
 */
export interface KeyHealthSnapshot {
  claude: ProviderHealth;
  tavily: ProviderHealth;
  dataforseo: ProviderHealth;
}

export type Tier = 'basic' | 'intermediate' | 'advanced';

/**
 * Minimum DataForSEO balance per tier.
 * Mirrors MIN_BALANCE in components/research-confirmation-modal.tsx.
 */
export const TIER_MIN_BALANCE: Record<Tier, number> = {
  basic: 0,
  intermediate: 2,
  advanced: 100,
};

/**
 * Which providers a tier actually needs. Basic doesn't need DataForSEO.
 */
export const TIER_PROVIDERS: Record<Tier, Provider[]> = {
  basic: ['claude', 'tavily'],
  intermediate: ['claude', 'tavily', 'dataforseo'],
  advanced: ['claude', 'tavily', 'dataforseo'],
};

/**
 * Decide whether a snapshot should block research start for the given tier.
 * Only providers required by the tier matter.
 */
export function isHealthBlocking(snapshot: KeyHealthSnapshot, tier: Tier): boolean {
  for (const provider of TIER_PROVIDERS[tier]) {
    const ph = snapshot[provider];
    if (ph.status !== 'healthy') return true;
  }
  return false;
}

export function verifyCacheKey(userId: string): string {
  return `key-health:verify:${userId}`;
}

/** 15 minutes. Fresh enough that fixes show up fast, loose enough to avoid spam. */
export const VERIFY_CACHE_TTL_SECONDS = 15 * 60;

/** A persisted health_status snapshot is trusted only if every provider's
 * checked_at is within this window. Older = fall through to a live probe. */
export const HEALTH_SNAPSHOT_FRESH_MS = 30 * 60 * 1000;

/**
 * Returns true only if every provider in the snapshot was checked within
 * HEALTH_SNAPSHOT_FRESH_MS. Stale snapshots should be ignored — re-checking
 * is cheap (decrypt-only) and prevents old flags from haunting users who
 * have since fixed their keys.
 */
export function isHealthSnapshotFresh(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const s = snapshot as Record<string, { checked_at?: string } | undefined>;
  const now = Date.now();
  for (const provider of ['claude', 'tavily', 'dataforseo'] as const) {
    const ts = s[provider]?.checked_at;
    if (!ts) return false;
    const parsed = Date.parse(ts);
    if (Number.isNaN(parsed)) return false;
    if (now - parsed > HEALTH_SNAPSHOT_FRESH_MS) return false;
  }
  return true;
}

export const PROVIDER_LINKS: Record<Provider, { billing: string; status: string }> = {
  claude: {
    billing: 'https://console.anthropic.com/settings/billing',
    status: 'https://status.anthropic.com',
  },
  tavily: {
    billing: 'https://app.tavily.com/billing',
    status: 'https://status.tavily.com',
  },
  dataforseo: {
    billing: 'https://app.dataforseo.com/billing',
    status: 'https://status.dataforseo.com',
  },
};
