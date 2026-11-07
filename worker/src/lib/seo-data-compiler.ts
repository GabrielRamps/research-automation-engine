/**
 * SEO Data Compiler — Phase 9
 *
 * Output aligns with the 10-phase spec unified JSON: meta (audit_metadata), domain_intelligence
 * (domain_overview), keyword_universe (with tier_1/2/3 via clustering), competitors, serp_analysis,
 * technical_audit, backlinks (Advanced only), business_profile/gbp_analysis.
 *
 * Compiles ALL gathered data from Phases 1–8 (DataForSEO waves + Tavily)
 * into a single unified JSON structure for AI consumption.
 *
 * Key operations:
 * 1. Aggregate results from all waves
 * 2. Deduplicate keywords across all sources
 * 3. Apply keyword prioritization scoring formula
 * 4. Calculate review analytics (rating distribution, sentiment, velocity)
 * 5. Calculate GBP completeness score
 * 6. Calculate technical health score from on-page audit
 * 7. Identify schema markup gaps
 * 8. Aggregate competitor profiles with shared/unique keyword analysis
 * 9. Build SERP feature map
 * 10. Store compiled JSON as `seo_audit_data` column
 */

import { supabase, supabaseWithRetry } from './supabase';
import { logger } from './logger';
import { classifyKeywordIntent } from './keyword-classifier';
import { isExcludedDomain } from './excluded-domains';

/**
 * Columns required for Phase 9 compilation. Excludes heavy JSONB (phase*_raw) to avoid
 * statement timeout (57014) when loading the session row. Use this for any fetch that
 * only needs to supply the compiler.
 */
export const SESSION_SELECT_FOR_COMPILATION =
  'id, location_code, location_name, website_url, business_name, business_type, street_address, city, state, zip_code, phone_number, operating_hours, services, primary_service, industry, phase1_citations, phase2_citations, phase3_citations, phase1_summary, phase2_summary, phase3_summary, dataforseo_tasks';

// ─── Unified Schema Types ───────────────────────────────────────

// Structured SERP sub-types
export interface SerpOrganicEntry {
  keyword: string;
  rankings: Array<{
    position: number;
    domain: string;
    title: string;
    url: string;
    description: string;
    is_user_domain: boolean;
  }>;
  features_present: string[];
  user_position: number | null;
}

export interface SerpMapsEntry {
  keyword: string;
  businesses: Array<{
    position: number;
    title: string;
    domain: string | null;
    address: string;
    phone: string;
    rating: number | null;
    reviews_count: number | null;
    category: string;
    place_id: string;
    is_user_business: boolean;
  }>;
}

export interface SerpLocalFinderEntry {
  keyword: string;
  total_results: number;
  businesses: Array<{
    position: number;
    title: string;
    domain: string | null;
    address: string;
    rating: number | null;
    reviews_count: number | null;
    category: string;
    is_user_business: boolean;
  }>;
}

export interface SerpAutocompleteEntry {
  keyword: string;
  suggestions: string[];
}

// Organic keyword analysis types
export interface OrganicKeywordEntry {
  keyword: string;
  search_volume: number;
  keyword_difficulty: number;
  search_intent: string;
  monthly_searches: Array<{ year: number; month: number; search_volume: number }>;
  search_volume_trend: { monthly: number; quarterly: number; yearly: number } | null;
  current_organic_position: number | null;
  opportunity_score: number;
  source: string;
}

export interface OrganicKeywordAnalysis {
  keywords: OrganicKeywordEntry[];
  total_addressable_traffic: number;
  avg_difficulty: number;
  intent_distribution: Record<string, number>;
  competitors: Array<{ domain: string; avg_position: number; intersections: number; estimated_monthly_traffic: number | null }>;
  keyword_gaps: Array<{ keyword: string; search_volume: number; keyword_difficulty: number; competitor_domain: string; competitor_rank: number | null; your_rank: number | null }>;
  top_opportunities: Array<{ keyword: string; volume: number; difficulty: number; intent: string }>;
}

// Paid keyword analysis types
export interface PaidKeywordEntry {
  keyword: string;
  search_volume: number;
  cpc: number;
  competition: string;
  competition_index: number;
  low_top_of_page_bid: number;
  high_top_of_page_bid: number;
  projected_impressions: number | null;
  projected_clicks: number | null;
  projected_ctr: number | null;
  projected_cost: number | null;
  opportunity_score: number;
  source: string;
  location_metrics?: Record<string, { search_volume: number; cpc: number; competition: number }>;
}

export interface PaidKeywordAnalysis {
  keywords: PaidKeywordEntry[];
  estimated_monthly_spend: number;
  estimated_monthly_clicks: number;
  avg_cpc: number;
  top_opportunities: Array<{ keyword: string; volume: number; cpc: number; competition: string }>;
}

// Return types for new DataForSEO client methods
export interface AdTrafficResult {
  keyword: string | null;
  impressions: number;
  ctr: number;
  average_cpc: number;
  cost: number;
  clicks: number;
  match: string;
  bid: number;
}

export interface GoogleAdsKeywordForSite {
  keyword: string;
  search_volume: number;
  cpc: number;
  competition: string;
  competition_index: number;
  low_top_of_page_bid: number;
  high_top_of_page_bid: number;
  monthly_searches: Array<{ year: number; month: number; search_volume: number }>;
}

export interface BulkTrafficEstimation {
  target: string;
  organic_etv: number;
  organic_count: number;
  organic_is_new: number;
}

export interface UnifiedAuditData {
  meta: {
    session_id: string;
    tier: string;
    location_code: number;
    location_name: string;
    /** Google Ads Keywords Data location code — city-level for search volume, CPC, competition data. */
    google_ads_location_code?: number;
    /** Google Ads Keywords Data location name — city-level for search volume, CPC, competition data. */
    google_ads_location_name?: string;
    /** All resolved service area cities with their location codes. */
    service_area_locations?: Array<{
      city: string;
      location_code: number;
      google_ads_location_code: number;
    }>;
    domain: string | null;
    generated_at: string;
    dataforseo_cost: number;
    api_calls_count: number;
  };
  business_profile: {
    name: string;
    category: string;
    subcategories: string[];
    address: string;
    phone: string;
    website: string;
    hours: any;
    attributes: string[];
    photos_count: number;
    is_claimed: boolean;
    gbp_completeness_score: number;
    gbp_completeness_gaps: string[];
  };
  domain_intelligence: {
    organic_traffic: number;
    paid_traffic: number;
    organic_keywords_count: number;
    backlinks_count: number;
    referring_domains_count: number;
    domain_rank: number;
    lighthouse: {
      desktop: { performance: number; accessibility: number; best_practices: number; seo: number; core_web_vitals: any } | null;
      mobile: { performance: number; accessibility: number; best_practices: number; seo: number; core_web_vitals: any } | null;
    };
  };
  reviews: {
    total_count: number;
    average_rating: number;
    rating_distribution: Record<string, number>;
    recent_reviews: any[];
    sentiment_summary: { positive_themes: string[]; negative_themes: string[]; neutral_themes: string[] };
    review_velocity: { last_30_days: number; last_90_days: number };
    competitor_comparison: {
      avg_competitor_rating: number;
      avg_competitor_review_count: number;
      rating_gap: number;
      review_count_gap: number;
    };
  };
  questions_and_answers: any[];
  keyword_universe: {
    total_keywords: number;
    keywords: Array<{
      keyword: string;
      search_volume: number;
      keyword_difficulty: number;
      cpc: number;
      competition: number;
      search_intent: string;
      monthly_trends: any[];
      priority_score: number;
      source: string;
      current_rank: number | null;
      target_page: string | null;
    }>;
    intent_distribution: Record<string, number>;
    /** Keywords grouped by search_intent (transactional, commercial, informational, navigational, unknown). */
    by_intent: Record<string, UnifiedAuditData['keyword_universe']['keywords']>;
    /** Keywords grouped by difficulty band: low (0–33), medium (34–66), high (67–100). */
    by_difficulty: { low: UnifiedAuditData['keyword_universe']['keywords']; medium: UnifiedAuditData['keyword_universe']['keywords']; high: UnifiedAuditData['keyword_universe']['keywords'] };
    clusters: any[];
  };
  /** Organic (SEO) keyword analysis — keywords scored for organic ranking opportunity. */
  organic_keyword_analysis?: OrganicKeywordAnalysis;
  /** Paid (SEM) keyword analysis — keywords scored for ad spend opportunity. */
  paid_keyword_analysis?: PaidKeywordAnalysis;
  competitors: {
    organic_competitors: Array<{ domain?: string; avg_position?: number; intersections?: number; estimated_monthly_traffic?: number | null; [k: string]: any }>;
    serp_competitors: any[];
    local_competitors: any[];
    backlink_competitors: any[];
    /** From Wave 7: local pack competitors with reviews and GBP profile (hours, attributes, posts). */
    competitor_profiles?: Array<{ key: string; business_info: any; reviews: any[] }>;
  };
  serp_analysis: {
    /** Structured organic results per keyword with rankings and SERP feature badges. */
    organic_results: SerpOrganicEntry[];
    /** Structured Maps results per keyword with business details. */
    maps_results: SerpMapsEntry[];
    /** Structured Local Finder results per keyword with business details. */
    local_finder_results: SerpLocalFinderEntry[];
    serp_features: {
      local_pack_present: boolean;
      featured_snippets: any[];
      people_also_ask: any[];
      knowledge_panel: any;
    };
    /** Paid (PPC) results per keyword: title, domain, description, url, rank. */
    paid_results: Array<{ keyword: string; title?: string; domain?: string; description?: string; url?: string; rank?: number }>;
    /** Related searches from SERP; items are query strings or { title, url }. */
    related_searches: Array<{ keyword: string; items: any[] }>;
    /** People also search (distinct from people_also_ask): title + items. */
    people_also_search: Array<{ keyword: string; title?: string; items: any[] }>;
    /** Local Service Ads (LSA) entries per keyword. */
    local_services_ads: Array<{ keyword: string; [k: string]: any }>;
    /** Discussions and forums: community threads for content/sentiment. */
    discussions_and_forums: Array<{ keyword: string; title?: string; url?: string; domain?: string; [k: string]: any }>;
    /** Optional: find results on (extra discovery). */
    find_results_on?: Array<{ keyword: string; [k: string]: any }>;
    /** Optional: Google Posts from SERP (and/or Business Data). */
    google_posts?: Array<{ keyword: string; [k: string]: any }>;
    /** Optional: Google reviews SERP snippet (review stars/snippet in SERP). */
    google_reviews?: Array<{ keyword: string; [k: string]: any }>;
    /** Local pack dominance: for transactional/commercial keywords, who is in the pack and user position. */
    local_pack_dominance: Array<{
      keyword: string;
      pack: Array<{ rank: number; title?: string; domain?: string; cid?: string; place_id?: string; rating?: { value?: number; votes_count?: number } | null; category?: string }>;
      your_position: number | null;
    }>;
    /** Autocomplete suggestions grouped by seed keyword. */
    autocomplete_suggestions: SerpAutocompleteEntry[];
    /** @deprecated Raw organic results for backward compatibility with legacy payloads. */
    _raw_organic_results?: any;
    /** @deprecated Raw maps results for backward compatibility. */
    _raw_maps_results?: any;
    /** @deprecated Raw local finder results for backward compatibility. */
    _raw_local_finder_results?: any;
  };
  /** Per service area city SERP data (when pipeline ran SERP per city). */
  serp_by_service_area_city?: Record<string, {
    organic_results?: SerpOrganicEntry[];
    maps_results?: SerpMapsEntry[];
    local_finder_results?: SerpLocalFinderEntry[];
    autocomplete_suggestions?: SerpAutocompleteEntry[];
    paid_results?: Array<{ keyword: string; title?: string; domain?: string; description?: string; url?: string; rank?: number }>;
    local_services_ads?: Array<{ keyword: string; [k: string]: unknown }>;
    serp_features?: {
      local_pack_present?: boolean;
      featured_snippets?: unknown[];
      people_also_ask?: unknown[];
      knowledge_panel?: unknown;
      paid_results?: UnifiedAuditData['serp_analysis']['paid_results'];
      related_searches?: UnifiedAuditData['serp_analysis']['related_searches'];
      people_also_search?: UnifiedAuditData['serp_analysis']['people_also_search'];
      local_services_ads?: UnifiedAuditData['serp_analysis']['local_services_ads'];
      discussions_and_forums?: UnifiedAuditData['serp_analysis']['discussions_and_forums'];
      find_results_on?: UnifiedAuditData['serp_analysis']['find_results_on'];
      google_posts?: UnifiedAuditData['serp_analysis']['google_posts'];
      google_reviews?: UnifiedAuditData['serp_analysis']['google_reviews'];
      local_pack_dominance?: unknown[];
    };
  }>;
  technical_audit: {
    crawl_summary: {
      pages_crawled: number;
      pages_with_issues: number;
      avg_onpage_score: number;
    };
    issues: {
      critical: any[];
      warnings: any[];
      notices: any[];
    };
    duplicate_tags: { titles: any[]; descriptions: any[] };
    link_analysis: {
      internal_links: number;
      external_links: number;
      broken_links: any[];
      redirect_chains: any[];
    };
    schema_markup: {
      existing_schemas: string[];
      recommended_schemas: string[];
    };
    image_audit: {
      total_images: number;
      missing_alt: number;
      oversized: number;
    };
    page_details: any[];
    domain_info?: {
      cms: string | null;
      server: string | null;
      ssl: boolean;
      has_sitemap: boolean;
      has_robots_txt: boolean;
      is_www_redirect: boolean;
      is_https_redirect: boolean;
      canonicalization: boolean;
      test_404: boolean;
      directory_browsing: boolean;
    };
    non_indexable?: {
      total: number;
      by_reason: Record<string, number>;
      pages: Array<{ url: string; reason: string }>;
    };
    duplicate_content?: {
      total_duplicate_pages: number;
      pages: Array<{ url: string; similar_to: string; similarity: number }>;
    };
    keyword_density?: {
      two_word: Array<{ keyword: string; frequency: number; density: number }>;
      three_word: Array<{ keyword: string; frequency: number; density: number }>;
    };
    waterfall?: {
      homepage_load_time: number;
      render_blocking_count: number;
      render_blocking_resources: Array<{ url: string; type: string; duration: number }>;
      slowest_resources: Array<{ url: string; type: string; duration: number }>;
      transfer_size_by_type: Record<string, number>;
    };
    content_structure?: {
      heading_hierarchy: Array<{ tag: string; text: string }>;
      main_topic: string | null;
      has_contact_info: boolean;
      has_ratings: boolean;
    };
    resource_audit?: {
      images: { total: number; missing_alt: number; oversized: number };
      scripts: { total: number; total_size: number; unminified: number };
      stylesheets: { total: number; total_size: number };
      broken: { total: number; urls: string[] };
    };
  };
  /** Technical analysis of top competitor domains from local pack (on-page audit, Lighthouse, domain rank). */
  competitor_technical_audit?: Array<{
    domain: string;
    business_name?: string;
    url?: string;
    domain_rank?: {
      domain_rank: number;
      organic_traffic: number;
      organic_keywords_count: number;
      backlinks: number;
      referring_domains: number;
    } | null;
    lighthouse?: {
      desktop: { performance: number; accessibility: number; best_practices: number; seo: number; core_web_vitals?: { lcp: number; fid: number; cls: number; fcp: number; si: number; tbt: number; tti: number } } | null;
      mobile: { performance: number; accessibility: number; best_practices: number; seo: number; core_web_vitals?: { lcp: number; fid: number; cls: number; fcp: number; si: number; tbt: number; tti: number } } | null;
    };
    crawl_summary?: { pages_crawled: number; pages_with_issues: number; avg_onpage_score: number } | null;
    schema_markup?: { existing_schemas: string[] } | null;
    issues_count?: { critical: number; warnings: number; notices: number } | null;
    link_analysis?: { internal_links: number; external_links: number; broken_links_count: number } | null;
    image_audit?: { total_images: number; missing_alt: number; oversized: number } | null;
    domain_info?: { cms: string | null; ssl: boolean; has_sitemap: boolean; has_robots_txt: boolean; is_https_redirect: boolean; canonicalization: boolean } | null;
    non_indexable?: { total: number; by_reason: Record<string, number> } | null;
    duplicate_tags?: { titles_count: number; descriptions_count: number } | null;
    redirect_chains?: { total: number } | null;
    keyword_density?: { top_terms: Array<{ keyword: string; frequency: number; density: number }> } | null;
    content_structure?: { heading_count: number; main_topic: string | null; has_contact_info: boolean } | null;
    resource_audit?: { scripts: { total: number; total_size: number }; stylesheets: { total: number; total_size: number }; broken_count: number } | null;
  }>;
  backlinks: {
    summary: {
      total_backlinks: number;
      referring_domains: number;
      dofollow_ratio: number;
      avg_domain_rank: number;
      spam_score: number;
      referring_ips: number;
      referring_subnets: number;
      broken_backlinks: number;
      link_types: Record<string, number>;
      platform_types: Record<string, number>;
      country_distribution: Record<string, number>;
    };
    top_referring_domains: any[];
    anchor_text_distribution: any[];
    individual_backlinks: any[];
    domain_pages: any[];
    referring_networks: any[];
    history: any[];
    timeseries: any[];
    new_lost_timeseries: any[];
    link_gap: {
      competitor_only_domains: any[];
      page_level_gaps: any[];
      shared_domains: any[];
      opportunity_score: number;
    };
    competitor_comparison: {
      bulk_ranks: any[];
      bulk_backlinks: any[];
      bulk_referring_domains: any[];
      bulk_new_lost: any[];
    };
    spam_analysis: {
      referring_domain_spam_scores: any[];
      avg_spam_score: number;
      high_spam_count: number;
      low_spam_count: number;
    };
  };
  tavily_research: {
    phase1_sources: any[];
    phase2_sources: any[];
    phase3_sources: any[];
    phase1_summary: string;
    phase2_summary: string;
    phase3_summary: string;
  };
  scoring: {
    keyword_prioritization: {
      method: string;
      weights: Record<string, number>;
      top_50_keywords: any[];
    };
    gbp_completeness: number;
    technical_health: number;
    competitive_position: number;
    overall_seo_readiness: number;
  };
}

