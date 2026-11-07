/**
 * Intermediate SEO Pipeline
 *
 * DataForSEO spec alignment: Intermediate = Phases 0–4, 6–8 (no Phase 5 backlinks).
 * Advanced tier adds Phase 5 backlinks inside Wave 1 (see executeWave1 when tier === 'advanced').
 *
 * Orchestrates the full DataForSEO pipeline (Phases 1–9) WITHOUT backlinks,
 * then runs Phase 9 (compile) and Phase 10 (enhanced AI synthesis).
 *
 * Parallel wave execution with checkpointing:
 * 
 * Wave 1: Location resolution, Domain rank, On-page crawl kick-off,
 *          Lighthouse ×2, GBP lookup, Reviews task_post, Content analysis
 * Wave 2: Claude seed expansion (50 seeds), Keyword suggestions (150/seed, concurrency 10), Related keywords (depth 2), Keywords for site
 * Wave 3: Bulk search volume, Search intent, Competitors domain
 * Wave 4: SERP competitors, Domain intersection ×3, Ranked keywords per competitor (×5)
 * Wave 5: SERP organic Live, Maps Live, Local Finder Live (depth 40), Autocomplete (30/25/25/30 keywords, concurrency 10)
 * Wave 6: On-page summary, Pages, Duplicate tags, Links, Redirects, Microdata, Resources, Lighthouse results ×2
 * Wave 7: Reviews task_get, Q&A, Google Trends
 * 
 * Concurrent: Tavily research (Phases 1-3) runs in parallel with Waves 1-7
 * After all waves: Phase 9 (Data Compilation) → Phase 10 (AI Synthesis)
 */

import { Job } from 'bullmq';
import { supabase, supabaseWithRetry } from './supabase';
import { decrypt } from './encryption';
import { DataForSEOClient, DataForSEOCredentials, DataForSEOBalanceError, withConcurrencyLimit } from './dataforseo-client';
import { DataForSEORateLimiter } from './dataforseo-rate-limiter';
import { logger } from './logger';
import { logServiceUsage } from './audit-logger';
import { processPhase1 } from '../phases/phase1';
import { processPhase2 } from '../phases/phase2';
import { processPhase3 } from '../phases/phase3';
import { processPhase4 } from '../phases/phase4';
import { compileAuditData } from './seo-data-compiler';
import { loadCheckpoint, saveCheckpoint } from './checkpoint-manager';
import { expandSeedKeywords, optimizeSeedsForGoogleAds } from './seed-expansion';
import { filterKeywordsByIntent } from './keyword-classifier';
import { EXCLUDED_COMPETITOR_DOMAINS, isExcludedDomain } from './excluded-domains';

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Build a pingback URL for DataForSEO async tasks.
 * Returns null if webhook is not configured.
 */
function buildPingbackUrl(sessionId: string, taskType?: string): string | null {
  const baseUrl = process.env.DATAFORSEO_WEBHOOK_BASE_URL;
  const secret = process.env.DATAFORSEO_WEBHOOK_SECRET;
  // The app's callback rejects requests without the shared secret, so both are required
  if (!baseUrl || !secret) return null;
  const params = new URLSearchParams();
  if (taskType) {
    params.set('tag', `${sessionId}:${taskType}`);
  }
  if (secret) {
    params.set('secret', secret);
  }

  return `${baseUrl}/api/dataforseo/callback?${params.toString()}&id=$id`;
}

// ─── Types ──────────────────────────────────────────────────────

interface WaveCheckpoint {
  completed_waves: string[];
  current_wave: string | null;
  wave_results: Record<string, any>;
  tavily_complete: boolean;
}

export interface ServiceAreaLocationEntry {
  city: string;
  location_code: number;
  location_name: string;
  google_ads_location_code: number;
  google_ads_location_name: string;
}

interface PipelineContext {
  sessionId: string;
  session: any;
  client: DataForSEOClient;
  rateLimiter: DataForSEORateLimiter;
  /** SERP location code (from /serp/google/locations). Use for SERP/Maps/Business Data calls. */
  locationCode: number;
  locationName: string;
  /** DataForSEO Labs location code — COUNTRY-LEVEL ONLY (Labs endpoints reject city/state codes). */
  labsLocationCode: number;
  labsLocationName: string;
  /** Google Ads Keywords Data location code — CITY-LEVEL (from /keywords_data/google_ads/locations). Use for search_volume, keywords_for_keywords, keywords_for_site, ad_traffic_by_keywords. */
  googleAdsLocationCode: number;
  googleAdsLocationName: string;
  languageCode: string;
  domain: string | null;
  businessName: string;
  primaryService: string;
  city: string;
  state: string;
  pingbackUrlBase: string | null;
  waveResults: Record<string, any>;
  tier: 'intermediate' | 'advanced';
  /** Resolved DataForSEO location_code per service area city (primary + service_area_cities). Populated in Wave 1. */
  serviceAreaLocationCodes: ServiceAreaLocationEntry[];
  /** Decrypted Claude API key for seed expansion in Wave 2. */
  claudeApiKey: string;
  /** Tracks consecutive DataForSEO balance errors across wave API calls. */
  balanceErrorCount: number;
}

const BALANCE_ERROR_THRESHOLD = 3;

/**
 * Check if an error is a DataForSEO balance error and track it.
 * Re-throws if consecutive balance errors exceed the threshold, causing the
 * session to pause instead of continuing with degraded data.
 */
function trackBalanceError(ctx: PipelineContext, err: any): void {
  const isBalanceErr =
    err instanceof DataForSEOBalanceError ||
    err?.name === 'DataForSEOBalanceError' ||
    (typeof err?.message === 'string' && (
      err.message.toLowerCase().includes('insufficient balance') ||
      err.message.toLowerCase().includes('add funds')
    ));

  if (isBalanceErr) {
    ctx.balanceErrorCount++;
    if (ctx.balanceErrorCount >= BALANCE_ERROR_THRESHOLD) {
      const panicErr = new DataForSEOBalanceError(
        `DataForSEO account has insufficient balance (${ctx.balanceErrorCount} consecutive failures). Please add funds at https://app.dataforseo.com/billing`
      );
      throw panicErr;
    }
  }
}

// ─── Main Entry Point ───────────────────────────────────────────

export interface RunIntermediatePipelineOptions {
  /** When true, skip Tavily and Phase 4 (AI synthesis). Used for admin DataForSEO-only testing. */
  seoOnly?: boolean;
}

