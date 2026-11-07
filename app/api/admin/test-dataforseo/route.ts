import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSSRClient } from '@/lib/supabase-server';
import { queueSEOOnlyJob } from '@/lib/queue';
import { SessionManager } from '@/lib/session-manager';
import { USE_QUEUE_SYSTEM } from '@/lib/feature-flags';
import { logger } from '@/lib/secure-logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  }
);

interface TestDataForSEOBody {
  sessionId?: string;
  // Core
  city?: string;
  state?: string;
  zipCode?: string;
  businessName?: string;
  businessType?: string;
  primaryService?: string;
  services?: string;
  additionalServices?: string;
  websiteUrl?: string;
  tier?: 'basic' | 'intermediate' | 'advanced';
  // Location
  streetAddress?: string;
  serviceAreaCities?: string[];
  // Business details
  targetAudience?: string;
  targetCustomerType?: 'residential' | 'commercial' | 'both';
  uniqueSellingPoints?: string;
  operatingHours?: string;
  yearsInBusiness?: string;
  licenseNumber?: string;
  googleBusinessUrl?: string;
  // Competitive intelligence
  competitorDomains?: string[];
  brandKeywords?: string[];
  certifications?: string[];
}

/** POST: Run DataForSEO-only test with full business context. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSSRClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized. You must be logged in as an admin.' },
        { status: 401 }
      );
    }

    const { data: adminConfig } = await serviceSupabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'admin_emails')
      .single();

    const adminEmails = (adminConfig?.config_value as string[]) || [];
    const isAdmin = adminEmails.includes(user.email || '');

    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden. Admin access required.' },
        { status: 403 }
      );
    }

    if (!USE_QUEUE_SYSTEM) {
      return NextResponse.json(
        { error: 'Queue system is not enabled. Enable USE_QUEUE_SYSTEM to run SEO-only tests.' },
        { status: 400 }
      );
    }

    const body = (await request.json()) as TestDataForSEOBody;

    let sessionId: string;

    if (body.sessionId && typeof body.sessionId === 'string') {
      sessionId = body.sessionId.trim();
      const { data: session, error } = await serviceSupabase
        .from('research_sessions')
        .select('id, user_id')
        .eq('id', sessionId)
        .single();
      if (error || !session) {
        return NextResponse.json(
          { error: 'Session not found.' },
          { status: 404 }
        );
      }
      const { data: keys } = await serviceSupabase
        .from('user_api_keys')
        .select('dataforseo_login_encrypted, dataforseo_password_encrypted')
        .eq('user_id', session.user_id)
        .single();
      if (!keys?.dataforseo_login_encrypted || !keys?.dataforseo_password_encrypted) {
        return NextResponse.json(
          { error: 'That session\'s user does not have DataForSEO keys saved. Save keys in API Key Setup first.' },
          { status: 400 }
        );
      }
    } else {
      const city = (body.city ?? '').trim();
      const state = (body.state ?? '').trim();
      const businessName = (body.businessName ?? '').trim();
      const servicesStr = (body.services ?? '').trim();
      const primaryService = (body.primaryService ?? '').trim()
        || servicesStr.split(',').map(s => s.trim()).filter(Boolean)[0]
        || (body.businessType ?? '').trim();
      if (!city || !state || !businessName || !servicesStr) {
        return NextResponse.json(
          { error: 'When not providing sessionId, city, state, businessName, and at least one service are required.' },
          { status: 400 }
        );
      }

      const { data: keys } = await serviceSupabase
        .from('user_api_keys')
        .select('dataforseo_login_encrypted, dataforseo_password_encrypted')
        .eq('user_id', user.id)
        .single();
      if (!keys?.dataforseo_login_encrypted || !keys?.dataforseo_password_encrypted) {
        return NextResponse.json(
          { error: 'Your account does not have DataForSEO keys saved. Save them in API Key Setup first.' },
          { status: 400 }
        );
      }

      const location = [city, state, body.zipCode?.trim()].filter(Boolean).join(', ');
      const tier = body.tier || 'intermediate';

      const session = await SessionManager.createSession({
        userId: user.id,
        businessName,
        industry: body.businessType?.trim() || primaryService,
        services: servicesStr || undefined,
        additionalServices: body.additionalServices?.trim() || undefined,
        location,
        tier,
        primaryService,
        city,
        state,
        zipCode: body.zipCode?.trim() || undefined,
        websiteUrl: body.websiteUrl?.trim() || undefined,
        // Business type
        businessType: body.businessType?.trim() || undefined,
        // Location fields
        streetAddress: body.streetAddress?.trim() || undefined,
        serviceAreaCities: body.serviceAreaCities?.length ? body.serviceAreaCities : undefined,
        // Business details
        targetAudience: body.targetAudience?.trim() || undefined,
        targetCustomerType: body.targetCustomerType || undefined,
        uniqueSellingPoints: body.uniqueSellingPoints?.trim() || undefined,
        operatingHours: body.operatingHours?.trim() || undefined,
        yearsInBusiness: body.yearsInBusiness?.trim() || undefined,
        licenseNumber: body.licenseNumber?.trim() || undefined,
        googleBusinessUrl: body.googleBusinessUrl?.trim() || undefined,
        // Competitive intelligence
        competitorDomains: body.competitorDomains?.length ? body.competitorDomains : undefined,
        brandKeywords: body.brandKeywords?.length ? body.brandKeywords : undefined,
        certifications: body.certifications?.length ? body.certifications : undefined,
      });
      sessionId = session.id;
      logger.info(`[Admin Test DataForSEO] Created test session ${sessionId} (tier=${tier}) for admin ${user.email}`);
    }

    const jobId = await queueSEOOnlyJob(sessionId);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '';
    const resultsUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/results/${sessionId}/download` : '';

    return NextResponse.json({
      ok: true,
      sessionId,
      jobId,
      message: 'SEO-only test job queued. The worker will run Claude keyword gen + DataForSEO waves 1–7 and compile.',
      resultsUrl: resultsUrl || undefined,
    });
  } catch (error: any) {
    logger.error('[Admin Test DataForSEO]', error);
    return NextResponse.json(
      { error: error.message || 'Failed to queue SEO-only test' },
      { status: 500 }
    );
  }
}