// ─── Main Compiler ──────────────────────────────────────────────

/**
 * @param sessionFromPipeline - Optional session row; if provided, skips DB fetch (used when pipeline re-fetches right before Phase 9 to avoid missing row).
 */
export async function compileAuditData(
  sessionId: string,
  waveResults: Record<string, any>,
  tier: 'intermediate' | 'advanced',
  sessionFromPipeline?: any
): Promise<UnifiedAuditData> {
  logger.debug(`[DataCompiler] Compiling audit data for session ${sessionId} (tier: ${tier})`);

  let session: any = sessionFromPipeline;

  if (!session) {
    const { data, error } = await supabaseWithRetry(
      () => supabase
        .from('research_sessions')
        .select('id, location_code, location_name, website_url, business_name, business_type, street_address, city, state, zip_code, phone_number, operating_hours, services, primary_service, industry')
        .eq('id', sessionId)
        .single(),
      'DataCompiler load session',
    );

    if (error) {
      logger.error('[DataCompiler] Supabase error loading session:', error.code, error.message);
      throw new Error(`Session not found for data compilation (${error.code}: ${error.message})`);
    }
    if (!data) {
      throw new Error('Session not found for data compilation (no row returned)');
    }
    session = { ...data };

    // Load phase data from dedicated table
    const { data: phaseRows } = await supabaseWithRetry(
      () => supabase
        .from('research_session_phase_data')
        .select('phase, summary, citations')
        .eq('session_id', sessionId),
      'DataCompiler load phase data',
    );

    for (const row of (phaseRows || [])) {
      session[`phase${row.phase}_summary`] = row.summary;
      session[`phase${row.phase}_citations`] = row.citations;
    }
  }

  const serpByCity = buildSerpByServiceAreaCity(waveResults, session);
  // ─── Build unified data structure ───
  const keywordUniverse = buildKeywordUniverse(waveResults, session);
  const competitors = buildCompetitorProfiles(waveResults);

  const auditData: UnifiedAuditData = {
    meta: buildMeta(session, waveResults, tier),
    business_profile: buildBusinessProfile(session, waveResults),
    domain_intelligence: buildDomainIntelligence(waveResults),
    reviews: buildReviewAnalytics(waveResults),
    questions_and_answers: waveResults.questions_answers || [],
    keyword_universe: keywordUniverse,
    organic_keyword_analysis: buildOrganicKeywordAnalysis(waveResults, session, competitors),
    paid_keyword_analysis: buildPaidKeywordAnalysis(waveResults, session),
    competitors,
    serp_analysis: buildSerpAnalysis(waveResults, session),
    ...(serpByCity ? { serp_by_service_area_city: serpByCity } : {}),
    technical_audit: buildTechnicalAudit(waveResults),
    competitor_technical_audit: buildCompetitorTechnicalAudit(waveResults),
    backlinks: buildBacklinksProfile(waveResults, tier),
    tavily_research: buildTavilyResearch(session),
    scoring: { 
      keyword_prioritization: { method: '', weights: {}, top_50_keywords: [] },
      gbp_completeness: 0,
      technical_health: 0,
      competitive_position: 0,
      overall_seo_readiness: 0,
    },
  };

  // ─── Calculate scores ───
  auditData.scoring = calculateScoring(auditData);

  // ─── Store compiled data in dedicated table ───
  await supabase
    .from('research_session_dataforseo')
    .upsert({
      session_id: sessionId,
      seo_audit_data: auditData,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'session_id' });

  logger.debug(`[DataCompiler] Compilation complete: ${auditData.keyword_universe.total_keywords} keywords, score: ${auditData.scoring.overall_seo_readiness}`);
  return auditData;
}

// ─── Builder Functions ──────────────────────────────────────────

function buildMeta(session: any, waveResults: Record<string, any>, tier: string): UnifiedAuditData['meta'] {
  const serviceAreaLocations = (waveResults.service_area_location_codes || []).map((loc: any) => ({
    city: loc.city,
    location_code: loc.location_code,
    google_ads_location_code: loc.google_ads_location_code,
  }));

  return {
    session_id: session.id,
    tier,
    location_code: waveResults.location?.location_code || session.location_code || 2840,
    location_name: waveResults.location?.location_name || session.location_name || 'United States',
    google_ads_location_code: waveResults.google_ads_location_code || 2840,
    google_ads_location_name: waveResults.google_ads_location_name || 'United States',
    service_area_locations: serviceAreaLocations.length > 0 ? serviceAreaLocations : undefined,
    domain: extractDomain(session.website_url),
    generated_at: new Date().toISOString(),
    dataforseo_cost: 0,
    api_calls_count: 0,
  };
}

function buildBusinessProfile(session: any, waveResults: Record<string, any>): UnifiedAuditData['business_profile'] {
  const userBiz = waveResults.user_business;
  const gbpResults = waveResults.gbp_results || [];

  // Find our business in GBP results
  const bizProfile = userBiz || (gbpResults.length > 0 ? gbpResults[0] : null);

  const profile: UnifiedAuditData['business_profile'] = {
    name: session.business_name || bizProfile?.title || '',
    category: bizProfile?.category || session.business_type || '',
    subcategories: [],
    address: bizProfile?.address || `${session.street_address || ''}, ${session.city || ''}, ${session.state || ''} ${session.zip_code || ''}`.trim(),
    phone: bizProfile?.phone || session.phone_number || '',
    website: session.website_url || bizProfile?.url || '',
    hours: session.operating_hours || {},
    attributes: [],
    photos_count: 0,
    is_claimed: bizProfile?.is_claimed || false,
    gbp_completeness_score: 0,
    gbp_completeness_gaps: [],
  };

  // Calculate GBP completeness
  const { score, gaps } = calculateGBPCompleteness(profile, waveResults);
  profile.gbp_completeness_score = score;
  profile.gbp_completeness_gaps = gaps;

  return profile;
}

function buildDomainIntelligence(waveResults: Record<string, any>): UnifiedAuditData['domain_intelligence'] {
  const dr = waveResults.domain_rank;
  const lhDesktop = waveResults.lighthouse_desktop;
  const lhMobile = waveResults.lighthouse_mobile;

  return {
    organic_traffic: dr?.organic_traffic || 0,
    paid_traffic: dr?.paid_traffic || 0,
    organic_keywords_count: dr?.organic_keywords_count || 0,
    backlinks_count: dr?.backlinks || 0,
    referring_domains_count: dr?.referring_domains || 0,
    domain_rank: dr?.domain_rank || 0,
    lighthouse: {
      desktop: lhDesktop ? {
        performance: lhDesktop.performance || 0,
        accessibility: lhDesktop.accessibility || 0,
        best_practices: lhDesktop.best_practices || 0,
        seo: lhDesktop.seo || 0,
        core_web_vitals: lhDesktop.core_web_vitals || {},
      } : null,
      mobile: lhMobile ? {
        performance: lhMobile.performance || 0,
        accessibility: lhMobile.accessibility || 0,
        best_practices: lhMobile.best_practices || 0,
        seo: lhMobile.seo || 0,
        core_web_vitals: lhMobile.core_web_vitals || {},
      } : null,
    },
  };
}

function buildReviewAnalytics(waveResults: Record<string, any>): UnifiedAuditData['reviews'] {
  const reviews: any[] = waveResults.reviews || [];
  const gbpResults: any[] = waveResults.gbp_results || [];

  // Calculate rating distribution
  const distribution: Record<string, number> = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };
  for (const review of reviews) {
    const rating = Math.round(review.rating || 0);
    if (rating >= 1 && rating <= 5) {
      distribution[String(rating)]++;
    }
  }

  // Calculate average rating
  const totalRating = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
  const avgRating = reviews.length > 0 ? totalRating / reviews.length : 0;

  // Simple sentiment summary based on ratings
  const positiveReviews = reviews.filter(r => r.rating >= 4).map(r => r.text).filter(Boolean);
  const negativeReviews = reviews.filter(r => r.rating <= 2).map(r => r.text).filter(Boolean);

  // Review velocity (approximate based on available data)
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  
  const recentReviews30 = reviews.filter(r => {
    if (!r.timestamp) return false;
    return new Date(r.timestamp) > thirtyDaysAgo;
  });
  const recentReviews90 = reviews.filter(r => {
    if (!r.timestamp) return false;
    return new Date(r.timestamp) > ninetyDaysAgo;
  });

  // Competitor comparison
  const competitorRatings = gbpResults
    .filter(r => r.rating?.value)
    .map(r => ({ rating: r.rating.value, count: r.rating.votes_count || 0 }));
  
  const avgCompRating = competitorRatings.length > 0
    ? competitorRatings.reduce((sum, c) => sum + c.rating, 0) / competitorRatings.length
    : 0;
  const avgCompReviewCount = competitorRatings.length > 0
    ? competitorRatings.reduce((sum, c) => sum + c.count, 0) / competitorRatings.length
    : 0;

  return {
    total_count: reviews.length,
    average_rating: Math.round(avgRating * 10) / 10,
    rating_distribution: distribution,
    recent_reviews: reviews.slice(0, 20).map(r => ({
      rating: r.rating,
      text: (r.text || '').substring(0, 500),
      time_ago: r.time_ago,
      profile_name: r.profile_name,
      owner_answer: r.owner_answer ? (r.owner_answer as string).substring(0, 200) : null,
    })),
    sentiment_summary: {
      positive_themes: extractThemes(positiveReviews, 5),
      negative_themes: extractThemes(negativeReviews, 5),
      neutral_themes: [],
    },
    review_velocity: {
      last_30_days: recentReviews30.length,
      last_90_days: recentReviews90.length,
    },
    competitor_comparison: {
      avg_competitor_rating: Math.round(avgCompRating * 10) / 10,
      avg_competitor_review_count: Math.round(avgCompReviewCount),
      rating_gap: Math.round((avgRating - avgCompRating) * 10) / 10,
      review_count_gap: reviews.length - Math.round(avgCompReviewCount),
    },
  };
}