export async function runIntermediatePipeline(sessionId: string, job: Job, options?: RunIntermediatePipelineOptions): Promise<void> {
  const seoOnly = options?.seoOnly === true;
  logger.debug(`[IntermediatePipeline] Starting ${seoOnly ? 'SEO-only test' : 'Intermediate'} pipeline for session ${sessionId}`);
  
  const startTime = Date.now();

  const { data: session, error: sessionError } = await supabaseWithRetry(
    () => supabase
      .from('research_sessions')
      .select('id, user_id, business_name, industry, primary_service, services, location, city, state, zip_code, tier, phone_number, street_address, operating_hours, website_url, google_business_url, service_area_cities, target_audience, search_radius, location_code, location_name, status, current_phase, api_costs, business_type, dataforseo_tasks')
      .eq('id', sessionId)
      .single(),
    'load session',
  );

  if (sessionError || !session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // ─── Validate all required API keys upfront ───
  // If any key is missing, fail immediately so the user is alerted to re-enter keys.
  const { data: keys } = await supabaseWithRetry(
    () => supabase
      .from('user_api_keys')
      .select('*')
      .eq('user_id', session.user_id)
      .single(),
    'load API keys',
  );

  if (!keys?.dataforseo_login_encrypted || !keys?.dataforseo_password_encrypted) {
    throw new Error('Your DataForSEO API key is missing. Please re-enter your API key in Settings to run research.');
  }
  if (!keys?.claude_api_key_encrypted) {
    throw new Error('Your Claude API key is missing. Please re-enter your API key in Settings to run research.');
  }

  const credentials: DataForSEOCredentials = {
    login: decrypt(keys.dataforseo_login_encrypted),
    password: decrypt(keys.dataforseo_password_encrypted),
  };
  const claudeApiKey = decrypt(keys.claude_api_key_encrypted);

  // Initialize rate limiter and client
  const rateLimiter = new DataForSEORateLimiter();
  const client = new DataForSEOClient(credentials, rateLimiter);

  logServiceUsage(session.user_id, 'dataforseo', 0, sessionId);

  // Load checkpoint
  const checkpoint = await loadWaveCheckpoint(sessionId);

  // Build pipeline context (restore serviceAreaLocationCodes from checkpoint when resuming)
  const ctx: PipelineContext = {
    sessionId,
    session,
    client,
    rateLimiter,
    locationCode: session.location_code || 2840,
    locationName: session.location_name || 'United States',
    labsLocationCode: checkpoint?.wave_results?.labs_location_code || 2840,
    labsLocationName: checkpoint?.wave_results?.labs_location_name || 'United States',
    googleAdsLocationCode: checkpoint?.wave_results?.google_ads_location_code || 2840,
    googleAdsLocationName: checkpoint?.wave_results?.google_ads_location_name || 'United States',
    languageCode: 'en',
    domain: extractDomain(session.website_url),
    businessName: session.business_name || '',
    primaryService: session.primary_service || session.industry || '',
    city: session.city || '',
    state: session.state || '',
    pingbackUrlBase: null,
    waveResults: checkpoint?.wave_results || {},
    tier: (session.tier as 'intermediate' | 'advanced') || 'intermediate',
    serviceAreaLocationCodes: checkpoint?.wave_results?.service_area_location_codes || [],
    claudeApiKey,
    balanceErrorCount: 0,
  };

  // Build pingback URL base from environment
  ctx.pingbackUrlBase = buildPingbackUrl(sessionId);

  try {
    // ─── Run Tavily research concurrently with DataForSEO waves (skip when seoOnly) ───
    const tavilyPromise = seoOnly || checkpoint?.tavily_complete
      ? Promise.resolve()
      : runTavilyResearch(ctx, job);

    // ─── Execute DataForSEO waves sequentially (with internal parallelism) ───
    const waveFns: Array<{ name: string; fn: (ctx: PipelineContext) => Promise<void> }> = [
      { name: 'wave1', fn: executeWave1 },
      { name: 'wave2', fn: executeWave2 },
      { name: 'wave3', fn: executeWave3 },
      { name: 'wave4', fn: executeWave4 },
      { name: 'wave5', fn: executeWave5 },
      { name: 'wave5b', fn: executeWave5b },
      { name: 'wave5c', fn: executeWave5c },
      { name: 'wave6', fn: executeWave6 },
      { name: 'wave7', fn: executeWave7 },
    ];

    const completedWaves = new Set(checkpoint?.completed_waves || []);
    // Track Tavily completion state — starts from checkpoint or false (or true when seoOnly)
    let tavilyComplete = seoOnly || checkpoint?.tavily_complete || false;

    for (const wave of waveFns) {
      if (completedWaves.has(wave.name)) {
        logger.debug(`[IntermediatePipeline] Skipping ${wave.name} (already completed)`);
        continue;
      }

      logger.debug(`[IntermediatePipeline] Starting ${wave.name}...`);
      await updateSessionProgress(sessionId, `Running ${wave.name}...`);

      try {
        await wave.fn(ctx);
      } catch (error: any) {
        logger.error(`[IntermediatePipeline] ${wave.name} error:`, error.message);
        // Save checkpoint with partial results — preserve tavily_complete state
        await saveWaveCheckpoint(sessionId, {
          completed_waves: Array.from(completedWaves),
          current_wave: wave.name,
          wave_results: ctx.waveResults,
          tavily_complete: tavilyComplete,
        });
        throw error;
      }

      completedWaves.add(wave.name);
      await saveWaveCheckpoint(sessionId, {
        completed_waves: Array.from(completedWaves),
        current_wave: null,
        wave_results: ctx.waveResults,
        tavily_complete: tavilyComplete,
      });

      // Update job progress (waves 1-7+5b = 10-66%)
      const waveIndex = waveFns.findIndex(w => w.name === wave.name);
      await job.updateProgress(10 + (waveIndex + 1) * 7);
    }

    // Wait for Tavily to complete
    await tavilyPromise;
    tavilyComplete = true;

    // Save checkpoint with tavily_complete: true so resumption skips Tavily
    await saveWaveCheckpoint(sessionId, {
      completed_waves: Array.from(completedWaves),
      current_wave: null,
      wave_results: ctx.waveResults,
      tavily_complete: true,
    });

    await job.updateProgress(75);

    // ─── Persist wave results ONCE to research_session_dataforseo ───
    logger.debug(`[IntermediatePipeline] Writing wave results to research_session_dataforseo...`);
    await supabase
      .from('research_session_dataforseo')
      .upsert({
        session_id: sessionId,
        wave_results: ctx.waveResults,
        location_code: ctx.locationCode,
        location_name: ctx.locationName,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'session_id' });

    // ─── Phase 9: Data Compilation ───
    logger.debug(`[IntermediatePipeline] Starting Phase 9: Data Compilation...`);
    await updateSessionProgress(sessionId, 'Compiling audit data...');

    // Load session metadata + phase data for compiler (with retry for transient Supabase failures)
    const { data: sessionMeta, error: sessionErr } = await supabaseWithRetry(
      () => supabase
        .from('research_sessions')
        .select('id, location_code, location_name, website_url, business_name, business_type, street_address, city, state, zip_code, phone_number, operating_hours, services, primary_service, industry')
        .eq('id', sessionId)
        .single(),
      'load session for data compilation',
    );

    if (sessionErr || !sessionMeta) {
      const msg = sessionErr
        ? `Session not found for data compilation (${sessionErr.code}: ${sessionErr.message})`
        : `Session not found for data compilation (sessionId: ${sessionId})`;
      logger.error('[IntermediatePipeline]', msg);
      throw new Error(msg);
    }

    // Load phase summaries/citations from dedicated table
    const { data: phaseRows } = await supabaseWithRetry(
      () => supabase
        .from('research_session_phase_data')
        .select('phase, summary, citations')
        .eq('session_id', sessionId),
      'load phase data for compilation',
    );

    const sessionForCompile: any = { ...sessionMeta };
    for (const row of (phaseRows || [])) {
      sessionForCompile[`phase${row.phase}_summary`] = row.summary;
      sessionForCompile[`phase${row.phase}_citations`] = row.citations;
    }

    await compileAuditData(sessionId, ctx.waveResults, ctx.tier, sessionForCompile);
    await job.updateProgress(85);

    // ─── Phase 10: AI Synthesis (skipped when seoOnly) ───
    if (!seoOnly) {
      logger.debug(`[IntermediatePipeline] Starting Phase 10: AI Synthesis...`);
      await updateSessionProgress(sessionId, 'AI synthesis in progress...');
      await processPhase4(sessionId);
      await job.updateProgress(95);
    } else {
      await job.updateProgress(95);
      logger.debug(`[IntermediatePipeline] SEO-only test: skipping Phase 10 (AI synthesis).`);
    }

    // Store DataForSEO cost info
    await supabase
      .from('research_sessions')
      .update({
        api_costs: {
          ...session.api_costs,
          dataforseo: {
            total_cost: client.getCost(),
            total_calls: client.getCallCount(),
          },
        },
      })
      .eq('id', sessionId);

    const totalDuration = Date.now() - startTime;
    logger.debug(`[IntermediatePipeline] DataForSEO pipeline completed in ${Math.round(totalDuration / 1000)}s (cost: $${client.getCost().toFixed(4)})${seoOnly ? ' [SEO-only test]' : ''}`);

  } catch (error: any) {
    logger.error(`[IntermediatePipeline] Pipeline failed:`, error.message);
    throw error;
  }
}

// ─── Wave Implementations ───────────────────────────────────────

/**
 * Wave 1: Initial parallel kickoffs
 * - Location resolution
 * - Domain rank overview (if website URL provided)
 * - Lighthouse ×2 (if website URL provided)
 * - On-page crawl task_post (if website URL provided)
 * - GBP lookup
 * - Reviews task_post
 */
async function executeWave1(ctx: PipelineContext): Promise<void> {
  logger.debug(`[Wave1] Starting parallel kickoffs...`);
  
  const promises: Promise<void>[] = [];

  // 1a. SERP location resolution (for SERP/Maps/Business Data calls)
  promises.push(
    (async () => {
      try {
        const zip = ctx.session.zip_code?.trim() || null;
        const result = await ctx.client.resolveLocationWithFallback(ctx.city, ctx.state, zip);
        ctx.locationCode = result.location_code;
        ctx.locationName = result.location_name;
        ctx.waveResults.location = result;

        logger.debug(`[Wave1] SERP location resolved: ${result.location_name} (${result.location_code})`);
      } catch (e: any) {
        logger.error(`[Wave1] SERP location resolution failed:`, e.message);
        ctx.waveResults.location = { location_code: 2840, location_name: 'United States' };
      }
    })()
  );

  // 1b. Labs location resolution (for DataForSEO Labs endpoints — country-level only)
  promises.push(
    (async () => {
      try {
        const zip = ctx.session.zip_code?.trim() || null;
        const result = await ctx.client.resolveLabsLocationWithFallback(ctx.city, ctx.state, zip);
        ctx.labsLocationCode = result.location_code;
        ctx.labsLocationName = result.location_name;
        ctx.waveResults.labs_location_code = result.location_code;
        ctx.waveResults.labs_location_name = result.location_name;

        logger.debug(`[Wave1] Labs location resolved: ${result.location_name} (${result.location_code})`);
      } catch (e: any) {
        logger.error(`[Wave1] Labs location resolution failed:`, e.message);
        ctx.labsLocationCode = 2840;
        ctx.labsLocationName = 'United States';
      }
    })()
  );

  // 1c. Google Ads Keywords Data location resolution (city-level for search_volume, keywords_for_keywords, etc.)
  promises.push(
    (async () => {
      try {
        const zip = ctx.session.zip_code?.trim() || null;
        const result = await ctx.client.resolveGoogleAdsLocationWithFallback(ctx.city, ctx.state, zip);
        ctx.googleAdsLocationCode = result.location_code;
        ctx.googleAdsLocationName = result.location_name;
        ctx.waveResults.google_ads_location_code = result.location_code;
        ctx.waveResults.google_ads_location_name = result.location_name;

        logger.debug(`[Wave1] Google Ads location resolved: ${result.location_name} (${result.location_code})`);
      } catch (e: any) {
        logger.error(`[Wave1] Google Ads location resolution failed:`, e.message);
        ctx.googleAdsLocationCode = 2840;
        ctx.googleAdsLocationName = 'United States';
      }
    })()
  );

  // 2. Domain rank overview (if website URL provided)
  if (ctx.domain) {
    promises.push(
      (async () => {
        try {
          const result = await ctx.client.domainRankOverview(ctx.domain!, ctx.labsLocationCode);
          ctx.waveResults.domain_rank = result;
          logger.debug(`[Wave1] Domain rank retrieved for ${ctx.domain}`);
        } catch (e: any) {
          logger.error(`[Wave1] Domain rank failed:`, e.message);
          trackBalanceError(ctx, e);
          ctx.waveResults.domain_rank = null;
        }
      })()
    );

    // 3. On-page crawl task_post
    promises.push(
      (async () => {
        try {
          const taskId = await ctx.client.onPageTaskPostEnhanced(
            ctx.session.website_url,
            100, // max 100 pages
            true, // enable JavaScript
            true  // load resources
          );
          ctx.waveResults.onpage_task_id = taskId;
          logger.debug(`[Wave1] On-page crawl task created: ${taskId}`);
        } catch (e: any) {
          logger.error(`[Wave1] On-page crawl failed:`, e.message);
        }
      })()
    );
  }

  // 6. GBP lookup
  promises.push(
    (async () => {
      try {
        const keyword = `${ctx.businessName} ${ctx.city} ${ctx.state}`.trim();
        const results = await ctx.client.searchGoogleMyBusiness(
          keyword,
          ctx.locationCode,
          ctx.languageCode,
          20
        );
        ctx.waveResults.gbp_results = results;

        // Also try to get user's own business
        if (ctx.session.google_business_url) {
          const userBiz = await ctx.client.getBusinessDataByUrl(ctx.session.google_business_url);
          ctx.waveResults.user_business = userBiz;
        }

        logger.debug(`[Wave1] GBP: ${results.length} results`);
      } catch (e: any) {
        logger.error(`[Wave1] GBP lookup failed:`, e.message);
        trackBalanceError(ctx, e);
        ctx.waveResults.gbp_results = [];
      }
    })()
  );

  // 7. Reviews task_post
  promises.push(
    (async () => {
      try {
        const keyword = ctx.businessName || `${ctx.primaryService} ${ctx.city}`;
        const taskId = await ctx.client.googleReviewsTaskPost(keyword, ctx.locationCode, 100);
        ctx.waveResults.reviews_task_id = taskId;
        logger.debug(`[Wave1] Reviews task created: ${taskId}`);
      } catch (e: any) {
        logger.error(`[Wave1] Reviews task failed:`, e.message);
      }
    })()
  );

  // 8. Backlinks (Advanced tier only — runs in parallel with Wave 1 per spec Phase 5)
  if (ctx.tier === 'advanced' && ctx.domain) {
    const competitorDomains: string[] = ctx.session.competitor_domains || [];
    promises.push(
      (async () => {
        try {
          const backlinksResults = await runBacklinksInWave1(ctx.client, ctx.domain!, competitorDomains);
          ctx.waveResults.backlinks_summary = backlinksResults.backlinks_summary;
          ctx.waveResults.referring_domains = backlinksResults.referring_domains;
          ctx.waveResults.anchor_texts = backlinksResults.anchor_texts;
          ctx.waveResults.backlink_competitors = backlinksResults.backlink_competitors;
          ctx.waveResults.backlinks_domain_intersection = backlinksResults.backlinks_domain_intersection;
          ctx.waveResults.backlinks_list = backlinksResults.backlinks_list || [];
          ctx.waveResults.backlinks_history = backlinksResults.backlinks_history || [];
          ctx.waveResults.backlinks_domain_pages = backlinksResults.backlinks_domain_pages || [];
          ctx.waveResults.backlinks_referring_networks = backlinksResults.backlinks_referring_networks || [];
          ctx.waveResults.backlinks_timeseries = backlinksResults.backlinks_timeseries || [];
          ctx.waveResults.backlinks_new_lost_timeseries = backlinksResults.backlinks_new_lost_timeseries || [];
          logger.debug(`[Wave1] Backlinks complete for ${ctx.domain}`);
        } catch (e: any) {
          logger.error(`[Wave1] Backlinks failed:`, e.message);
          trackBalanceError(ctx, e);
          ctx.waveResults.backlinks_summary = null;
          ctx.waveResults.referring_domains = [];
          ctx.waveResults.anchor_texts = [];
          ctx.waveResults.backlink_competitors = [];
          ctx.waveResults.backlinks_domain_intersection = [];
          ctx.waveResults.backlinks_list = [];
          ctx.waveResults.backlinks_history = [];
          ctx.waveResults.backlinks_domain_pages = [];
          ctx.waveResults.backlinks_referring_networks = [];
          ctx.waveResults.backlinks_timeseries = [];
          ctx.waveResults.backlinks_new_lost_timeseries = [];
        }
      })()
    );
  }

  await Promise.allSettled(promises);

  // Resolve location_code per service area city (primary + service_area_cities) for local data per area
  const primaryCity = (ctx.city || '').trim();
  const state = (ctx.state || '').trim();
  const serviceAreaCities: string[] = Array.isArray(ctx.session.service_area_cities)
    ? ctx.session.service_area_cities.map((c: string) => (c || '').trim()).filter(Boolean)
    : [];
  const citiesToResolve = new Map<string, string>(); // normalized key -> display name
  if (primaryCity) {
    citiesToResolve.set(primaryCity.toLowerCase(), primaryCity);
  }
  for (const c of serviceAreaCities) {
    if (c && !citiesToResolve.has(c.toLowerCase())) {
      citiesToResolve.set(c.toLowerCase(), c);
    }
  }
  const resolved: ServiceAreaLocationEntry[] = [];
  for (const cityName of citiesToResolve.values()) {
    try {
      const serpResult = await ctx.client.resolveLocationWithFallback(cityName, state);
      let gadsCode = ctx.googleAdsLocationCode;
      let gadsName = ctx.googleAdsLocationName;
      try {
        const gadsResult = await ctx.client.resolveGoogleAdsLocationWithFallback(cityName, state);
        gadsCode = gadsResult.location_code;
        gadsName = gadsResult.location_name;
      } catch (gadsErr: any) {
        logger.warn(`[Wave1] Google Ads location resolve failed for "${cityName}", using primary: ${gadsErr.message}`);
      }
      resolved.push({
        city: cityName,
        location_code: serpResult.location_code,
        location_name: serpResult.location_name,
        google_ads_location_code: gadsCode,
        google_ads_location_name: gadsName,
      });
      logger.debug(`[Wave1] Service area location: ${cityName} → SERP ${serpResult.location_name} (${serpResult.location_code}), Google Ads ${gadsName} (${gadsCode})`);
    } catch (e: any) {
      console.warn(`[Wave1] Location resolve failed for "${cityName}":`, e.message);
      resolved.push({
        city: cityName,
        location_code: ctx.locationCode,
        location_name: ctx.locationName,
        google_ads_location_code: ctx.googleAdsLocationCode,
        google_ads_location_name: ctx.googleAdsLocationName,
      });
    }
  }
  if (resolved.length === 0 && primaryCity) {
    resolved.push({
      city: primaryCity,
      location_code: ctx.locationCode,
      location_name: ctx.locationName,
      google_ads_location_code: ctx.googleAdsLocationCode,
      google_ads_location_name: ctx.googleAdsLocationName,
    });
  }
  ctx.serviceAreaLocationCodes = resolved;
  ctx.waveResults.service_area_location_codes = resolved;

  // Backlinks data stays in ctx.waveResults (in-memory) and will be
  // persisted to research_session_dataforseo after all waves complete.

  logger.debug(`[Wave1] Complete`);
}

/**
 * Wave 2: Keyword Discovery (Two Parallel Pipelines)
 *
 * ORGANIC DISCOVERY (parallel group):
 *   - Claude seed expansion → 300-1,000 intent-classified keywords
 *   - Labs keywords_for_site → keywords domain ranks for organically
 *
 * PAID DISCOVERY (sequential):
 *   - Step 1: Claude seed optimizer → 20 optimized Google Ads seeds
 *   - Step 2: Google Ads keywords_for_keywords → up to 20K suggestions
 *   - Step 3: Google Ads keywords_for_site → ad targeting suggestions (if domain)
 *
 * Both groups run in parallel.
 */
async function executeWave2(ctx: PipelineContext): Promise<void> {
  logger.debug(`[Wave2] Starting keyword discovery (organic + paid pipelines)...`);

  // ─── ORGANIC DISCOVERY (parallel group) ───

  const organicDiscoveryPromise = (async () => {
    const claudePromise = expandSeedKeywords({
      claudeApiKey: ctx.claudeApiKey,
      session: ctx.session,
      userId: ctx.session.user_id,
      sessionId: ctx.sessionId,
      serviceAreaLocationCodes: ctx.serviceAreaLocationCodes,
    });

    const siteKeywordsPromise = ctx.domain
      ? (async () => {
          try {
            const keywords = await ctx.client.keywordsForSite(ctx.domain!, ctx.labsLocationCode, ctx.languageCode, 500);
            ctx.waveResults.keywords_for_site = keywords;
            logger.debug(`[Wave2] Labs Keywords for Site: ${keywords.length}`);
          } catch (e: any) {
            logger.error(`[Wave2] Labs Keywords for Site failed:`, e.message);
            trackBalanceError(ctx, e);
            ctx.waveResults.keywords_for_site = [];
          }
        })()
      : Promise.resolve();

    const [claudeResult] = await Promise.all([claudePromise, siteKeywordsPromise]);

    // Store Claude results
    if (claudeResult) {
      ctx.waveResults.claude_keywords = claudeResult.keywords;
      ctx.waveResults.claude_keyword_summary = claudeResult.summary;
      ctx.waveResults.seed_keywords = claudeResult.flatKeywords;
      ctx.waveResults.seed_keywords_source = 'claude';
      ctx.waveResults.seed_keywords_claude_count = claudeResult.totalCount;
      ctx.waveResults.claude_tier_counts = claudeResult.tierCounts;
      logger.debug(`[Wave2] Claude generated ${claudeResult.totalCount} keywords: ${JSON.stringify(claudeResult.tierCounts)}`);
    } else {
      logger.warn(`[Wave2] Claude keyword generation failed; falling back to form-based seeds`);
      ctx.waveResults.claude_keywords = [];
      ctx.waveResults.seed_keywords_source = 'form-only';
      ctx.waveResults.seed_keywords_claude_count = 0;

      const formSeeds: string[] = [];
      const primaryService = (ctx.primaryService || '').trim().toLowerCase();
      if (primaryService) formSeeds.push(primaryService);
      const services = ctx.session.services?.split(',')
        .map((s: string) => s.trim().toLowerCase())
        .filter(Boolean) || [];
      for (const svc of services) {
        if (!formSeeds.includes(svc)) formSeeds.push(svc);
      }
      ctx.waveResults.seed_keywords = formSeeds;
    }
  })();

  // ─── PAID DISCOVERY (sequential within, parallel with organic) ───

  const paidDiscoveryPromise = (async () => {
    try {
      // Step 1: Claude seed optimizer → 20 optimized Google Ads seeds
      const services = ctx.session.services?.split(',').map((s: string) => s.trim()).filter(Boolean) || [];
      const additionalServices = ctx.session.additional_services?.split(',').map((s: string) => s.trim()).filter(Boolean) || [];

      const googleAdsSeeds = await optimizeSeedsForGoogleAds({
        claudeApiKey: ctx.claudeApiKey,
        services,
        additionalServices,
        industry: ctx.session.industry || ctx.session.business_type || '',
        city: ctx.city,
        state: ctx.state,
        businessName: ctx.businessName,
      });

      ctx.waveResults.google_ads_seeds_used = googleAdsSeeds;
      logger.debug(`[Wave2] Claude generated ${googleAdsSeeds.length} Google Ads seeds`);

      if (googleAdsSeeds.length === 0) {
        logger.warn(`[Wave2] No Google Ads seeds generated, skipping paid discovery`);
        ctx.waveResults.google_ads_keyword_suggestions = [];
        ctx.waveResults.google_ads_keyword_suggestions_by_city = {};
        ctx.waveResults.google_ads_keywords_for_site = [];
        ctx.waveResults.google_ads_keywords_for_site_by_city = {};
        return;
      }

      // Step 2: Google Ads keywords_for_keywords → per-city keyword suggestions
      const areas = ctx.serviceAreaLocationCodes?.length
        ? ctx.serviceAreaLocationCodes
        : [{ city: ctx.city, location_code: ctx.locationCode, location_name: ctx.locationName, google_ads_location_code: ctx.googleAdsLocationCode, google_ads_location_name: ctx.googleAdsLocationName }];

      const suggestionsByCity: Record<string, any[]> = {};
      const mergedSuggestionMap = new Map<string, any>();

      for (const area of areas) {
        try {
          const gadsCode = area.google_ads_location_code || ctx.googleAdsLocationCode;
          const citySuggestions = await ctx.client.keywordsForKeywords(googleAdsSeeds, gadsCode, ctx.languageCode);
          suggestionsByCity[area.city] = citySuggestions;
          logger.debug(`[Wave2] keywords_for_keywords for ${area.city}: ${citySuggestions.length} results (location ${gadsCode})`);

          for (const kw of citySuggestions) {
            const key = kw.keyword?.toLowerCase();
            if (!key) continue;
            const existing = mergedSuggestionMap.get(key);
            if (!existing || (kw.search_volume || 0) > (existing.search_volume || 0)) {
              mergedSuggestionMap.set(key, kw);
            }
          }
        } catch (cityErr: any) {
          logger.error(`[Wave2] keywords_for_keywords failed for ${area.city}:`, cityErr.message);
          trackBalanceError(ctx, cityErr);
          suggestionsByCity[area.city] = [];
        }
      }

      const rawSuggestions = Array.from(mergedSuggestionMap.values());
      ctx.waveResults.google_ads_keyword_suggestions_by_city = suggestionsByCity;
      logger.debug(`[Wave2] Google Ads keywords_for_keywords: ${rawSuggestions.length} merged across ${Object.keys(suggestionsByCity).length} cities`);

      // Step 2b: Remove zero volume, then classify intent with DataForSEO
      const nonZero = rawSuggestions.filter(kw => kw.search_volume > 0);
      const zeroVolumeCount = rawSuggestions.length - nonZero.length;
      logger.debug(`[Wave2] Removed ${zeroVolumeCount} zero-volume keywords, classifying ${nonZero.length} remaining`);

      // Classify intent via DataForSEO Labs search_intent endpoint (~$0.00035/keyword)
      const keywordsToClassify = nonZero.map(kw => kw.keyword);
      let intentMap = new Map<string, string>();
      try {
        const intentResults = await ctx.client.searchIntentClassification(keywordsToClassify, ctx.labsLocationCode, ctx.languageCode);
        for (const ir of intentResults) {
          intentMap.set(ir.keyword.toLowerCase(), ir.search_intent);
        }
        logger.debug(`[Wave2] DataForSEO classified intent for ${intentResults.length} keywords`);

        ctx.waveResults.google_ads_intents = intentResults;
      } catch (e: any) {
        logger.error(`[Wave2] Intent classification failed, proceeding with unknown intents:`, e.message);
        trackBalanceError(ctx, e);
        ctx.waveResults.google_ads_intents = [];
      }

      // Step 2c: Apply intent-based MSV thresholds
      const keywordsWithIntent = nonZero.map(kw => ({
        ...kw,
        intent_label: intentMap.get(kw.keyword.toLowerCase()) || 'unknown',
      }));

      const { kept: filtered, stats: filterStats } = filterKeywordsByIntent(keywordsWithIntent, rawSuggestions.length);

      filtered.sort((a, b) => b.search_volume - a.search_volume);

      ctx.waveResults.google_ads_keyword_suggestions = filtered;
      ctx.waveResults.google_ads_filter_stats = filterStats;
      logger.debug(`[Wave2] Intent-filtered from ${rawSuggestions.length} → ${filtered.length} Google Ads keyword suggestions`);

      // Step 3: Google Ads keywords_for_site → per-city ad targeting suggestions
      const siteKwsByCity: Record<string, any[]> = {};
      const mergedSiteKwMap = new Map<string, any>();

      if (ctx.domain) {
        for (const area of areas) {
          try {
            const gadsCode = area.google_ads_location_code || ctx.googleAdsLocationCode;
            const cityKws = await ctx.client.googleAdsKeywordsForSite(ctx.domain!, gadsCode, ctx.languageCode);
            siteKwsByCity[area.city] = cityKws;
            logger.debug(`[Wave2] keywords_for_site for ${area.city}: ${cityKws.length} results (location ${gadsCode})`);

            for (const kw of cityKws) {
              const key = kw.keyword?.toLowerCase();
              if (!key) continue;
              const existing = mergedSiteKwMap.get(key);
              if (!existing || (kw.search_volume || 0) > (existing.search_volume || 0)) {
                mergedSiteKwMap.set(key, kw);
              }
            }
          } catch (cityErr: any) {
            logger.error(`[Wave2] keywords_for_site failed for ${area.city}:`, cityErr.message);
            trackBalanceError(ctx, cityErr);
            siteKwsByCity[area.city] = [];
          }
        }
      }

      ctx.waveResults.google_ads_keywords_for_site = Array.from(mergedSiteKwMap.values());
      ctx.waveResults.google_ads_keywords_for_site_by_city = siteKwsByCity;
      logger.debug(`[Wave2] Google Ads keywords_for_site: ${ctx.waveResults.google_ads_keywords_for_site.length} merged across ${Object.keys(siteKwsByCity).length} cities`);
    } catch (e: any) {
      logger.error(`[Wave2] Paid discovery pipeline failed:`, e.message);
      trackBalanceError(ctx, e);
      ctx.waveResults.google_ads_keyword_suggestions = [];
      ctx.waveResults.google_ads_keyword_suggestions_by_city = {};
      ctx.waveResults.google_ads_keywords_for_site = [];
      ctx.waveResults.google_ads_keywords_for_site_by_city = {};
      ctx.waveResults.google_ads_seeds_used = [];
    }
  })();

  // ─── Run both pipelines in parallel ───
  await Promise.all([organicDiscoveryPromise, paidDiscoveryPromise]);

  const totalKeywords = (ctx.waveResults.claude_keywords?.length || 0)
    + (ctx.waveResults.keywords_for_site?.length || 0)
    + (ctx.waveResults.google_ads_keyword_suggestions?.length || 0)
    + (ctx.waveResults.google_ads_keywords_for_site?.length || 0);

  logger.debug(`[Wave2] Complete — ${ctx.waveResults.claude_keywords?.length || 0} Claude, ${ctx.waveResults.keywords_for_site?.length || 0} Labs site, ${ctx.waveResults.google_ads_keyword_suggestions?.length || 0} Google Ads suggestions, ${ctx.waveResults.google_ads_keywords_for_site?.length || 0} Google Ads site (total: ${totalKeywords})`);
}

/**
 * Wave 3: Keyword Enrichment (needs keyword list from Wave 2)
 */
async function executeWave3(ctx: PipelineContext): Promise<void> {
  logger.debug(`[Wave3] Starting keyword enrichment (organic + paid)...`);

  // Deduplicate keywords from all Wave 2 sources (organic + paid)
  const allKeywords = new Set<string>();
  for (const kw of (ctx.waveResults.claude_keywords || [])) allKeywords.add(kw.keyword);
  for (const kw of (ctx.waveResults.keywords_for_site || [])) allKeywords.add(kw.keyword);
  for (const kw of (ctx.waveResults.google_ads_keyword_suggestions || [])) allKeywords.add(kw.keyword);
  for (const kw of (ctx.waveResults.google_ads_keywords_for_site || [])) allKeywords.add(kw.keyword);
  
  const dedupedKeywords = Array.from(allKeywords);
  logger.debug(`[Wave3] ${dedupedKeywords.length} unique keywords to enrich`);

  const promises: Promise<void>[] = [];

  // ─── SHARED ENRICHMENT ───

  // 1. Bulk search volume per service area city (Google Ads — authoritative for volume, CPC, competition)
  // Results used by BOTH organic and paid analysis
  if (dedupedKeywords.length > 0) {
    promises.push(
      (async () => {
        try {
          const volumeByCity: Record<string, any[]> = {};
          for (const area of ctx.serviceAreaLocationCodes) {
            try {
              const gadsCode = area.google_ads_location_code || ctx.googleAdsLocationCode;
              const cityVolume = await ctx.client.bulkSearchVolume(dedupedKeywords, gadsCode, ctx.languageCode);
              volumeByCity[area.city] = cityVolume;
              logger.debug(`[Wave3] Search volume for ${area.city}: ${cityVolume.length} results (location ${gadsCode})`);
            } catch (cityErr: any) {
              logger.error(`[Wave3] Search volume failed for ${area.city}:`, cityErr.message);
              trackBalanceError(ctx, cityErr);
              volumeByCity[area.city] = [];
            }
          }
          ctx.waveResults.bulk_search_volume_by_city = volumeByCity;
          ctx.waveResults.bulk_search_volume = volumeByCity[ctx.city] || Object.values(volumeByCity)[0] || [];
          const totalResults = Object.values(volumeByCity).reduce((sum, arr) => sum + arr.length, 0);
          logger.debug(`[Wave3] Search volume: ${totalResults} total results across ${Object.keys(volumeByCity).length} cities`);
        } catch (e: any) {
          logger.error(`[Wave3] Search volume failed:`, e.message);
          trackBalanceError(ctx, e);
          ctx.waveResults.bulk_search_volume_by_city = {};
          ctx.waveResults.bulk_search_volume = [];
        }
      })()
    );

    // ─── ORGANIC ENRICHMENT ───

    // 2. Search intent classification
    // Skip keywords already classified in Wave 2 (Google Ads suggestions) to avoid paying twice
    promises.push(
      (async () => {
        try {
          const alreadyClassified = new Set<string>();
          for (const ir of (ctx.waveResults.google_ads_intents || [])) {
            alreadyClassified.add(ir.keyword.toLowerCase());
          }
          const needsClassification = dedupedKeywords.filter(kw => !alreadyClassified.has(kw.toLowerCase()));
          logger.debug(`[Wave3] ${alreadyClassified.size} keywords already classified in Wave 2, classifying ${needsClassification.length} remaining`);

          let newIntents = needsClassification.length > 0
            ? await ctx.client.searchIntentClassification(needsClassification, ctx.labsLocationCode, ctx.languageCode)
            : [];

          // Merge Wave 2 intents with newly classified intents
          const allIntents = [...(ctx.waveResults.google_ads_intents || []), ...newIntents];
          ctx.waveResults.search_intents = allIntents;
          logger.debug(`[Wave3] Search intents: ${allIntents.length} total (${newIntents.length} new + ${ctx.waveResults.google_ads_intents?.length || 0} from Wave 2)`);
        } catch (e: any) {
          logger.error(`[Wave3] Search intent failed:`, e.message);
          trackBalanceError(ctx, e);
          ctx.waveResults.search_intents = ctx.waveResults.google_ads_intents || [];
        }
      })()
    );

    // 3. Bulk keyword difficulty (Labs — provides difficulty scores + trend)
    promises.push(
      (async () => {
        try {
          const difficulty = await ctx.client.keywordOverview(dedupedKeywords, ctx.labsLocationCode, ctx.languageCode);
          ctx.waveResults.keyword_difficulty = difficulty;
          logger.debug(`[Wave3] Keyword difficulty: ${difficulty.length} results`);
        } catch (e: any) {
          logger.error(`[Wave3] Keyword difficulty failed:`, e.message);
          trackBalanceError(ctx, e);
          ctx.waveResults.keyword_difficulty = [];
        }
      })()
    );

    // ─── PAID ENRICHMENT ───

    // 4. Ad traffic by keywords per service area city (Google Ads — impressions, CTR, cost, clicks projections)
    // Run on the top commercial/transactional keywords from paid discovery, capped at 1000
    promises.push(
      (async () => {
        try {
          const paidKeywordSet = new Set<string>();
          for (const kw of (ctx.waveResults.google_ads_keyword_suggestions || [])) {
            paidKeywordSet.add(kw.keyword);
          }
          for (const kw of (ctx.waveResults.google_ads_keywords_for_site || [])) {
            paidKeywordSet.add(kw.keyword);
          }
          for (const kw of (ctx.waveResults.claude_keywords || []).slice(0, 200)) {
            paidKeywordSet.add(kw.keyword);
          }

          const paidKeywords = Array.from(paidKeywordSet).slice(0, 1000);

          if (paidKeywords.length > 0) {
            const adTrafficByCity: Record<string, any[]> = {};
            for (const area of ctx.serviceAreaLocationCodes) {
              try {
                const gadsCode = area.google_ads_location_code || ctx.googleAdsLocationCode;
                const traffic = await ctx.client.adTrafficByKeywords(paidKeywords, gadsCode, ctx.languageCode, 999, 'exact');
                adTrafficByCity[area.city] = traffic;
                logger.debug(`[Wave3] Ad traffic for ${area.city}: ${traffic.length} results`);
              } catch (cityErr: any) {
                logger.error(`[Wave3] Ad traffic failed for ${area.city}:`, cityErr.message);
                trackBalanceError(ctx, cityErr);
                adTrafficByCity[area.city] = [];
              }
            }
            ctx.waveResults.ad_traffic_by_city = adTrafficByCity;
            ctx.waveResults.ad_traffic = adTrafficByCity[ctx.city] || Object.values(adTrafficByCity)[0] || [];
            logger.debug(`[Wave3] Ad traffic: ${Object.values(adTrafficByCity).reduce((s, a) => s + a.length, 0)} total results across ${Object.keys(adTrafficByCity).length} cities`);
          } else {
            ctx.waveResults.ad_traffic_by_city = {};
            ctx.waveResults.ad_traffic = [];
          }
        } catch (e: any) {
          logger.error(`[Wave3] Ad traffic failed:`, e.message);
          trackBalanceError(ctx, e);
          ctx.waveResults.ad_traffic_by_city = {};
          ctx.waveResults.ad_traffic = [];
        }
      })()
    );
  }

  // 5. Competitors domain (organic)
  if (ctx.domain) {
    promises.push(
      (async () => {
        try {
          const competitors = await ctx.client.competitorsDomain(ctx.domain!, ctx.labsLocationCode, ctx.languageCode, 20);
          ctx.waveResults.competitors_domain = competitors;
          logger.debug(`[Wave3] Domain competitors: ${competitors.length}`);
        } catch (e: any) {
          logger.error(`[Wave3] Domain competitors failed:`, e.message);
          trackBalanceError(ctx, e);
          ctx.waveResults.competitors_domain = [];
        }
      })()
    );
  }

  await Promise.allSettled(promises);
  logger.debug(`[Wave3] Complete`);
}

/**
 * Wave 4: Competitive Deep Dive (needs competitors from Wave 3 or SERP when no domain)
 */
async function executeWave4(ctx: PipelineContext): Promise<void> {
  logger.debug(`[Wave4] Starting competitive deep dive...`);

  const topKeywords = getTopRelevantKeywords(
    ctx.waveResults, 10,
    ctx.primaryService,
    ctx.session.services || '',
    ctx.session.additional_services || '',
    ctx.session.industry || ctx.session.business_type || ''
  );

  // 1. Run SERP competitors first so we can use them as competitor list when no website
  if (topKeywords.length > 0) {
    try {
      const serpComps = await ctx.client.serpCompetitorsForKeywords(topKeywords, ctx.labsLocationCode, ctx.languageCode, 20);
      ctx.waveResults.serp_competitors = serpComps.filter(
        (c: any) => !isExcludedDomain(c.domain)
      );
      logger.debug(`[Wave4] SERP competitors: ${ctx.waveResults.serp_competitors.length} (${serpComps.length - ctx.waveResults.serp_competitors.length} mega-sites filtered)`);
    } catch (e: any) {
      logger.error(`[Wave4] SERP competitors failed:`, e.message);
      trackBalanceError(ctx, e);
      ctx.waveResults.serp_competitors = [];
    }
  }

  // Filter mega-sites from competitors_domain (Wave 3 organic competitors)
  if (ctx.waveResults.competitors_domain?.length) {
    const before = ctx.waveResults.competitors_domain.length;
    ctx.waveResults.competitors_domain = ctx.waveResults.competitors_domain.filter(
      (c: any) => !isExcludedDomain(c.domain)
    );
    if (before !== ctx.waveResults.competitors_domain.length) {
      logger.debug(`[Wave4] Filtered ${before - ctx.waveResults.competitors_domain.length} mega-sites from organic competitors`);
    }
  }

  // No-website case: use SERP competitors as primary organic competitor list
  if (!ctx.domain && (ctx.waveResults.serp_competitors?.length ?? 0) > 0) {
    ctx.waveResults.competitors_domain = ctx.waveResults.serp_competitors;
    logger.debug(`[Wave4] Using ${ctx.waveResults.competitors_domain.length} SERP competitors (no domain)`);
  }

  const competitors: Array<{ domain: string }> = ctx.waveResults.competitors_domain || [];
  const userCompetitors = ctx.session.competitor_domains || [];
  const allCompetitorDomains = new Set<string>();
  for (const comp of competitors.slice(0, 10)) allCompetitorDomains.add(comp.domain);
  for (const domain of userCompetitors) allCompetitorDomains.add(domain);
  const topCompetitors = Array.from(allCompetitorDomains).slice(0, 5);

  const promises: Promise<void>[] = [];

  // 2. Domain intersection for top 3 competitors (only when we have a domain)
  if (ctx.domain && topCompetitors.length > 0) {
    for (const compDomain of topCompetitors.slice(0, 3)) {
      promises.push(
        (async () => {
          try {
            const intersection = await ctx.client.domainIntersection(ctx.domain!, compDomain, ctx.labsLocationCode, ctx.languageCode, 200);
            if (!ctx.waveResults.domain_intersections) ctx.waveResults.domain_intersections = {};
            ctx.waveResults.domain_intersections[compDomain] = intersection;
            logger.debug(`[Wave4] Domain intersection (${compDomain}): ${intersection.length} keywords`);
          } catch (e: any) {
            logger.error(`[Wave4] Domain intersection (${compDomain}) failed:`, e.message);
            trackBalanceError(ctx, e);
          }
        })()
      );
    }
  }

  // 3. Ranked keywords for each competitor (top 5)
  for (const compDomain of topCompetitors) {
    promises.push(
      (async () => {
        try {
          const rankedKws = await ctx.client.rankedKeywords(compDomain, ctx.labsLocationCode, ctx.languageCode, 200);
          if (!ctx.waveResults.competitor_ranked_keywords) ctx.waveResults.competitor_ranked_keywords = {};
          ctx.waveResults.competitor_ranked_keywords[compDomain] = rankedKws;
          logger.debug(`[Wave4] Ranked keywords for ${compDomain}: ${rankedKws.length}`);
        } catch (e: any) {
          logger.error(`[Wave4] Ranked keywords (${compDomain}) failed:`, e.message);
          trackBalanceError(ctx, e);
        }
      })()
    );
  }

  // 4. Bulk traffic estimation for competitor domains (Labs — organic traffic volumes)
  const allCompDomainsForTraffic = Array.from(allCompetitorDomains).slice(0, 10);
  if (allCompDomainsForTraffic.length > 0) {
    promises.push(
      (async () => {
        try {
          const trafficEst = await ctx.client.bulkTrafficEstimation(allCompDomainsForTraffic, ctx.labsLocationCode, ctx.languageCode);
          ctx.waveResults.competitor_traffic_estimation = trafficEst;
          logger.debug(`[Wave4] Bulk traffic estimation: ${trafficEst.length} domains`);
        } catch (e: any) {
          logger.error(`[Wave4] Bulk traffic estimation failed:`, e.message);
          trackBalanceError(ctx, e);
          ctx.waveResults.competitor_traffic_estimation = [];
        }
      })()
    );
  }

  await Promise.allSettled(promises);
  logger.debug(`[Wave4] Complete`);
}

/**
 * Wave 5: SERP Analysis — Live endpoints with comprehensive keyword coverage
 * 
 * Uses real-time Live endpoints (no polling) with concurrency pool of 10.
 * - Organic SERP: top 30 keywords
 * - Maps SERP: top 25 keywords
 * - Local Finder: top 15 keywords, depth 40
 * - Autocomplete: top 15 keywords
 * All types use service-relevance-prioritized keywords (60 calls/city).
 */
async function executeWave5(ctx: PipelineContext): Promise<void> {
  logger.debug(`[Wave5] Starting Live SERP analysis (comprehensive coverage)...`);

  // All SERP types use relevance-prioritized keywords (Claude seeds first, then service-relevant, then volume)
  const serpKeywords = getTopRelevantKeywords(
    ctx.waveResults, 15,
    ctx.primaryService,
    ctx.session.services || '',
    ctx.session.additional_services || '',
    ctx.session.industry || ctx.session.business_type || ''
  );

  logger.debug(`[Wave5] SERP keywords (${serpKeywords.length}): ${serpKeywords.slice(0, 5).join(', ')}${serpKeywords.length > 5 ? '...' : ''}`);

  // Cities to run SERP for: all service area cities
  const areaCodes = ctx.serviceAreaLocationCodes?.length
    ? ctx.serviceAreaLocationCodes
    : [{ city: (ctx.city || '').trim(), location_code: ctx.locationCode, location_name: ctx.locationName, google_ads_location_code: ctx.googleAdsLocationCode, google_ads_location_name: ctx.googleAdsLocationName }];
  const citiesForSerp = areaCodes;
  const callsPerCity = serpKeywords.length * 4;
  if (citiesForSerp.length > 5) {
    logger.warn(`[Wave5] Running SERP analysis for ${citiesForSerp.length} cities — expect ~${citiesForSerp.length * callsPerCity} API calls`);
  }

  const organicResultsByCity: Record<string, Record<string, any>> = {};
  const mapsResultsByCity: Record<string, Record<string, any>> = {};
  const localResultsByCity: Record<string, Record<string, any>> = {};
  const autocompleteResultsByCity: Record<string, Array<{ keyword: string; suggestions: string[] }>> = {};

  // Build all task closures across all cities
  const allTasks: (() => Promise<void>)[] = [];

  for (const entry of citiesForSerp) {
    const cityName = (entry.city || '').trim();
    const locCode = entry.location_code;
    const locationQuery = `${cityName} ${ctx.state}`.trim();
    if (!cityName) continue;

    organicResultsByCity[cityName] = {};
    mapsResultsByCity[cityName] = {};
    localResultsByCity[cityName] = {};
    autocompleteResultsByCity[cityName] = [];

    for (const kw of serpKeywords) {
      const kwWithLoc = `${kw} ${locationQuery}`;

      // 1. Organic SERP Live
      allTasks.push(async () => {
        try {
          const result = await ctx.client.serpOrganicLive(kwWithLoc, locCode, ctx.languageCode);
          organicResultsByCity[cityName][kwWithLoc] = result;
        } catch (e: any) {
          logger.error(`[Wave5] Live organic failed for "${kw}" (${cityName}):`, e.message);
          trackBalanceError(ctx, e);
        }
      });

      // 2. Maps SERP Live
      allTasks.push(async () => {
        try {
          const result = await ctx.client.serpMapsLive(kwWithLoc, locCode, ctx.languageCode);
          mapsResultsByCity[cityName][kwWithLoc] = result;
        } catch (e: any) {
          logger.error(`[Wave5] Live Maps failed for "${kw}" (${cityName}):`, e.message);
          trackBalanceError(ctx, e);
        }
      });

      // 3. Local Finder Live (depth 40)
      allTasks.push(async () => {
        try {
          const result = await ctx.client.serpLocalFinderLive(kwWithLoc, locCode, ctx.languageCode, 40);
          localResultsByCity[cityName][kwWithLoc] = result;
        } catch (e: any) {
          logger.error(`[Wave5] Live Local Finder failed for "${kw}" (${cityName}):`, e.message);
          trackBalanceError(ctx, e);
        }
      });

      // 4. Autocomplete Live
      allTasks.push(async () => {
        try {
          const result = await ctx.client.serpAutocomplete(`${kw} ${locationQuery}`, locCode, ctx.languageCode);
          autocompleteResultsByCity[cityName].push(result);
        } catch (e: any) {
          logger.error(`[Wave5] Autocomplete failed for "${kw}" (${cityName}):`, e.message);
          trackBalanceError(ctx, e);
        }
      });
    }
  }

  logger.debug(`[Wave5] Running ${allTasks.length} Live SERP requests (concurrency: 10)...`);
  await withConcurrencyLimit(allTasks, 10);

  // Store results
  const primaryCity = (ctx.city || '').trim() || (citiesForSerp[0]?.city ?? '');
  ctx.waveResults.serp_organic_results_by_city = organicResultsByCity;
  ctx.waveResults.serp_maps_results_by_city = mapsResultsByCity;
  ctx.waveResults.local_finder_results_by_city = localResultsByCity;
  ctx.waveResults.autocomplete_results_by_city = autocompleteResultsByCity;

  // Backward compatibility: flat keys = primary city only
  ctx.waveResults.serp_organic_results = organicResultsByCity[primaryCity] || {};
  ctx.waveResults.serp_maps_results = mapsResultsByCity[primaryCity] || {};
  ctx.waveResults.local_finder_results = localResultsByCity[primaryCity] || {};
  ctx.waveResults.autocomplete_results = autocompleteResultsByCity[primaryCity] || [];

  logger.debug(`[Wave5] Complete — ${allTasks.length} Live SERP requests finished`);
}

/**
 * Wave 5b: Fire Competitor Technical Analysis
 * Extracts top 3 competitor domains from local pack results (Wave 5),
 * then kicks off on-page crawls, Lighthouse tests, and domain rank lookups.
 * Results are collected later in Wave 6.
 */
async function executeWave5b(ctx: PipelineContext): Promise<void> {
  logger.debug(`[Wave5b] Starting competitor technical analysis...`);

  const competitorDomains = collectCompetitorDomainsFromLocalFinder(ctx);
  if (competitorDomains.length === 0) {
    logger.debug(`[Wave5b] No competitor domains found in local finder results — skipping`);
    return;
  }

  logger.debug(`[Wave5b] Analyzing ${competitorDomains.length} competitor domains: ${competitorDomains.map(c => c.domain).join(', ')}`);

  ctx.waveResults.competitor_analysis_domains = competitorDomains;
  ctx.waveResults.competitor_onpage_task_ids = {} as Record<string, string>;
  ctx.waveResults.competitor_domain_ranks = {} as Record<string, any>;

  const promises: Promise<void>[] = [];

  for (const comp of competitorDomains) {
    const compUrl = comp.url.startsWith('http') ? comp.url : `https://${comp.domain}`;

    // On-page crawl (50 pages max for competitors)
    promises.push(
      (async () => {
        try {
          const taskId = await ctx.client.onPageTaskPostEnhanced(compUrl, 50, true, true, undefined, undefined, {
            calculateKeywordDensity: true,
            enableContentParsing: true,
            checkSpell: false,
            respectSitemap: true,
          });
          ctx.waveResults.competitor_onpage_task_ids[comp.domain] = taskId;
          logger.debug(`[Wave5b] On-page crawl task created for ${comp.domain}: ${taskId}`);
        } catch (e: any) {
          logger.error(`[Wave5b] On-page crawl failed for ${comp.domain}:`, e.message);
          trackBalanceError(ctx, e);
        }
      })()
    );

    // Domain Rank Overview (instant result)
    promises.push(
      (async () => {
        try {
          const result = await ctx.client.domainRankOverview(comp.domain, ctx.labsLocationCode);
          ctx.waveResults.competitor_domain_ranks[comp.domain] = result;
          logger.debug(`[Wave5b] Domain rank for ${comp.domain}: ${result?.domain_rank ?? 'N/A'}`);
        } catch (e: any) {
          logger.error(`[Wave5b] Domain rank failed for ${comp.domain}:`, e.message);
          trackBalanceError(ctx, e);
          ctx.waveResults.competitor_domain_ranks[comp.domain] = null;
        }
      })()
    );
  }

  await Promise.allSettled(promises);
  logger.debug(`[Wave5b] Complete — fired analysis for ${competitorDomains.length} competitors`);
}

/**
 * Wave 5c: Backlinks Competitor Analysis (Advanced tier only)
 * Uses competitors auto-detected from local finder in Wave 5, plus any from
 * backlinksCompetitors() results from Wave 1. Runs bulk comparison and intersection endpoints.
 */
async function executeWave5c(ctx: PipelineContext): Promise<void> {
  if (ctx.tier !== 'advanced' || !ctx.domain) {
    logger.debug(`[Wave5c] Skipping — not advanced tier or no domain`);
    return;
  }

  // Check if domain intersection was already run in Wave 1 with user-provided competitors
  const alreadyHasDomainIntersection = ctx.waveResults.backlinks_domain_intersection?.length > 0;

  // Collect competitor domains from local finder (auto-detect)
  let competitorDomainNames: string[] = [];
  const localFinderComps = collectCompetitorDomainsFromLocalFinder(ctx);
  if (localFinderComps.length > 0) {
    competitorDomainNames = localFinderComps.map(c => c.domain);
  }

  // Also merge in any competitor domains found by backlinksCompetitors() in Wave 1
  const backlinkComps = (ctx.waveResults.backlink_competitors || []) as Array<{ domain: string }>;
  for (const bc of backlinkComps) {
    if (bc.domain && !competitorDomainNames.includes(bc.domain) && bc.domain !== ctx.domain) {
      competitorDomainNames.push(bc.domain);
    }
  }

  competitorDomainNames = competitorDomainNames.slice(0, 5);

  if (competitorDomainNames.length === 0) {
    logger.debug(`[Wave5c] No competitor domains available — skipping backlinks competitor analysis`);
    return;
  }

  logger.debug(`[Wave5c] Running backlinks competitor analysis with ${competitorDomainNames.length} competitors: ${competitorDomainNames.join(', ')}`);

  // Collect referring domain names from Wave 1 for bulk spam scoring
  const referringDomainsList: string[] = ((ctx.waveResults.referring_domains || []) as Array<{ domain: string }>)
    .map(rd => rd.domain)
    .filter(Boolean);

  const compResults = await runBacklinksCompetitorAnalysis(
    ctx.client,
    ctx.domain,
    competitorDomainNames,
    referringDomainsList
  );

  // Merge results into waveResults (don't overwrite domain_intersection if Wave 1 already ran it)
  if (!alreadyHasDomainIntersection && compResults.backlinks_domain_intersection) {
    ctx.waveResults.backlinks_domain_intersection = compResults.backlinks_domain_intersection;
  }
  ctx.waveResults.backlinks_page_intersection = compResults.backlinks_page_intersection || [];
  ctx.waveResults.backlinks_bulk_ranks = compResults.backlinks_bulk_ranks || [];
  ctx.waveResults.backlinks_bulk_backlinks = compResults.backlinks_bulk_backlinks || [];
  ctx.waveResults.backlinks_bulk_referring_domains = compResults.backlinks_bulk_referring_domains || [];
  ctx.waveResults.backlinks_bulk_new_lost = compResults.backlinks_bulk_new_lost || [];
  ctx.waveResults.backlinks_bulk_spam_scores = compResults.backlinks_bulk_spam_scores || [];

  logger.debug(`[Wave5c] Complete`);
}

/**
 * Wave 6: On-Page Results (after crawl completes)
 */
async function executeWave6(ctx: PipelineContext): Promise<void> {
  logger.debug(`[Wave6] Starting on-page results...`);

  const promises: Promise<void>[] = [];

  // On-page results (if crawl was started)
  if (ctx.waveResults.onpage_task_id) {
    const taskId = ctx.waveResults.onpage_task_id;

    // Wait for crawl to complete by polling summary (60 attempts x 8s = 480s max)
    let crawlComplete = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const summary = await ctx.client.onPageSummary(taskId);
        if (summary?.crawl_progress === 'finished') {
          ctx.waveResults.onpage_summary = summary;
          crawlComplete = true;
          break;
        }
      } catch (e: any) {
        // Task not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 8000));
    }

    if (crawlComplete) {
      // 1. Pages
      promises.push(
        (async () => {
          try {
            const pages = await ctx.client.onPagePages(taskId, 100, ['onpage_score,asc']);
            ctx.waveResults.onpage_pages = pages;
            logger.debug(`[Wave6] On-page pages: ${pages.length}`);
          } catch (e: any) {
            logger.error(`[Wave6] On-page pages failed:`, e.message);
            trackBalanceError(ctx, e);
          }
        })()
      );

      // 2. Duplicate tags
      promises.push(
        (async () => {
          try {
            const dups = await ctx.client.onPageDuplicateTags(taskId);
            ctx.waveResults.onpage_duplicate_tags = dups;
            logger.debug(`[Wave6] Duplicate tags: ${dups.length} groups`);
          } catch (e: any) {
            logger.error(`[Wave6] Duplicate tags failed:`, e.message);
            trackBalanceError(ctx, e);
          }
        })()
      );

      // 3. Links
      promises.push(
        (async () => {
          try {
            const links = await ctx.client.onPageLinks(taskId, 200);
            ctx.waveResults.onpage_links = links;
            logger.debug(`[Wave6] On-page links: ${links.length}`);
          } catch (e: any) {
            logger.error(`[Wave6] On-page links failed:`, e.message);
            trackBalanceError(ctx, e);
          }
        })()
      );

      // 4. Redirect chains
      promises.push(
        (async () => {
          try {
            const redirects = await ctx.client.onPageRedirectChains(taskId);
            ctx.waveResults.onpage_redirects = redirects;
            logger.debug(`[Wave6] Redirect chains: ${redirects.length}`);
          } catch (e: any) {
            logger.error(`[Wave6] Redirect chains failed:`, e.message);
            trackBalanceError(ctx, e);
          }
        })()
      );

      // 5. Microdata
      promises.push(
        (async () => {
          try {
            const microdata = await ctx.client.onPageMicrodata(taskId);
            ctx.waveResults.onpage_microdata = microdata;
            logger.debug(`[Wave6] Microdata: ${microdata.length} pages with schema`);
          } catch (e: any) {
            logger.error(`[Wave6] Microdata failed:`, e.message);
            trackBalanceError(ctx, e);
          }
        })()
      );

      // 6. Resources (ALL types — images, scripts, CSS, broken)
      promises.push(
        (async () => {
          try {
            const resources = await ctx.client.onPageResources(taskId, undefined, 200);
            ctx.waveResults.onpage_resources = resources;
            logger.debug(`[Wave6] Resources: ${resources.length}`);
          } catch (e: any) {
            logger.error(`[Wave6] Resources failed:`, e.message);
            trackBalanceError(ctx, e);
          }
        })()
      );

      // 7. Non-indexable pages
      promises.push(
        (async () => {
          try {
            const nonIndexable = await ctx.client.onPageNonIndexable(taskId);
            ctx.waveResults.onpage_non_indexable = nonIndexable;
            logger.debug(`[Wave6] Non-indexable pages: ${nonIndexable.length}`);
          } catch (e: any) {
            logger.error(`[Wave6] Non-indexable failed:`, e.message);
            trackBalanceError(ctx, e);
          }
        })()
      );

      // 8. Duplicate content (homepage as reference)
      if (ctx.session.website_url) {
        promises.push(
          (async () => {
            try {
              const dups = await ctx.client.onPageDuplicateContent(taskId, ctx.session.website_url);
              ctx.waveResults.onpage_duplicate_content = dups;
              logger.debug(`[Wave6] Duplicate content groups: ${dups.length}`);
            } catch (e: any) {
              logger.error(`[Wave6] Duplicate content failed:`, e.message);
              trackBalanceError(ctx, e);
            }
          })()
        );
      }

      // 9. Keyword density (2-word phrases)
      promises.push(
        (async () => {
          try {
            const kd = await ctx.client.onPageKeywordDensity(taskId, 2, undefined, 100);
            ctx.waveResults.onpage_keyword_density_2word = kd;
            logger.debug(`[Wave6] Keyword density (2-word): ${kd.length}`);
          } catch (e: any) {
            logger.error(`[Wave6] Keyword density (2-word) failed:`, e.message);
          }
        })()
      );

      // 10. Keyword density (3-word phrases)
      promises.push(
        (async () => {
          try {
            const kd = await ctx.client.onPageKeywordDensity(taskId, 3, undefined, 100);
            ctx.waveResults.onpage_keyword_density_3word = kd;
            logger.debug(`[Wave6] Keyword density (3-word): ${kd.length}`);
          } catch (e: any) {
            logger.error(`[Wave6] Keyword density (3-word) failed:`, e.message);
          }
        })()
      );

      // 11. Waterfall (homepage page speed)
      if (ctx.session.website_url) {
        promises.push(
          (async () => {
            try {
              const wf = await ctx.client.onPageWaterfall(taskId, ctx.session.website_url);
              ctx.waveResults.onpage_waterfall = wf;
              logger.debug(`[Wave6] Waterfall: ${wf?.items?.length || 0} resources`);
            } catch (e: any) {
              logger.error(`[Wave6] Waterfall failed:`, e.message);
            }
          })()
        );
      }

      // 12. Content parsing (homepage)
      if (ctx.session.website_url) {
        promises.push(
          (async () => {
            try {
              const cp = await ctx.client.onPageContentParsing(taskId, ctx.session.website_url);
              ctx.waveResults.onpage_content_parsing = cp;
              logger.debug(`[Wave6] Content parsing: topic="${cp?.page_content?.main_topic || 'N/A'}"`);
            } catch (e: any) {
              logger.error(`[Wave6] Content parsing failed:`, e.message);
            }
          })()
        );
      }
    } else {
      logger.warn(`[Wave6] On-page crawl did not complete in time — force stopping`);
      try { await ctx.client.onPageForceStop(taskId); } catch { /* best-effort */ }
    }
  }

  // Lighthouse results via Live endpoint (synchronous — no polling needed)
  if (ctx.domain && ctx.session.website_url) {
    promises.push(
      (async () => {
        try {
          const result = await ctx.client.lighthouseLive(ctx.session.website_url, false);
          if (result) {
            ctx.waveResults.lighthouse_desktop = result;
            logger.debug(`[Wave6] Lighthouse desktop: performance ${result.performance}`);
          } else {
            logger.warn(`[Wave6] Lighthouse desktop returned no data`);
          }
        } catch (e: any) {
          logger.error(`[Wave6] Lighthouse desktop failed:`, e.message);
          trackBalanceError(ctx, e);
        }
      })()
    );

    promises.push(
      (async () => {
        try {
          const result = await ctx.client.lighthouseLive(ctx.session.website_url, true);
          if (result) {
            ctx.waveResults.lighthouse_mobile = result;
            logger.debug(`[Wave6] Lighthouse mobile: performance ${result.performance}`);
          } else {
            logger.warn(`[Wave6] Lighthouse mobile returned no data`);
          }
        } catch (e: any) {
          logger.error(`[Wave6] Lighthouse mobile failed:`, e.message);
          trackBalanceError(ctx, e);
        }
      })()
    );
  }

  // ─── Competitor Technical Analysis Results (from Wave 5b) ───
  const competitorTaskIds = ctx.waveResults.competitor_onpage_task_ids as Record<string, string> | undefined;
  const competitorDomains = ctx.waveResults.competitor_analysis_domains as Array<{ domain: string; title: string; url: string }> | undefined;

  if (competitorTaskIds && Object.keys(competitorTaskIds).length > 0) {
    // Initialize result containers
    if (!ctx.waveResults.competitor_onpage_summaries) ctx.waveResults.competitor_onpage_summaries = {};
    if (!ctx.waveResults.competitor_onpage_pages) ctx.waveResults.competitor_onpage_pages = {};
    if (!ctx.waveResults.competitor_onpage_links) ctx.waveResults.competitor_onpage_links = {};
    if (!ctx.waveResults.competitor_onpage_resources) ctx.waveResults.competitor_onpage_resources = {};
    if (!ctx.waveResults.competitor_onpage_microdata) ctx.waveResults.competitor_onpage_microdata = {};
    if (!ctx.waveResults.competitor_onpage_duplicate_tags) ctx.waveResults.competitor_onpage_duplicate_tags = {};
    if (!ctx.waveResults.competitor_onpage_redirects) ctx.waveResults.competitor_onpage_redirects = {};
    if (!ctx.waveResults.competitor_onpage_non_indexable) ctx.waveResults.competitor_onpage_non_indexable = {};
    if (!ctx.waveResults.competitor_onpage_keyword_density) ctx.waveResults.competitor_onpage_keyword_density = {};
    if (!ctx.waveResults.competitor_onpage_content_parsing) ctx.waveResults.competitor_onpage_content_parsing = {};
    if (!ctx.waveResults.competitor_lighthouse_desktop) ctx.waveResults.competitor_lighthouse_desktop = {};
    if (!ctx.waveResults.competitor_lighthouse_mobile) ctx.waveResults.competitor_lighthouse_mobile = {};

    for (const [domain, taskId] of Object.entries(competitorTaskIds)) {
      // Poll and collect on-page crawl results for each competitor (45 attempts x 8s = 360s max)
      promises.push(
        (async () => {
          try {
            let crawlComplete = false;
            for (let attempt = 0; attempt < 45; attempt++) {
              try {
                const summary = await ctx.client.onPageSummary(taskId);
                if (summary?.crawl_progress === 'finished') {
                  ctx.waveResults.competitor_onpage_summaries[domain] = summary;
                  crawlComplete = true;
                  break;
                }
              } catch {
                // Task not ready yet
              }
              await new Promise(resolve => setTimeout(resolve, 8000));
            }

            if (crawlComplete) {
              const compUrl = competitorDomains?.find(c => c.domain === domain)?.url || `https://${domain}`;
              const subPromises: Promise<void>[] = [];
              subPromises.push((async () => {
                try {
                  const pages = await ctx.client.onPagePages(taskId, 50, ['onpage_score,asc']);
                  ctx.waveResults.competitor_onpage_pages[domain] = pages;
                  logger.debug(`[Wave6] Competitor on-page pages for ${domain}: ${pages.length}`);
                } catch (e: any) {
                  logger.error(`[Wave6] Competitor on-page pages failed for ${domain}:`, e.message);
                }
              })());
              subPromises.push((async () => {
                try {
                  const links = await ctx.client.onPageLinks(taskId, 200);
                  ctx.waveResults.competitor_onpage_links[domain] = links;
                  logger.debug(`[Wave6] Competitor on-page links for ${domain}: ${links.length}`);
                } catch (e: any) {
                  logger.error(`[Wave6] Competitor on-page links failed for ${domain}:`, e.message);
                }
              })());
              subPromises.push((async () => {
                try {
                  const resources = await ctx.client.onPageResources(taskId, undefined, 200);
                  ctx.waveResults.competitor_onpage_resources[domain] = resources;
                  logger.debug(`[Wave6] Competitor on-page resources for ${domain}: ${resources.length}`);
                } catch (e: any) {
                  logger.error(`[Wave6] Competitor on-page resources failed for ${domain}:`, e.message);
                }
              })());
              subPromises.push((async () => {
                try {
                  const microdata = await ctx.client.onPageMicrodata(taskId);
                  ctx.waveResults.competitor_onpage_microdata[domain] = microdata;
                  logger.debug(`[Wave6] Competitor microdata for ${domain}: ${microdata.length} pages`);
                } catch (e: any) {
                  logger.error(`[Wave6] Competitor microdata failed for ${domain}:`, e.message);
                }
              })());
              subPromises.push((async () => {
                try {
                  const dups = await ctx.client.onPageDuplicateTags(taskId);
                  ctx.waveResults.competitor_onpage_duplicate_tags[domain] = dups;
                  logger.debug(`[Wave6] Competitor duplicate tags for ${domain}: ${dups.length}`);
                } catch (e: any) {
                  logger.error(`[Wave6] Competitor duplicate tags failed for ${domain}:`, e.message);
                }
              })());
              subPromises.push((async () => {
                try {
                  const redirects = await ctx.client.onPageRedirectChains(taskId);
                  ctx.waveResults.competitor_onpage_redirects[domain] = redirects;
                  logger.debug(`[Wave6] Competitor redirect chains for ${domain}: ${redirects.length}`);
                } catch (e: any) {
                  logger.error(`[Wave6] Competitor redirect chains failed for ${domain}:`, e.message);
                }
              })());
              subPromises.push((async () => {
                try {
                  const ni = await ctx.client.onPageNonIndexable(taskId);
                  ctx.waveResults.competitor_onpage_non_indexable[domain] = ni;
                  logger.debug(`[Wave6] Competitor non-indexable for ${domain}: ${ni.length}`);
                } catch (e: any) {
                  logger.error(`[Wave6] Competitor non-indexable failed for ${domain}:`, e.message);
                }
              })());
              subPromises.push((async () => {
                try {
                  const kd = await ctx.client.onPageKeywordDensity(taskId, 2, undefined, 50);
                  ctx.waveResults.competitor_onpage_keyword_density[domain] = kd;
                  logger.debug(`[Wave6] Competitor keyword density for ${domain}: ${kd.length}`);
                } catch (e: any) {
                  logger.error(`[Wave6] Competitor keyword density failed for ${domain}:`, e.message);
                }
              })());
              subPromises.push((async () => {
                try {
                  const cp = await ctx.client.onPageContentParsing(taskId, compUrl);
                  ctx.waveResults.competitor_onpage_content_parsing[domain] = cp;
                  logger.debug(`[Wave6] Competitor content parsing for ${domain}: topic="${cp?.page_content?.main_topic || 'N/A'}"`);
                } catch (e: any) {
                  logger.error(`[Wave6] Competitor content parsing failed for ${domain}:`, e.message);
                }
              })());
              await Promise.allSettled(subPromises);
            } else {
              logger.warn(`[Wave6] Competitor on-page crawl for ${domain} did not complete in time — force stopping`);
              try { await ctx.client.onPageForceStop(taskId); } catch { /* best-effort */ }
            }
          } catch (e: any) {
            logger.error(`[Wave6] Competitor on-page collection failed for ${domain}:`, e.message);
          }
        })()
      );
    }

    // Collect competitor Lighthouse results via Live endpoint
    if (competitorDomains && competitorDomains.length > 0) {
      for (const comp of competitorDomains) {
        const compUrl = comp.url.startsWith('http') ? comp.url : `https://${comp.domain}`;

        promises.push(
          (async () => {
            try {
              const result = await ctx.client.lighthouseLive(compUrl, false);
              if (result) {
                ctx.waveResults.competitor_lighthouse_desktop[comp.domain] = result;
                logger.debug(`[Wave6] Competitor Lighthouse desktop for ${comp.domain}: performance ${result.performance}`);
              } else {
                logger.warn(`[Wave6] Competitor Lighthouse desktop returned no data for ${comp.domain}`);
              }
            } catch (e: any) {
              logger.error(`[Wave6] Competitor Lighthouse desktop failed for ${comp.domain}:`, e.message);
            }
          })()
        );

        promises.push(
          (async () => {
            try {
              const result = await ctx.client.lighthouseLive(compUrl, true);
              if (result) {
                ctx.waveResults.competitor_lighthouse_mobile[comp.domain] = result;
                logger.debug(`[Wave6] Competitor Lighthouse mobile for ${comp.domain}: performance ${result.performance}`);
              } else {
                logger.warn(`[Wave6] Competitor Lighthouse mobile returned no data for ${comp.domain}`);
              }
            } catch (e: any) {
              logger.error(`[Wave6] Competitor Lighthouse mobile failed for ${comp.domain}:`, e.message);
            }
          })()
        );
      }
    }

    logger.debug(`[Wave6] Collecting competitor technical results for ${Object.keys(competitorTaskIds).length} domains`);
  }

  await Promise.allSettled(promises);
  logger.debug(`[Wave6] Complete`);
}

