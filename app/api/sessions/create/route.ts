import { NextRequest, NextResponse } from 'next/server';
import { SessionManager, Tier } from '@/lib/session-manager';
import { USE_QUEUE_SYSTEM } from '@/lib/feature-flags';
import { rateLimitMiddleware } from '@/lib/rate-limit';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse, hasActiveAccess, noAccessResponse } from '@/lib/auth-helpers';
import { handleApiError } from '@/lib/error-handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_TIERS: Tier[] = ['basic', 'intermediate', 'advanced'];

export async function POST(request: NextRequest) {
  try {
    // SECURITY FIX: Authenticate user first before processing request
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return unauthorizedResponse();
    }
    if (!(await hasActiveAccess(auth.userId))) {
      return noAccessResponse();
    }

    const body = (await request.json()) as {
      businessName?: string; industry?: string; services?: string; additionalServices?: string; location?: string;
      targetAudience?: string; uniqueSellingPoints?: string; contactEmail?: string; projectType?: string; brandColors?: string;
      businessType?: string; primaryService?: string; city?: string; state?: string; phoneNumber?: string;
      streetAddress?: string; zipCode?: string; operatingHours?: string; hasBrandColors?: boolean;
      brandColorsArray?: string[]; hasBrandFonts?: boolean; brandFontsArray?: string[]; brandFonts?: string;
      yearsInBusiness?: string; licenseNumber?: string; googleBusinessUrl?: string;
      tier?: string; websiteUrl?: string; serviceAreaCities?: string[]; competitorDomains?: string[];
      targetCustomerType?: 'residential' | 'commercial' | 'both'; brandKeywords?: string[]; certifications?: string[];
    };
    const {
      // SECURITY FIX: Removed userId from body - now extracted from auth session
      businessName,
      industry,
      services,
      additionalServices,
      location,
      targetAudience,
      uniqueSellingPoints,
      contactEmail,
      projectType,
      brandColors,
      
      // Business information fields
      businessType,
      primaryService,
      city,
      state,
      phoneNumber,
      streetAddress,
      zipCode,
      operatingHours,
      hasBrandColors,
      brandColorsArray,
      hasBrandFonts,
      brandFontsArray,
      brandFonts,
      yearsInBusiness,
      licenseNumber,
      googleBusinessUrl,

      // Tier & enhanced fields
      tier,
      websiteUrl,
      serviceAreaCities,
      competitorDomains,
      targetCustomerType,
      brandKeywords,
      certifications,
    } = body;

    // Validate required fields (userId no longer needed from body)
    if (!businessName || !industry || !location) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate tier
    const selectedTier: Tier = (tier && VALID_TIERS.includes(tier as Tier)) ? (tier as Tier) : 'basic';

    // Website URL is optional for all tiers - log for tracking purposes
    // Research process will gracefully skip domain-specific analysis if not provided
    if (!websiteUrl) {
      logger.info(`[Session Create] ${selectedTier} tier selected without websiteUrl - domain analysis will be skipped`);
    }

    // SECURITY FIX: Use authenticated userId instead of body userId
    const userId = auth.userId;

    // Layer 1: Rate Limiting (The Shield) - Check before touching database
    const rateLimitResponse = await rateLimitMiddleware(request, userId);
    if (rateLimitResponse) {
      return rateLimitResponse; // Return 429 if rate limit exceeded
    }

    // Layer 2: Concurrency Limit Check (The Logic) - Count active sessions
    const activeSessionCount = await SessionManager.countActiveSessions(userId);
    const MAX_CONCURRENT_SESSIONS = 3;
    
    if (activeSessionCount >= MAX_CONCURRENT_SESSIONS) {
      return NextResponse.json(
        { 
          error: 'Limit of 3 active researches reached.',
          details: `You currently have ${activeSessionCount} active research session(s). Please wait for existing sessions to complete before starting a new one.`
        },
        { status: 429 }
      );
    }

    // Create session (pending when queue enabled so enqueueNextPendingForUser controls who runs)
    const session = await SessionManager.createSession({
      userId,
      businessName,
      industry,
      services,
      additionalServices,
      location,
      targetAudience,
      uniqueSellingPoints,
      contactEmail,
      projectType,
      brandColors,
      
      // Business information fields
      businessType,
      primaryService,
      city,
      state,
      phoneNumber,
      streetAddress,
      zipCode,
      operatingHours,
      hasBrandColors,
      brandColorsArray,
      hasBrandFonts,
      brandFontsArray,
      brandFonts,
      yearsInBusiness,
      licenseNumber,
      googleBusinessUrl,

      // Tier & enhanced fields
      tier: selectedTier,
      websiteUrl,
      serviceAreaCities: Array.isArray(serviceAreaCities) ? serviceAreaCities.filter((c: string) => c?.trim()) : undefined,
      competitorDomains: Array.isArray(competitorDomains) ? competitorDomains.filter((c: string) => c?.trim()) : undefined,
      targetCustomerType,
      brandKeywords: Array.isArray(brandKeywords) ? brandKeywords.filter((k: string) => k?.trim()) : undefined,
      certifications: Array.isArray(certifications) ? certifications.filter((c: string) => c?.trim()) : undefined,
    }, USE_QUEUE_SYSTEM ? { initialStatus: 'pending' } : undefined);

    logger.info(`[Session Create] Created session ${session.id} with tier: ${selectedTier}`);

    if (USE_QUEUE_SYSTEM) {
      try {
        const enqueuedId = await SessionManager.enqueueNextPendingForUser(userId);
        const queued = enqueuedId === session.id;
        if (queued) {
          logger.info('[Session Create] Session enqueued successfully');
        } else {
          logger.info('[Session Create] Session created as pending (another session running for user)');
        }
        return NextResponse.json({
          success: true,
          session,
          queued
        });
      } catch (queueError: any) {
        return handleApiError(queueError, 'Queue research job', 500);
      }
    }

    // Old system: return session, Phase 1 will be triggered by frontend
    logger.info('[Session Create] Queue system disabled, using old system');
    return NextResponse.json({
      success: true,
      session
    });

  } catch (error: any) {
    // SECURITY FIX: Sanitized error - don't expose internal error details
    return handleApiError(error, 'Create session', 500);
  }
}