/** City name tokens that often appear in "service + city" suggestions; used to exclude keywords for other locations. */
const OTHER_CITY_TOKENS = new Set([
  'charlotte', 'tampa', 'dallas', 'houston', 'atlanta', 'phoenix', 'austin', 'denver', 'miami', 'orlando',
  'reno', 'nashville', 'raleigh', 'jacksonville', 'memphis', 'louisville', 'baltimore', 'milwaukee', 'albuquerque',
  'tacoma', 'mesa', 'sacramento', 'omaha', 'oakland', 'minneapolis', 'tulsa', 'arlington', 'cleveland', 'bakersfield',
  'honolulu', 'anaheim', 'lexington', 'henderson', 'stockton', 'newark', 'plano', 'lincoln', 'toledo', 'irvine',
  'durham', 'buffalo', 'madison', 'lubbock', 'scottsdale', 'gilbert', 'glendale', 'chandler', 'norfolk', 'garland',
  'irving', 'hialeah', 'fremont', 'boise', 'spokane', 'frisco', 'birmingham', 'modesto', 'rochester', 'fontana',
  'fayetteville', 'mckinney', 'huntsville', 'waco', 'amarillo', 'columbus', 'montgomery', 'augusta', 'aurora',
  'oxnard', 'akron', 'knoxville', 'ontario', 'salinas', 'eugene', 'torrance', 'pasadena', 'bridgeport', 'hayward',
  'rockford', 'savannah', 'mesquite', 'dayton', 'syracuse', 'mcallen', 'pomona', 'paterson', 'alexandria', 'lakewood',
  'sunnyvale', 'hollywood', 'escondido', 'joliet', 'murfreesboro', 'midland', 'elgin', 'carrollton', 'bellevue',
  'surprise', 'charleston', 'hampton', 'warren', 'cedar rapids', 'evansville', 'topeka', 'gainesville', 'downey',
  'wilmington', 'arvada', 'inglewood', 'westminster', 'odessa', 'manchester', 'lancaster', 'norman', 'everett',
  'palmdale', 'salem', 'corona', 'jackson', 'clarksville', 'lewisville', 'tyler', 'peoria', 'lansing',
  'kansas city', 'virginia beach', 'san antonio', 'san diego', 'las vegas', 'new york', 'los angeles', 'chicago',
  'boston', 'seattle', 'portland', 'fort worth', 'oklahoma city', 'st paul', 'jersey city', 'st petersburg',
  'grand rapids', 'little rock', 'el paso', 'santa ana', 'fort lauderdale', 'new haven', 'corpus christi',
  'san jose', 'cape coral', 'ann arbor', 'sterling heights', 'des moines', 'salt lake city', 'baton rouge',
  'san bernardino', 'moreno valley', 'grand prairie', 'huntington beach', 'santa rosa', 'thousand oaks',
  'el monte', 'el cajon', 'santa clara', 'costa mesa', 'lake forest', 'pembroke pines', 'west valley',
  'winston-salem', 'north las vegas', 'fort wayne', 'chula vista', 'daly city',
]);

/**
 * Returns true if the keyword clearly targets another city outside the service area.
 * Keeps keywords that contain the session's primary city or any service area city.
 */
function isKeywordForOtherLocation(keyword: string, sessionCity: string, sessionState: string, serviceAreaCities?: string[]): boolean {
  if (!keyword || typeof keyword !== 'string') return false;
  const sessionCityNorm = (sessionCity || '').toLowerCase().trim();
  if (!sessionCityNorm) return false;
  const kw = keyword.toLowerCase();

  const ourCities = new Set<string>([sessionCityNorm]);
  if (Array.isArray(serviceAreaCities)) {
    for (const c of serviceAreaCities) {
      const cityPart = (c || '').split(',')[0].trim().toLowerCase();
      if (cityPart) ourCities.add(cityPart);
    }
  }

  for (const token of OTHER_CITY_TOKENS) {
    if (kw.includes(token)) {
      let isOurs = false;
      for (const city of ourCities) {
        if (kw.includes(city)) { isOurs = true; break; }
      }
      if (!isOurs) return true;
    }
  }
  return false;
}

function buildKeywordUniverse(waveResults: Record<string, any>, session: any): UnifiedAuditData['keyword_universe'] {
  const sessionCity = (session.city || '').trim();
  const sessionState = (session.state || '').trim();
  const serviceAreaCities: string[] = Array.isArray(session.service_area_cities) ? session.service_area_cities : [];

  // Build per-city lookup tables from bulk_search_volume_by_city and ad_traffic_by_city
  const volumeByCity = (waveResults.bulk_search_volume_by_city || {}) as Record<string, any[]>;
  const adTrafficByCity = (waveResults.ad_traffic_by_city || {}) as Record<string, any[]>;
  const cityNames = Object.keys(volumeByCity);

  // keyword → { city → { search_volume, cpc, competition } }
  const perCityMetrics = new Map<string, Record<string, { search_volume: number; cpc: number; competition: number }>>();
  for (const [cityKey, cityData] of Object.entries(volumeByCity)) {
    for (const kw of (cityData || [])) {
      const key = kw.keyword?.toLowerCase();
      if (!key) continue;
      if (!perCityMetrics.has(key)) perCityMetrics.set(key, {});
      const metrics = perCityMetrics.get(key)!;
      metrics[cityKey] = {
        search_volume: kw.search_volume || 0,
        cpc: kw.cpc || 0,
        competition: kw.competition || 0,
      };
    }
  }
  // Merge ad traffic CPC data into per-city metrics where missing
  for (const [cityKey, cityData] of Object.entries(adTrafficByCity)) {
    for (const kw of (cityData || [])) {
      const key = kw.keyword?.toLowerCase();
      if (!key) continue;
      if (!perCityMetrics.has(key)) perCityMetrics.set(key, {});
      const metrics = perCityMetrics.get(key)!;
      if (!metrics[cityKey]) {
        metrics[cityKey] = { search_volume: 0, cpc: kw.average_cpc || 0, competition: 0 };
      }
    }
  }

  // Merge all keyword sources with deduplication; exclude keywords that target other cities outside service area
  const keywordMap = new Map<string, any>();

  const addKeywords = (source: any[], sourceName: string) => {
    for (const kw of source) {
      const key = kw.keyword?.toLowerCase();
      if (!key) continue;
      if (sessionCity && isKeywordForOtherLocation(kw.keyword, sessionCity, sessionState, serviceAreaCities)) continue;

      const existing = keywordMap.get(key);
      // Use max search_volume across all cities for the main sort field
      let bestVolume = kw.search_volume || 0;
      const cityMetrics = perCityMetrics.get(key);
      if (cityMetrics) {
        for (const cm of Object.values(cityMetrics)) {
          if (cm.search_volume > bestVolume) bestVolume = cm.search_volume;
        }
      }

      if (!existing || bestVolume > (existing.search_volume || 0)) {
        keywordMap.set(key, {
          keyword: kw.keyword,
          search_volume: bestVolume,
          keyword_difficulty: kw.keyword_difficulty || 0,
          cpc: kw.cpc || 0,
          competition: kw.competition || 0,
          competition_level: kw.competition_level || null,
          search_intent: kw.search_intent || 'unknown',
          foreign_intents: kw.foreign_intents || [],
          monthly_trends: kw.monthly_searches || [],
          search_volume_trend: kw.search_volume_trend || null,
          low_top_of_page_bid: kw.low_top_of_page_bid || 0,
          high_top_of_page_bid: kw.high_top_of_page_bid || 0,
          categories: kw.categories || [],
          core_keyword: kw.core_keyword || null,
          source: sourceName,
          current_rank: null,
          target_page: null,
          content_flag: kw.content_flag || null,
          location_metrics: cityNames.length > 1 ? (cityMetrics || undefined) : undefined,
        });
      }
    }
  };

  addKeywords(waveResults.keywords_for_site || [], 'keywords_for_site');
  addKeywords(waveResults.bulk_search_volume || [], 'search_volume');
  addKeywords(waveResults.google_ads_keyword_suggestions || [], 'google_ads_suggestions');
  addKeywords(waveResults.google_ads_keywords_for_site || [], 'google_ads_site');

  // Add Claude-generated keywords that weren't found in DataForSEO enrichment
  const claudeKeywords = waveResults.claude_keywords || [];
  for (const ck of claudeKeywords) {
    const key = ck.keyword?.toLowerCase();
    if (!key) continue;
    if (keywordMap.has(key)) continue;
    if (sessionCity && isKeywordForOtherLocation(ck.keyword, sessionCity, sessionState, serviceAreaCities)) continue;

    keywordMap.set(key, {
      keyword: ck.keyword,
      search_volume: 0,
      keyword_difficulty: 0,
      cpc: 0,
      competition: 0,
      competition_level: null,
      search_intent: 'unknown',
      foreign_intents: [],
      monthly_trends: [],
      search_volume_trend: null,
      low_top_of_page_bid: 0,
      high_top_of_page_bid: 0,
      categories: [],
      core_keyword: null,
      source: `claude_${ck.tier || 'unknown'}`,
      claude_tier: ck.tier || null,
      claude_location: ck.location || null,
      claude_service: ck.service || null,
      current_rank: null,
      target_page: null,
      content_flag: null,
    });
  }

  // Merge search intents
  const intents = waveResults.search_intents || [];
  for (const intent of intents) {
    const key = intent.keyword?.toLowerCase();
    if (key && keywordMap.has(key)) {
      keywordMap.get(key)!.search_intent = intent.search_intent;
    }
  }

  // Merge keyword difficulty + trend from Labs bulk_keyword_difficulty
  const difficultyData = waveResults.keyword_difficulty || [];
  for (const dk of difficultyData) {
    const key = dk.keyword?.toLowerCase();
    if (!key || !keywordMap.has(key)) continue;
    const existing = keywordMap.get(key)!;
    if (dk.keyword_difficulty > 0) existing.keyword_difficulty = dk.keyword_difficulty;
    if (dk.search_volume_trend) existing.search_volume_trend = dk.search_volume_trend;
    if (dk.competition_level && !existing.competition_level) existing.competition_level = dk.competition_level;
    if (dk.search_intent && dk.search_intent !== 'unknown' && existing.search_intent === 'unknown') {
      existing.search_intent = dk.search_intent;
    }
  }

  // ─── Intent-aware volume filtering ───
  // Use the shared keyword classifier to apply per-intent MSV thresholds.
  // Keywords that already have a content_flag from the pipeline (e.g., Google Ads
  // suggestions classified in Wave 2) keep their flag. All others get classified here.
  for (const [key, kw] of keywordMap) {
    const vol = kw.search_volume || 0;
    if (vol === 0) {
      keywordMap.delete(key);
      continue;
    }

    // If this keyword already has a content_flag from the pipeline, it passed
    // intent-based filtering in Wave 2 — keep it as-is.
    if (kw.content_flag) continue;

    // Classify using DataForSEO intent label (merged from Wave 3 search_intents)
    const result = classifyKeywordIntent(kw.keyword, vol, kw.search_intent || 'unknown');
    if (!result.keep) {
      keywordMap.delete(key);
    } else {
      kw.content_flag = result.content_flag;
    }
  }

  // Calculate priority scores
  const city = (session.city || '').toLowerCase();
  const state = (session.state || '').toLowerCase();
  const keywords = Array.from(keywordMap.values()).map(kw => ({
    ...kw,
    priority_score: calculateKeywordPriority(kw, city, state),
  }));

  // Sort by priority score
  keywords.sort((a, b) => b.priority_score - a.priority_score);

  // Calculate intent distribution
  const intentDist: Record<string, number> = { informational: 0, navigational: 0, commercial: 0, transactional: 0 };
  for (const kw of keywords) {
    const intent = kw.search_intent?.toLowerCase() || 'unknown';
    if (intent in intentDist) {
      intentDist[intent]++;
    }
  }

  // Build keyword clusters based on shared terms
  const clusters = buildKeywordClusters(keywords.slice(0, 200), session);

  // Slice by search_intent (transactional, commercial, informational, navigational, unknown, or any other)
  const by_intent: Record<string, UnifiedAuditData['keyword_universe']['keywords']> = {};
  for (const kw of keywords) {
    const intent = (kw.search_intent?.toLowerCase() || 'unknown');
    if (!by_intent[intent]) by_intent[intent] = [];
    by_intent[intent].push(kw);
  }
  for (const key of Object.keys(by_intent)) {
    by_intent[key] = by_intent[key].slice(0, 200);
  }

  // Slice by difficulty bands: 0–33 low, 34–66 medium, 67–100 high
  const capped = keywords.slice(0, 2000);
  const by_difficulty = {
    low: capped.filter(kw => (kw.keyword_difficulty ?? 0) <= 33).slice(0, 200),
    medium: capped.filter(kw => { const d = kw.keyword_difficulty ?? 0; return d >= 34 && d <= 66; }).slice(0, 200),
    high: capped.filter(kw => (kw.keyword_difficulty ?? 0) >= 67).slice(0, 200),
  };

  return {
    total_keywords: keywords.length,
    keywords: capped,
    intent_distribution: intentDist,
    by_intent,
    by_difficulty,
    clusters,
  };
}

// ─── Organic Keyword Analysis Builder ──────────────────────────