/**
 * Wave 7: GBP Reviews & Trends
 */
async function executeWave7(ctx: PipelineContext): Promise<void> {
  logger.debug(`[Wave7] Starting reviews & trends...`);

  const promises: Promise<void>[] = [];

  // 1. Reviews task_get
  if (ctx.waveResults.reviews_task_id) {
    promises.push(
      (async () => {
        try {
          // Wait for reviews task to complete
          await new Promise(resolve => setTimeout(resolve, 10000));
          const reviews = await ctx.client.googleReviewsTaskGet(ctx.waveResults.reviews_task_id);
          ctx.waveResults.reviews = reviews;
          logger.debug(`[Wave7] Reviews: ${reviews.length}`);
        } catch (e: any) {
          logger.error(`[Wave7] Reviews task_get failed:`, e.message);
          ctx.waveResults.reviews = [];
        }
      })()
    );
  }

  // 2. Q&A
  promises.push(
    (async () => {
      try {
        const keyword = ctx.businessName || `${ctx.primaryService} ${ctx.city}`;
        const qa = await ctx.client.googleQuestionsAnswers(keyword, ctx.locationCode);
        ctx.waveResults.questions_answers = qa;
        logger.debug(`[Wave7] Q&A: ${qa.length} items`);
      } catch (e: any) {
        logger.error(`[Wave7] Q&A failed:`, e.message);
        ctx.waveResults.questions_answers = [];
      }
    })()
  );

  await Promise.allSettled(promises);

  // 4. Competitor reviews and GBP (after SERP local_pack is in waveResults from Wave 5)
  const competitors = collectCompetitorPlaceIdsFromLocalPack(ctx, 10);
  if (competitors.length > 0) {
    ctx.waveResults.competitor_reviews_task_ids = {};
    ctx.waveResults.competitor_business_info = {};
    ctx.waveResults.competitor_reviews = {};

    for (const comp of competitors) {
      try {
        const taskId = comp.placeId
          ? await ctx.client.googleReviewsTaskPostByPlaceId(comp.placeId, ctx.locationCode, 50)
          : await ctx.client.googleReviewsTaskPostByCid(comp.cid!, ctx.locationCode, 50);
        ctx.waveResults.competitor_reviews_task_ids[comp.key] = taskId;
      } catch (e: any) {
        logger.warn(`[Wave7] Competitor reviews task_post failed for ${comp.key}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    for (const comp of competitors) {
      try {
        const identifier = comp.placeId || comp.cid!;
        const profile = await ctx.client.getBusinessDataByPlaceIdOrCid(identifier, { byCid: !comp.placeId });
        if (profile) ctx.waveResults.competitor_business_info[comp.key] = profile;
      } catch (e: any) {
        logger.warn(`[Wave7] Competitor business info failed for ${comp.key}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    await new Promise(resolve => setTimeout(resolve, 15000));
    const taskIds = ctx.waveResults.competitor_reviews_task_ids as Record<string, string> || {};
    for (const [key, taskId] of Object.entries(taskIds)) {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const reviews = await ctx.client.googleReviewsTaskGet(taskId);
          ctx.waveResults.competitor_reviews[key] = reviews;
          break;
        } catch (e: any) {
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 10000));
          else ctx.waveResults.competitor_reviews[key] = [];
        }
      }
    }
    logger.debug(`[Wave7] Competitor reviews & GBP: ${competitors.length} competitors`);
  }

  logger.debug(`[Wave7] Complete`);
}

