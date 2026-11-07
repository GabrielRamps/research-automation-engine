// Tiny Upstash Redis client for arbitrary cache use.
// Mirrors the env-var fallback pattern from lib/rate-limit.ts so we don't
// duplicate that file's working production behavior — but keeps this isolated
// so a bug here can't break rate limiting.

import { Redis } from '@upstash/redis';
import { logger } from './secure-logger';

let cached: Redis | null = null;

function getRedis(): Redis | null {
  if (cached) return cached;

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    cached = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    return cached;
  }

  if (process.env.REDIS_URL) {
    try {
      const u = new URL(process.env.REDIS_URL);
      if (!u.hostname || !u.password) {
        logger.warn('[redis-cache] REDIS_URL missing hostname or password; cache disabled');
        return null;
      }
      cached = new Redis({
        url: `https://${u.hostname}`,
        token: u.password,
      });
      return cached;
    } catch (err) {
      logger.error('[redis-cache] Failed to parse REDIS_URL; cache disabled', err);
      return null;
    }
  }

  logger.warn('[redis-cache] No Redis env vars; cache disabled (calls become pass-through)');
  return null;
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const v = await r.get<T>(key);
    return v ?? null;
  } catch (err) {
    logger.warn('[redis-cache] get failed; treating as cache miss', err);
    return null;
  }
}

export async function setCachedJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, value, { ex: ttlSeconds });
  } catch (err) {
    logger.warn('[redis-cache] set failed; cache write skipped', err);
  }
}

export async function deleteCached(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(key);
  } catch (err) {
    logger.warn('[redis-cache] del failed; cache may be stale', err);
  }
}