function buildOrganicKeywordAnalysis(
  waveResults: Record<string, any>,
  session: any,
  competitors: UnifiedAuditData['competitors']
): OrganicKeywordAnalysis | undefined {
  const volumeData = waveResults.bulk_search_volume || [];
  const difficultyData = waveResults.keyword_difficulty || [];
  const intentData = waveResults.search_intents || [];

  if (volumeData.length === 0 && difficultyData.length === 0) return undefined;

  // Build a keyword map from all organic sources
  const kwMap = new Map<string, any>();

  // Merge volume data
  for (const kw of volumeData) {
    const key = (kw.keyword || '').toLowerCase();
    if (!key) continue;
    kwMap.set(key, {
      keyword: kw.keyword,
      search_volume: kw.search_volume || 0,
      keyword_difficulty: 0,
      search_intent: 'unknown',
      monthly_searches: kw.monthly_searches || [],
      search_volume_trend: kw.search_volume_trend || null,
      current_organic_position: null,
      source: 'search_volume',
    });
  }

  // Merge difficulty scores
  for (const dk of difficultyData) {
    const key = (dk.keyword || '').toLowerCase();
    if (!key) continue;
    const existing = kwMap.get(key);
    if (existing) {
      if (dk.keyword_difficulty > 0) existing.keyword_difficulty = dk.keyword_difficulty;
      if (dk.search_volume_trend) existing.search_volume_trend = dk.search_volume_trend;
    } else {
      kwMap.set(key, {
        keyword: dk.keyword,
        search_volume: dk.search_volume || 0,
        keyword_difficulty: dk.keyword_difficulty || 0,
        search_intent: 'unknown',
        monthly_searches: dk.monthly_searches || [],
        search_volume_trend: dk.search_volume_trend || null,
        current_organic_position: null,
        source: 'keyword_difficulty',
      });
    }
  }

  // Merge intent classification
  for (const intent of intentData) {
    const key = (intent.keyword || '').toLowerCase();
    if (key && kwMap.has(key)) {
      kwMap.get(key)!.search_intent = intent.search_intent || 'unknown';
    }
  }

  // Merge current organic position from competitor ranked keywords (if user domain)
  const domain = extractDomain(session.website_url);
  if (domain) {
    const rankedByComp = waveResults.competitor_ranked_keywords || {};
    const userRanked = rankedByComp[domain] || [];
    for (const rk of userRanked) {
      const key = (rk.keyword || '').toLowerCase();
      if (key && kwMap.has(key)) {
        kwMap.get(key)!.current_organic_position = rk.rank_group || rk.rank_absolute || null;
      }
    }
  }

  // Filter: volume > 0 for organic analysis
  const filtered = Array.from(kwMap.values()).filter(kw => kw.search_volume > 0);

  // Score keywords: high volume + low difficulty = opportunity
  const scored: OrganicKeywordEntry[] = filtered.map(kw => {
    const volumeScore = Math.min(kw.search_volume / 1000, 10);
    const difficultyPenalty = (kw.keyword_difficulty || 0) / 100;
    const intentBonus = ['transactional', 'commercial'].includes(kw.search_intent?.toLowerCase()) ? 2 : 0;
    const opportunity_score = Math.round((volumeScore * (1 - difficultyPenalty) + intentBonus) * 10) / 10;

    return {
      keyword: kw.keyword,
      search_volume: kw.search_volume,
      keyword_difficulty: kw.keyword_difficulty,
      search_intent: kw.search_intent,
      monthly_searches: kw.monthly_searches,
      search_volume_trend: kw.search_volume_trend,
      current_organic_position: kw.current_organic_position,
      opportunity_score,
      source: kw.source,
    };
  });

  // Sort by opportunity score
  scored.sort((a, b) => b.opportunity_score - a.opportunity_score);

  // Intent distribution
  const intentDist: Record<string, number> = {};
  for (const kw of scored) {
    const intent = kw.search_intent?.toLowerCase() || 'unknown';
    intentDist[intent] = (intentDist[intent] || 0) + 1;
  }

  // Build competitors with traffic estimation
  const trafficEstimation = waveResults.competitor_traffic_estimation || [];
  const trafficMap = new Map<string, number>();
  for (const te of trafficEstimation) {
    if (te.target) trafficMap.set(te.target.toLowerCase(), te.organic_etv || 0);
  }

  const organicCompetitors = (competitors.organic_competitors || []).slice(0, 10).map((c: any) => ({
    domain: c.domain || '',
    avg_position: c.avg_position || 0,
    intersections: c.intersections || 0,
    estimated_monthly_traffic: trafficMap.get((c.domain || '').toLowerCase()) ?? null,
  }));

  // Build keyword gaps from domain intersections
  const keywordGaps: OrganicKeywordAnalysis['keyword_gaps'] = [];
  const intersections = waveResults.domain_intersections || {};
  for (const [compDomain, kws] of Object.entries(intersections)) {
    for (const gap of (kws as any[]).filter((k: any) => !k.target1_rank && k.target2_rank).slice(0, 20)) {
      keywordGaps.push({
        keyword: gap.keyword || '',
        search_volume: gap.search_volume || 0,
        keyword_difficulty: gap.keyword_difficulty || 0,
        competitor_domain: compDomain,
        competitor_rank: gap.target2_rank || null,
        your_rank: gap.target1_rank || null,
      });
    }
  }

  const totalTraffic = scored.reduce((sum, kw) => sum + kw.search_volume, 0);
  const avgDifficulty = scored.length > 0
    ? Math.round(scored.reduce((sum, kw) => sum + kw.keyword_difficulty, 0) / scored.length)
    : 0;

  return {
    keywords: scored.slice(0, 500),
    total_addressable_traffic: totalTraffic,
    avg_difficulty: avgDifficulty,
    intent_distribution: intentDist,
    competitors: organicCompetitors,
    keyword_gaps: keywordGaps.slice(0, 100),
    top_opportunities: scored.slice(0, 20).map(kw => ({
      keyword: kw.keyword,
      volume: kw.search_volume,
      difficulty: kw.keyword_difficulty,
      intent: kw.search_intent,
    })),
  };
}

// ─── Paid Keyword Analysis Builder ────────────────────────────

/**
 * Derive competition level string from the numeric competition index (0–1 scale).
 * Google Ads sometimes returns competition_level as null even when the numeric
 * competition value is available.
 */
function deriveCompetitionLevel(competitionIndex: number | null | undefined, competitionLevel: string | null | undefined): string {
  if (competitionLevel && competitionLevel !== 'UNSPECIFIED') return competitionLevel;
  const idx = typeof competitionIndex === 'number' ? competitionIndex : NaN;
  if (Number.isNaN(idx) || idx <= 0) return 'UNSPECIFIED';
  if (idx < 0.34) return 'LOW';
  if (idx < 0.67) return 'MEDIUM';
  return 'HIGH';
}

function buildPaidKeywordAnalysis(
  waveResults: Record<string, any>,
  _session: any
): PaidKeywordAnalysis | undefined {
  const volumeByCity = (waveResults.bulk_search_volume_by_city || {}) as Record<string, any[]>;
  const adTrafficByCity = (waveResults.ad_traffic_by_city || {}) as Record<string, any[]>;
  const volumeData = Object.keys(volumeByCity).length > 0
    ? Object.values(volumeByCity).flat()
    : (waveResults.bulk_search_volume || []);
  const adTrafficData = Object.keys(adTrafficByCity).length > 0
    ? Object.values(adTrafficByCity).flat()
    : (waveResults.ad_traffic || []);
  const paidSuggestions = waveResults.google_ads_keyword_suggestions || [];
  const paidSiteKws = waveResults.google_ads_keywords_for_site || [];
  const cityNames = Object.keys(volumeByCity);

  // Build per-city metrics lookup: keyword → { city → { search_volume, cpc, competition } }
  const perCityMetrics = new Map<string, Record<string, { search_volume: number; cpc: number; competition: number }>>();
  for (const [cityKey, cityData] of Object.entries(volumeByCity)) {
    for (const kw of (cityData || [])) {
      const key = kw.keyword?.toLowerCase();
      if (!key) continue;
      if (!perCityMetrics.has(key)) perCityMetrics.set(key, {});
      perCityMetrics.get(key)![cityKey] = {
        search_volume: kw.search_volume || 0,
        cpc: kw.cpc || 0,
        competition: kw.competition || 0,
      };
    }
  }
  for (const [cityKey, cityData] of Object.entries(adTrafficByCity)) {
    for (const kw of (cityData || [])) {
      const key = kw.keyword?.toLowerCase();
      if (!key) continue;
      if (!perCityMetrics.has(key)) perCityMetrics.set(key, {});
      const metrics = perCityMetrics.get(key)!;
      if (!metrics[cityKey]) {
        metrics[cityKey] = { search_volume: 0, cpc: kw.average_cpc || 0, competition: 0 };
      }
    }
  }

  // Build a map of all paid-relevant keywords
  const kwMap = new Map<string, any>();

  // Add Google Ads suggestions (from Wave 2)
  for (const kw of paidSuggestions) {
    const key = (kw.keyword || '').toLowerCase();
    if (!key) continue;
    const compIdx = typeof kw.competition === 'number' ? kw.competition : 0;

    let bestVolume = kw.search_volume || 0;
    const cityMetrics = perCityMetrics.get(key);
    if (cityMetrics) {
      for (const cm of Object.values(cityMetrics)) {
        if (cm.search_volume > bestVolume) bestVolume = cm.search_volume;
      }
    }

    kwMap.set(key, {
      keyword: kw.keyword,
      search_volume: bestVolume,
      cpc: kw.cpc || 0,
      competition: deriveCompetitionLevel(compIdx, kw.competition_level),
      competition_index: compIdx,
      low_top_of_page_bid: kw.low_top_of_page_bid || 0,
      high_top_of_page_bid: kw.high_top_of_page_bid || 0,
      projected_impressions: null as number | null,
      projected_clicks: null as number | null,
      projected_ctr: null as number | null,
      projected_cost: null as number | null,
      source: 'google_ads_keywords_for_keywords',
      location_metrics: cityNames.length > 1 ? (cityMetrics || undefined) : undefined,
    });
  }

  // Add Google Ads site keywords
  for (const kw of paidSiteKws) {
    const key = (kw.keyword || '').toLowerCase();
    if (!key || kwMap.has(key)) continue;
    const compIdx = typeof kw.competition === 'number' ? kw.competition : 0;

    let bestVolume = kw.search_volume || 0;
    const cityMetrics = perCityMetrics.get(key);
    if (cityMetrics) {
      for (const cm of Object.values(cityMetrics)) {
        if (cm.search_volume > bestVolume) bestVolume = cm.search_volume;
      }
    }

    kwMap.set(key, {
      keyword: kw.keyword,
      search_volume: bestVolume,
      cpc: kw.cpc || 0,
      competition: deriveCompetitionLevel(compIdx, kw.competition_level),
      competition_index: compIdx,
      low_top_of_page_bid: kw.low_top_of_page_bid || 0,
      high_top_of_page_bid: kw.high_top_of_page_bid || 0,
      projected_impressions: null as number | null,
      projected_clicks: null as number | null,
      projected_ctr: null as number | null,
      projected_cost: null as number | null,
      source: 'google_ads_keywords_for_site',
      location_metrics: cityNames.length > 1 ? (cityMetrics || undefined) : undefined,
    });
  }

  // Enrich with authoritative search volume data from Wave 3 (all cities merged)
  // Deduplicate enrichment data — use max volume across cities
  const volumeDeduped = new Map<string, any>();
  for (const vol of volumeData) {
    const key = (vol.keyword || '').toLowerCase();
    if (!key) continue;
    const existing = volumeDeduped.get(key);
    if (!existing || (vol.search_volume || 0) > (existing.search_volume || 0)) {
      volumeDeduped.set(key, vol);
    }
  }
  for (const vol of volumeDeduped.values()) {
    const key = (vol.keyword || '').toLowerCase();
    const existing = kwMap.get(key);
    if (existing) {
      existing.search_volume = vol.search_volume || existing.search_volume;
      existing.cpc = vol.cpc || existing.cpc;
      const volCompIdx = typeof vol.competition === 'number' ? vol.competition : existing.competition_index;
      existing.competition = deriveCompetitionLevel(volCompIdx, vol.competition_level || existing.competition);
      existing.competition_index = volCompIdx;
      existing.low_top_of_page_bid = vol.low_top_of_page_bid || existing.low_top_of_page_bid;
      existing.high_top_of_page_bid = vol.high_top_of_page_bid || existing.high_top_of_page_bid;
    }
  }

  // Merge ad traffic projections from Wave 3 (all cities merged, use max)
  let adTrafficMerged = 0;
  const adTrafficDeduped = new Map<string, any>();
  for (const at of adTrafficData) {
    const key = (at.keyword || '').toLowerCase();
    if (!key) continue;
    const existing = adTrafficDeduped.get(key);
    if (!existing || (at.clicks ?? 0) > (existing.clicks ?? 0)) {
      adTrafficDeduped.set(key, at);
    }
  }
  for (const at of adTrafficDeduped.values()) {
    const key = (at.keyword || '').toLowerCase();
    const existing = kwMap.get(key);
    if (existing) {
      existing.projected_impressions = at.impressions ?? 0;
      existing.projected_clicks = at.clicks ?? 0;
      existing.projected_ctr = at.ctr ?? 0;
      existing.projected_cost = at.cost ?? 0;
      adTrafficMerged++;
    } else {
      const cityMetrics = perCityMetrics.get(key);
      kwMap.set(key, {
        keyword: at.keyword,
        search_volume: 0,
        cpc: at.average_cpc || 0,
        competition: deriveCompetitionLevel(at.competition, at.competition_level),
        competition_index: typeof at.competition === 'number' ? at.competition : 0,
        low_top_of_page_bid: 0,
        high_top_of_page_bid: 0,
        projected_impressions: at.impressions ?? 0,
        projected_clicks: at.clicks ?? 0,
        projected_ctr: at.ctr ?? 0,
        projected_cost: at.cost ?? 0,
        source: 'ad_traffic',
        location_metrics: cityNames.length > 1 ? (cityMetrics || undefined) : undefined,
      });
      adTrafficMerged++;
    }
  }

  // When ad_traffic data is missing or empty, estimate projections from volume + CPC
  if (adTrafficMerged === 0 && kwMap.size > 0) {
    for (const kw of kwMap.values()) {
      if (kw.projected_clicks != null) continue;
      const vol = kw.search_volume || 0;
      const cpc = kw.cpc || 0;
      if (vol > 0) {
        const estCtr = 0.025;
        const estClicks = Math.round(vol * estCtr);
        kw.projected_impressions = vol;
        kw.projected_clicks = estClicks;
        kw.projected_ctr = estCtr;
        kw.projected_cost = cpc > 0 ? Math.round(estClicks * cpc * 100) / 100 : 0;
      }
    }
  }

  if (kwMap.size === 0) return undefined;

  // Filter: volume > 0 for meaningful analysis
  const filtered = Array.from(kwMap.values()).filter(kw => kw.search_volume > 0);

  // Score keywords: high volume + low CPC + low competition = opportunity
  const scored: PaidKeywordEntry[] = filtered.map(kw => {
    const volumeScore = Math.min(kw.search_volume / 1000, 10);
    const cpcPenalty = Math.min(kw.cpc / 20, 1);
    const compPenalty = typeof kw.competition_index === 'number' && !Number.isNaN(kw.competition_index) ? kw.competition_index : 0;
    const clickBonus = typeof kw.projected_clicks === 'number' && kw.projected_clicks > 0 ? Math.min(kw.projected_clicks / 100, 2) : 0;
    let opportunity_score = Math.round((volumeScore * (1 - cpcPenalty) * (1 - compPenalty) + clickBonus) * 10) / 10;
    if (!Number.isFinite(opportunity_score)) opportunity_score = 0;

    return {
      keyword: kw.keyword,
      search_volume: kw.search_volume,
      cpc: kw.cpc,
      competition: typeof kw.competition === 'string' && kw.competition !== 'UNSPECIFIED' ? kw.competition : deriveCompetitionLevel(kw.competition_index, null),
      competition_index: typeof kw.competition_index === 'number' ? kw.competition_index : 0,
      low_top_of_page_bid: kw.low_top_of_page_bid,
      high_top_of_page_bid: kw.high_top_of_page_bid,
      projected_impressions: kw.projected_impressions,
      projected_clicks: kw.projected_clicks,
      projected_ctr: kw.projected_ctr,
      projected_cost: kw.projected_cost,
      opportunity_score,
      source: kw.source,
      location_metrics: kw.location_metrics,
    };
  });

  // Sort by opportunity score
  scored.sort((a, b) => b.opportunity_score - a.opportunity_score);

  const totalSpend = scored.reduce((sum, kw) => sum + (kw.projected_cost || 0), 0);
  const totalClicks = scored.reduce((sum, kw) => sum + (kw.projected_clicks || 0), 0);
  const cpcValues = scored.filter(kw => kw.cpc > 0).map(kw => kw.cpc);
  const avgCpc = cpcValues.length > 0 ? Math.round((cpcValues.reduce((s, c) => s + c, 0) / cpcValues.length) * 100) / 100 : 0;

  return {
    keywords: scored.slice(0, 500),
    estimated_monthly_spend: Math.round(totalSpend * 100) / 100,
    estimated_monthly_clicks: Math.round(totalClicks),
    avg_cpc: avgCpc,
    top_opportunities: scored.slice(0, 20).map(kw => ({
      keyword: kw.keyword,
      volume: kw.search_volume,
      cpc: kw.cpc,
      competition: kw.competition,
    })),
  };
}