/** Top N local pack entries per keyword; max competitors to collect (deduped). */
const LOCAL_PACK_TOP_PER_KEYWORD = 3;
const MAX_COMPETITORS = 10;

/**
 * From SERP organic results (Wave 5), collect unique competitor place_id/cid from local_pack.
 * Excludes the session's own business. Returns at most maxCompetitors (default 10).
 */
function collectCompetitorPlaceIdsFromLocalPack(
  ctx: PipelineContext,
  maxCompetitors: number = MAX_COMPETITORS
): Array<{ placeId?: string; cid?: string; key: string }> {
  const organic = ctx.waveResults.serp_organic_results as Record<string, any> | undefined;
  if (!organic || typeof organic !== 'object') return [];

  const ourPlaceId = (ctx.waveResults.user_business?.place_id || '').toString().trim();
  const ourCid = (ctx.waveResults.user_business?.cid || '').toString().trim();
  const seen = new Set<string>();
  const result: Array<{ placeId?: string; cid?: string; key: string }> = [];

  for (const [_keyword, resultData] of Object.entries(organic)) {
    const items = (resultData as any)?.tasks?.[0]?.result?.[0]?.items ?? [];
    const localPack = items.find((i: any) => i.type === 'local_pack');
    const entries = Array.isArray(localPack?.items) ? localPack.items.slice(0, LOCAL_PACK_TOP_PER_KEYWORD) : [];
    for (const entry of entries) {
      const placeId = (entry.place_id || '').toString().trim();
      const cid = (entry.cid || '').toString().trim();
      const key = placeId || cid || '';
      if (!key || seen.has(key)) continue;
      if (ourPlaceId && (key === ourPlaceId || cid === ourCid)) continue;
      if (ourCid && (key === ourCid || placeId === ourPlaceId)) continue;
      seen.add(key);
      result.push({ placeId: placeId || undefined, cid: cid || undefined, key });
      if (result.length >= maxCompetitors) return result;
    }
  }
  return result;
}

