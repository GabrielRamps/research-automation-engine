import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextRequest, NextResponse } from "next/server";
import { logger } from './secure-logger';

/**
 * Rate Limiting Utility (Layer 1: The Shield)
 * 
 * Limits users to 20 requests per minute using Upstash Rate Limit.
 * Returns 429 error immediately if limit exceeded (does not touch database).
 */

// Initialize Redis client for Upstash Rate Limit
// Uses REST API (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN)
// If not available, falls back to parsing REDIS_URL for Upstash REST credentials
let ratelimit: Ratelimit | null = null;

function getRateLimiter(): Ratelimit {
  if (ratelimit) {
    return ratelimit;
  }

  // Try to use Upstash REST API first (preferred for serverless)
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, "1 m"), // 20 requests per minute
      analytics: true,
    });
  } else if (process.env.REDIS_URL) {
    // Fallback: Parse REDIS_URL to extract Upstash REST API credentials
    // Upstash Redis URL format: redis://default:PASSWORD@endpoint.upstash.io:6379
    // We need to convert this to REST API format
    try {
      const redisUrl = new URL(process.env.REDIS_URL);
      
      // Extract endpoint (e.g., "endpoint.upstash.io")
      const hostname = redisUrl.hostname;
      const password = redisUrl.password;
      
      if (!hostname || !password) {
        throw new Error('REDIS_URL missing hostname or password');
      }
      
      // Upstash REST API URL format: https://endpoint.upstash.io
      const restUrl = `https://${hostname}`;
      
      const redis = new Redis({
        url: restUrl,
        token: password,
      });

      ratelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(20, "1 m"), // 20 requests per minute
        analytics: true,
      });
      
      logger.info('[Rate Limit] Initialized using REDIS_URL fallback');
    } catch (error: any) {
      logger.error('[Rate Limit] Failed to parse REDIS_URL:', error);
      throw new Error('Rate limiting requires UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or valid REDIS_URL');
    }
  } else {
    throw new Error('Rate limiting requires either UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or REDIS_URL environment variables');
  }

  return ratelimit;
}

/**
 * Check rate limit for a user
 * @param identifier - Unique identifier for the user (user ID, IP address, etc.)
 * @returns Object with { success: boolean, limit: number, remaining: number, reset: number }
 */
export async function checkRateLimit(identifier: string): Promise<{
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}> {
  try {
    const limiter = getRateLimiter();
    const result = await limiter.limit(identifier);
    
    return {
      success: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    };
  } catch (error: any) {
    logger.error('[Rate Limit] Error checking rate limit:', error);
    // SECURITY FIX: Fail closed - deny request if we can't verify rate limit
    // This prevents abuse during Redis outages or errors
    return {
      success: false, // Changed from true to false
      limit: 20,
      remaining: 0,   // Changed from 19 to 0
      reset: Date.now() + 60000,
    };
  }
}

/**
 * Rate limit middleware for API routes
 * Returns 429 response if rate limit exceeded, otherwise returns null
 */
export async function rateLimitMiddleware(
  request: NextRequest,
  userId: string
): Promise<NextResponse | null> {
  const result = await checkRateLimit(userId);
  
  if (!result.success) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        details: `You have exceeded the limit of ${result.limit} requests per minute. Please try again later.`,
        reset: new Date(result.reset).toISOString(),
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': result.limit.toString(),
          'X-RateLimit-Remaining': result.remaining.toString(),
          'X-RateLimit-Reset': result.reset.toString(),
        },
      }
    );
  }
  
  return null; // Rate limit passed, continue
}