function buildCompetitorProfiles(waveResults: Record<string, any>): UnifiedAuditData['competitors'] {
  // No-website case: use SERP competitors as organic list when competitors_domain is empty
  const domainSource = (waveResults.competitors_domain?.length ? waveResults.competitors_domain : (waveResults.serp_competitors || [])) as any[];

  // Build traffic estimation lookup from Wave 4 bulkTrafficEstimation
  const trafficEstimation = waveResults.competitor_traffic_estimation || [];
  const trafficMap = new Map<string, number>();
  for (const te of trafficEstimation) {
    if (te.target) trafficMap.set(te.target.toLowerCase(), te.organic_etv || 0);
  }

  const organicComps = domainSource.map((c: any) => ({
    domain: c.domain,
    avg_position: c.avg_position,
    intersections: c.intersections,
    estimated_monthly_traffic: trafficMap.get((c.domain || '').toLowerCase()) ?? null,
    unique_keywords: 0,
    shared_keywords: [] as any[],
    keyword_gaps: [] as any[],
    domain_metrics: c.full_domain_metrics,
    top_keywords: [] as any[],
  }));

  // Enrich with intersection data
  const intersections = waveResults.domain_intersections || {};
  for (const comp of organicComps) {
    const intersection = intersections[comp.domain];
    if (intersection) {
      comp.shared_keywords = intersection.filter((k: any) => k.target1_rank && k.target2_rank).slice(0, 50);
      comp.keyword_gaps = intersection.filter((k: any) => !k.target1_rank && k.target2_rank).slice(0, 50);
      comp.unique_keywords = comp.keyword_gaps.length;
    }
  }

  // Enrich with ranked keywords per competitor
  const rankedByComp = waveResults.competitor_ranked_keywords || {};
  for (const comp of organicComps) {
    if (rankedByComp[comp.domain]) {
      comp.top_keywords = rankedByComp[comp.domain].slice(0, 20);
    }
  }

  const businessInfo = (waveResults.competitor_business_info || {}) as Record<string, any>;
  const reviewsByKey = (waveResults.competitor_reviews || {}) as Record<string, any[]>;
  const competitor_profiles: Array<{ key: string; business_info: any; reviews: any[] }> = [];
  const keys = new Set([...Object.keys(businessInfo), ...Object.keys(reviewsByKey)]);
  for (const key of keys) {
    competitor_profiles.push({
      key,
      business_info: businessInfo[key] ?? null,
      reviews: reviewsByKey[key] ?? [],
    });
  }

  const filteredOrganic = organicComps.filter((c: any) => !isExcludedDomain(c.domain));
  const filteredSerp = (waveResults.serp_competitors || []).filter((c: any) => !isExcludedDomain(c.domain));

  return {
    organic_competitors: filteredOrganic.slice(0, 10),
    serp_competitors: filteredSerp.slice(0, 10),
    local_competitors: (waveResults.gbp_results || []).slice(0, 10),
    backlink_competitors: (waveResults.backlink_competitors || []).slice(0, 10),
    ...(competitor_profiles.length > 0 ? { competitor_profiles } : {}),
  };
}

/** Extended SERP feature arrays parsed from advanced task_get items (paid, related_searches, LSA, etc.). */
interface ExtendedSerpFeatures {
  paid_results: UnifiedAuditData['serp_analysis']['paid_results'];
  related_searches: UnifiedAuditData['serp_analysis']['related_searches'];
  people_also_search: UnifiedAuditData['serp_analysis']['people_also_search'];
  local_services_ads: UnifiedAuditData['serp_analysis']['local_services_ads'];
  discussions_and_forums: UnifiedAuditData['serp_analysis']['discussions_and_forums'];
  find_results_on: NonNullable<UnifiedAuditData['serp_analysis']['find_results_on']>;
  google_posts: NonNullable<UnifiedAuditData['serp_analysis']['google_posts']>;
  google_reviews: NonNullable<UnifiedAuditData['serp_analysis']['google_reviews']>;
}

/**
 * Iterate over SERP organic result items (advanced task_get) and extract extended features:
 * paid, related_searches, people_also_search, local_services, discussions_and_forums, find_results_on, google_posts, google_reviews.
 * Used for main SERP and for per-city SERP when present.
 */
function extractExtendedSerpFeatures(organicResults: Record<string, any>): ExtendedSerpFeatures {
  const paid_results: ExtendedSerpFeatures['paid_results'] = [];
  const related_searches: ExtendedSerpFeatures['related_searches'] = [];
  const people_also_search: ExtendedSerpFeatures['people_also_search'] = [];
  const local_services_ads: ExtendedSerpFeatures['local_services_ads'] = [];
  const discussions_and_forums: ExtendedSerpFeatures['discussions_and_forums'] = [];
  const find_results_on: ExtendedSerpFeatures['find_results_on'] = [];
  const google_posts: ExtendedSerpFeatures['google_posts'] = [];
  const google_reviews: ExtendedSerpFeatures['google_reviews'] = [];

  for (const [keyword, result] of Object.entries(organicResults)) {
    const items = (result as any)?.tasks?.[0]?.result?.[0]?.items ?? [];
    for (const item of items) {
      switch (item.type) {
        case 'paid':
          if (item.items) {
            for (let i = 0; i < item.items.length; i++) {
              const ad = item.items[i];
              paid_results.push({
                keyword,
                title: ad.title,
                domain: ad.domain ?? ad.breadcrumb,
                description: ad.description?.substring?.(0, 500) ?? ad.description,
                url: ad.url,
                rank: ad.rank ?? ad.position ?? i + 1,
              });
            }
          } else {
            paid_results.push({
              keyword,
              title: item.title,
              domain: item.domain ?? item.breadcrumb,
              description: typeof item.description === 'string' ? item.description.substring(0, 500) : item.description,
              url: item.url,
              rank: item.rank ?? item.position,
            });
          }
          break;
        case 'related_searches':
          related_searches.push({
            keyword,
            items: Array.isArray(item.items) ? item.items : [],
          });
          break;
        case 'people_also_search':
          people_also_search.push({
            keyword,
            title: item.title,
            items: Array.isArray(item.items) ? item.items : [],
          });
          break;
        case 'local_services':
          const lsaItems = Array.isArray(item.items) ? item.items : [item];
          for (const entry of lsaItems) {
            local_services_ads.push({ keyword, ...entry });
          }
          break;
        case 'discussions_and_forums':
          const forumItems = Array.isArray(item.items) ? item.items : [item];
          for (const entry of forumItems) {
            discussions_and_forums.push({
              keyword,
              title: entry.title ?? item.title,
              url: entry.url ?? item.url,
              domain: entry.domain ?? item.domain,
              ...entry,
            });
          }
          break;
        case 'find_results_on':
          find_results_on.push({ keyword, ...item });
          break;
        case 'google_posts':
          const postItems = Array.isArray(item.items) ? item.items : [item];
          for (const entry of postItems) {
            google_posts.push({ keyword, ...entry });
          }
          break;
        case 'google_reviews':
          const reviewItems = Array.isArray(item.items) ? item.items : [item];
          for (const entry of reviewItems) {
            google_reviews.push({ keyword, ...entry });
          }
          break;
        default:
          break;
      }
    }
  }

  return {
    paid_results,
    related_searches,
    people_also_search,
    local_services_ads,
    discussions_and_forums,
    find_results_on,
    google_posts,
    google_reviews,
  };
}

/** Intent values we use for local pack dominance (transactional + commercial). */
const LOCAL_PACK_INTENTS = new Set(['transactional', 'commercial']);

/**
 * Build local pack dominance for transactional (and commercial) keywords only.
 * For each such keyword, builds pack entries from SERP local_pack and resolves your_position
 * by matching session place_id / cid / domain (from GBP lookup) to pack entries.
 */
function buildLocalPackDominance(
  waveResults: Record<string, any>,
  session: any
): UnifiedAuditData['serp_analysis']['local_pack_dominance'] {
  const organicResults = waveResults.serp_organic_results || {};
  if (typeof organicResults !== 'object' || Object.keys(organicResults).length === 0) return [];

  const intentMap = new Map<string, string>();
  for (const row of waveResults.search_intents || []) {
    const k = (row.keyword || '').toString().toLowerCase().trim();
    if (k) intentMap.set(k, (row.search_intent || 'unknown').toString().toLowerCase());
  }

  const ourDomain = extractDomain(session?.website_url);
  const userBiz = waveResults.user_business;
  const ourPlaceId = userBiz?.place_id ?? userBiz?.cid ?? null;
  const ourCid = userBiz?.cid ?? userBiz?.place_id ?? null;

  const dominance: UnifiedAuditData['serp_analysis']['local_pack_dominance'] = [];

  for (const [keyword, result] of Object.entries(organicResults)) {
    const intent = intentMap.get((keyword as string).toLowerCase().trim()) || 'unknown';
    if (!LOCAL_PACK_INTENTS.has(intent)) continue;

    const items = (result as any)?.tasks?.[0]?.result?.[0]?.items ?? [];
    const localPackItem = items.find((i: any) => i.type === 'local_pack');
    const packEntries = Array.isArray(localPackItem?.items) ? localPackItem.items : [];
    if (packEntries.length === 0) continue;

    const pack = packEntries.map((entry: any, index: number) => ({
      rank: index + 1,
      title: entry.title,
      domain: entry.domain ?? entry.breadcrumb,
      cid: entry.cid ?? undefined,
      place_id: entry.place_id ?? undefined,
      rating: entry.rating ?? undefined,
    }));

    let your_position: number | null = null;
    for (let i = 0; i < pack.length; i++) {
      const p = pack[i];
      const matchCid = ourCid && (p.cid === ourCid || p.place_id === ourCid);
      const matchPlaceId = ourPlaceId && (p.place_id === ourPlaceId || p.cid === ourPlaceId);
      const matchDomain = ourDomain && p.domain && p.domain.toLowerCase().includes(ourDomain.toLowerCase());
      if (matchCid || matchPlaceId || matchDomain) {
        your_position = i + 1;
        break;
      }
    }

    dominance.push({ keyword: keyword as string, pack, your_position });
  }

  return dominance;
}

function buildSerpAnalysis(
  waveResults: Record<string, any>,
  session?: any
): UnifiedAuditData['serp_analysis'] {
  const organicResults = waveResults.serp_organic_results || {};
  const rawMaps = waveResults.serp_maps_results || {};
  const rawLocal = waveResults.local_finder_results || {};
  const extended = extractExtendedSerpFeatures(organicResults);

  const userDomain = extractDomain(session?.website_url)?.toLowerCase() || '';
  const businessName = session?.business_name || '';

  const { structured: structuredOrganic, features: serpFeatures } = processRawOrganicResults(organicResults, userDomain);
  const structuredMaps = processRawMapsResults(rawMaps, userDomain, businessName);
  const structuredLocalFinder = processRawLocalFinderResults(rawLocal, userDomain, businessName);
  const structuredAutocomplete = processRawAutocomplete(waveResults.autocomplete_results || []);

  return {
    organic_results: structuredOrganic,
    maps_results: structuredMaps,
    local_finder_results: structuredLocalFinder,
    serp_features: {
      local_pack_present: serpFeatures.localPackPresent,
      featured_snippets: serpFeatures.featuredSnippets,
      people_also_ask: serpFeatures.peopleAlsoAsk,
      knowledge_panel: serpFeatures.knowledgePanel,
    },
    paid_results: extended.paid_results,
    related_searches: extended.related_searches,
    people_also_search: extended.people_also_search,
    local_services_ads: extended.local_services_ads,
    discussions_and_forums: extended.discussions_and_forums,
    find_results_on: extended.find_results_on.length > 0 ? extended.find_results_on : undefined,
    google_posts: extended.google_posts.length > 0 ? extended.google_posts : undefined,
    google_reviews: extended.google_reviews.length > 0 ? extended.google_reviews : undefined,
    local_pack_dominance: session ? buildLocalPackDominance(waveResults, session) : [],
    autocomplete_suggestions: structuredAutocomplete,
    _raw_organic_results: organicResults,
    _raw_maps_results: rawMaps,
    _raw_local_finder_results: rawLocal,
  };
}