/** Max competitor domains for technical analysis from local finder. */
const MAX_COMPETITOR_DOMAINS_FOR_ANALYSIS = 3;

/** Aggregator, social media, and directory domains to skip in competitor analysis. */
// Re-export for backward compatibility
export { EXCLUDED_COMPETITOR_DOMAINS, isExcludedDomain } from './excluded-domains';

/**
 * From Local Finder results (Wave 5), collect unique competitor domains.
 * Iterates the raw local_finder_results (keyed by keyword), extracts businesses
 * with non-null domains, frequency-ranks them, and returns the top N excluding
 * the user's own domain and known aggregator/social media sites.
 */
function collectCompetitorDomainsFromLocalFinder(
  ctx: PipelineContext,
  maxDomains: number = MAX_COMPETITOR_DOMAINS_FOR_ANALYSIS
): Array<{ domain: string; title: string; url: string }> {
  const localFinder = ctx.waveResults.local_finder_results as Record<string, any> | undefined;
  if (!localFinder || typeof localFinder !== 'object') return [];

  const userDomain = ctx.domain?.toLowerCase() || '';

  // Count how often each domain appears across keywords
  const domainFrequency = new Map<string, { count: number; title: string; url: string }>();

  for (const [_keyword, resultData] of Object.entries(localFinder)) {
    const items = (resultData as any)?.tasks?.[0]?.result?.[0]?.items ?? [];
    for (const item of items) {
      const bizEntries: any[] = item.type === 'maps_search' && Array.isArray(item.items)
        ? item.items
        : (item.title ? [item] : []);

      for (const biz of bizEntries) {
        const domain = (biz.domain || '').toString().trim().toLowerCase();
        if (!domain) continue;
        if (EXCLUDED_COMPETITOR_DOMAINS.has(domain)) continue;
        if (userDomain && domain.includes(userDomain)) continue;
        if (userDomain && userDomain.includes(domain)) continue;

        const existing = domainFrequency.get(domain);
        if (existing) {
          existing.count++;
        } else {
          const bizUrl = (biz.url || `https://${domain}`).toString().trim();
          const bizTitle = (biz.title || domain).toString().trim();
          domainFrequency.set(domain, { count: 1, title: bizTitle, url: bizUrl });
        }
      }
    }
  }

  // Sort by frequency (most dominant first) and return top N
  return Array.from(domainFrequency.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, maxDomains)
    .map(([domain, info]) => ({ domain, title: info.title, url: info.url }));
}

// ─── Helper Functions ───────────────────────────────────────────

/**
 * Run backlinks analysis Group A (user's own domain). Used only when tier is advanced, inside Wave 1.
 * Competitor-dependent calls (link gap, bulk comparisons) run separately after Wave 5
 * via runBacklinksCompetitorAnalysis() once local finder competitors are known.
 */
async function runBacklinksInWave1(
  client: DataForSEOClient,
  domain: string,
  competitorDomains: string[]
): Promise<Record<string, any>> {
  logger.debug(`[Wave1-Backlinks] Starting backlinks analysis for ${domain}...`);
  const results: Record<string, any> = {};
  const promises: Promise<void>[] = [];

  // 5A: Backlinks summary
  promises.push(
    (async () => {
      try {
        const summary = await client.backlinksSummary(domain);
        results.backlinks_summary = summary;
      } catch (e: any) {
        logger.error(`[Wave1-Backlinks] Summary failed:`, e.message);
        results.backlinks_summary = null;
      }
    })()
  );
  // 5B: Referring domains
  promises.push(
    (async () => {
      try {
        const domains = await client.referringDomains(domain, 100);
        results.referring_domains = domains;
      } catch (e: any) {
        logger.error(`[Wave1-Backlinks] Referring domains failed:`, e.message);
        results.referring_domains = [];
      }
    })()
  );
  // 5C: Anchor text distribution
  promises.push(
    (async () => {
      try {
        const anchors = await client.backlinksAnchors(domain, 100);
        results.anchor_texts = anchors;
      } catch (e: any) {
        logger.error(`[Wave1-Backlinks] Anchors failed:`, e.message);
        results.anchor_texts = [];
      }
    })()
  );
  // 5D: Backlink competitors
  promises.push(
    (async () => {
      try {
        const competitors = await client.backlinksCompetitors(domain, 20);
        results.backlink_competitors = competitors;
      } catch (e: any) {
        logger.error(`[Wave1-Backlinks] Competitors failed:`, e.message);
        results.backlink_competitors = [];
      }
    })()
  );
  // 5F: Individual backlinks list (deduped one per domain)
  promises.push(
    (async () => {
      try {
        const backlinks = await client.backlinksBacklinks(domain, 100);
        results.backlinks_list = backlinks;
      } catch (e: any) {
        logger.error(`[Wave1-Backlinks] Backlinks list failed:`, e.message);
        results.backlinks_list = [];
      }
    })()
  );
  // 5G: Historical backlink profile (monthly snapshots)
  promises.push(
    (async () => {
      try {
        const history = await client.backlinksHistory(domain);
        results.backlinks_history = history;
      } catch (e: any) {
        logger.error(`[Wave1-Backlinks] History failed:`, e.message);
        results.backlinks_history = [];
      }
    })()
  );
  // 5H: Per-page backlink distribution
  promises.push(
    (async () => {
      try {
        const pages = await client.backlinksDomainPages(domain, 50);
        results.backlinks_domain_pages = pages;
      } catch (e: any) {
        logger.error(`[Wave1-Backlinks] Domain pages failed:`, e.message);
        results.backlinks_domain_pages = [];
      }
    })()
  );
  // 5I: Referring networks (subnet diversity)
  promises.push(
    (async () => {
      try {
        const networks = await client.backlinksReferringNetworks(domain, 50);
        results.backlinks_referring_networks = networks;
      } catch (e: any) {
        logger.error(`[Wave1-Backlinks] Referring networks failed:`, e.message);
        results.backlinks_referring_networks = [];
      }
    })()
  );
  // 5J: Timeseries summary (12-month trend)
  promises.push(
    (async () => {
      try {
        const ts = await client.backlinksTimeseriesSummary(domain);
        results.backlinks_timeseries = ts;
      } catch (e: any) {
        logger.error(`[Wave1-Backlinks] Timeseries failed:`, e.message);
        results.backlinks_timeseries = [];
      }
    })()
  );
  // 5K: New & lost timeseries
  promises.push(
    (async () => {
      try {
        const nl = await client.backlinksNewLostTimeseries(domain);
        results.backlinks_new_lost_timeseries = nl;
      } catch (e: any) {
        logger.error(`[Wave1-Backlinks] New/lost timeseries failed:`, e.message);
        results.backlinks_new_lost_timeseries = [];
      }
    })()
  );

  // 5E: Domain intersection — only if user provided competitor domains
  // Otherwise, competitor analysis runs after Wave 5 with auto-detected competitors
  if (competitorDomains.length > 0) {
    promises.push(
      (async () => {
        try {
          const intersection = await client.backlinksDomainIntersection(
            competitorDomains.slice(0, 3),
            [domain],
            100
          );
          results.backlinks_domain_intersection = intersection;
        } catch (e: any) {
          logger.error(`[Wave1-Backlinks] Link gap failed:`, e.message);
          results.backlinks_domain_intersection = [];
        }
      })()
    );
  }

  await Promise.allSettled(promises);
  logger.debug(`[Wave1-Backlinks] Complete (${promises.length} calls)`);
  return results;
}