// ─── Shared SERP extraction helpers ───

function processRawOrganicResults(
  rawOrganic: Record<string, any>,
  userDomain: string,
): { structured: SerpOrganicEntry[]; features: { localPackPresent: boolean; featuredSnippets: any[]; peopleAlsoAsk: any[]; knowledgePanel: any } } {
  const structured: SerpOrganicEntry[] = [];
  const featuredSnippets: any[] = [];
  const peopleAlsoAsk: any[] = [];
  let knowledgePanel: any = null;
  let localPackPresent = false;

  for (const [keyword, result] of Object.entries(rawOrganic)) {
    const items = (result as any)?.tasks?.[0]?.result?.[0]?.items || [];
    const rankings: SerpOrganicEntry['rankings'] = [];
    const features: string[] = [];
    let userPos: number | null = null;

    for (const item of items) {
      if (item.type === 'organic') {
        const domain = (item.domain || '').toLowerCase();
        const isUser = userDomain ? domain.includes(userDomain) || userDomain.includes(domain) : false;
        rankings.push({
          position: item.rank_group || item.rank_absolute || 0,
          domain: item.domain || '',
          title: item.title || '',
          url: item.url || '',
          description: (item.description || '').substring(0, 300),
          is_user_domain: isUser,
        });
        if (isUser && userPos === null) {
          userPos = item.rank_group || item.rank_absolute || null;
        }
      } else if (['local_pack', 'featured_snippet', 'people_also_ask', 'knowledge_graph', 'paid', 'video', 'images', 'top_stories', 'twitter', 'related_searches', 'shopping'].includes(item.type)) {
        if (!features.includes(item.type)) features.push(item.type);
      }

      switch (item.type) {
        case 'local_pack':
          localPackPresent = true;
          break;
        case 'featured_snippet':
          featuredSnippets.push({
            keyword,
            title: item.title,
            description: item.description?.substring(0, 300),
            url: item.url,
            type: item.featured_snippet?.type || 'paragraph',
          });
          break;
        case 'people_also_ask':
          if (item.items) {
            for (const question of item.items) {
              peopleAlsoAsk.push({
                keyword,
                question: question.title || question.question,
                snippet: question.description?.substring(0, 200),
                url: question.url,
              });
            }
          }
          break;
        case 'knowledge_graph':
          if (!knowledgePanel) {
            knowledgePanel = {
              keyword,
              title: item.title,
              description: item.description?.substring(0, 300),
              type: item.sub_type,
            };
          }
          break;
      }
    }

    if (rankings.length > 0) {
      structured.push({ keyword, rankings: rankings.slice(0, 10), features_present: features, user_position: userPos });
    }
  }

  const seenQuestions = new Set<string>();
  const dedupedPAA = peopleAlsoAsk.filter(paa => {
    const key = (paa.question || '').toLowerCase();
    if (seenQuestions.has(key)) return false;
    seenQuestions.add(key);
    return true;
  });

  return {
    structured,
    features: { localPackPresent, featuredSnippets: featuredSnippets.slice(0, 20), peopleAlsoAsk: dedupedPAA.slice(0, 30), knowledgePanel },
  };
}

function processRawMapsResults(
  rawMaps: Record<string, any>,
  userDomain: string,
  businessName: string,
): SerpMapsEntry[] {
  const structured: SerpMapsEntry[] = [];
  for (const [keyword, result] of Object.entries(rawMaps)) {
    const items = (result as any)?.tasks?.[0]?.result?.[0]?.items || [];
    const businesses: SerpMapsEntry['businesses'] = [];
    for (const item of items) {
      if (item.type === 'maps_search') {
        for (const biz of (item.items || [])) {
          const bizDomain = (biz.domain || biz.url || '').toLowerCase();
          const isUser = userDomain ? bizDomain.includes(userDomain) || (biz.title || '').toLowerCase().includes(businessName.toLowerCase()) : false;
          businesses.push({
            position: biz.rank_group || biz.rank_absolute || businesses.length + 1,
            title: biz.title || '', domain: biz.domain || null, address: biz.address || '', phone: biz.phone || '',
            rating: biz.rating?.value ?? null, reviews_count: biz.rating?.votes_count ?? null,
            category: biz.category || '', place_id: biz.place_id || '', is_user_business: isUser,
          });
        }
      } else if (item.domain || item.title) {
        const bizDomain = (item.domain || item.url || '').toLowerCase();
        const isUser = userDomain ? bizDomain.includes(userDomain) || (item.title || '').toLowerCase().includes(businessName.toLowerCase()) : false;
        businesses.push({
          position: item.rank_group || item.rank_absolute || businesses.length + 1,
          title: item.title || '', domain: item.domain || null, address: item.address || '', phone: item.phone || '',
          rating: item.rating?.value ?? null, reviews_count: item.rating?.votes_count ?? null,
          category: item.category || '', place_id: item.place_id || '', is_user_business: isUser,
        });
      }
    }
    if (businesses.length > 0) structured.push({ keyword, businesses });
  }
  return structured;
}

function processRawLocalFinderResults(
  rawLocal: Record<string, any>,
  userDomain: string,
  businessName: string,
): SerpLocalFinderEntry[] {
  const structured: SerpLocalFinderEntry[] = [];
  for (const [keyword, result] of Object.entries(rawLocal)) {
    const items = (result as any)?.tasks?.[0]?.result?.[0]?.items || [];
    const businesses: SerpLocalFinderEntry['businesses'] = [];
    for (const item of items) {
      if (item.type === 'maps_search') {
        for (const biz of (item.items || [])) {
          const isUser = userDomain
            ? ((biz.domain || '').toLowerCase().includes(userDomain) || (biz.title || '').toLowerCase().includes(businessName.toLowerCase()))
            : false;
          businesses.push({
            position: biz.rank_group || biz.rank_absolute || businesses.length + 1,
            title: biz.title || '', domain: biz.domain || null, address: biz.address || '',
            rating: biz.rating?.value ?? null, reviews_count: biz.rating?.votes_count ?? null,
            category: biz.category || '', is_user_business: isUser,
          });
        }
      } else if (item.title) {
        const isUser = userDomain
          ? ((item.domain || '').toLowerCase().includes(userDomain) || (item.title || '').toLowerCase().includes(businessName.toLowerCase()))
          : false;
        businesses.push({
          position: item.rank_group || item.rank_absolute || businesses.length + 1,
          title: item.title || '', domain: item.domain || null, address: item.address || '',
          rating: item.rating?.value ?? null, reviews_count: item.rating?.votes_count ?? null,
          category: item.category || '', is_user_business: isUser,
        });
      }
    }
    const totalResults = (result as any)?.tasks?.[0]?.result?.[0]?.items_count || businesses.length;
    if (businesses.length > 0) structured.push({ keyword, total_results: totalResults, businesses });
  }
  return structured;
}

function processRawAutocomplete(rawAutocomplete: any[]): SerpAutocompleteEntry[] {
  const structured: SerpAutocompleteEntry[] = [];
  for (const entry of rawAutocomplete) {
    if (entry.keyword && Array.isArray(entry.suggestions) && entry.suggestions.length > 0) {
      structured.push({ keyword: entry.keyword, suggestions: entry.suggestions });
    }
  }
  return structured;
}

function buildSerpByServiceAreaCity(
  waveResults: Record<string, any>,
  session?: any,
): NonNullable<UnifiedAuditData['serp_by_service_area_city']> | undefined {
  const byCity = waveResults.serp_organic_results_by_city as Record<string, any> | undefined;
  if (!byCity || typeof byCity !== 'object' || Object.keys(byCity).length === 0) return undefined;
  const mapsByCity = (waveResults.serp_maps_results_by_city || {}) as Record<string, any>;
  const localByCity = (waveResults.local_finder_results_by_city || {}) as Record<string, any>;
  const autocompleteByCity = (waveResults.autocomplete_results_by_city || {}) as Record<string, any[]>;

  const userDomain = extractDomain(session?.website_url)?.toLowerCase() || '';
  const businessName = session?.business_name || '';

  const out: NonNullable<UnifiedAuditData['serp_by_service_area_city']> = {};
  for (const city of Object.keys(byCity)) {
    const cityOrganic = byCity[city] || {};
    const cityExtended = extractExtendedSerpFeatures(
      typeof cityOrganic === 'object' && !Array.isArray(cityOrganic) ? cityOrganic : {}
    );
    const { structured: organicResults, features: serpFeatures } = processRawOrganicResults(cityOrganic, userDomain);
    const mapsResults = processRawMapsResults(mapsByCity[city] || {}, userDomain, businessName);
    const localFinderResults = processRawLocalFinderResults(localByCity[city] || {}, userDomain, businessName);
    const autocompleteResults = processRawAutocomplete(autocompleteByCity[city] || []);

    out[city] = {
      organic_results: organicResults,
      maps_results: mapsResults,
      local_finder_results: localFinderResults,
      autocomplete_suggestions: autocompleteResults,
      paid_results: cityExtended.paid_results as any,
      local_services_ads: cityExtended.local_services_ads as any,
      serp_features: {
        local_pack_present: serpFeatures.localPackPresent,
        featured_snippets: serpFeatures.featuredSnippets,
        people_also_ask: serpFeatures.peopleAlsoAsk,
        knowledge_panel: serpFeatures.knowledgePanel,
        related_searches: cityExtended.related_searches,
        people_also_search: cityExtended.people_also_search,
        local_pack_dominance: [],
      },
    };
  }
  return out;
}

function buildTechnicalAudit(waveResults: Record<string, any>): UnifiedAuditData['technical_audit'] {
  const summary = waveResults.onpage_summary;
  const pages = waveResults.onpage_pages || [];
  const duplicateTags = waveResults.onpage_duplicate_tags || [];
  const links = waveResults.onpage_links || [];
  const redirects = waveResults.onpage_redirects || [];
  const microdata = waveResults.onpage_microdata || [];
  const resources = waveResults.onpage_resources || [];
  const nonIndexableItems = waveResults.onpage_non_indexable || [];
  const duplicateContentItems = waveResults.onpage_duplicate_content || [];
  const kd2 = waveResults.onpage_keyword_density_2word || [];
  const kd3 = waveResults.onpage_keyword_density_3word || [];
  const waterfall = waveResults.onpage_waterfall;
  const contentParsing = waveResults.onpage_content_parsing;

  // Categorize issues
  const critical: any[] = [];
  const warnings: any[] = [];
  const notices: any[] = [];

  if (summary?.checks) {
    for (const [check, count] of Object.entries(summary.checks)) {
      if ((count as number) > 0) {
        const item = { check, count };
        if (check.includes('broken') || check.includes('error') || check.includes('missing_title')) {
          critical.push(item);
        } else if (check.includes('duplicate') || check.includes('redirect') || check.includes('long')) {
          warnings.push(item);
        } else {
          notices.push(item);
        }
      }
    }
  }

  // Link analysis
  const internalLinks = links.filter((l: any) => !l.is_external).length;
  const externalLinks = links.filter((l: any) => l.is_external).length;
  const brokenLinks = links.filter((l: any) => l.is_broken);

  // Schema markup
  const existingSchemas = new Set<string>();
  for (const md of microdata) {
    for (const type of (md.types || [])) {
      existingSchemas.add(type);
    }
  }

  // Resource audit — full breakdown by type
  const imageResources = resources.filter((r: any) => r.resource_type === 'image');
  const scriptResources = resources.filter((r: any) => r.resource_type === 'script');
  const cssResources = resources.filter((r: any) => r.resource_type === 'stylesheet');
  const brokenResources = resources.filter((r: any) => r.status_code >= 400 || r.status_code === 0);
  const oversized = imageResources.filter((r: any) => r.size > 200000);

  // Extract missing alt from page-level data
  let missingAltCount = 0;
  for (const page of pages) {
    const checks = page.checks || {};
    if (checks.no_image_alt) missingAltCount++;
  }

  // Domain info from expanded summary
  const domainInfo = summary?.domain_info || undefined;

  // Non-indexable pages
  const niByReason: Record<string, number> = {};
  for (const ni of nonIndexableItems) {
    niByReason[ni.reason] = (niByReason[ni.reason] || 0) + 1;
  }

  // Duplicate content
  let totalDupPages = 0;
  const dupContentPages: Array<{ url: string; similar_to: string; similarity: number }> = [];
  for (const dc of duplicateContentItems) {
    totalDupPages += dc.total_count || dc.pages?.length || 0;
    for (const p of (dc.pages || []).slice(0, 10)) {
      dupContentPages.push({ url: p.url, similar_to: dc.url, similarity: p.similarity || dc.similarity || 0 });
    }
  }

  // Waterfall processing
  let waterfallData: UnifiedAuditData['technical_audit']['waterfall'] | undefined = undefined;
  if (waterfall) {
    const renderBlocking = (waterfall.items || []).filter((i: any) => i.is_render_blocking);
    const sorted = [...(waterfall.items || [])].sort((a: any, b: any) => (b.duration_time || 0) - (a.duration_time || 0));
    const sizeByType: Record<string, number> = {};
    for (const item of (waterfall.items || [])) {
      const t = item.resource_type || 'other';
      sizeByType[t] = (sizeByType[t] || 0) + (item.size || 0);
    }
    waterfallData = {
      homepage_load_time: waterfall.page_timing?.duration_time || 0,
      render_blocking_count: renderBlocking.length,
      render_blocking_resources: renderBlocking.slice(0, 20).map((i: any) => ({
        url: i.url || '', type: i.resource_type || '', duration: i.duration_time || 0,
      })),
      slowest_resources: sorted.slice(0, 20).map((i: any) => ({
        url: i.url || '', type: i.resource_type || '', duration: i.duration_time || 0,
      })),
      transfer_size_by_type: sizeByType,
    };
  }

  // Content structure from content parsing
  let contentStructure: UnifiedAuditData['technical_audit']['content_structure'] | undefined = undefined;
  if (contentParsing) {
    const headings: Array<{ tag: string; text: string }> = [];
    const pc = contentParsing.page_content;
    if (pc?.header?.primary_content) {
      for (const block of pc.header.primary_content) {
        if (block.type === 'heading') headings.push({ tag: block.tag || 'h', text: block.text || '' });
      }
    }
    contentStructure = {
      heading_hierarchy: headings.slice(0, 30),
      main_topic: pc?.main_topic || null,
      has_contact_info: !!(contentParsing.contacts?.telephones?.length || contentParsing.contacts?.emails?.length),
      has_ratings: !!(contentParsing.ratings?.length),
    };
  }

  // Unminified scripts (heuristic: size > encoded_size * 1.3)
  const unminifiedScripts = scriptResources.filter((r: any) => r.size > 0 && r.encoded_size > 0 && r.size > r.encoded_size * 1.3);

  return {
    crawl_summary: {
      pages_crawled: summary?.pages_count || 0,
      pages_with_issues: summary?.pages_with_issues || 0,
      avg_onpage_score: summary?.onpage_score || 0,
    },
    issues: { critical, warnings, notices },
    duplicate_tags: {
      titles: duplicateTags.filter((d: any) => d.type === 'title' || d.type?.includes('title')),
      descriptions: duplicateTags.filter((d: any) => d.type === 'description' || d.type?.includes('description')),
    },
    link_analysis: {
      internal_links: internalLinks,
      external_links: externalLinks,
      broken_links: brokenLinks.slice(0, 50),
      redirect_chains: redirects.slice(0, 50),
    },
    schema_markup: {
      existing_schemas: Array.from(existingSchemas),
      recommended_schemas: ['LocalBusiness', 'Service', 'FAQPage', 'BreadcrumbList'],
    },
    image_audit: {
      total_images: imageResources.length,
      missing_alt: missingAltCount,
      oversized: oversized.length,
    },
    page_details: pages.slice(0, 50),
    domain_info: domainInfo || undefined,
    non_indexable: nonIndexableItems.length > 0 ? {
      total: nonIndexableItems.length,
      by_reason: niByReason,
      pages: nonIndexableItems.slice(0, 50),
    } : undefined,
    duplicate_content: dupContentPages.length > 0 ? {
      total_duplicate_pages: totalDupPages,
      pages: dupContentPages.slice(0, 30),
    } : undefined,
    keyword_density: (kd2.length > 0 || kd3.length > 0) ? {
      two_word: kd2.slice(0, 50),
      three_word: kd3.slice(0, 50),
    } : undefined,
    waterfall: waterfallData,
    content_structure: contentStructure,
    resource_audit: {
      images: { total: imageResources.length, missing_alt: missingAltCount, oversized: oversized.length },
      scripts: { total: scriptResources.length, total_size: scriptResources.reduce((s: number, r: any) => s + (r.size || 0), 0), unminified: unminifiedScripts.length },
      stylesheets: { total: cssResources.length, total_size: cssResources.reduce((s: number, r: any) => s + (r.size || 0), 0) },
      broken: { total: brokenResources.length, urls: brokenResources.slice(0, 20).map((r: any) => r.url) },
    },
  };
}