/**
 * Run backlinks competitor analysis (Group B). Called after Wave 5b when local finder
 * competitors are available. Runs domain/page intersection and bulk comparison endpoints.
 */
async function runBacklinksCompetitorAnalysis(
  client: DataForSEOClient,
  domain: string,
  competitorDomains: string[],
  referringDomainsList: string[]
): Promise<Record<string, any>> {
  logger.debug(`[Backlinks-CompAnalysis] Starting competitor backlinks analysis: ${competitorDomains.length} competitors`);
  const results: Record<string, any> = {};
  const promises: Promise<void>[] = [];

  // Domain-level link gap (if not already done in Wave 1)
  promises.push(
    (async () => {
      try {
        const intersection = await client.backlinksDomainIntersection(
          competitorDomains.slice(0, 3),
          [domain],
          100
        );
        results.backlinks_domain_intersection = intersection;
      } catch (e: any) {
        logger.error(`[Backlinks-CompAnalysis] Domain intersection failed:`, e.message);
        results.backlinks_domain_intersection = [];
      }
    })()
  );

  // Page-level link gap
  promises.push(
    (async () => {
      try {
        const pageGaps = await client.backlinksPageIntersection(
          competitorDomains.slice(0, 3),
          [domain],
          100
        );
        results.backlinks_page_intersection = pageGaps;
      } catch (e: any) {
        logger.error(`[Backlinks-CompAnalysis] Page intersection failed:`, e.message);
        results.backlinks_page_intersection = [];
      }
    })()
  );

  // Bulk ranks comparison
  const allTargets = [domain, ...competitorDomains].slice(0, 20);
  promises.push(
    (async () => {
      try {
        const ranks = await client.backlinksBulkRanks(allTargets);
        results.backlinks_bulk_ranks = ranks;
      } catch (e: any) {
        logger.error(`[Backlinks-CompAnalysis] Bulk ranks failed:`, e.message);
        results.backlinks_bulk_ranks = [];
      }
    })()
  );

  // Bulk backlink counts comparison
  promises.push(
    (async () => {
      try {
        const bl = await client.backlinksBulkBacklinks(allTargets);
        results.backlinks_bulk_backlinks = bl;
      } catch (e: any) {
        logger.error(`[Backlinks-CompAnalysis] Bulk backlinks failed:`, e.message);
        results.backlinks_bulk_backlinks = [];
      }
    })()
  );

  // Bulk referring domains comparison
  promises.push(
    (async () => {
      try {
        const rd = await client.backlinksBulkReferringDomains(allTargets);
        results.backlinks_bulk_referring_domains = rd;
      } catch (e: any) {
        logger.error(`[Backlinks-CompAnalysis] Bulk referring domains failed:`, e.message);
        results.backlinks_bulk_referring_domains = [];
      }
    })()
  );

  // Bulk new/lost backlinks comparison
  promises.push(
    (async () => {
      try {
        const nl = await client.backlinksBulkNewLostBacklinks(allTargets);
        results.backlinks_bulk_new_lost = nl;
      } catch (e: any) {
        logger.error(`[Backlinks-CompAnalysis] Bulk new/lost failed:`, e.message);
        results.backlinks_bulk_new_lost = [];
      }
    })()
  );

  // Bulk spam scores for user's referring domains
  if (referringDomainsList.length > 0) {
    promises.push(
      (async () => {
        try {
          const spam = await client.backlinksBulkSpamScore(referringDomainsList.slice(0, 100));
          results.backlinks_bulk_spam_scores = spam;
        } catch (e: any) {
          logger.error(`[Backlinks-CompAnalysis] Bulk spam scores failed:`, e.message);
          results.backlinks_bulk_spam_scores = [];
        }
      })()
    );
  }

  await Promise.allSettled(promises);
  logger.debug(`[Backlinks-CompAnalysis] Complete (${promises.length} calls)`);
  return results;
}