function buildCompetitorTechnicalAudit(waveResults: Record<string, any>): UnifiedAuditData['competitor_technical_audit'] {
  const domains = waveResults.competitor_analysis_domains as Array<{ domain: string; title: string; url: string }> | undefined;
  if (!domains || domains.length === 0) return undefined;

  const summaries = (waveResults.competitor_onpage_summaries || {}) as Record<string, any>;
  const pagesMap = (waveResults.competitor_onpage_pages || {}) as Record<string, any[]>;
  const linksMap = (waveResults.competitor_onpage_links || {}) as Record<string, any[]>;
  const resourcesMap = (waveResults.competitor_onpage_resources || {}) as Record<string, any[]>;
  const microdataMap = (waveResults.competitor_onpage_microdata || {}) as Record<string, any[]>;
  const dupTagsMap = (waveResults.competitor_onpage_duplicate_tags || {}) as Record<string, any[]>;
  const redirectsMap = (waveResults.competitor_onpage_redirects || {}) as Record<string, any[]>;
  const nonIndexableMap = (waveResults.competitor_onpage_non_indexable || {}) as Record<string, any[]>;
  const kwDensityMap = (waveResults.competitor_onpage_keyword_density || {}) as Record<string, any[]>;
  const contentParsingMap = (waveResults.competitor_onpage_content_parsing || {}) as Record<string, any>;
  const lhDesktop = (waveResults.competitor_lighthouse_desktop || {}) as Record<string, any>;
  const lhMobile = (waveResults.competitor_lighthouse_mobile || {}) as Record<string, any>;
  const domainRanks = (waveResults.competitor_domain_ranks || {}) as Record<string, any>;

  const results: NonNullable<UnifiedAuditData['competitor_technical_audit']> = [];

  for (const comp of domains) {
    const summary = summaries[comp.domain];
    const pages = pagesMap[comp.domain] || [];
    const links = linksMap[comp.domain] || [];
    const resources = resourcesMap[comp.domain] || [];
    const microdata = microdataMap[comp.domain] || [];
    const dupTags = dupTagsMap[comp.domain] || [];
    const redirects = redirectsMap[comp.domain] || [];
    const nonIndexable = nonIndexableMap[comp.domain] || [];
    const kwDensity = kwDensityMap[comp.domain] || [];
    const contentParsed = contentParsingMap[comp.domain];
    const desktop = lhDesktop[comp.domain];
    const mobile = lhMobile[comp.domain];
    const dr = domainRanks[comp.domain];

    // Categorize issues
    let criticalCount = 0;
    let warningsCount = 0;
    let noticesCount = 0;
    if (summary?.checks) {
      for (const [check, count] of Object.entries(summary.checks)) {
        if ((count as number) > 0) {
          if (check.includes('broken') || check.includes('error') || check.includes('missing_title')) {
            criticalCount += count as number;
          } else if (check.includes('duplicate') || check.includes('redirect') || check.includes('long')) {
            warningsCount += count as number;
          } else {
            noticesCount += count as number;
          }
        }
      }
    }

    // Schema markup
    const existingSchemas = new Set<string>();
    for (const md of microdata) {
      for (const type of (md.types || [])) {
        existingSchemas.add(type);
      }
    }

    // Link analysis
    const internalLinks = links.filter((l: any) => !l.is_external).length;
    const externalLinks = links.filter((l: any) => l.is_external).length;
    const brokenLinksCount = links.filter((l: any) => l.is_broken).length;

    // Full resource audit
    const imageResources = resources.filter((r: any) => r.resource_type === 'image');
    const scriptResources = resources.filter((r: any) => r.resource_type === 'script');
    const cssResources = resources.filter((r: any) => r.resource_type === 'stylesheet');
    const brokenResources = resources.filter((r: any) => r.status_code >= 400 || r.status_code === 0);
    const oversized = imageResources.filter((r: any) => r.size > 200000);

    // Domain info from expanded summary
    const di = summary?.domain_info;

    // Non-indexable breakdown
    const niByReason: Record<string, number> = {};
    for (const ni of nonIndexable) {
      niByReason[ni.reason] = (niByReason[ni.reason] || 0) + 1;
    }

    // Duplicate tags counts
    const titleDups = dupTags.filter((d: any) => d.type === 'title' || d.type?.includes('title'));
    const descDups = dupTags.filter((d: any) => d.type === 'description' || d.type?.includes('description'));

    // Content structure
    let headingCount = 0;
    let mainTopic: string | null = null;
    let hasContactInfo = false;
    if (contentParsed) {
      const pc = contentParsed.page_content;
      if (pc?.header?.primary_content) {
        headingCount = pc.header.primary_content.filter((b: any) => b.type === 'heading').length;
      }
      mainTopic = pc?.main_topic || null;
      hasContactInfo = !!(contentParsed.contacts?.telephones?.length || contentParsed.contacts?.emails?.length);
    }

    const formatLighthouse = (lh: any) => {
      if (!lh) return null;
      return {
        performance: lh.performance ?? 0,
        accessibility: lh.accessibility ?? 0,
        best_practices: lh.best_practices ?? 0,
        seo: lh.seo ?? 0,
        core_web_vitals: lh.core_web_vitals ? {
          lcp: lh.core_web_vitals.lcp ?? 0,
          fid: lh.core_web_vitals.fid ?? 0,
          cls: lh.core_web_vitals.cls ?? 0,
          fcp: lh.core_web_vitals.fcp ?? 0,
          si: lh.core_web_vitals.si ?? 0,
          tbt: lh.core_web_vitals.tbt ?? 0,
          tti: lh.core_web_vitals.tti ?? 0,
        } : undefined,
      };
    };

    results.push({
      domain: comp.domain,
      business_name: comp.title,
      url: comp.url,
      domain_rank: dr ? {
        domain_rank: dr.domain_rank ?? 0,
        organic_traffic: dr.organic_traffic ?? 0,
        organic_keywords_count: dr.organic_keywords_count ?? 0,
        backlinks: dr.backlinks ?? 0,
        referring_domains: dr.referring_domains ?? 0,
      } : null,
      lighthouse: (desktop || mobile) ? {
        desktop: formatLighthouse(desktop),
        mobile: formatLighthouse(mobile),
      } : undefined,
      crawl_summary: summary ? {
        pages_crawled: summary.pages_count ?? 0,
        pages_with_issues: summary.pages_with_issues ?? 0,
        avg_onpage_score: summary.onpage_score ?? 0,
      } : null,
      schema_markup: existingSchemas.size > 0 ? {
        existing_schemas: Array.from(existingSchemas),
      } : null,
      issues_count: summary ? {
        critical: criticalCount,
        warnings: warningsCount,
        notices: noticesCount,
      } : null,
      link_analysis: links.length > 0 ? {
        internal_links: internalLinks,
        external_links: externalLinks,
        broken_links_count: brokenLinksCount,
      } : null,
      image_audit: imageResources.length > 0 ? {
        total_images: imageResources.length,
        missing_alt: 0,
        oversized: oversized.length,
      } : null,
      domain_info: di ? {
        cms: di.cms || null,
        ssl: !!di.ssl,
        has_sitemap: di.has_sitemap ?? false,
        has_robots_txt: di.has_robots_txt ?? false,
        is_https_redirect: di.is_https_redirect ?? false,
        canonicalization: di.canonicalization ?? false,
      } : null,
      non_indexable: nonIndexable.length > 0 ? {
        total: nonIndexable.length,
        by_reason: niByReason,
      } : null,
      duplicate_tags: dupTags.length > 0 ? {
        titles_count: titleDups.reduce((s: number, d: any) => s + (d.accumulated_count || d.pages?.length || 0), 0),
        descriptions_count: descDups.reduce((s: number, d: any) => s + (d.accumulated_count || d.pages?.length || 0), 0),
      } : null,
      redirect_chains: redirects.length > 0 ? {
        total: redirects.length,
      } : null,
      keyword_density: kwDensity.length > 0 ? {
        top_terms: kwDensity.slice(0, 20),
      } : null,
      content_structure: contentParsed ? {
        heading_count: headingCount,
        main_topic: mainTopic,
        has_contact_info: hasContactInfo,
      } : null,
      resource_audit: (scriptResources.length > 0 || cssResources.length > 0) ? {
        scripts: { total: scriptResources.length, total_size: scriptResources.reduce((s: number, r: any) => s + (r.size || 0), 0) },
        stylesheets: { total: cssResources.length, total_size: cssResources.reduce((s: number, r: any) => s + (r.size || 0), 0) },
        broken_count: brokenResources.length,
      } : null,
    });
  }

  return results.length > 0 ? results : undefined;
}

function buildBacklinksProfile(waveResults: Record<string, any>, tier: string): UnifiedAuditData['backlinks'] {
  const emptyResult: UnifiedAuditData['backlinks'] = {
    summary: {
      total_backlinks: 0, referring_domains: 0, dofollow_ratio: 0, avg_domain_rank: 0,
      spam_score: 0, referring_ips: 0, referring_subnets: 0, broken_backlinks: 0,
      link_types: {}, platform_types: {}, country_distribution: {},
    },
    top_referring_domains: [],
    anchor_text_distribution: [],
    individual_backlinks: [],
    domain_pages: [],
    referring_networks: [],
    history: [],
    timeseries: [],
    new_lost_timeseries: [],
    link_gap: { competitor_only_domains: [], page_level_gaps: [], shared_domains: [], opportunity_score: 0 },
    competitor_comparison: { bulk_ranks: [], bulk_backlinks: [], bulk_referring_domains: [], bulk_new_lost: [] },
    spam_analysis: { referring_domain_spam_scores: [], avg_spam_score: 0, high_spam_count: 0, low_spam_count: 0 },
  };

  if (tier !== 'advanced' || !waveResults.backlinks_summary) {
    return emptyResult;
  }

  const summary = waveResults.backlinks_summary;
  const referringDomains = waveResults.referring_domains || [];
  const anchors = waveResults.anchor_texts || [];
  const linkGap = waveResults.backlinks_domain_intersection || [];

  const totalBL = summary.total_backlinks || 0;
  const dofollow = summary.dofollow || 0;
  const dofollowRatio = totalBL > 0 ? dofollow / totalBL : 0;

  const avgDomainRank = referringDomains.length > 0
    ? referringDomains.reduce((sum: number, d: any) => sum + (d.rank || 0), 0) / referringDomains.length
    : 0;

  // Build spam analysis from bulk spam scores
  const bulkSpamScores = waveResults.backlinks_bulk_spam_scores || [];
  let avgSpam = 0;
  let highSpamCount = 0;
  let lowSpamCount = 0;
  if (bulkSpamScores.length > 0) {
    let total = 0;
    for (const s of bulkSpamScores) {
      const score = s.spam_score || 0;
      total += score;
      if (score > 50) highSpamCount++;
      else if (score < 20) lowSpamCount++;
    }
    avgSpam = Math.round(total / bulkSpamScores.length);
  }

  return {
    summary: {
      total_backlinks: totalBL,
      referring_domains: summary.referring_domains || 0,
      dofollow_ratio: Math.round(dofollowRatio * 100) / 100,
      avg_domain_rank: Math.round(avgDomainRank),
      spam_score: summary.backlinks_spam_score || 0,
      referring_ips: summary.referring_ips || 0,
      referring_subnets: summary.referring_subnets || 0,
      broken_backlinks: summary.broken_backlinks || 0,
      link_types: summary.referring_links_types || {},
      platform_types: summary.referring_links_platform_types || {},
      country_distribution: summary.referring_links_countries || {},
    },
    top_referring_domains: referringDomains.slice(0, 30),
    anchor_text_distribution: anchors.slice(0, 30),
    individual_backlinks: (waveResults.backlinks_list || []).slice(0, 50),
    domain_pages: (waveResults.backlinks_domain_pages || []).slice(0, 30),
    referring_networks: (waveResults.backlinks_referring_networks || []).slice(0, 30),
    history: waveResults.backlinks_history || [],
    timeseries: waveResults.backlinks_timeseries || [],
    new_lost_timeseries: waveResults.backlinks_new_lost_timeseries || [],
    link_gap: {
      competitor_only_domains: linkGap.slice(0, 50),
      page_level_gaps: (waveResults.backlinks_page_intersection || []).slice(0, 50),
      shared_domains: [],
      opportunity_score: Math.min(linkGap.length * 2, 100),
    },
    competitor_comparison: {
      bulk_ranks: waveResults.backlinks_bulk_ranks || [],
      bulk_backlinks: waveResults.backlinks_bulk_backlinks || [],
      bulk_referring_domains: waveResults.backlinks_bulk_referring_domains || [],
      bulk_new_lost: waveResults.backlinks_bulk_new_lost || [],
    },
    spam_analysis: {
      referring_domain_spam_scores: bulkSpamScores.slice(0, 100),
      avg_spam_score: avgSpam,
      high_spam_count: highSpamCount,
      low_spam_count: lowSpamCount,
    },
  };
}