/**
 * Run Tavily research phases (1-3) concurrently with DataForSEO waves
 * 
 * IMPORTANT: skipDataForSEO=true is passed to all phases because the
 * intermediate/advanced pipeline handles all DataForSEO calls via the
 * wave system. Without this flag, each phase would make its own duplicate
 * DataForSEO API calls, resulting in double billing and wasted time.
 */
async function runTavilyResearch(ctx: PipelineContext, job: Job): Promise<void> {
  logger.debug(`[TavilyResearch] Running Tavily phases 1-3 in parallel (DataForSEO handled by waves)...`);
  
  const phaseOptions = { skipDataForSEO: true };
  
  try {
    await processPhase1(ctx.sessionId, phaseOptions);
    await processPhase2(ctx.sessionId, phaseOptions);
    await processPhase3(ctx.sessionId, phaseOptions);
    logger.debug(`[TavilyResearch] All Tavily phases complete`);
  } catch (e: any) {
    logger.error(`[TavilyResearch] Tavily research failed:`, e.message);
    // Non-fatal — DataForSEO data is still valuable
  }
}

/**
 * Extract top N keywords by search volume from all wave results
 */
/**
 * Extract top N keywords prioritizing service relevance.
 *
 * Uses a 3-tier priority system to ensure SERP queries match the actual
 * business instead of selecting irrelevant high-volume keywords:
 *
 *   1. Claude-generated seed keywords (crafted for this business/industry)
 *   2. Enriched keywords containing service/industry terms
 *   3. Remaining high-volume keywords to fill slots
 */
function getTopRelevantKeywords(
  waveResults: Record<string, any>,
  n: number,
  primaryService: string,
  services: string,
  additionalServices?: string,
  industry?: string
): string[] {
  const serviceTerms = new Set<string>();
  const allServiceStrings = [
    primaryService,
    ...(services || '').split(','),
    ...(additionalServices || '').split(','),
    industry || '',
  ];
  for (const svc of allServiceStrings) {
    const lower = svc.trim().toLowerCase();
    if (!lower) continue;
    serviceTerms.add(lower);
    for (const word of lower.split(/\s+/)) {
      if (word.length >= 3) serviceTerms.add(word);
    }
  }

  const keywordVolumes = new Map<string, number>();
  const volumeByCity = waveResults.bulk_search_volume_by_city as Record<string, any[]> | undefined;
  if (volumeByCity && typeof volumeByCity === 'object') {
    for (const cityData of Object.values(volumeByCity)) {
      for (const kw of (cityData || [])) {
        const keyword = kw.keyword?.toLowerCase();
        const volume = kw.search_volume || 0;
        if (keyword && (!keywordVolumes.has(keyword) || keywordVolumes.get(keyword)! < volume)) {
          keywordVolumes.set(keyword, volume);
        }
      }
    }
  }
  if (keywordVolumes.size === 0) {
    for (const kw of (waveResults.bulk_search_volume || [])) {
      const keyword = kw.keyword?.toLowerCase();
      const volume = kw.search_volume || 0;
      if (keyword && (!keywordVolumes.has(keyword) || keywordVolumes.get(keyword)! < volume)) {
        keywordVolumes.set(keyword, volume);
      }
    }
  }
  for (const kw of (waveResults.keywords_for_site || [])) {
    const keyword = kw.keyword?.toLowerCase();
    const volume = kw.search_volume || 0;
    if (keyword && (!keywordVolumes.has(keyword) || keywordVolumes.get(keyword)! < volume)) {
      keywordVolumes.set(keyword, volume);
    }
  }

  const isRelevant = (kw: string): boolean => {
    const lower = kw.toLowerCase();
    for (const term of serviceTerms) {
      if (lower.includes(term) || term.includes(lower)) return true;
    }
    return false;
  };

  const selected = new Set<string>();
  const result: string[] = [];

  // Tier 1: Claude-generated keywords sorted by enriched volume
  const claudeKeywords: string[] = (waveResults.claude_keywords || [])
    .map((kw: any) => (kw.keyword || '').toLowerCase())
    .filter(Boolean);

  const claudeWithVolume = claudeKeywords
    .map(kw => ({ keyword: kw, volume: keywordVolumes.get(kw) || 0 }))
    .sort((a, b) => b.volume - a.volume);

  for (const { keyword } of claudeWithVolume) {
    if (result.length >= n) break;
    if (!selected.has(keyword)) {
      selected.add(keyword);
      result.push(keyword);
    }
  }

  // Tier 2: Service-relevant keywords from enrichment data
  if (result.length < n) {
    const relevantEnriched = Array.from(keywordVolumes.entries())
      .filter(([kw]) => !selected.has(kw) && isRelevant(kw))
      .sort((a, b) => b[1] - a[1]);

    for (const [keyword] of relevantEnriched) {
      if (result.length >= n) break;
      selected.add(keyword);
      result.push(keyword);
    }
  }

  // Tier 3: Fill remaining slots with highest-volume keywords
  if (result.length < n) {
    const remaining = Array.from(keywordVolumes.entries())
      .filter(([kw]) => !selected.has(kw))
      .sort((a, b) => b[1] - a[1]);

    for (const [keyword] of remaining) {
      if (result.length >= n) break;
      selected.add(keyword);
      result.push(keyword);
    }
  }

  if (result.length === 0 && waveResults.seed_keywords?.length) {
    return waveResults.seed_keywords.slice(0, n);
  }

  logger.debug(`[getTopRelevantKeywords] Selected ${result.length}/${n} keywords: ${result.length > 0 ? result.slice(0, 5).join(', ') + (result.length > 5 ? '...' : '') : 'none'} (${claudeWithVolume.length} Claude seeds, ${serviceTerms.size} service terms)`);

  return result;
}

/**
 * Extract domain from URL
 */
function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return null;
  }
}

// ─── Checkpoint Management ──────────────────────────────────────

async function loadWaveCheckpoint(sessionId: string): Promise<WaveCheckpoint | null> {
  try {
    const checkpoint = await loadCheckpoint(sessionId);
    return (checkpoint as { waves?: WaveCheckpoint }).waves ?? null;
  } catch {
    return null;
  }
}

async function saveWaveCheckpoint(sessionId: string, checkpoint: WaveCheckpoint): Promise<void> {
  // Only save lightweight checkpoint metadata (completed waves, current wave, tavily status).
  // The full waveResults stay in memory and are written ONCE to research_session_dataforseo
  // after all waves complete. This eliminates the 5-15MB write-per-wave that was crashing Supabase.
  const lightCheckpoint = {
    completed_waves: checkpoint.completed_waves,
    current_wave: checkpoint.current_wave,
    tavily_complete: checkpoint.tavily_complete,
    // Preserve location codes for resume
    wave_results: {
      location: checkpoint.wave_results?.location,
      labs_location_code: checkpoint.wave_results?.labs_location_code,
      labs_location_name: checkpoint.wave_results?.labs_location_name,
      google_ads_location_code: checkpoint.wave_results?.google_ads_location_code,
      google_ads_location_name: checkpoint.wave_results?.google_ads_location_name,
      service_area_location_codes: checkpoint.wave_results?.service_area_location_codes,
    },
  };

  try {
    const existing = await loadCheckpoint(sessionId);
    const merged = { ...existing, waves: lightCheckpoint };
    await saveCheckpoint(sessionId, merged as Parameters<typeof saveCheckpoint>[1] & { waves?: unknown });
  } catch (e: any) {
    logger.error(`[Pipeline Checkpoint] Save failed:`, e.message);
  }
}

async function updateSessionProgress(sessionId: string, message: string): Promise<void> {
  logger.debug(`[IntermediatePipeline] Progress: ${message}`);
  // CRITICAL FIX: Do NOT write to phase1_summary here.
  // Previously this overwrote phase1_summary with { dataforseo_pipeline_status: message },
  // which destroyed the actual Tavily Phase 1 research data (searches, content, sources)
  // and caused Phase 4 to fail with "Previous phase data not found".
  // Wave progress is already tracked via the checkpoint system and console logs.
}