function buildTavilyResearch(session: any): UnifiedAuditData['tavily_research'] {
  return {
    phase1_sources: session.phase1_citations || [],
    phase2_sources: session.phase2_citations || [],
    phase3_sources: session.phase3_citations || [],
    phase1_summary: session.phase1_summary?.content || '',
    phase2_summary: session.phase2_summary?.content || '',
    phase3_summary: session.phase3_summary?.content || '',
  };
}

// ─── Keyword Clustering ─────────────────────────────────────────

/**
 * Build keyword clusters based on shared terms and service categories.
 * Groups keywords into topic clusters for hub-and-spoke content strategy.
 * 
 * Clustering strategy:
 * 1. Service-based clusters (e.g., "drain cleaning", "water heater repair")
 * 2. Location-based clusters (e.g., keywords containing city names)
 * 3. Intent-based clusters (informational, transactional, etc.)
 * 4. Modifier-based clusters (e.g., "cost", "near me", "emergency")
 */
function buildKeywordClusters(keywords: any[], session: any): any[] {
  if (keywords.length === 0) return [];

  const clusters = new Map<string, { name: string; keywords: any[]; total_volume: number; avg_difficulty: number }>();
  
  // Extract service terms for clustering
  const services = (session.services || session.primary_service || '')
    .split(',')
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);
  
  const city = (session.city || '').toLowerCase();
  const primaryService = (session.primary_service || session.industry || '').toLowerCase();
  
  // Common modifiers that indicate cluster groupings
  const modifierGroups: Record<string, string[]> = {
    'Cost & Pricing': ['cost', 'price', 'pricing', 'cheap', 'affordable', 'expensive', 'quote', 'estimate', 'rate'],
    'Emergency': ['emergency', 'urgent', '24/7', '24 hour', 'same day', 'after hours'],
    'Near Me / Local': ['near me', 'near', 'nearby', 'local', 'closest'],
    'Reviews & Ratings': ['review', 'reviews', 'rating', 'ratings', 'best', 'top'],
    'How-To / DIY': ['how to', 'how do', 'diy', 'fix', 'repair yourself', 'guide', 'tips'],
  };

  for (const kw of keywords) {
    const kwLower = (kw.keyword || '').toLowerCase();
    let assigned = false;

    // 1. Try service-based clusters
    for (const service of services) {
      if (service.length > 3 && kwLower.includes(service)) {
        const clusterName = service.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        if (!clusters.has(clusterName)) {
          clusters.set(clusterName, { name: clusterName, keywords: [], total_volume: 0, avg_difficulty: 0 });
        }
        clusters.get(clusterName)!.keywords.push(kw);
        clusters.get(clusterName)!.total_volume += kw.search_volume || 0;
        assigned = true;
        break;
      }
    }

    if (assigned) continue;

    // 2. Try modifier-based clusters
    for (const [groupName, modifiers] of Object.entries(modifierGroups)) {
      if (modifiers.some(mod => kwLower.includes(mod))) {
        if (!clusters.has(groupName)) {
          clusters.set(groupName, { name: groupName, keywords: [], total_volume: 0, avg_difficulty: 0 });
        }
        clusters.get(groupName)!.keywords.push(kw);
        clusters.get(groupName)!.total_volume += kw.search_volume || 0;
        assigned = true;
        break;
      }
    }

    if (assigned) continue;

    // 3. Location-based cluster
    if (city && kwLower.includes(city)) {
      const clusterName = `${city.charAt(0).toUpperCase() + city.slice(1)} Local`;
      if (!clusters.has(clusterName)) {
        clusters.set(clusterName, { name: clusterName, keywords: [], total_volume: 0, avg_difficulty: 0 });
      }
      clusters.get(clusterName)!.keywords.push(kw);
      clusters.get(clusterName)!.total_volume += kw.search_volume || 0;
      continue;
    }

    // 4. General / Primary service cluster
    if (primaryService && kwLower.includes(primaryService.split(' ')[0])) {
      const clusterName = `General ${primaryService.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`;
      if (!clusters.has(clusterName)) {
        clusters.set(clusterName, { name: clusterName, keywords: [], total_volume: 0, avg_difficulty: 0 });
      }
      clusters.get(clusterName)!.keywords.push(kw);
      clusters.get(clusterName)!.total_volume += kw.search_volume || 0;
    }
  }

  // Calculate average difficulty and sort clusters by total volume
  const result = Array.from(clusters.values())
    .filter(c => c.keywords.length >= 2) // Only clusters with 2+ keywords
    .map(c => {
      const totalDiff = c.keywords.reduce((sum, kw) => sum + (kw.keyword_difficulty || 0), 0);
      return {
        name: c.name,
        keyword_count: c.keywords.length,
        total_volume: c.total_volume,
        avg_difficulty: Math.round(totalDiff / c.keywords.length),
        top_keywords: c.keywords
          .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
          .slice(0, 10)
          .map(kw => ({
            keyword: kw.keyword,
            search_volume: kw.search_volume,
            keyword_difficulty: kw.keyword_difficulty,
            search_intent: kw.search_intent,
          })),
      };
    })
    .sort((a, b) => b.total_volume - a.total_volume)
    .slice(0, 15); // Cap at 15 clusters

  logger.debug(`[DataCompiler] Built ${result.length} keyword clusters from ${keywords.length} keywords`);
  return result;
}

// ─── Scoring Functions ──────────────────────────────────────────

function calculateScoring(data: UnifiedAuditData): UnifiedAuditData['scoring'] {
  const weights = {
    search_volume: 0.30,
    keyword_difficulty_inverse: 0.25,
    cpc: 0.15,
    intent_alignment: 0.20,
    local_relevance: 0.10,
  };

  // Top 50 keywords by priority score
  const top50 = data.keyword_universe.keywords.slice(0, 50);

  // GBP completeness
  const gbpCompleteness = data.business_profile.gbp_completeness_score;

  // Technical health (based on on-page score and issue count)
  const technicalHealth = calculateTechnicalHealth(data.technical_audit);

  // Competitive position
  const competitivePosition = calculateCompetitivePosition(data);

  // Keyword pillar (0–1)
  const keywordPillar = data.keyword_universe.total_keywords > 50 ? 1 : data.keyword_universe.total_keywords / 50;

  // No-website: score from three pillars so technical health doesn't cap the score
  const hasWebsite = !!data.meta?.domain && (data.technical_audit?.crawl_summary?.pages_crawled ?? 0) > 0;
  const overallScore = hasWebsite
    ? Math.round(
        (gbpCompleteness * 0.25 +
          technicalHealth * 0.25 +
          competitivePosition * 0.25 +
          keywordPillar * 0.25) *
          100
      )
    : Math.round(
        (gbpCompleteness * (1 / 3) + competitivePosition * (1 / 3) + keywordPillar * (1 / 3)) * 100
      );

  return {
    keyword_prioritization: {
      method: 'weighted_score',
      weights,
      top_50_keywords: top50,
    },
    gbp_completeness: gbpCompleteness,
    technical_health: technicalHealth,
    competitive_position: competitivePosition,
    overall_seo_readiness: overallScore,
  };
}

/**
 * Calculate keyword priority score. Weights are aligned with spec-style prioritization:
 * Volume, relevance (local), intent, achievability (difficulty inverse), commercial value.
 *
 * Factors in competition_level and high_top_of_page_bid for commercial value assessment.
 */
function calculateKeywordPriority(kw: any, city: string, state: string): number {
  // Normalize volume (log scale, max ~10000 = 1.0)
  const maxVolume = 10000;
  const normalizedVolume = Math.min((kw.search_volume || 0) / maxVolume, 1.0);

  // Keyword difficulty inverse (0-100 → 0-1)
  const diffInverse = (100 - (kw.keyword_difficulty || 0)) / 100;

  // Commercial value: use high_top_of_page_bid if available, fall back to CPC
  const bidOrCpc = (kw.high_top_of_page_bid || kw.cpc || 0);
  const maxBid = 50;
  const normalizedCommercialValue = Math.min(bidOrCpc / maxBid, 1.0);

  // Competition level bonus: LOW competition with high bid = great opportunity
  const competitionScores: Record<string, number> = {
    LOW: 1.0,
    MEDIUM: 0.6,
    HIGH: 0.3,
  };
  const competitionBonus = competitionScores[(kw.competition_level || '').toUpperCase()] || 0.5;

  // Intent score
  const intentScores: Record<string, number> = {
    transactional: 1.0,
    commercial: 0.8,
    informational: 0.4,
    navigational: 0.2,
  };
  const intentScore = intentScores[kw.search_intent?.toLowerCase()] || 0.3;

  // Local relevance
  const keywordLower = (kw.keyword || '').toLowerCase();
  let localRelevance = 0;
  if (city && keywordLower.includes(city)) localRelevance = 1.0;
  else if (state && keywordLower.includes(state)) localRelevance = 0.7;
  else if (keywordLower.includes('near me') || keywordLower.includes('local')) localRelevance = 0.5;

  return Math.round(
    (normalizedVolume * 0.25 +
     diffInverse * 0.20 +
     normalizedCommercialValue * 0.15 +
     competitionBonus * 0.10 +
     intentScore * 0.20 +
     localRelevance * 0.10
    ) * 100
  ) / 100;
}

function calculateGBPCompleteness(
  profile: UnifiedAuditData['business_profile'],
  waveResults: Record<string, any>
): { score: number; gaps: string[] } {
  const checks: Array<{ field: string; present: boolean; label: string }> = [
    { field: 'name', present: !!profile.name, label: 'Business name' },
    { field: 'address', present: !!profile.address && profile.address.length > 5, label: 'Address' },
    { field: 'phone', present: !!profile.phone, label: 'Phone number' },
    { field: 'website', present: !!profile.website, label: 'Website URL' },
    { field: 'hours', present: !!profile.hours && Object.keys(profile.hours).length > 0, label: 'Operating hours' },
    { field: 'category', present: !!profile.category, label: 'Primary category' },
    { field: 'is_claimed', present: profile.is_claimed, label: 'Claimed profile' },
    { field: 'photos', present: profile.photos_count > 5, label: 'Photos (5+)' },
    { field: 'reviews', present: (waveResults.reviews || []).length > 10, label: 'Reviews (10+)' },
    { field: 'qa', present: (waveResults.questions_answers || []).length > 0, label: 'Q&A responses' },
  ];

  const completed = checks.filter(c => c.present).length;
  const gaps = checks.filter(c => !c.present).map(c => c.label);

  return {
    score: Math.round((completed / checks.length) * 100) / 100,
    gaps,
  };
}

function calculateTechnicalHealth(audit: UnifiedAuditData['technical_audit']): number {
  if (audit.crawl_summary.pages_crawled === 0) return 0;

  const avgScore = audit.crawl_summary.avg_onpage_score || 0;
  const issueRatio = audit.crawl_summary.pages_with_issues / Math.max(audit.crawl_summary.pages_crawled, 1);
  const criticalCount = audit.issues.critical.length;

  // Start with on-page score (0-100)
  let health = avgScore;

  // Penalize for issues
  health -= issueRatio * 20;
  health -= criticalCount * 5;

  // Cap at 0-100
  return Math.max(0, Math.min(100, Math.round(health))) / 100;
}

function calculateCompetitivePosition(data: UnifiedAuditData): number {
  let score = 0.5; // Start at neutral

  // Rating gap (positive = better than competitors)
  const ratingGap = data.reviews.competitor_comparison.rating_gap;
  if (ratingGap > 0) score += 0.15;
  else if (ratingGap < -0.5) score -= 0.15;

  // Review count gap
  const reviewGap = data.reviews.competitor_comparison.review_count_gap;
  if (reviewGap > 0) score += 0.1;
  else if (reviewGap < -20) score -= 0.1;

  // Domain metrics (if available)
  if (data.domain_intelligence.organic_traffic > 1000) score += 0.1;
  if (data.domain_intelligence.domain_rank > 50) score += 0.1;

  // Keyword count
  if (data.keyword_universe.total_keywords > 100) score += 0.05;

  return Math.max(0, Math.min(1, score));
}

// ─── Utility Functions ──────────────────────────────────────────

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Extract common themes from review texts (simple keyword extraction)
 */
function extractThemes(texts: string[], maxThemes: number): string[] {
  if (texts.length === 0) return [];

  const wordCounts = new Map<string, number>();
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them',
    'this', 'that', 'these', 'those', 'very', 'really', 'just', 'so', 'too', 'also',
    'not', 'no', 'nor', 'yet', 'both', 'each', 'every', 'all', 'any', 'few', 'more',
  ]);

  for (const text of texts) {
    const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
    for (const word of words) {
      if (word.length > 3 && !stopWords.has(word)) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }
  }

  return Array.from(wordCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxThemes)
    .map(([word]) => word);
}
