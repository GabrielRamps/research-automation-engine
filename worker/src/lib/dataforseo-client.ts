/**
 * DataForSEO API Client
 * Wraps the DataForSEO REST API with typed methods, error handling, and cost tracking.
 * Uses login/password Basic Auth (no separate SDK needed).
 * 
 * Supports three tiers:
 * - Basic: No DataForSEO calls (Tavily only)
 * - Intermediate: Full DataForSEO suite EXCEPT backlinks
 * - Advanced: Full DataForSEO suite INCLUDING backlinks ($100/mo minimum balance)
 */

import { withTimeout, TIMEOUTS } from './timeout-helper';
import { DataForSEORateLimiter, withRetry, type RateLimitCategory } from './dataforseo-rate-limiter';
import { logger } from './logger';

// ─── Concurrency Helper ──────────────────────────────────────────

/**
 * Run an array of task closures with a concurrency limit.
 * Returns PromiseSettledResult[] in the same order as the input tasks.
 */
export async function withConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (index < tasks.length) {
      const i = index++;
      try {
        const value = await tasks[i]();
        results[i] = { status: 'fulfilled', value };
      } catch (reason: any) {
        results[i] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── Types ────────────────────────────────────────────────────────

export interface DataForSEOCredentials {
  login: string;
  password: string;
}

export interface DataForSEOConfig {
  location_code?: number;    // Default: 2840 (United States)
  language_code?: string;    // Default: "en"
  enabled?: boolean;
  // Phase 1 specific
  gmb_search_depth?: number;
  local_pack_keywords?: number;
  // Phase 2 specific
  max_serp_competitors?: number;
  max_ranked_keywords_per_competitor?: number;
  keyword_suggestion_limit?: number;
  keyword_enrichment_batch_size?: number;
  // Phase 3 specific
  max_urls_to_audit?: number;
  enable_javascript_rendering?: boolean;
  max_crawl_pages?: number;
  load_resources?: boolean;
}

export interface GMBResult {
  title: string;
  category: string;
  address: string;
  phone: string;
  url: string;
  rating: { value: number; votes_count: number } | null;
  latitude: number;
  longitude: number;
  place_id: string;
  is_claimed: boolean;
}

/** Full business profile from my_business_info (for competitor profile: hours, attributes, posts). */
export interface BusinessProfileResult extends GMBResult {
  cid?: string;
  hours?: any;
  attributes?: string[] | any;
  posts?: any[];
  [key: string]: any;
}

export interface SERPOrganicResult {
  type: string;
  rank_group: number;
  rank_absolute: number;
  domain: string;
  title: string;
  url: string;
  description: string;
  breadcrumb: string;
}

export interface LocalPackResult {
  title: string;
  domain: string;
  url: string;
  rating: { value: number; votes_count: number } | null;
  phone: string;
  address: string;
}

export interface SERPCompetitor {
  domain: string;
  avg_position: number;
  intersections: number;
  full_domain_metrics: any;
}

export interface RankedKeyword {
  keyword: string;
  search_volume: number;
  keyword_difficulty: number;
  cpc: number;
  competition: number;
  rank_group: number;
  url: string;
  search_intent: string;
}

export interface KeywordData {
  keyword: string;
  search_volume: number;
  keyword_difficulty: number;
  cpc: number;
  competition: number;
  competition_level: string | null;
  search_intent: string;
  foreign_intents: string[];
  monthly_searches: Array<{ year: number; month: number; search_volume: number }>;
  search_volume_trend: { monthly: number; quarterly: number; yearly: number } | null;
  low_top_of_page_bid: number;
  high_top_of_page_bid: number;
  categories: number[];
  core_keyword: string | null;
  last_updated_time: string | null;
  content_flag?: 'service_page' | 'faq_service_page' | 'blog_content_only' | null;
}

export interface OnPageResult {
  crawl_progress: string;
  crawl_status: any;
  pages_count: number;
  pages: Array<{
    url: string;
    status_code: number;
    meta: {
      title: string;
      description: string;
      h1: string[];
      h2: string[];
      h3: string[];
      canonical: string;
    };
    page_timing: {
      time_to_interactive: number;
      dom_complete: number;
      largest_contentful_paint: number;
      first_input_delay: number;
      cumulative_layout_shift: number;
    };
    onpage_score: number;
    total_dom_size: number;
    content: {
      plain_text_size: number;
      plain_text_rate: number;
      plain_text_word_count: number;
    };
    links: {
      internal: number;
      external: number;
      broken: number;
    };
    images: {
      total: number;
      without_alt: number;
      without_src: number;
    };
    checks: Record<string, boolean>;
  }>;
}

// ─── Additional Types for Expanded API Coverage ──────────────────

export interface LocationResult {
  location_code: number;
  location_name: string;
  location_type: string;
  country_iso_code: string;
}

export interface DomainRankOverview {
  target: string;
  organic_traffic: number;
  organic_keywords_count: number;
  paid_traffic: number;
  paid_keywords_count: number;
  backlinks: number;
  referring_domains: number;
  domain_rank: number;
  online_visibility: number;
  etv: number;
  metrics: any;
}

export interface LighthouseResult {
  performance: number;
  accessibility: number;
  best_practices: number;
  seo: number;
  pwa: number;
  core_web_vitals: {
    lcp: number;
    fid: number;
    cls: number;
    fcp: number;
    si: number;
    tbt: number;
    tti: number;
  };
  audits: any;
}

export interface ReviewItem {
  rating: number;
  text: string;
  time_ago: string;
  timestamp: string;
  review_id: string;
  profile_name: string;
  owner_answer: string | null;
}

export interface QAItem {
  question_text: string;
  answer_text: string;
  question_votes: number;
  answer_votes: number;
  original_question_url: string;
}

export interface SearchIntentResult {
  keyword: string;
  search_intent: string; // informational, navigational, commercial, transactional
  secondary_intents: string[];
}

export interface BacklinksSummaryResult {
  target: string;
  total_backlinks: number;
  referring_domains: number;
  referring_main_domains: number;
  dofollow: number;
  nofollow: number;
  anchor: number;
  image: number;
  referring_domains_nofollow: number;
  broken_backlinks: number;
  referring_ips: number;
  referring_subnets: number;
  referring_pages: number;
  rank: number;
  backlinks_spam_score: number;
  referring_links_tld: Record<string, number> | null;
  referring_links_types: Record<string, number> | null;
  referring_links_platform_types: Record<string, number> | null;
  referring_links_countries: Record<string, number> | null;
}

export interface ReferringDomainResult {
  domain: string;
  rank: number;
  backlinks: number;
  first_seen: string;
  last_seen: string;
  broken_backlinks: number;
  referring_links_tld: any;
  backlinks_spam_score: number;
  referring_pages: number;
  referring_domains_nofollow: number;
}

export interface AnchorResult {
  anchor: string;
  domains: number;
  backlinks: number;
  first_seen: string;
  last_seen: string;
  referring_domains: number;
}

export interface BacklinksCompetitorResult {
  domain: string;
  avg_position: number;
  intersections: number;
  full_domain_metrics: any;
}

export interface DomainIntersectionResult {
  keyword: string;
  search_volume: number;
  keyword_difficulty: number;
  target1_rank: number | null;
  target2_rank: number | null;
  target1_url: string | null;
  target2_url: string | null;
}

export interface BacklinkEntry {
  url_from: string;
  domain_from: string;
  url_to: string;
  anchor: string;
  dofollow: boolean;
  backlink_spam_score: number;
  rank: number;
  page_from_rank: number;
  domain_from_rank: number;
  first_seen: string;
  last_seen: string;
  is_broken: boolean;
  is_new: boolean;
  is_lost: boolean;
  item_type: string;
  semantic_location: string;
  domain_from_platform_type: string[];
  domain_from_country: string;
}

export interface BacklinksHistoryEntry {
  date: string;
  rank: number;
  backlinks: number;
  new_backlinks: number;
  lost_backlinks: number;
  referring_domains: number;
  new_referring_domains: number;
  lost_referring_domains: number;
  referring_pages: number;
  broken_backlinks: number;
}

export interface BacklinksDomainPageEntry {
  page: string;
  title: string | null;
  rank: number;
  backlinks: number;
  referring_domains: number;
  backlinks_spam_score: number;
  broken_backlinks: number;
  first_seen: string;
  internal_links_count: number;
  external_links_count: number;
}

export interface ReferringNetworkEntry {
  network_address: string;
  rank: number;
  backlinks: number;
  referring_domains: number;
  first_seen: string;
}

export interface TimeseriesSummaryEntry {
  date: string;
  rank: number;
  backlinks: number;
  referring_domains: number;
  referring_main_domains: number;
  referring_ips: number;
  referring_subnets: number;
  referring_pages: number;
}

export interface NewLostTimeseriesEntry {
  date: string;
  new_backlinks: number;
  lost_backlinks: number;
  new_referring_domains: number;
  lost_referring_domains: number;
  new_referring_main_domains: number;
  lost_referring_main_domains: number;
}

export interface BulkRankEntry {
  target: string;
  rank: number;
}

export interface BulkBacklinksEntry {
  target: string;
  backlinks: number;
}

export interface BulkSpamScoreEntry {
  target: string;
  spam_score: number;
}

export interface BulkReferringDomainsEntry {
  target: string;
  referring_domains: number;
  referring_domains_nofollow: number;
  referring_main_domains: number;
  referring_main_domains_nofollow: number;
}

export interface BulkNewLostBacklinksEntry {
  target: string;
  new_backlinks: number;
  lost_backlinks: number;
}

export interface SERPTaskPostResult {
  task_id: string;
  status: string;
}

export interface AutocompleteResult {
  keyword: string;
  suggestions: string[];
}

export interface OnPageDomainInfo {
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
}

export interface OnPagePageMetrics {
  duplicate_title: number;
  duplicate_description: number;
  duplicate_content: number;
  non_indexable: number;
  broken_links: number;
  broken_resources: number;
  links_internal: number;
  links_external: number;
  onpage_score: number;
}

export interface OnPageSummaryResult {
  crawl_progress: string;
  crawl_status: any;
  pages_count: number;
  pages_with_issues: number;
  checks: Record<string, number>;
  onpage_score: number;
  domain_info: OnPageDomainInfo | null;
  page_metrics: OnPagePageMetrics | null;
}

export interface DuplicateTagResult {
  type: string; // 'title' | 'description'
  pages: Array<{ url: string; meta: { title?: string; description?: string } }>;
  accumulated_count: number;
}

export interface OnPageLinkResult {
  source_url: string;
  destination_url: string;
  is_external: boolean;
  is_broken: boolean;
  direction: string;
  page_from_status_code: number;
  dofollow: boolean;
  anchor: string;
}

export interface RedirectChainResult {
  url: string;
  redirect_url: string;
  status_code: number;
  is_redirect: boolean;
  chain: Array<{ url: string; status_code: number }>;
}

export interface MicrodataResult {
  url: string;
  types: string[];
  data: any;
}

export interface OnPageResourceResult {
  url: string;
  resource_type: string;
  status_code: number;
  size: number;
  encoded_size: number;
  total_transfer_size: number;
  fetch_timing: any;
  media_type: string;
}

export interface NonIndexableResult {
  url: string;
  reason: string;
}

export interface DuplicateContentResult {
  url: string;
  similarity: number;
  total_count: number;
  pages: Array<{ url: string; similarity: number; meta?: { title?: string; description?: string } }>;
}

export interface KeywordDensityResult {
  keyword: string;
  frequency: number;
  density: number;
}

export interface WaterfallResourceItem {
  resource_type: string;
  url: string;
  duration_time: number;
  fetch_start: number;
  fetch_end: number;
  is_render_blocking: boolean;
  initiator: string | null;
  size: number;
  encoded_size: number;
}

export interface WaterfallResult {
  url: string;
  page_timing: {
    time_to_interactive: number;
    dom_complete: number;
    connection_time: number;
    time_to_secure_connection: number;
    request_sent_time: number;
    waiting_time: number;
    download_time: number;
    duration_time: number;
  } | null;
  items: WaterfallResourceItem[];
}

export interface ContentParsingResult {
  url: string;
  page_content: {
    header: any;
    footer: any;
    main_topic: string | null;
    secondary_topic: string | null;
  } | null;
  contacts: {
    telephones: string[];
    emails: string[];
  } | null;
  ratings: any[];
  offers: any[];
}

// ─── API Error Types ──────────────────────────────────────────────

export class DataForSEOError extends Error {
  public statusCode: number;
  public apiCode: number;
  
  constructor(message: string, statusCode: number, apiCode: number = 0) {
    super(message);
    this.name = 'DataForSEOError';
    this.statusCode = statusCode;
    this.apiCode = apiCode;
  }
}

export class DataForSEOBalanceError extends DataForSEOError {
  constructor(message: string) {
    super(message, 402, 40200);
    this.name = 'DataForSEOBalanceError';
  }
}

export class DataForSEOAuthError extends DataForSEOError {
  constructor(message: string) {
    super(message, 401, 40100);
    this.name = 'DataForSEOAuthError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Compute search volume trend (monthly/quarterly/yearly % change) from
 * the monthly_searches array returned by DataForSEO.
 * Array is sorted newest→oldest: [{year, month, search_volume}, ...].
 */
function computeTrendFromMonthly(
  monthly: Array<{ year: number; month: number; search_volume: number }> | null | undefined
): { monthly: number; quarterly: number; yearly: number } | null {
  if (!monthly || monthly.length < 2) return null;

  const vol = (i: number) => monthly[i]?.search_volume ?? 0;

  const avg = (start: number, count: number) => {
    let sum = 0, n = 0;
    for (let i = start; i < start + count && i < monthly.length; i++) {
      sum += vol(i);
      n++;
    }
    return n > 0 ? sum / n : 0;
  };

  const pctChange = (current: number, previous: number) =>
    previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;

  const monthlyChange = pctChange(vol(0), vol(1));

  const q1 = avg(0, 3);
  const q2 = avg(3, 3);
  const quarterlyChange = pctChange(q1, q2);

  const h1 = avg(0, 6);
  const h2 = monthly.length >= 12 ? avg(6, 6) : avg(3, 6);
  const yearlyChange = pctChange(h1, h2);

  return { monthly: monthlyChange, quarterly: quarterlyChange, yearly: yearlyChange };
}

// ─── Client Class ─────────────────────────────────────────────────

const BASE_URL = 'https://api.dataforseo.com/v3';
const REQUEST_TIMEOUT = 60000; // 60 seconds per request

export class DataForSEOClient {
  private authHeader: string;
  private totalCost: number = 0;
  private callCount: number = 0;
  private rateLimiter: DataForSEORateLimiter | null = null;
  private rateLimitRemaining: number | null = null;

  constructor(credentials: DataForSEOCredentials, rateLimiter?: DataForSEORateLimiter) {
    const encoded = Buffer.from(`${credentials.login}:${credentials.password}`).toString('base64');
    this.authHeader = `Basic ${encoded}`;
    this.rateLimiter = rateLimiter || null;
  }

  // ─── Core HTTP Method ────────────────────────────────────────

  private async request<T>(endpoint: string, body?: any): Promise<T> {
    const url = `${BASE_URL}${endpoint}`;
    const options: RequestInit = {
      method: body ? 'POST' : 'GET',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    // Apply rate limiting if available
    const category = this.rateLimiter
      ? DataForSEORateLimiter.categorizeEndpoint(endpoint)
      : null;

    if (this.rateLimiter && category) {
      await this.rateLimiter.acquire(category);
    }

    this.callCount++;
    const startTime = Date.now();
    const RATE_LIMIT_RETRIES = 2;
    const RATE_LIMIT_DELAYS_MS = [15000, 30000]; // 15s, then 30s

    try {
      let lastResponse: Response | null = null;
      let lastData: any = null;

      for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
        const response = await withTimeout(
          fetch(url, options),
          REQUEST_TIMEOUT,
          'DataForSEO request to ' + endpoint + ' timed out'
        );
        const duration = Date.now() - startTime;
        const data = await response.json() as any;
        lastResponse = response;
        lastData = data;

        // Track rate limit remaining from headers
        const remaining = response.headers.get('X-RateLimit-Remaining');
        if (remaining) {
          this.rateLimitRemaining = parseInt(remaining, 10);
          if (this.rateLimiter) {
            this.rateLimiter.updateRateLimitRemaining(this.rateLimitRemaining);
          }
        }

        logger.debug('[DataForSEO] ' + endpoint + ' - ' + response.status + ' - ' + duration + 'ms');

        if (response.ok) {
          if (data.status_code && data.status_code !== 20000) {
            if (data.status_code === 40201 || data.status_code === 40200) {
              throw new DataForSEOBalanceError('DataForSEO account has insufficient balance. Please add funds at https://app.dataforseo.com/billing');
            }
            if (data.status_code === 40100 || data.status_code === 40101) {
              throw new DataForSEOAuthError('DataForSEO credentials are invalid');
            }
            throw new DataForSEOError(
              'DataForSEO API error: ' + (data.status_message || ''),
              response.status,
              data.status_code
            );
          }
          if (data.cost) {
            this.totalCost += data.cost;
          }
          return data as T;
        }

        if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
          const delay = RATE_LIMIT_DELAYS_MS[attempt] || 30000;
          logger.warn('[DataForSEO] Rate limited (429). Waiting ' + (delay / 1000) + 's before retry ' + (attempt + 1) + '/' + RATE_LIMIT_RETRIES + '...');
          await new Promise(function (r) { return setTimeout(r, delay); });
          continue;
        }

        if (response.status === 401 || response.status === 403) {
          throw new DataForSEOAuthError('DataForSEO credentials are invalid or unauthorized');
        }
        if (response.status === 402) {
          throw new DataForSEOBalanceError('DataForSEO account has insufficient balance. Please add funds at https://app.dataforseo.com/billing');
        }
        throw new DataForSEOError(
          'DataForSEO API error: ' + (lastData?.status_message || response.statusText || ''),
          response.status
        );
      }

      throw new DataForSEOError(
        'DataForSEO API error: ' + (lastData?.status_message || (lastResponse ? String(lastResponse.status) : '')),
        lastResponse ? lastResponse.status : 0
      );
    } catch (error: any) {
      if (error instanceof DataForSEOError || error instanceof DataForSEOBalanceError || error instanceof DataForSEOAuthError) {
        throw error;
      }
      throw new DataForSEOError(
        'DataForSEO request failed: ' + error.message,
        0
      );
    } finally {
      // Release rate limiter slot
      if (this.rateLimiter && category) {
        this.rateLimiter.release(category);
      }
    }
  }

  /**
   * Make a request with automatic retry on transient failures
   */
  private async requestWithRetry<T>(endpoint: string, body?: any, maxRetries: number = 3): Promise<T> {
    return withRetry(
      () => this.request<T>(endpoint, body),
      { maxRetries, initialDelayMs: 1000, maxDelayMs: 10000 }
    );
  }

  // ─── Cost Tracking ───────────────────────────────────────────

  getCost(): number {
    return this.totalCost;
  }

  getCallCount(): number {
    return this.callCount;
  }

  getRateLimitRemaining(): number | null {
    return this.rateLimitRemaining;
  }

  // ─── Phase 1: Location Resolution ───────────────────────────

  /**
   * Fetch the full list of US locations from DataForSEO.
   * The API does NOT support a query parameter; it returns the entire list.
   * We filter client-side to find city/state/zip matches.
   */
  private async getUSLocationsList(): Promise<Array<{ location_code: number; location_name: string; location_type: string; country_iso_code: string }>> {
    const data = await this.request<any>('/serp/google/locations/us');
    const tasks = data?.tasks;
    const firstTask = tasks?.[0];
    const result = firstTask?.result;
    if (!Array.isArray(result)) return [];
    const usOnly = result.filter((loc: { country_iso_code?: string }) => (loc.country_iso_code || '').toUpperCase() === 'US');
    return usOnly;
  }

  /**
   * Fetch the Google Ads / Keywords Data locations list filtered to US.
   * These location codes are valid for DataForSEO Labs and Keywords Data endpoints
   * (keyword_suggestions, keyword_ideas, related_keywords, bulk_search_volume, etc.).
   * NOTE: This is a DIFFERENT location database than the SERP locations above.
   */
  private googleAdsLocationsCache: Array<{ location_code: number; location_name: string; location_type: string; country_iso_code: string }> | null = null;

  private async getGoogleAdsLocationsList(): Promise<Array<{ location_code: number; location_name: string; location_type: string; country_iso_code: string }>> {
    if (this.googleAdsLocationsCache) return this.googleAdsLocationsCache;

    const data = await this.request<any>('/keywords_data/google_ads/locations');
    const tasks = data?.tasks;
    const firstTask = tasks?.[0];
    const result = firstTask?.result;
    if (!Array.isArray(result)) return [];
    const usOnly = result.filter((loc: { country_iso_code?: string }) => (loc.country_iso_code || '').toUpperCase() === 'US');
    this.googleAdsLocationsCache = usOnly;
    logger.debug(`[DataForSEO] Loaded ${usOnly.length} Google Ads US locations`);
    return usOnly;
  }

  /**
   * Find a location in the list whose location_name matches the query.
   * Query is normalized and split (e.g. "Lakeland, Florida 33801" -> ["lakeland","florida","33801"]).
   * We require location_name to contain all parts (case-insensitive).
   * Prefer most specific: City > State > Country.
   */
  private findLocationInList(
    list: Array<{ location_code: number; location_name: string; location_type: string; country_iso_code: string }>,
    query: string
  ): LocationResult | null {
    const parts = query
      .replace(/,/g, ' ')
      .split(/\s+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return null;

    const matches = list.filter((loc) => {
      const name = (loc.location_name || '').toLowerCase();
      return parts.every((part) => name.includes(part));
    });
    if (matches.length === 0) return null;

    // Prefer City, then State, then Country (most specific first)
    const typeOrder: Record<string, number> = { City: 3, State: 2, Country: 1 };
    const sorted = [...matches].sort((a, b) => {
      const aOrder = typeOrder[a.location_type] ?? 0;
      const bOrder = typeOrder[b.location_type] ?? 0;
      return bOrder - aOrder;
    });
    const loc = sorted[0];
    return {
      location_code: loc.location_code,
      location_name: loc.location_name,
      location_type: loc.location_type || 'unknown',
      country_iso_code: (loc.country_iso_code || 'US').toUpperCase(),
    };
  }

  /**
   * Resolve a city/state (and optional zip) query to a DataForSEO location_code.
   * Fetches the full US list once and filters client-side (API does not support query param).
   */
  async resolveLocationCode(query: string): Promise<LocationResult | null> {
    logger.debug('[DataForSEO] Resolving location code for "' + query + '" (US only)');
    try {
      const list = await this.getUSLocationsList();
      const found = this.findLocationInList(list, query);
      if (found) {
        logger.debug('[DataForSEO] Resolved "' + query + '" -> ' + found.location_code + ' (' + found.location_name + ', US)');
        return found;
      }
      logger.warn('[DataForSEO] No location found for "' + query + '"');
      return null;
    } catch (error: any) {
      logger.error('[DataForSEO] Location resolution failed:', error.message);
      return null;
    }
  }

  /**
   * Resolve with fallback chain: city+state+zip -> city+state -> state -> country (2840).
   * Uses zip when provided for more precise local targeting (e.g. Lakeland, FL 33801).
   */
  async resolveLocationWithFallback(city: string, state: string, zip?: string | null): Promise<{ location_code: number; location_name: string }> {
    const list = await this.getUSLocationsList();
    if (list.length === 0) {
      logger.warn('[DataForSEO] Empty locations list, using fallback 2840');
      return { location_code: 2840, location_name: 'United States' };
    }

    // 1) Try city + state + zip (most specific)
    if (city && state && zip) {
      const withZip = this.findLocationInList(list, [city, state, zip].join(', '));
      if (withZip) {
        logger.debug('[DataForSEO] Resolved with zip -> ' + withZip.location_code + ' (' + withZip.location_name + ')');
        return { location_code: withZip.location_code, location_name: withZip.location_name };
      }
    }

    // 2) Try city + state
    if (city && state) {
      const cityState = this.findLocationInList(list, city + ', ' + state);
      if (cityState) {
        logger.debug('[DataForSEO] Resolved city+state -> ' + cityState.location_code + ' (' + cityState.location_name + ')');
        return { location_code: cityState.location_code, location_name: cityState.location_name };
      }
    }

    // 3) Try state only
    if (state) {
      const stateOnly = this.findLocationInList(list, state);
      if (stateOnly) {
        logger.debug('[DataForSEO] Resolved state -> ' + stateOnly.location_code + ' (' + stateOnly.location_name + ')');
        return { location_code: stateOnly.location_code, location_name: stateOnly.location_name };
      }
    }

    // 4) Ultimate fallback: US
    logger.warn('[DataForSEO] Using fallback location code 2840 (United States)');
    return { location_code: 2840, location_name: 'United States' };
  }

  /**
   * Resolve a location for DataForSEO Labs / Keywords Data endpoints.
   * 
   * IMPORTANT: Labs endpoints (keyword_suggestions, keyword_ideas, related_keywords,
   * keywords_for_site, domain_rank_overview, serp_competitors, etc.) ONLY accept
   * COUNTRY-LEVEL location codes. City/state codes (e.g. 1015088 for Lakeland, FL)
   * cause status_code=40501 "Invalid Field: 'location_code'".
   * 
   * Always returns 2840 (United States) for US-based businesses.
   */
  async resolveLabsLocationWithFallback(city: string, state: string, zip?: string | null): Promise<{ location_code: number; location_name: string }> {
    // Labs endpoints only support country-level location_code / location_name.
    // Passing city or state codes triggers Invalid Field errors.
    logger.debug('[DataForSEO] Labs location: using country-level 2840 (United States)');
    return { location_code: 2840, location_name: 'United States' };
  }

  /**
   * Resolve a city-level location for Google Ads Keywords Data endpoints.
   *
   * Unlike DataForSEO Labs endpoints (country-only), the Google Ads Keywords Data
   * endpoints (/keywords_data/google_ads/search_volume, keywords_for_keywords,
   * keywords_for_site, ad_traffic_by_keywords) support city/DMA/state-level
   * location codes — the same granularity as Google Geographical Targeting.
   *
   * Uses the Google Ads locations database (different from SERP locations).
   * Fallback chain: city+state+zip -> city+state -> state -> country (2840).
   */
  async resolveGoogleAdsLocationWithFallback(city: string, state: string, zip?: string | null): Promise<{ location_code: number; location_name: string }> {
    const list = await this.getGoogleAdsLocationsList();
    if (list.length === 0) {
      logger.warn('[DataForSEO] Empty Google Ads locations list, using fallback 2840');
      return { location_code: 2840, location_name: 'United States' };
    }

    // 1) Try city + state + zip (most specific)
    if (city && state && zip) {
      const withZip = this.findLocationInList(list, [city, state, zip].join(', '));
      if (withZip) {
        logger.debug('[DataForSEO] Google Ads location resolved with zip -> ' + withZip.location_code + ' (' + withZip.location_name + ')');
        return { location_code: withZip.location_code, location_name: withZip.location_name };
      }
    }

    // 2) Try city + state
    if (city && state) {
      const cityState = this.findLocationInList(list, city + ', ' + state);
      if (cityState) {
        logger.debug('[DataForSEO] Google Ads location resolved city+state -> ' + cityState.location_code + ' (' + cityState.location_name + ')');
        return { location_code: cityState.location_code, location_name: cityState.location_name };
      }
    }

    // 3) Try state only
    if (state) {
      const stateOnly = this.findLocationInList(list, state);
      if (stateOnly) {
        logger.debug('[DataForSEO] Google Ads location resolved state -> ' + stateOnly.location_code + ' (' + stateOnly.location_name + ')');
        return { location_code: stateOnly.location_code, location_name: stateOnly.location_name };
      }
    }

    // 4) Ultimate fallback: US
    logger.warn('[DataForSEO] Google Ads location: using fallback 2840 (United States)');
    return { location_code: 2840, location_name: 'United States' };
  }

  // ─── Phase 2: Domain Intelligence ──────────────────────────

  /**
   * Get domain rank overview metrics
   * Endpoint: POST /v3/dataforseo_labs/google/domain_rank_overview/live
   */
  async domainRankOverview(
    domain: string,
    locationCode: number = 2840,
    languageCode: string = 'en'
  ): Promise<DomainRankOverview | null> {
    logger.debug(`[DataForSEO] Getting domain rank overview for "${domain}"`);

    const data = await this.requestWithRetry<any>('/dataforseo_labs/google/domain_rank_overview/live', [
      {
        target: domain,
        location_code: locationCode,
        language_code: languageCode,
      }
    ]);

    if (data.tasks?.[0]?.result?.[0]) {
      const r = data.tasks[0].result[0];
      const metrics = r.metrics?.organic || {};
      return {
        target: r.target || domain,
        organic_traffic: metrics.etv || 0,
        organic_keywords_count: metrics.count || 0,
        paid_traffic: r.metrics?.paid?.etv || 0,
        paid_keywords_count: r.metrics?.paid?.count || 0,
        backlinks: r.metrics?.organic?.backlinks || 0,
        referring_domains: r.metrics?.organic?.referring_domains || 0,
        domain_rank: metrics.pos_1 || 0,
        online_visibility: metrics.is_new || 0,
        etv: metrics.etv || 0,
        metrics: r.metrics,
      };
    }

    return null;
  }

  /**
   * Post a Lighthouse audit task (async)
   * Endpoint: POST /v3/on_page/lighthouse/task_post
   */
  async lighthouseTaskPost(
    url: string,
    forMobile: boolean = false,
    pingbackUrl?: string
  ): Promise<string> {
    logger.debug(`[DataForSEO] Creating Lighthouse task for "${url}" (mobile: ${forMobile})`);

    const taskPayload: any = {
      url,
      for_mobile: forMobile,
    };
    if (pingbackUrl) taskPayload.pingback_url = pingbackUrl;

    const data = await this.requestWithRetry<any>('/on_page/lighthouse/task_post', [taskPayload]);

    const taskId = data.tasks?.[0]?.id;
    if (!taskId) {
      throw new DataForSEOError('Failed to create Lighthouse task - no task ID returned', 500);
    }

    logger.debug(`[DataForSEO] Lighthouse task created: ${taskId}`);
    return taskId;
  }

  /**
   * Get Lighthouse results
   * Endpoint: GET /v3/on_page/lighthouse/task_get/{task_id}
   */
  async lighthouseResults(taskId: string): Promise<LighthouseResult | null> {
    logger.debug(`[DataForSEO] Getting Lighthouse results for task ${taskId}`);

    const data = await this.requestWithRetry<any>(`/on_page/lighthouse/task_get/${taskId}`);

    if (data.tasks?.[0]?.result?.[0]?.categories) {
      const cats = data.tasks[0].result[0].categories;
      const audits = data.tasks[0].result[0].audits || {};
      return {
        performance: Math.round((cats.performance?.score || 0) * 100),
        accessibility: Math.round((cats.accessibility?.score || 0) * 100),
        best_practices: Math.round(((cats['best-practices']?.score ?? cats.best_practices?.score) || 0) * 100),
        seo: Math.round((cats.seo?.score || 0) * 100),
        pwa: Math.round((cats.pwa?.score || 0) * 100),
        core_web_vitals: {
          lcp: audits['largest-contentful-paint']?.numericValue || 0,
          fid: audits['max-potential-fid']?.numericValue || 0,
          cls: audits['cumulative-layout-shift']?.numericValue || 0,
          fcp: audits['first-contentful-paint']?.numericValue || 0,
          si: audits['speed-index']?.numericValue || 0,
          tbt: audits['total-blocking-time']?.numericValue || 0,
          tti: audits['interactive']?.numericValue || 0,
        },
        audits,
      };
    }

    return null;
  }

  /**
   * Run a Lighthouse audit synchronously via the Live endpoint.
   * Blocks until DataForSEO completes the audit (up to 120s server-side timeout).
   * Endpoint: POST /v3/on_page/lighthouse/live/json
   */
  async lighthouseLive(url: string, forMobile: boolean = false): Promise<LighthouseResult | null> {
    logger.debug(`[DataForSEO] Running Lighthouse Live for "${url}" (mobile: ${forMobile})`);

    const data = await this.requestWithRetry<any>('/on_page/lighthouse/live/json', [{
      url,
      for_mobile: forMobile,
    }]);

    if (data.tasks?.[0]?.result?.[0]?.categories) {
      const cats = data.tasks[0].result[0].categories;
      const audits = data.tasks[0].result[0].audits || {};
      return {
        performance: Math.round((cats.performance?.score || 0) * 100),
        accessibility: Math.round((cats.accessibility?.score || 0) * 100),
        best_practices: Math.round(((cats['best-practices']?.score ?? cats.best_practices?.score) || 0) * 100),
        seo: Math.round((cats.seo?.score || 0) * 100),
        pwa: Math.round((cats.pwa?.score || 0) * 100),
        core_web_vitals: {
          lcp: audits['largest-contentful-paint']?.numericValue || 0,
          fid: audits['max-potential-fid']?.numericValue || 0,
          cls: audits['cumulative-layout-shift']?.numericValue || 0,
          fcp: audits['first-contentful-paint']?.numericValue || 0,
          si: audits['speed-index']?.numericValue || 0,
          tbt: audits['total-blocking-time']?.numericValue || 0,
          tti: audits['interactive']?.numericValue || 0,
        },
        audits,
      };
    }

    return null;
  }

  // ─── Phase 3: Google Business Profile Deep Dive ────────────

  /**
   * Post a Google Reviews fetch task (async)
   * Endpoint: POST /v3/business_data/google/reviews/task_post
   */
  async googleReviewsTaskPost(
    keyword: string,
    locationCode: number = 2840,
    depth: number = 100,
    pingbackUrl?: string
  ): Promise<string> {
    logger.debug(`[DataForSEO] Creating reviews task for "${keyword}"`);

    const taskPayload: any = {
      keyword,
      location_code: locationCode,
      language_code: 'en',
      depth,
    };
    if (pingbackUrl) taskPayload.pingback_url = pingbackUrl;

    const data = await this.requestWithRetry<any>('/business_data/google/reviews/task_post', [taskPayload]);

    const taskId = data.tasks?.[0]?.id;
    if (!taskId) {
      throw new DataForSEOError('Failed to create reviews task - no task ID returned', 500);
    }

    logger.debug(`[DataForSEO] Reviews task created: ${taskId}`);
    return taskId;
  }

  /**
   * Post a Google Reviews fetch task by place_id (async).
   * Use for competitor reviews when you have place_id from SERP local_pack.
   * Endpoint: POST /v3/business_data/google/reviews/task_post
   * Use googleReviewsTaskGet(taskId) to retrieve results.
   */
  async googleReviewsTaskPostByPlaceId(
    placeId: string,
    locationCode: number = 2840,
    depth: number = 100,
    pingbackUrl?: string
  ): Promise<string> {
    logger.debug(`[DataForSEO] Creating reviews task by place_id (location: ${locationCode}, depth: ${depth})`);

    const taskPayload: any = {
      place_id: placeId,
      location_code: locationCode,
      language_code: 'en',
      depth,
    };
    if (pingbackUrl) taskPayload.pingback_url = pingbackUrl;

    const data = await this.requestWithRetry<any>('/business_data/google/reviews/task_post', [taskPayload]);

    const taskId = data.tasks?.[0]?.id;
    if (!taskId) {
      throw new DataForSEOError('Failed to create reviews task by place_id - no task ID returned', 500);
    }

    logger.debug(`[DataForSEO] Reviews task (place_id) created: ${taskId}`);
    return taskId;
  }

  /**
   * Post a Google Reviews fetch task by cid (async).
   * Use for competitor reviews when you have cid from SERP local_pack.
   * Endpoint: POST /v3/business_data/google/reviews/task_post
   * Use googleReviewsTaskGet(taskId) to retrieve results.
   */
  async googleReviewsTaskPostByCid(
    cid: string,
    locationCode: number = 2840,
    depth: number = 100,
    pingbackUrl?: string
  ): Promise<string> {
    logger.debug(`[DataForSEO] Creating reviews task by cid (location: ${locationCode}, depth: ${depth})`);

    const taskPayload: any = {
      cid,
      location_code: locationCode,
      language_code: 'en',
      depth,
    };
    if (pingbackUrl) taskPayload.pingback_url = pingbackUrl;

    const data = await this.requestWithRetry<any>('/business_data/google/reviews/task_post', [taskPayload]);

    const taskId = data.tasks?.[0]?.id;
    if (!taskId) {
      throw new DataForSEOError('Failed to create reviews task by cid - no task ID returned', 500);
    }

    logger.debug(`[DataForSEO] Reviews task (cid) created: ${taskId}`);
    return taskId;
  }

  /**
   * Get Google Reviews results
   * Endpoint: GET /v3/business_data/google/reviews/task_get/{task_id}
   */
  async googleReviewsTaskGet(taskId: string): Promise<ReviewItem[]> {
    logger.debug(`[DataForSEO] Getting reviews for task ${taskId}`);

    const data = await this.requestWithRetry<any>(`/business_data/google/reviews/task_get/${taskId}`);

    const reviews: ReviewItem[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        reviews.push({
          rating: item.rating?.value || 0,
          text: item.review_text || '',
          time_ago: item.time_ago || '',
          timestamp: item.timestamp || '',
          review_id: item.review_id || '',
          profile_name: item.profile_name || '',
          owner_answer: item.owner_answer || null,
        });
      }
    }

    logger.debug(`[DataForSEO] Retrieved ${reviews.length} reviews`);
    return reviews;
  }

  /**
   * Get Google Questions and Answers
   * Endpoint: POST /v3/business_data/google/questions_and_answers/live
   */
  async googleQuestionsAnswers(
    keyword: string,
    locationCode: number = 2840
  ): Promise<QAItem[]> {
    logger.debug(`[DataForSEO] Getting Q&A for "${keyword}"`);

    const data = await this.requestWithRetry<any>('/business_data/google/questions_and_answers/live', [
      {
        keyword,
        location_code: locationCode,
        language_code: 'en',
      }
    ]);

    const results: QAItem[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          question_text: item.question_text || '',
          answer_text: item.answer_text || '',
          question_votes: item.question_votes || 0,
          answer_votes: item.answer_votes || 0,
          original_question_url: item.original_question_url || '',
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} Q&A items`);
    return results;
  }

  // ─── Phase 4: Keyword Universe Construction ────────────────

  /**
   * Get keywords that a site ranks for
   * Endpoint: POST /v3/dataforseo_labs/google/keywords_for_site/live
   */
  async keywordsForSite(
    domain: string,
    locationCode: number = 2840,
    languageCode: string = 'en',
    limit: number = 500
  ): Promise<KeywordData[]> {
    logger.debug(`[DataForSEO] Getting keywords for site "${domain}"`);

    const data = await this.requestWithRetry<any>('/dataforseo_labs/google/keywords_for_site/live', [
      {
        target: domain,
        location_code: locationCode,
        language_code: languageCode,
        limit,
        order_by: ['keyword_info.search_volume,desc'],
      }
    ]);

    return this.parseKeywordResults(data);
  }

  /**
   * Get related keywords (semantic clusters) via depth-first search on
   * Google's "searches related to" SERP element.
   * Depth 1 = ~8 keywords, depth 2 = ~72, depth 3 = ~584, depth 4 = ~4680
   * Endpoint: POST /v3/dataforseo_labs/google/related_keywords/live
   */
  async relatedKeywords(
    keyword: string,
    locationCode: number = 2840,
    languageCode: string = 'en',
    depth: number = 2,
    limit: number = 200
  ): Promise<KeywordData[]> {
    logger.debug(`[DataForSEO] Getting related keywords for "${keyword}"`);

    const data = await this.requestWithRetry<any>('/dataforseo_labs/google/related_keywords/live', [
      {
        keyword,
        location_code: locationCode,
        language_code: languageCode,
        depth,
        limit,
        order_by: ['keyword_info.search_volume,desc'],
      }
    ]);

    this.logResponseShape('related_keywords', data);
    return this.parseKeywordResults(data);
  }

  /**
   * Get bulk search volume from Google Ads
   * Endpoint: POST /v3/keywords_data/google_ads/search_volume/live
   * NOTE: Rate limited to 12 req/min. Batches in groups of 700.
   */
  async bulkSearchVolume(
    keywords: string[],
    locationCode: number = 2840,
    languageCode: string = 'en'
  ): Promise<KeywordData[]> {
    if (keywords.length === 0) return [];

    // Batch in groups of 700 (API limit)
    const batchSize = 700;
    const batches: string[][] = [];
    for (let i = 0; i < keywords.length; i += batchSize) {
      batches.push(keywords.slice(i, i + batchSize));
    }

    const allResults: KeywordData[] = [];

    for (const batch of batches) {
      logger.debug(`[DataForSEO] Fetching search volume for ${batch.length} keywords`);

      const data = await this.requestWithRetry<any>('/keywords_data/google_ads/search_volume/live', [
        {
          keywords: batch,
          location_code: locationCode,
          language_code: languageCode,
        }
      ]);

      if (data.tasks?.[0]?.result) {
        for (const item of data.tasks[0].result) {
          allResults.push({
            keyword: item.keyword || '',
            search_volume: item.search_volume || 0,
            keyword_difficulty: 0, // Not available from Google Ads
            cpc: item.cpc || 0,
            competition: item.competition || 0,
            competition_level: item.competition_level || null,
            search_intent: 'unknown',
            foreign_intents: [],
            monthly_searches: item.monthly_searches || [],
            search_volume_trend: computeTrendFromMonthly(item.monthly_searches),
            low_top_of_page_bid: item.low_top_of_page_bid || 0,
            high_top_of_page_bid: item.high_top_of_page_bid || 0,
            categories: item.categories || [],
            core_keyword: null,
            last_updated_time: null,
          });
        }
      }
    }

    logger.debug(`[DataForSEO] Search volume returned ${allResults.length} results`);
    return allResults;
  }

  /**
   * Classify search intent for keywords
   * Endpoint: POST /v3/dataforseo_labs/google/search_intent/live
   * Batches in groups of 1000.
   */
  async searchIntentClassification(
    keywords: string[],
    locationCode: number = 2840,
    languageCode: string = 'en'
  ): Promise<SearchIntentResult[]> {
    if (keywords.length === 0) return [];

    const batchSize = 1000;
    const batches: string[][] = [];
    for (let i = 0; i < keywords.length; i += batchSize) {
      batches.push(keywords.slice(i, i + batchSize));
    }

    const allResults: SearchIntentResult[] = [];

    for (const batch of batches) {
      logger.debug(`[DataForSEO] Classifying search intent for ${batch.length} keywords`);

      const data = await this.requestWithRetry<any>('/dataforseo_labs/google/search_intent/live', [
        {
          keywords: batch,
          location_code: locationCode,
          language_code: languageCode,
        }
      ]);

      if (data.tasks?.[0]?.result?.[0]?.items) {
        for (const item of data.tasks[0].result[0].items) {
          allResults.push({
            keyword: item.keyword || '',
            search_intent: item.keyword_intent?.label || 'unknown',
            secondary_intents: item.secondary_keyword_intents?.map((i: any) => i.label) || [],
          });
        }
      }
    }

    logger.debug(`[DataForSEO] Intent classified for ${allResults.length} keywords`);
    return allResults;
  }

  // ─── Phase 5: Competitive Landscape Mapping ────────────────

  /**
   * Find organic competitors by domain
   * Endpoint: POST /v3/dataforseo_labs/google/competitors_domain/live
   */
  async competitorsDomain(
    domain: string,
    locationCode: number = 2840,
    languageCode: string = 'en',
    limit: number = 20
  ): Promise<SERPCompetitor[]> {
    logger.debug(`[DataForSEO] Finding competitors for domain "${domain}"`);

    const data = await this.requestWithRetry<any>('/dataforseo_labs/google/competitors_domain/live', [
      {
        target: domain,
        location_code: locationCode,
        language_code: languageCode,
        limit,
      }
    ]);

    const results: SERPCompetitor[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          domain: item.domain || '',
          avg_position: item.avg_position || 0,
          intersections: item.intersections || 0,
          full_domain_metrics: item.metrics || null,
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} domain competitors`);
    return results;
  }

  /**
   * Find SERP-level competitors for a set of keywords
   * Endpoint: POST /v3/dataforseo_labs/google/serp_competitors/live
   */
  async serpCompetitorsForKeywords(
    keywords: string[],
    locationCode: number = 2840,
    languageCode: string = 'en',
    limit: number = 20
  ): Promise<SERPCompetitor[]> {
    logger.debug(`[DataForSEO] Finding SERP competitors for ${keywords.length} keywords`);

    const data = await this.requestWithRetry<any>('/dataforseo_labs/google/serp_competitors/live', [
      {
        keywords,
        location_code: locationCode,
        language_code: languageCode,
        limit,
      }
    ]);

    const results: SERPCompetitor[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          domain: item.domain || '',
          avg_position: item.avg_position || 0,
          intersections: item.intersections || 0,
          full_domain_metrics: item.metrics || null,
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} SERP competitors`);
    return results;
  }

  /**
   * Get domain intersection (shared/unique keywords between two domains)
   * Endpoint: POST /v3/dataforseo_labs/google/domain_intersection/live
   */
  async domainIntersection(
    target1: string,
    target2: string,
    locationCode: number = 2840,
    languageCode: string = 'en',
    limit: number = 200
  ): Promise<DomainIntersectionResult[]> {
    logger.debug(`[DataForSEO] Domain intersection: "${target1}" vs "${target2}"`);

    const data = await this.requestWithRetry<any>('/dataforseo_labs/google/domain_intersection/live', [
      {
        target1,
        target2,
        location_code: locationCode,
        language_code: languageCode,
        limit,
        order_by: ['first_domain_serp_element.keyword_data.keyword_info.search_volume,desc'],
      }
    ]);

    const results: DomainIntersectionResult[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        const kd = item.first_domain_serp_element?.keyword_data;
        results.push({
          keyword: kd?.keyword || '',
          search_volume: kd?.keyword_info?.search_volume || 0,
          keyword_difficulty: kd?.keyword_info?.keyword_difficulty || 0,
          target1_rank: item.first_domain_serp_element?.rank_absolute || null,
          target2_rank: item.second_domain_serp_element?.rank_absolute || null,
          target1_url: item.first_domain_serp_element?.url || null,
          target2_url: item.second_domain_serp_element?.url || null,
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} intersection keywords`);
    return results;
  }

  // ─── Phase 5 (Advanced): Backlinks ─────────────────────────

  /**
   * Get backlinks summary
   * Endpoint: POST /v3/backlinks/summary/live
   */
  async backlinksSummary(domain: string): Promise<BacklinksSummaryResult | null> {
    logger.debug(`[DataForSEO] Getting backlinks summary for "${domain}"`);

    const data = await this.requestWithRetry<any>('/backlinks/summary/live', [
      { target: domain, internal_list_limit: 10, backlinks_status_type: 'live' }
    ]);

    if (data.tasks?.[0]?.result?.[0]) {
      const r = data.tasks[0].result[0];
      return {
        target: r.target || domain,
        total_backlinks: r.total_backlinks || r.backlinks || 0,
        referring_domains: r.referring_domains || 0,
        referring_main_domains: r.referring_main_domains || 0,
        dofollow: r.dofollow || 0,
        nofollow: r.nofollow || 0,
        anchor: r.anchor || 0,
        image: r.image || 0,
        referring_domains_nofollow: r.referring_domains_nofollow || 0,
        broken_backlinks: r.broken_backlinks || 0,
        referring_ips: r.referring_ips || 0,
        referring_subnets: r.referring_subnets || 0,
        referring_pages: r.referring_pages || 0,
        rank: r.rank || 0,
        backlinks_spam_score: r.backlinks_spam_score || 0,
        referring_links_tld: r.referring_links_tld || null,
        referring_links_types: r.referring_links_types || null,
        referring_links_platform_types: r.referring_links_platform_types || null,
        referring_links_countries: r.referring_links_countries || null,
      };
    }

    return null;
  }

  /**
   * Get referring domains
   * Endpoint: POST /v3/backlinks/referring_domains/live
   */
  async referringDomains(
    domain: string,
    limit: number = 100
  ): Promise<ReferringDomainResult[]> {
    logger.debug(`[DataForSEO] Getting referring domains for "${domain}"`);

    const data = await this.requestWithRetry<any>('/backlinks/referring_domains/live', [
      {
        target: domain,
        limit,
        order_by: ['rank,desc'],
        backlinks_status_type: 'live',
      }
    ]);

    const results: ReferringDomainResult[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          domain: item.domain || '',
          rank: item.rank || 0,
          backlinks: item.backlinks || 0,
          first_seen: item.first_seen || '',
          last_seen: item.last_seen || '',
          broken_backlinks: item.broken_backlinks || 0,
          referring_links_tld: item.referring_links_tld || null,
          backlinks_spam_score: item.backlinks_spam_score || 0,
          referring_pages: item.referring_pages || 0,
          referring_domains_nofollow: item.referring_domains_nofollow || 0,
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} referring domains`);
    return results;
  }

  /**
   * Get anchor text distribution
   * Endpoint: POST /v3/backlinks/anchors/live
   */
  async backlinksAnchors(
    domain: string,
    limit: number = 100
  ): Promise<AnchorResult[]> {
    logger.debug(`[DataForSEO] Getting anchor texts for "${domain}"`);

    const data = await this.requestWithRetry<any>('/backlinks/anchors/live', [
      {
        target: domain,
        limit,
        order_by: ['backlinks,desc'],
        backlinks_status_type: 'live',
      }
    ]);

    const results: AnchorResult[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          anchor: item.anchor || '',
          domains: item.domains || 0,
          backlinks: item.backlinks || 0,
          first_seen: item.first_seen || '',
          last_seen: item.last_seen || '',
          referring_domains: item.referring_domains || 0,
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} anchor texts`);
    return results;
  }

  /**
   * Get backlink competitors
   * Endpoint: POST /v3/backlinks/competitors/live
   */
  async backlinksCompetitors(
    domain: string,
    limit: number = 20
  ): Promise<BacklinksCompetitorResult[]> {
    logger.debug(`[DataForSEO] Getting backlink competitors for "${domain}"`);

    const data = await this.requestWithRetry<any>('/backlinks/competitors/live', [
      { target: domain, limit }
    ]);

    const results: BacklinksCompetitorResult[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          domain: item.target || item.domain || '',
          avg_position: item.avg_position || 0,
          intersections: item.intersections || 0,
          full_domain_metrics: item.metrics || null,
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} backlink competitors`);
    return results;
  }

  /**
   * Get backlinks domain intersection (link gap analysis)
   * Endpoint: POST /v3/backlinks/domain_intersection/live
   */
  async backlinksDomainIntersection(
    targets: string[],
    excludeTargets: string[],
    limit: number = 100
  ): Promise<any[]> {
    logger.debug(`[DataForSEO] Backlinks domain intersection: ${targets.length} targets, ${excludeTargets.length} excluded`);

    const data = await this.requestWithRetry<any>('/backlinks/domain_intersection/live', [
      {
        targets,
        exclude_targets: excludeTargets,
        limit,
        order_by: ['rank,desc'],
      }
    ]);

    const results: any[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      results.push(...data.tasks[0].result[0].items);
    }

    logger.debug(`[DataForSEO] Found ${results.length} link gap domains`);
    return results;
  }

  /**
   * Get individual backlinks list
   * Endpoint: POST /v3/backlinks/backlinks/live
   */
  async backlinksBacklinks(
    domain: string,
    limit: number = 100
  ): Promise<BacklinkEntry[]> {
    logger.debug(`[DataForSEO] Getting individual backlinks for "${domain}"`);

    const data = await this.requestWithRetry<any>('/backlinks/backlinks/live', [
      {
        target: domain,
        limit,
        mode: 'one_per_domain',
        order_by: ['rank,desc'],
        backlinks_status_type: 'live',
      }
    ]);

    const results: BacklinkEntry[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          url_from: item.url_from || '',
          domain_from: item.domain_from || '',
          url_to: item.url_to || '',
          anchor: item.anchor || '',
          dofollow: item.dofollow ?? true,
          backlink_spam_score: item.backlink_spam_score || 0,
          rank: item.rank || 0,
          page_from_rank: item.page_from_rank || 0,
          domain_from_rank: item.domain_from_rank || 0,
          first_seen: item.first_seen || '',
          last_seen: item.last_seen || '',
          is_broken: item.is_broken ?? false,
          is_new: item.is_new ?? false,
          is_lost: item.is_lost ?? false,
          item_type: item.item_type || 'anchor',
          semantic_location: item.semantic_location || '',
          domain_from_platform_type: item.domain_from_platform_type || [],
          domain_from_country: item.domain_from_country || '',
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} individual backlinks`);
    return results;
  }

  /**
   * Get backlinks history (monthly snapshots)
   * Endpoint: POST /v3/backlinks/history/live
   */
  async backlinksHistory(
    domain: string,
    dateFrom?: string,
    dateTo?: string
  ): Promise<BacklinksHistoryEntry[]> {
    logger.debug(`[DataForSEO] Getting backlinks history for "${domain}"`);

    const params: any = { target: domain };
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;

    const data = await this.requestWithRetry<any>('/backlinks/history/live', [params]);

    const results: BacklinksHistoryEntry[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          date: item.date || '',
          rank: item.rank || 0,
          backlinks: item.backlinks || 0,
          new_backlinks: item.new_backlinks || 0,
          lost_backlinks: item.lost_backlinks || 0,
          referring_domains: item.referring_domains || 0,
          new_referring_domains: item.new_referring_domains || 0,
          lost_referring_domains: item.lost_referring_domains || 0,
          referring_pages: item.referring_pages || 0,
          broken_backlinks: item.broken_backlinks || 0,
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} history entries`);
    return results;
  }

  /**
   * Get per-page backlink distribution for a domain
   * Endpoint: POST /v3/backlinks/domain_pages/live
   */
  async backlinksDomainPages(
    domain: string,
    limit: number = 50
  ): Promise<BacklinksDomainPageEntry[]> {
    logger.debug(`[DataForSEO] Getting domain pages backlinks for "${domain}"`);

    const data = await this.requestWithRetry<any>('/backlinks/domain_pages/live', [
      {
        target: domain,
        limit,
        order_by: ['page_summary.backlinks,desc'],
        backlinks_status_type: 'live',
      }
    ]);

    const results: BacklinksDomainPageEntry[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        const ps = item.page_summary || {};
        const meta = item.meta || {};
        results.push({
          page: item.page || '',
          title: meta.title || null,
          rank: ps.rank || 0,
          backlinks: ps.backlinks || 0,
          referring_domains: ps.referring_domains || 0,
          backlinks_spam_score: ps.backlinks_spam_score || 0,
          broken_backlinks: ps.broken_backlinks || 0,
          first_seen: ps.first_seen || '',
          internal_links_count: meta.internal_links_count || 0,
          external_links_count: meta.external_links_count || 0,
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} domain pages`);
    return results;
  }

  /**
   * Get referring networks (IP/subnet analysis)
   * Endpoint: POST /v3/backlinks/referring_networks/live
   */
  async backlinksReferringNetworks(
    domain: string,
    limit: number = 50,
    networkType: 'ip' | 'subnet' = 'subnet'
  ): Promise<ReferringNetworkEntry[]> {
    logger.debug(`[DataForSEO] Getting referring networks for "${domain}" (${networkType})`);

    const data = await this.requestWithRetry<any>('/backlinks/referring_networks/live', [
      {
        target: domain,
        limit,
        network_address_type: networkType,
        order_by: ['backlinks,desc'],
        backlinks_status_type: 'live',
      }
    ]);

    const results: ReferringNetworkEntry[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          network_address: item.network_address || '',
          rank: item.rank || 0,
          backlinks: item.backlinks || 0,
          referring_domains: item.referring_domains || 0,
          first_seen: item.first_seen || '',
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} referring networks`);
    return results;
  }

  /**
   * Get page-level backlink intersection (link gap at page level)
   * Endpoint: POST /v3/backlinks/page_intersection/live
   */
  async backlinksPageIntersection(
    targets: string[],
    excludeTargets: string[],
    limit: number = 100
  ): Promise<any[]> {
    logger.debug(`[DataForSEO] Backlinks page intersection: ${targets.length} targets, ${excludeTargets.length} excluded`);

    const targetsObj: Record<string, string> = {};
    targets.forEach((t, i) => { targetsObj[String(i + 1)] = t; });
    const excludeObj: Record<string, string> = {};
    excludeTargets.forEach((t, i) => { excludeObj[String(i + 1)] = t; });

    const data = await this.requestWithRetry<any>('/backlinks/page_intersection/live', [
      {
        targets: targetsObj,
        exclude_targets: excludeTargets,
        limit,
        order_by: ['1.rank,desc'],
        backlinks_status_type: 'live',
      }
    ]);

    const results: any[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      results.push(...data.tasks[0].result[0].items);
    }

    logger.debug(`[DataForSEO] Found ${results.length} page intersection results`);
    return results;
  }

  /**
   * Get backlink timeseries summary (trends over time)
   * Endpoint: POST /v3/backlinks/timeseries_summary/live
   */
  async backlinksTimeseriesSummary(
    domain: string,
    dateFrom?: string,
    dateTo?: string,
    groupRange: 'day' | 'week' | 'month' | 'year' = 'month'
  ): Promise<TimeseriesSummaryEntry[]> {
    logger.debug(`[DataForSEO] Getting backlinks timeseries for "${domain}"`);

    const params: any = { target: domain, group_range: groupRange };
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;

    const data = await this.requestWithRetry<any>('/backlinks/timeseries_summary/live', [params]);

    const results: TimeseriesSummaryEntry[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          date: item.date || '',
          rank: item.rank || 0,
          backlinks: item.backlinks || 0,
          referring_domains: item.referring_domains || 0,
          referring_main_domains: item.referring_main_domains || 0,
          referring_ips: item.referring_ips || 0,
          referring_subnets: item.referring_subnets || 0,
          referring_pages: item.referring_pages || 0,
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} timeseries entries`);
    return results;
  }

  /**
   * Get new & lost backlinks timeseries
   * Endpoint: POST /v3/backlinks/timeseries_new_lost_summary/live
   */
  async backlinksNewLostTimeseries(
    domain: string,
    dateFrom?: string,
    dateTo?: string,
    groupRange: 'day' | 'week' | 'month' | 'year' = 'month'
  ): Promise<NewLostTimeseriesEntry[]> {
    logger.debug(`[DataForSEO] Getting new/lost timeseries for "${domain}"`);

    const params: any = { target: domain, group_range: groupRange };
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;

    const data = await this.requestWithRetry<any>('/backlinks/timeseries_new_lost_summary/live', [params]);

    const results: NewLostTimeseriesEntry[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          date: item.date || '',
          new_backlinks: item.new_backlinks || 0,
          lost_backlinks: item.lost_backlinks || 0,
          new_referring_domains: item.new_referring_domains || 0,
          lost_referring_domains: item.lost_referring_domains || 0,
          new_referring_main_domains: item.new_referring_main_domains || 0,
          lost_referring_main_domains: item.lost_referring_main_domains || 0,
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} new/lost timeseries entries`);
    return results;
  }

  // ─── Backlinks Bulk Endpoints ──────────────────────────────

  /**
   * Bulk rank scores for up to 1000 domains
   * Endpoint: POST /v3/backlinks/bulk_ranks/live
   */
  async backlinksBulkRanks(targets: string[]): Promise<BulkRankEntry[]> {
    logger.debug(`[DataForSEO] Getting bulk ranks for ${targets.length} targets`);

    const data = await this.requestWithRetry<any>('/backlinks/bulk_ranks/live', [
      { targets: targets.slice(0, 1000) }
    ]);

    const results: BulkRankEntry[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          target: item.target || '',
          rank: item.rank || 0,
        });
      }
    }

    logger.debug(`[DataForSEO] Got ranks for ${results.length} targets`);
    return results;
  }

  /**
   * Bulk backlink counts for up to 1000 domains
   * Endpoint: POST /v3/backlinks/bulk_backlinks/live
   */
  async backlinksBulkBacklinks(targets: string[]): Promise<BulkBacklinksEntry[]> {
    logger.debug(`[DataForSEO] Getting bulk backlinks for ${targets.length} targets`);

    const data = await this.requestWithRetry<any>('/backlinks/bulk_backlinks/live', [
      { targets: targets.slice(0, 1000) }
    ]);

    const results: BulkBacklinksEntry[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          target: item.target || '',
          backlinks: item.backlinks || 0,
        });
      }
    }

    logger.debug(`[DataForSEO] Got backlink counts for ${results.length} targets`);
    return results;
  }

  /**
   * Bulk spam scores for up to 1000 domains
   * Endpoint: POST /v3/backlinks/bulk_spam_score/live
   */
  async backlinksBulkSpamScore(targets: string[]): Promise<BulkSpamScoreEntry[]> {
    logger.debug(`[DataForSEO] Getting bulk spam scores for ${targets.length} targets`);

    const data = await this.requestWithRetry<any>('/backlinks/bulk_spam_score/live', [
      { targets: targets.slice(0, 1000) }
    ]);

    const results: BulkSpamScoreEntry[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          target: item.target || '',
          spam_score: item.spam_score ?? item.backlinks_spam_score ?? 0,
        });
      }
    }

    logger.debug(`[DataForSEO] Got spam scores for ${results.length} targets`);
    return results;
  }

  /**
   * Bulk referring domains for up to 1000 domains
   * Endpoint: POST /v3/backlinks/bulk_referring_domains/live
   */
  async backlinksBulkReferringDomains(targets: string[]): Promise<BulkReferringDomainsEntry[]> {
    logger.debug(`[DataForSEO] Getting bulk referring domains for ${targets.length} targets`);

    const data = await this.requestWithRetry<any>('/backlinks/bulk_referring_domains/live', [
      { targets: targets.slice(0, 1000) }
    ]);

    const results: BulkReferringDomainsEntry[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          target: item.target || '',
          referring_domains: item.referring_domains || 0,
          referring_domains_nofollow: item.referring_domains_nofollow || 0,
          referring_main_domains: item.referring_main_domains || 0,
          referring_main_domains_nofollow: item.referring_main_domains_nofollow || 0,
        });
      }
    }

    logger.debug(`[DataForSEO] Got referring domains for ${results.length} targets`);
    return results;
  }

  /**
   * Bulk new & lost backlinks for up to 1000 domains
   * Endpoint: POST /v3/backlinks/bulk_new_lost_backlinks/live
   */
  async backlinksBulkNewLostBacklinks(
    targets: string[],
    dateFrom?: string
  ): Promise<BulkNewLostBacklinksEntry[]> {
    logger.debug(`[DataForSEO] Getting bulk new/lost backlinks for ${targets.length} targets`);

    const params: any = { targets: targets.slice(0, 1000) };
    if (dateFrom) params.date_from = dateFrom;

    const data = await this.requestWithRetry<any>('/backlinks/bulk_new_lost_backlinks/live', [params]);

    const results: BulkNewLostBacklinksEntry[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          target: item.target || '',
          new_backlinks: item.new_backlinks || 0,
          lost_backlinks: item.lost_backlinks || 0,
        });
      }
    }

    logger.debug(`[DataForSEO] Got new/lost for ${results.length} targets`);
    return results;
  }

  // ─── Phase 6: SERP & Local Search Analysis ─────────────────

  /**
   * Post async SERP organic task
   * Endpoint: POST /v3/serp/google/organic/task_post
   */
  async serpOrganicTaskPost(
    keyword: string,
    locationCode: number = 2840,
    languageCode: string = 'en',
    pingbackUrl?: string,
    tag?: string
  ): Promise<SERPTaskPostResult> {
    logger.debug(`[DataForSEO] Creating SERP organic task for "${keyword}"`);

    const taskPayload: any = {
      keyword,
      location_code: locationCode,
      language_code: languageCode,
      device: 'desktop',
      os: 'windows',
    };
    if (pingbackUrl) taskPayload.pingback_url = pingbackUrl;
    if (tag) taskPayload.tag = tag;

    const data = await this.requestWithRetry<any>('/serp/google/organic/task_post', [taskPayload]);

    const taskId = data.tasks?.[0]?.id;
    if (!taskId) {
      throw new DataForSEOError('Failed to create SERP organic task', 500);
    }

    return { task_id: taskId, status: data.tasks[0].status_message || 'pending' };
  }

  /**
   * Get SERP organic task results
   * Endpoint: GET /v3/serp/google/organic/task_get/advanced/{task_id}
   */
  async serpOrganicTaskGet(taskId: string): Promise<any> {
    logger.debug(`[DataForSEO] Getting SERP organic results for task ${taskId}`);
    return this.requestWithRetry<any>(`/serp/google/organic/task_get/advanced/${taskId}`);
  }

  /**
   * Post async SERP Maps task
   * Endpoint: POST /v3/serp/google/maps/task_post
   */
  async serpMapsTaskPost(
    keyword: string,
    locationCode: number = 2840,
    languageCode: string = 'en',
    pingbackUrl?: string,
    tag?: string
  ): Promise<SERPTaskPostResult> {
    logger.debug(`[DataForSEO] Creating SERP Maps task for "${keyword}"`);

    const taskPayload: any = {
      keyword,
      location_code: locationCode,
      language_code: languageCode,
      device: 'desktop',
    };
    if (pingbackUrl) taskPayload.pingback_url = pingbackUrl;
    if (tag) taskPayload.tag = tag;

    const data = await this.requestWithRetry<any>('/serp/google/maps/task_post', [taskPayload]);

    const taskId = data.tasks?.[0]?.id;
    if (!taskId) {
      throw new DataForSEOError('Failed to create SERP Maps task', 500);
    }

    return { task_id: taskId, status: data.tasks[0].status_message || 'pending' };
  }

  /**
   * Get SERP Maps task results
   * Endpoint: GET /v3/serp/google/maps/task_get/advanced/{task_id}
   */
  async serpMapsTaskGet(taskId: string): Promise<any> {
    logger.debug(`[DataForSEO] Getting SERP Maps results for task ${taskId}`);
    return this.requestWithRetry<any>(`/serp/google/maps/task_get/advanced/${taskId}`);
  }

  /**
   * Post async SERP Local Finder task
   * Endpoint: POST /v3/serp/google/local_finder/task_post
   */
  async serpLocalFinderTaskPost(
    keyword: string,
    locationCode: number = 2840,
    languageCode: string = 'en',
    depth: number = 20,
    pingbackUrl?: string,
    tag?: string
  ): Promise<SERPTaskPostResult> {
    logger.debug(`[DataForSEO] Creating Local Finder task for "${keyword}"`);

    const taskPayload: any = {
      keyword,
      location_code: locationCode,
      language_code: languageCode,
      device: 'desktop',
      depth,
    };
    if (pingbackUrl) taskPayload.pingback_url = pingbackUrl;
    if (tag) taskPayload.tag = tag;

    const data = await this.requestWithRetry<any>('/serp/google/local_finder/task_post', [taskPayload]);

    const taskId = data.tasks?.[0]?.id;
    if (!taskId) {
      throw new DataForSEOError('Failed to create Local Finder task', 500);
    }

    return { task_id: taskId, status: data.tasks[0].status_message || 'pending' };
  }

  /**
   * Get SERP Local Finder task results
   * Endpoint: GET /v3/serp/google/local_finder/task_get/advanced/{task_id}
   */
  async serpLocalFinderTaskGet(taskId: string): Promise<any> {
    logger.debug(`[DataForSEO] Getting Local Finder results for task ${taskId}`);
    return this.requestWithRetry<any>(`/serp/google/local_finder/task_get/advanced/${taskId}`);
  }

  // ─── Live SERP Methods (real-time, no polling) ─────────────────

  /**
   * Live SERP organic results (real-time)
   * Endpoint: POST /v3/serp/google/organic/live/advanced
   */
  async serpOrganicLive(
    keyword: string,
    locationCode: number = 2840,
    languageCode: string = 'en'
  ): Promise<any> {
    logger.debug(`[DataForSEO] Live organic SERP for "${keyword}"`);

    return this.requestWithRetry<any>('/serp/google/organic/live/advanced', [
      {
        keyword,
        location_code: locationCode,
        language_code: languageCode,
        device: 'desktop',
        os: 'windows',
      }
    ]);
  }

  /**
   * Live SERP Maps results (real-time)
   * Endpoint: POST /v3/serp/google/maps/live/advanced
   */
  async serpMapsLive(
    keyword: string,
    locationCode: number = 2840,
    languageCode: string = 'en'
  ): Promise<any> {
    logger.debug(`[DataForSEO] Live Maps SERP for "${keyword}"`);

    return this.requestWithRetry<any>('/serp/google/maps/live/advanced', [
      {
        keyword,
        location_code: locationCode,
        language_code: languageCode,
        device: 'desktop',
      }
    ]);
  }

  /**
   * Live SERP Local Finder results (real-time)
   * Endpoint: POST /v3/serp/google/local_finder/live/advanced
   */
  async serpLocalFinderLive(
    keyword: string,
    locationCode: number = 2840,
    languageCode: string = 'en',
    depth: number = 40
  ): Promise<any> {
    logger.debug(`[DataForSEO] Live Local Finder for "${keyword}"`);

    return this.requestWithRetry<any>('/serp/google/local_finder/live/advanced', [
      {
        keyword,
        location_code: locationCode,
        language_code: languageCode,
        device: 'desktop',
        depth,
      }
    ]);
  }

  /**
   * Get SERP autocomplete suggestions
   * Endpoint: POST /v3/serp/google/autocomplete/live/advanced
   */
  async serpAutocomplete(
    keyword: string,
    locationCode: number = 2840,
    languageCode: string = 'en'
  ): Promise<AutocompleteResult> {
    logger.debug(`[DataForSEO] Getting autocomplete for "${keyword}"`);

    const data = await this.requestWithRetry<any>('/serp/google/autocomplete/live/advanced', [
      {
        keyword,
        location_code: locationCode,
        language_code: languageCode,
      }
    ]);

    const suggestions: string[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        if (item.suggestion) {
          suggestions.push(item.suggestion);
        }
      }
    }

    logger.debug(`[DataForSEO] Found ${suggestions.length} autocomplete suggestions`);
    return { keyword, suggestions };
  }

  // ─── Phase 7: On-Page Technical Audit (expanded) ──────────

  /**
   * Create an on-page audit task (enhanced version)
   * Endpoint: POST /v3/on_page/task_post
   */
  async onPageTaskPostEnhanced(
    url: string,
    maxCrawlPages: number = 100,
    enableJavascript: boolean = true,
    loadResources: boolean = true,
    pingbackUrl?: string,
    tag?: string,
    options?: {
      calculateKeywordDensity?: boolean;
      enableContentParsing?: boolean;
      checkSpell?: boolean;
      respectSitemap?: boolean;
    }
  ): Promise<string> {
    logger.debug(`[DataForSEO] Creating enhanced on-page audit for "${url}" (max ${maxCrawlPages} pages)`);

    const taskPayload: any = {
      target: url,
      max_crawl_pages: maxCrawlPages,
      enable_javascript: enableJavascript,
      load_resources: loadResources,
      enable_browser_rendering: enableJavascript,
      enable_microdata: true,
      calculate_keyword_density: options?.calculateKeywordDensity ?? true,
      enable_content_parsing: options?.enableContentParsing ?? true,
      check_spell: options?.checkSpell ?? true,
      check_spell_language: 'en',
      respect_sitemap: options?.respectSitemap ?? true,
    };
    if (pingbackUrl) taskPayload.pingback_url = pingbackUrl;
    if (tag) taskPayload.tag = tag;

    const data = await this.requestWithRetry<any>('/on_page/task_post', [taskPayload]);

    const taskId = data.tasks?.[0]?.id;
    if (!taskId) {
      throw new DataForSEOError('Failed to create on-page audit task - no task ID returned', 500);
    }

    logger.debug(`[DataForSEO] Enhanced on-page task created: ${taskId}`);
    return taskId;
  }

  /**
   * Get on-page crawl summary
   * Endpoint: GET /v3/on_page/summary/{task_id}
   */
  async onPageSummary(taskId: string): Promise<OnPageSummaryResult | null> {
    logger.debug(`[DataForSEO] Getting on-page summary for task ${taskId}`);

    const data = await this.requestWithRetry<any>(`/on_page/summary/${taskId}`);

    if (data.tasks?.[0]?.result?.[0]) {
      const r = data.tasks[0].result[0];
      const di = r.domain_info;
      const pm = r.page_metrics;

      let domainInfo: OnPageDomainInfo | null = null;
      if (di) {
        const checks = di.checks || {};
        domainInfo = {
          cms: di.cms || null,
          server: di.server || null,
          ssl: !!di.ssl_info?.valid_certificate,
          has_sitemap: checks.sitemap ?? false,
          has_robots_txt: checks.robots_txt ?? false,
          is_www_redirect: checks.www_redirect ?? false,
          is_https_redirect: checks.https_redirect ?? false,
          canonicalization: checks.canonical ?? false,
          test_404: checks.test_404 ?? false,
          directory_browsing: checks.test_directory_browsing ?? false,
        };
      }

      let pageMetrics: OnPagePageMetrics | null = null;
      if (pm) {
        pageMetrics = {
          duplicate_title: pm.checks?.duplicate_title ?? 0,
          duplicate_description: pm.checks?.duplicate_description ?? 0,
          duplicate_content: pm.checks?.duplicate_content ?? 0,
          non_indexable: pm.non_indexable ?? 0,
          broken_links: pm.broken_links ?? 0,
          broken_resources: pm.broken_resources ?? 0,
          links_internal: pm.links_internal ?? 0,
          links_external: pm.links_external ?? 0,
          onpage_score: pm.onpage_score ?? 0,
        };
      }

      return {
        crawl_progress: r.crawl_progress || 'unknown',
        crawl_status: r.crawl_status,
        pages_count: r.pages_count || 0,
        pages_with_issues: r.pages_with_issues || 0,
        checks: r.checks || {},
        onpage_score: r.onpage_score || 0,
        domain_info: domainInfo,
        page_metrics: pageMetrics,
      };
    }

    return null;
  }

  /**
   * Get detailed on-page pages data
   * Endpoint: POST /v3/on_page/pages
   */
  async onPagePages(
    taskId: string,
    limit: number = 100,
    orderBy?: string[],
    filters?: any[]
  ): Promise<any[]> {
    logger.debug(`[DataForSEO] Getting on-page pages for task ${taskId}`);

    const body: any = {
      id: taskId,
      limit,
    };
    if (orderBy) body.order_by = orderBy;
    if (filters) body.filters = filters;

    const data = await this.requestWithRetry<any>('/on_page/pages', [body]);

    const pages: any[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      pages.push(...data.tasks[0].result[0].items);
    }

    logger.debug(`[DataForSEO] Retrieved ${pages.length} page details`);
    return pages;
  }

  /**
   * Get duplicate tags (titles/descriptions)
   * Endpoint: POST /v3/on_page/duplicate_tags
   */
  async onPageDuplicateTags(taskId: string): Promise<DuplicateTagResult[]> {
    logger.debug(`[DataForSEO] Getting duplicate tags for task ${taskId}`);

    const data = await this.requestWithRetry<any>('/on_page/duplicate_tags', [
      { id: taskId }
    ]);

    const results: DuplicateTagResult[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          type: item.accumulator || 'unknown',
          pages: item.pages?.map((p: any) => ({
            url: p.url || '',
            meta: { title: p.meta?.title, description: p.meta?.description },
          })) || [],
          accumulated_count: item.accumulated_count || 0,
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} duplicate tag groups`);
    return results;
  }

  /**
   * Get internal/external link analysis
   * Endpoint: POST /v3/on_page/links
   */
  async onPageLinks(taskId: string, limit: number = 200): Promise<OnPageLinkResult[]> {
    logger.debug(`[DataForSEO] Getting on-page links for task ${taskId}`);

    const data = await this.requestWithRetry<any>('/on_page/links', [
      { id: taskId, limit }
    ]);

    const results: OnPageLinkResult[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          source_url: item.page_from || '',
          destination_url: item.page_to || '',
          is_external: item.direction === 'external',
          is_broken: item.is_broken || false,
          direction: item.direction || '',
          page_from_status_code: item.page_from_status_code || 0,
          dofollow: item.dofollow || false,
          anchor: item.anchor || '',
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} links`);
    return results;
  }

  /**
   * Get redirect chains
   * Endpoint: POST /v3/on_page/redirect_chains
   */
  async onPageRedirectChains(taskId: string): Promise<RedirectChainResult[]> {
    logger.debug(`[DataForSEO] Getting redirect chains for task ${taskId}`);

    const data = await this.requestWithRetry<any>('/on_page/redirect_chains', [
      { id: taskId }
    ]);

    const results: RedirectChainResult[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          url: item.url || '',
          redirect_url: item.redirect_url || '',
          status_code: item.status_code || 0,
          is_redirect: item.is_redirect || false,
          chain: item.chain || [],
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} redirect chains`);
    return results;
  }

  /**
   * Get microdata/schema markup
   * Endpoint: POST /v3/on_page/microdata
   */
  async onPageMicrodata(taskId: string): Promise<MicrodataResult[]> {
    logger.debug(`[DataForSEO] Getting microdata for task ${taskId}`);

    const data = await this.requestWithRetry<any>('/on_page/microdata', [
      { id: taskId }
    ]);

    const results: MicrodataResult[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          url: item.page_url || '',
          types: item.test_results?.map((t: any) => t.type) || [],
          data: item.test_results || [],
        });
      }
    }

    logger.debug(`[DataForSEO] Found microdata on ${results.length} pages`);
    return results;
  }

  /**
   * Get resources (images, scripts, CSS)
   * Endpoint: POST /v3/on_page/resources
   */
  async onPageResources(
    taskId: string,
    filters?: any[],
    limit: number = 100
  ): Promise<OnPageResourceResult[]> {
    logger.debug(`[DataForSEO] Getting on-page resources for task ${taskId}`);

    const body: any = { id: taskId, limit };
    if (filters) body.filters = filters;

    const data = await this.requestWithRetry<any>('/on_page/resources', [body]);

    const results: OnPageResourceResult[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          url: item.url || '',
          resource_type: item.resource_type || '',
          status_code: item.status_code || 0,
          size: item.size || 0,
          encoded_size: item.encoded_size || 0,
          total_transfer_size: item.total_transfer_size || 0,
          fetch_timing: item.fetch_timing || null,
          media_type: item.media_type || '',
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} resources`);
    return results;
  }

  /**
   * Get non-indexable pages
   * Endpoint: POST /v3/on_page/non_indexable
   */
  async onPageNonIndexable(taskId: string, limit: number = 100): Promise<NonIndexableResult[]> {
    logger.debug(`[DataForSEO] Getting non-indexable pages for task ${taskId}`);

    const data = await this.requestWithRetry<any>('/on_page/non_indexable', [
      { id: taskId, limit }
    ]);

    const results: NonIndexableResult[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          url: item.url || '',
          reason: item.reason || 'unknown',
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} non-indexable pages`);
    return results;
  }

  /**
   * Get duplicate content pages (similar to a reference URL)
   * Endpoint: POST /v3/on_page/duplicate_content
   */
  async onPageDuplicateContent(
    taskId: string,
    url: string,
    similarity: number = 6,
    limit: number = 50
  ): Promise<DuplicateContentResult[]> {
    logger.debug(`[DataForSEO] Getting duplicate content for task ${taskId}, url="${url}"`);

    const data = await this.requestWithRetry<any>('/on_page/duplicate_content', [
      { id: taskId, url, similarity, limit }
    ]);

    const results: DuplicateContentResult[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          url: item.url || url,
          similarity: item.similarity || 0,
          total_count: item.total_count || 0,
          pages: (item.pages || []).map((p: any) => ({
            url: p.url || '',
            similarity: p.similarity || 0,
            meta: { title: p.meta?.title, description: p.meta?.description },
          })),
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} duplicate content groups`);
    return results;
  }

  /**
   * Get keyword density for the crawled site
   * Endpoint: POST /v3/on_page/keyword_density
   * Requires calculate_keyword_density: true in Task POST
   */
  async onPageKeywordDensity(
    taskId: string,
    keywordLength: number = 2,
    url?: string,
    limit: number = 100
  ): Promise<KeywordDensityResult[]> {
    logger.debug(`[DataForSEO] Getting keyword density (${keywordLength}-word) for task ${taskId}`);

    const body: any = { id: taskId, keyword_length: keywordLength, limit, order_by: ['frequency,desc'] };
    if (url) body.url = url;

    const data = await this.requestWithRetry<any>('/on_page/keyword_density', [body]);

    const results: KeywordDensityResult[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          keyword: item.keyword || '',
          frequency: item.frequency || 0,
          density: item.density || 0,
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} keyword density entries`);
    return results;
  }

  /**
   * Get page speed waterfall for a specific URL
   * Endpoint: POST /v3/on_page/waterfall
   */
  async onPageWaterfall(taskId: string, url: string): Promise<WaterfallResult | null> {
    logger.debug(`[DataForSEO] Getting waterfall for task ${taskId}, url="${url}"`);

    const data = await this.requestWithRetry<any>('/on_page/waterfall', [
      { id: taskId, url }
    ]);

    if (data.tasks?.[0]?.result?.[0]) {
      const r = data.tasks[0].result[0];
      const items: WaterfallResourceItem[] = [];
      if (r.items) {
        for (const item of r.items) {
          items.push({
            resource_type: item.resource_type || '',
            url: item.url || '',
            duration_time: item.duration_time || 0,
            fetch_start: item.fetch_start || 0,
            fetch_end: item.fetch_end || 0,
            is_render_blocking: item.is_render_blocking || false,
            initiator: item.initiator || null,
            size: item.size || 0,
            encoded_size: item.encoded_size || 0,
          });
        }
      }
      return {
        url: r.url || url,
        page_timing: r.page_timing || null,
        items,
      };
    }

    return null;
  }

  /**
   * Get parsed page content (headings, topics, contacts)
   * Endpoint: POST /v3/on_page/content_parsing
   * Requires enable_content_parsing: true in Task POST
   */
  async onPageContentParsing(taskId: string, url: string): Promise<ContentParsingResult | null> {
    logger.debug(`[DataForSEO] Getting content parsing for task ${taskId}, url="${url}"`);

    const data = await this.requestWithRetry<any>('/on_page/content_parsing', [
      { id: taskId, url }
    ]);

    if (data.tasks?.[0]?.result?.[0]?.items?.[0]) {
      const item = data.tasks[0].result[0].items[0];
      return {
        url: item.url || url,
        page_content: item.page_content ? {
          header: item.page_content.header || null,
          footer: item.page_content.footer || null,
          main_topic: item.page_content.main_topic || null,
          secondary_topic: item.page_content.secondary_topic || null,
        } : null,
        contacts: item.page_content ? {
          telephones: item.page_content.contacts?.telephones || [],
          emails: item.page_content.contacts?.emails || [],
        } : null,
        ratings: item.page_content?.ratings || [],
        offers: item.page_content?.offers || [],
      };
    }

    return null;
  }

  /**
   * Force stop an in-progress crawl
   * Endpoint: POST /v3/on_page/force_stop
   */
  async onPageForceStop(taskId: string): Promise<void> {
    logger.debug(`[DataForSEO] Force stopping on-page task ${taskId}`);
    try {
      await this.requestWithRetry<any>('/on_page/force_stop', [{ id: taskId }]);
      logger.debug(`[DataForSEO] Force stop sent for task ${taskId}`);
    } catch (e: any) {
      logger.warn(`[DataForSEO] Force stop failed for task ${taskId}: ${e.message}`);
    }
  }

  /**
   * Instant single-page audit (Live — no Task POST needed)
   * Endpoint: POST /v3/on_page/instant_pages
   */
  async onPageInstantPages(
    url: string,
    options?: { enableJavascript?: boolean; enableBrowserRendering?: boolean; loadResources?: boolean }
  ): Promise<any | null> {
    logger.debug(`[DataForSEO] Instant page audit for "${url}"`);

    const data = await this.requestWithRetry<any>('/on_page/instant_pages', [{
      url,
      enable_javascript: options?.enableJavascript ?? true,
      enable_browser_rendering: options?.enableBrowserRendering ?? true,
      load_resources: options?.loadResources ?? true,
    }]);

    if (data.tasks?.[0]?.result?.[0]?.items?.[0]) {
      return data.tasks[0].result[0].items[0];
    }

    return null;
  }

  // ─── Async Task Management ─────────────────────────────────

  /**
   * Generic async task result getter
   */
  async getTaskResult<T = any>(endpoint: string, taskId: string): Promise<T> {
    logger.debug(`[DataForSEO] Getting task result: ${endpoint}/task_get/${taskId}`);
    return this.requestWithRetry<T>(`${endpoint}/task_get/${taskId}`);
  }

  /**
   * Check which tasks are ready
   */
  async checkTasksReady(endpoint: string): Promise<Array<{ id: string; status: string }>> {
    logger.debug(`[DataForSEO] Checking ready tasks for ${endpoint}`);
    const data = await this.request<any>(`${endpoint}/tasks_ready`);

    const tasks: Array<{ id: string; status: string }> = [];
    if (data.tasks?.[0]?.result) {
      for (const item of data.tasks[0].result) {
        tasks.push({
          id: item.id || '',
          status: item.status_message || 'unknown',
        });
      }
    }

    return tasks;
  }

  /**
   * Poll for an async task to complete
   */
  async pollTaskCompletion(
    endpoint: string,
    taskId: string,
    maxWaitMs: number = 120000,
    pollIntervalMs: number = 5000
  ): Promise<any> {
    logger.debug(`[DataForSEO] Polling task ${taskId} at ${endpoint}...`);
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const data = await this.request<any>(`${endpoint}/task_get/advanced/${taskId}`);

        if (data.tasks?.[0]?.status_code === 20000 && data.tasks?.[0]?.result) {
          logger.debug(`[DataForSEO] Task ${taskId} completed`);
          return data;
        }
      } catch (error: any) {
        // Task might not be ready yet — keep polling unless it's a fatal error
        if (error instanceof DataForSEOAuthError || error instanceof DataForSEOBalanceError) {
          throw error;
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    logger.warn(`[DataForSEO] Task ${taskId} polling timed out after ${maxWaitMs}ms`);
    return null;
  }

  // ─── Phase 1: Local Competitive Intelligence (legacy) ──────

  /**
   * Search Google My Business for local competitors
   * Endpoint: /business_data/google/my_business/search/live
   */
  async searchGoogleMyBusiness(
    keyword: string,
    locationCode: number = 2840,
    languageCode: string = 'en',
    limit: number = 20
  ): Promise<GMBResult[]> {
    logger.debug(`[DataForSEO] Searching GMB for "${keyword}" (location: ${locationCode})`);

    const data = await this.request<any>('/business_data/google/my_business_info/live', [
      {
        keyword,
        location_code: locationCode,
        language_code: languageCode,
        limit,
      }
    ]);

    const results: GMBResult[] = [];
    if (data.tasks?.[0]?.result) {
      for (const item of data.tasks[0].result) {
        if (item.items) {
          for (const biz of item.items) {
            results.push({
              title: biz.title || '',
              category: biz.category || '',
              address: biz.address || '',
              phone: biz.phone || '',
              url: biz.url || '',
              rating: biz.rating ? {
                value: biz.rating.value || 0,
                votes_count: biz.rating.votes_count || 0,
              } : null,
              latitude: biz.latitude || 0,
              longitude: biz.longitude || 0,
              place_id: biz.place_id || '',
              is_claimed: biz.is_claimed || false,
            });
          }
        }
      }
    }

    logger.debug(`[DataForSEO] GMB returned ${results.length} local businesses`);
    return results;
  }

  /**
   * Get a specific business by Google Maps URL or place_id
   * Endpoint: /business_data/google/my_business_info/live
   * 
   * Extracts place_id from Google Maps URL and fetches that specific business.
   * Returns null if business not found or URL is invalid.
   */
  async getBusinessDataByUrl(googleMapsUrl: string): Promise<GMBResult | null> {
    logger.debug(`[DataForSEO] Fetching business by URL: ${googleMapsUrl}`);

    // Extract place_id from Google Maps URL
    // Format: https://www.google.com/maps/place/.../@lat,lng,zoom/data=!4m5!3m4!1s<PLACE_ID>...
    // Or: https://maps.google.com/?cid=<CID>
    let placeId: string | null = null;
    
    try {
      const url = new URL(googleMapsUrl);
      
      // Try to extract place_id from data parameter
      const dataParam = url.searchParams.get('data');
      if (dataParam) {
        const placeIdMatch = dataParam.match(/!1s([A-Za-z0-9_-]+)/);
        if (placeIdMatch) {
          placeId = placeIdMatch[1];
        }
      }
      
      // Try to extract from path (some URLs have place_id in path)
      if (!placeId) {
        const pathMatch = url.pathname.match(/place_id:([A-Za-z0-9_-]+)/);
        if (pathMatch) {
          placeId = pathMatch[1];
        }
      }
      
      // If we couldn't extract place_id, try using the business name from the URL
      if (!placeId) {
        const pathParts = url.pathname.split('/');
        const placeIndex = pathParts.indexOf('place');
        if (placeIndex !== -1 && pathParts[placeIndex + 1]) {
          // Use the business name as keyword for search
          const businessName = decodeURIComponent(pathParts[placeIndex + 1].replace(/\+/g, ' '));
          logger.debug(`[DataForSEO] Could not extract place_id, searching by name: "${businessName}"`);
          
          // Search for the business by name
          const results = await this.searchGoogleMyBusiness(businessName, 2840, 'en', 5);
          
          // Return the first result that matches the URL or has similar name
          for (const result of results) {
            if (result.url === googleMapsUrl || result.title.toLowerCase().includes(businessName.toLowerCase())) {
              logger.debug(`[DataForSEO] Found business by name: ${result.title}`);
              return result;
            }
          }
          
          // If we found results but no exact match, return the first one
          if (results.length > 0) {
            logger.debug(`[DataForSEO] No exact match, returning first result: ${results[0].title}`);
            return results[0];
          }
        }
      }
      
      if (!placeId) {
        logger.warn(`[DataForSEO] Could not extract place_id or business name from URL: ${googleMapsUrl}`);
        return null;
      }
      
      // Fetch business by place_id
      const data = await this.request<any>('/business_data/google/my_business_info/live', [
        {
          place_id: placeId,
          language_code: 'en',
        }
      ]);
      
      if (data.tasks?.[0]?.result?.[0]?.items?.[0]) {
        const biz = data.tasks[0].result[0].items[0];
        const result: GMBResult = {
          title: biz.title || '',
          category: biz.category || '',
          address: biz.address || '',
          phone: biz.phone || '',
          url: biz.url || googleMapsUrl,
          rating: biz.rating ? {
            value: biz.rating.value || 0,
            votes_count: biz.rating.votes_count || 0,
          } : null,
          latitude: biz.latitude || 0,
          longitude: biz.longitude || 0,
          place_id: biz.place_id || placeId,
          is_claimed: biz.is_claimed || false,
        };
        
        logger.debug(`[DataForSEO] Found business: ${result.title}`);
        return result;
      }
      
      logger.warn(`[DataForSEO] Business not found for place_id: ${placeId}`);
      return null;
      
    } catch (error: any) {
      console.error(`[DataForSEO] Error fetching business by URL:`, error.message);
      return null;
    }
  }

  /**
   * Get a single business profile by place_id or cid (for competitor profile: hours, attributes, posts).
   * Endpoint: /business_data/google/my_business_info/live
   */
  async getBusinessDataByPlaceIdOrCid(
    identifier: string,
    options: { byCid?: boolean } = {}
  ): Promise<BusinessProfileResult | null> {
    const { byCid = false } = options;
    logger.debug(`[DataForSEO] Fetching business by ${byCid ? 'cid' : 'place_id'}`);

    const payload: any = {
      language_code: 'en',
    };
    if (byCid) {
      payload.cid = identifier;
    } else {
      payload.place_id = identifier;
    }

    const data = await this.request<any>('/business_data/google/my_business_info/live', [payload]);

    if (!data.tasks?.[0]?.result?.[0]?.items?.[0]) {
      logger.debug(`[DataForSEO] No business found for ${byCid ? 'cid' : 'place_id'}: ${identifier}`);
      return null;
    }

    const biz = data.tasks[0].result[0].items[0];
    const result: BusinessProfileResult = {
      title: biz.title || '',
      category: biz.category || '',
      address: biz.address || '',
      phone: biz.phone || '',
      url: biz.url || '',
      rating: biz.rating ? {
        value: biz.rating.value || 0,
        votes_count: biz.rating.votes_count || 0,
      } : null,
      latitude: biz.latitude || 0,
      longitude: biz.longitude || 0,
      place_id: biz.place_id || (byCid ? '' : identifier),
      is_claimed: biz.is_claimed || false,
      cid: biz.cid ?? (byCid ? identifier : undefined),
      hours: biz.hours,
      attributes: biz.attributes,
      posts: biz.posts ?? biz.google_posts,
    };

    logger.debug(`[DataForSEO] Found business: ${result.title}`);
    return result;
  }

  /**
   * Get Google SERP results with local pack data
   * Endpoint: /serp/google/organic/live/advanced
   */
  async serpLocalPack(
    keyword: string,
    locationCode: number = 2840,
    languageCode: string = 'en'
  ): Promise<{ organic: SERPOrganicResult[]; localPack: LocalPackResult[] }> {
    logger.debug(`[DataForSEO] SERP local pack for "${keyword}" (location: ${locationCode})`);

    const data = await this.request<any>('/serp/google/organic/live/advanced', [
      {
        keyword,
        location_code: locationCode,
        language_code: languageCode,
        device: 'desktop',
        os: 'windows',
      }
    ]);

    const organic: SERPOrganicResult[] = [];
    const localPack: LocalPackResult[] = [];

    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        if (item.type === 'organic') {
          organic.push({
            type: item.type,
            rank_group: item.rank_group,
            rank_absolute: item.rank_absolute,
            domain: item.domain,
            title: item.title,
            url: item.url,
            description: item.description || '',
            breadcrumb: item.breadcrumb || '',
          });
        }
        if (item.type === 'local_pack') {
          for (const localItem of (item.items || [])) {
            localPack.push({
              title: localItem.title || '',
              domain: localItem.domain || '',
              url: localItem.url || '',
              rating: localItem.rating ? {
                value: localItem.rating.value || 0,
                votes_count: localItem.rating.votes_count || 0,
              } : null,
              phone: localItem.phone || '',
              address: localItem.address || '',
            });
          }
        }
      }
    }

    logger.debug(`[DataForSEO] SERP returned ${organic.length} organic + ${localPack.length} local pack results`);
    return { organic, localPack };
  }

  // ─── Phase 2: SEO & Keyword Research (legacy) ───────────────

  /**
   * Find SERP competitors for a keyword (legacy method)
   * Endpoint: /dataforseo_labs/google/competitors_domain/live
   */
  async serpCompetitors(
    keyword: string,
    locationCode: number = 2840,
    languageCode: string = 'en',
    limit: number = 10
  ): Promise<SERPCompetitor[]> {
    logger.debug(`[DataForSEO] Finding SERP competitors for "${keyword}"`);

    const data = await this.request<any>('/dataforseo_labs/google/competitors_domain/live', [
      {
        keyword,
        location_code: locationCode,
        language_code: languageCode,
        limit,
      }
    ]);

    const results: SERPCompetitor[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          domain: item.domain || '',
          avg_position: item.avg_position || 0,
          intersections: item.intersections || 0,
          full_domain_metrics: item.metrics || null,
        });
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} SERP competitors`);
    return results;
  }

  /**
   * Get keywords that a specific domain ranks for
   * Endpoint: /dataforseo_labs/google/ranked_keywords/live
   */
  async rankedKeywords(
    domain: string,
    locationCode: number = 2840,
    languageCode: string = 'en',
    limit: number = 100
  ): Promise<RankedKeyword[]> {
    logger.debug(`[DataForSEO] Getting ranked keywords for "${domain}"`);

    const data = await this.request<any>('/dataforseo_labs/google/ranked_keywords/live', [
      {
        target: domain,
        location_code: locationCode,
        language_code: languageCode,
        limit,
        order_by: ['keyword_data.keyword_info.search_volume,desc'],
      }
    ]);

    const results: RankedKeyword[] = [];
    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        const kd = item.keyword_data;
        if (kd) {
          results.push({
            keyword: kd.keyword || '',
            search_volume: kd.keyword_info?.search_volume || 0,
            keyword_difficulty: kd.keyword_info?.keyword_difficulty || 0,
            cpc: kd.keyword_info?.cpc || 0,
            competition: kd.keyword_info?.competition || 0,
            rank_group: item.rank_group || 0,
            url: item.url || '',
            search_intent: kd.search_intent_info?.main_intent || 'unknown',
          });
        }
      }
    }

    logger.debug(`[DataForSEO] Found ${results.length} ranked keywords for ${domain}`);
    return results;
  }

  /**
   * Get keyword suggestions based on a seed keyword
   * Endpoint: /dataforseo_labs/google/keyword_suggestions/live
   */
  async keywordSuggestions(
    keyword: string,
    locationCode: number = 2840,
    languageCode: string = 'en',
    limit: number = 150
  ): Promise<KeywordData[]> {
    logger.debug(`[DataForSEO] Getting keyword suggestions for "${keyword}"`);

    const data = await this.requestWithRetry<any>('/dataforseo_labs/google/keyword_suggestions/live', [
      {
        keyword,
        location_code: locationCode,
        language_code: languageCode,
        limit,
        order_by: ['keyword_info.search_volume,desc'],
      }
    ]);

    this.logResponseShape('keyword_suggestions', data);
    return this.parseKeywordResults(data);
  }

  /**
   * Get keyword ideas based on seed keywords (category-based matching).
   * Takes up to 200 keywords and finds terms in the same product/service categories.
   * Endpoint: POST /v3/dataforseo_labs/google/keyword_ideas/live
   */
  async keywordIdeas(
    keywords: string[],
    locationCode: number = 2840,
    languageCode: string = 'en',
    limit: number = 700
  ): Promise<KeywordData[]> {
    if (keywords.length === 0) return [];

    logger.debug(`[DataForSEO] Getting keyword ideas for ${keywords.length} seed keywords`);

    const data = await this.requestWithRetry<any>('/dataforseo_labs/google/keyword_ideas/live', [
      {
        keywords: keywords.slice(0, 200),
        location_code: locationCode,
        language_code: languageCode,
        limit,
        order_by: ['keyword_info.search_volume,desc'],
      }
    ]);

    this.logResponseShape('keyword_ideas', data);
    return this.parseKeywordResults(data);
  }

  /**
   * Get detailed keyword data for a list of keywords
   * Endpoint: /dataforseo_labs/google/bulk_keyword_difficulty/live
   */
  async keywordOverview(
    keywords: string[],
    locationCode: number = 2840,
    languageCode: string = 'en'
  ): Promise<KeywordData[]> {
    if (keywords.length === 0) return [];

    // Batch in groups of 1000 (API limit)
    const batches: string[][] = [];
    for (let i = 0; i < keywords.length; i += 1000) {
      batches.push(keywords.slice(i, i + 1000));
    }

    const allResults: KeywordData[] = [];

    for (const batch of batches) {
      logger.debug(`[DataForSEO] Getting keyword overview for ${batch.length} keywords`);

      const data = await this.request<any>('/dataforseo_labs/google/bulk_keyword_difficulty/live', [
        {
          keywords: batch,
          location_code: locationCode,
          language_code: languageCode,
        }
      ]);

      if (data.tasks?.[0]?.result) {
        for (const item of data.tasks[0].result) {
          if (item.items) {
            for (const kw of item.items) {
              allResults.push({
                keyword: kw.keyword || '',
                search_volume: kw.search_volume || 0,
                keyword_difficulty: kw.keyword_difficulty || 0,
                cpc: kw.cpc || 0,
                competition: kw.competition || 0,
                competition_level: kw.competition_level || null,
                search_intent: kw.search_intent?.main_intent || 'unknown',
                foreign_intents: [],
                monthly_searches: kw.monthly_searches || [],
                search_volume_trend: computeTrendFromMonthly(kw.monthly_searches),
                low_top_of_page_bid: kw.low_top_of_page_bid || 0,
                high_top_of_page_bid: kw.high_top_of_page_bid || 0,
                categories: kw.categories || [],
                core_keyword: null,
                last_updated_time: null,
              });
            }
          }
        }
      }
    }

    logger.debug(`[DataForSEO] Keyword overview returned ${allResults.length} results`);
    return allResults;
  }

  // ─── Phase 3: On-Page SEO Audit ──────────────────────────────

  /**
   * Create an on-page audit task
   * Endpoint: /on_page/task_post
   */
  async onPageTaskPost(
    url: string,
    maxCrawlPages: number = 10,
    enableJavascript: boolean = false,
    loadResources: boolean = false
  ): Promise<string> {
    logger.debug(`[DataForSEO] Creating on-page audit for "${url}"`);

    const data = await this.request<any>('/on_page/task_post', [
      {
        target: url,
        max_crawl_pages: maxCrawlPages,
        enable_javascript: enableJavascript,
        load_resources: loadResources,
        enable_browser_rendering: enableJavascript,
      }
    ]);

    const taskId = data.tasks?.[0]?.id;
    if (!taskId) {
      throw new DataForSEOError('Failed to create on-page audit task - no task ID returned', 500);
    }

    logger.debug(`[DataForSEO] On-page task created: ${taskId}`);
    return taskId;
  }

  /**
   * Get on-page audit results (with polling)
   * Endpoint: /on_page/summary/{task_id}
   */
  async onPageResults(
    taskId: string,
    maxWaitMs: number = 120000, // 2 minutes max wait
    pollIntervalMs: number = 5000 // Check every 5 seconds
  ): Promise<OnPageResult | null> {
    logger.debug(`[DataForSEO] Polling on-page results for task ${taskId}`);

    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const data = await this.request<any>(`/on_page/summary/${taskId}`);

      if (data.tasks?.[0]?.result?.[0]) {
        const result = data.tasks[0].result[0];
        
        if (result.crawl_progress === 'finished' || result.crawl_progress === 'in_progress') {
          // Get detailed page data
          const pagesData = await this.request<any>('/on_page/pages', [
            {
              id: taskId,
              limit: 10,
              order_by: ['meta.internal_links_count,desc'],
            }
          ]);

          const pages: OnPageResult['pages'] = [];
          if (pagesData.tasks?.[0]?.result?.[0]?.items) {
            for (const page of pagesData.tasks[0].result[0].items) {
              pages.push({
                url: page.url || '',
                status_code: page.status_code || 0,
                meta: {
                  title: page.meta?.title || '',
                  description: page.meta?.description || '',
                  h1: page.meta?.htags?.h1 || [],
                  h2: page.meta?.htags?.h2 || [],
                  h3: page.meta?.htags?.h3 || [],
                  canonical: page.meta?.canonical || '',
                },
                page_timing: {
                  time_to_interactive: page.page_timing?.time_to_interactive || 0,
                  dom_complete: page.page_timing?.dom_complete || 0,
                  largest_contentful_paint: page.page_timing?.largest_contentful_paint || 0,
                  first_input_delay: page.page_timing?.first_input_delay || 0,
                  cumulative_layout_shift: page.page_timing?.cumulative_layout_shift || 0,
                },
                onpage_score: page.onpage_score || 0,
                total_dom_size: page.total_dom_size || 0,
                content: {
                  plain_text_size: page.content?.plain_text_size || 0,
                  plain_text_rate: page.content?.plain_text_rate || 0,
                  plain_text_word_count: page.content?.plain_text_word_count || 0,
                },
                links: {
                  internal: page.internal_links_count || 0,
                  external: page.external_links_count || 0,
                  broken: page.broken_links || 0,
                },
                images: {
                  total: page.images_count || 0,
                  without_alt: page.images_without_alt_count || 0,
                  without_src: page.images_without_src_count || 0,
                },
                checks: page.checks || {},
              });
            }
          }

          logger.debug(`[DataForSEO] On-page audit complete: ${pages.length} pages analyzed`);
          return {
            crawl_progress: result.crawl_progress,
            crawl_status: result.crawl_status,
            pages_count: result.pages_count || 0,
            pages,
          };
        }
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    logger.warn(`[DataForSEO] On-page audit timed out after ${maxWaitMs}ms`);
    return null;
  }

  // ─── Validation ──────────────────────────────────────────────

  /**
   * Validate credentials by checking user account data
   * Endpoint: /appendix/user_data
   */
  async validateCredentials(): Promise<{ valid: boolean; balance: number; error?: string }> {
    try {
      const data = await this.request<any>('/appendix/user_data');
      
      if (data.tasks?.[0]?.result?.[0]) {
        const userData = data.tasks[0].result[0];
        return {
          valid: true,
          balance: userData.money?.balance || 0,
        };
      }

      return { valid: true, balance: 0 };
    } catch (error: any) {
      if (error instanceof DataForSEOAuthError) {
        return { valid: false, balance: 0, error: 'Invalid DataForSEO credentials' };
      }
      return { valid: false, balance: 0, error: error.message };
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────

  private logResponseShape(apiName: string, data: any): void {
    try {
      const task = data.tasks?.[0];
      const resultBlocks = task?.result || [];
      const blockSummaries = resultBlocks.map((b: any, i: number) => ({
        index: i,
        hasItems: !!b?.items,
        itemsCount: b?.items_count ?? b?.items?.length ?? 0,
        totalCount: b?.total_count ?? 'n/a',
        seType: b?.se_type ?? 'n/a',
      }));
      logger.debug(`[DataForSEO] ${apiName} response: status=${task?.status_code}, result_blocks=${resultBlocks.length}, blocks=${JSON.stringify(blockSummaries)}`);
    } catch {
      logger.debug(`[DataForSEO] ${apiName} response: unable to inspect shape`);
    }
  }

  private parseKeywordResults(data: any): KeywordData[] {
    const results: KeywordData[] = [];
    const taskResult = data.tasks?.[0];
    const resultBlocks: any[] = taskResult?.result || [];

    if (resultBlocks.length === 0) {
      logger.warn(`[DataForSEO] parseKeywordResults: no result blocks in response (status_code=${taskResult?.status_code}, status_message=${taskResult?.status_message})`);
      return results;
    }

    for (const block of resultBlocks) {
      if (!block?.items || !Array.isArray(block.items)) continue;

      logger.debug(`[DataForSEO] parseKeywordResults: found block with ${block.items_count ?? block.items.length} items (total_count=${block.total_count ?? 'n/a'})`);

      for (const rawItem of block.items) {
        // Related Keywords API wraps each item in keyword_data; Suggestions/Ideas do not
        const item = rawItem.keyword_data || rawItem;
        const ki = item.keyword_info || {};
        const kp = item.keyword_properties || {};
        const si = item.search_intent_info || rawItem.search_intent_info || {};

        results.push({
          keyword: item.keyword || '',
          search_volume: ki.search_volume || 0,
          keyword_difficulty: kp.keyword_difficulty || 0,
          cpc: ki.cpc || 0,
          competition: ki.competition || 0,
          competition_level: ki.competition_level || null,
          search_intent: si.main_intent || 'unknown',
          foreign_intents: si.foreign_intent || [],
          monthly_searches: ki.monthly_searches || [],
          search_volume_trend: ki.search_volume_trend || null,
          low_top_of_page_bid: ki.low_top_of_page_bid || 0,
          high_top_of_page_bid: ki.high_top_of_page_bid || 0,
          categories: ki.categories || [],
          core_keyword: kp.core_keyword || null,
          last_updated_time: ki.last_updated_time || null,
        });
      }
    }

    logger.debug(`[DataForSEO] Parsed ${results.length} keyword results from ${resultBlocks.length} result block(s)`);
    return results;
  }

  // ─── New Paid / Traffic Methods ──────────────────────────────────

  /**
   * Get keyword suggestions from Google Ads based on seed keywords.
   * Endpoint: POST /v3/keywords_data/google_ads/keywords_for_keywords/live
   * Max 20 seed keywords per request, returns up to 20K suggestions.
   * Rate limited under google_ads category (12 req/min).
   */
  async keywordsForKeywords(
    keywords: string[],
    locationCode: number = 2840,
    languageCode: string = 'en'
  ): Promise<KeywordData[]> {
    if (keywords.length === 0) return [];
    const seeds = keywords.slice(0, 20);

    logger.debug(`[DataForSEO] Getting Google Ads keywords_for_keywords for ${seeds.length} seeds`);

    const data = await this.requestWithRetry<any>('/keywords_data/google_ads/keywords_for_keywords/live', [
      {
        keywords: seeds,
        location_code: locationCode,
        language_code: languageCode,
        sort_by: 'search_volume',
      }
    ]);

    const allResults: KeywordData[] = [];
    if (data.tasks?.[0]?.result) {
      for (const item of data.tasks[0].result) {
        allResults.push({
          keyword: item.keyword || '',
          search_volume: item.search_volume || 0,
          keyword_difficulty: 0,
          cpc: item.cpc || 0,
          competition: item.competition || 0,
          competition_level: item.competition_level || null,
          search_intent: 'unknown',
          foreign_intents: [],
          monthly_searches: item.monthly_searches || [],
          search_volume_trend: computeTrendFromMonthly(item.monthly_searches),
          low_top_of_page_bid: item.low_top_of_page_bid || 0,
          high_top_of_page_bid: item.high_top_of_page_bid || 0,
          categories: item.categories || [],
          core_keyword: null,
          last_updated_time: null,
        });
      }
    }

    logger.debug(`[DataForSEO] keywords_for_keywords returned ${allResults.length} results`);
    return allResults;
  }

  /**
   * Get ad traffic projections for keywords from Google Ads.
   * Endpoint: POST /v3/keywords_data/google_ads/ad_traffic_by_keywords/live
   * Max 1000 keywords per request. Returns impressions, CTR, CPC, cost, clicks.
   * Rate limited under google_ads category (12 req/min).
   */
  async adTrafficByKeywords(
    keywords: string[],
    locationCode: number = 2840,
    languageCode: string = 'en',
    bid: number = 999,
    match: string = 'exact'
  ): Promise<Array<{
    keyword: string | null;
    impressions: number;
    ctr: number;
    average_cpc: number;
    cost: number;
    clicks: number;
    match: string;
    bid: number;
  }>> {
    if (keywords.length === 0) return [];

    const batchSize = 1000;
    const batches: string[][] = [];
    for (let i = 0; i < keywords.length; i += batchSize) {
      batches.push(keywords.slice(i, i + batchSize));
    }

    const allResults: Array<{
      keyword: string | null;
      impressions: number;
      ctr: number;
      average_cpc: number;
      cost: number;
      clicks: number;
      match: string;
      bid: number;
    }> = [];

    for (const batch of batches) {
      logger.debug(`[DataForSEO] Getting ad_traffic_by_keywords for ${batch.length} keywords`);

      const data = await this.requestWithRetry<any>('/keywords_data/google_ads/ad_traffic_by_keywords/live', [
        {
          keywords: batch,
          location_code: locationCode,
          language_code: languageCode,
          bid,
          match,
          date_interval: 'next_month',
        }
      ]);

      if (data.tasks?.[0]?.result) {
        for (const item of data.tasks[0].result) {
          allResults.push({
            keyword: item.keyword || null,
            impressions: item.impressions || 0,
            ctr: item.ctr || 0,
            average_cpc: item.average_cpc || 0,
            cost: item.cost || 0,
            clicks: item.clicks || 0,
            match: item.match || match,
            bid: item.bid || bid,
          });
        }
      }
    }

    logger.debug(`[DataForSEO] ad_traffic_by_keywords returned ${allResults.length} results`);
    return allResults;
  }

  /**
   * Get keywords that Google Ads recommends for ad targeting on a domain.
   * Endpoint: POST /v3/keywords_data/google_ads/keywords_for_site/live
   * Different from Labs keywordsForSite — this returns ad-targeting suggestions.
   * Rate limited under google_ads category (12 req/min).
   */
  async googleAdsKeywordsForSite(
    domain: string,
    locationCode: number = 2840,
    languageCode: string = 'en'
  ): Promise<KeywordData[]> {
    logger.debug(`[DataForSEO] Getting Google Ads keywords_for_site for "${domain}"`);

    const data = await this.requestWithRetry<any>('/keywords_data/google_ads/keywords_for_site/live', [
      {
        target: domain,
        location_code: locationCode,
        language_code: languageCode,
      }
    ]);

    const allResults: KeywordData[] = [];
    if (data.tasks?.[0]?.result) {
      for (const item of data.tasks[0].result) {
        allResults.push({
          keyword: item.keyword || '',
          search_volume: item.search_volume || 0,
          keyword_difficulty: 0,
          cpc: item.cpc || 0,
          competition: item.competition || 0,
          competition_level: item.competition_level || null,
          search_intent: 'unknown',
          foreign_intents: [],
          monthly_searches: item.monthly_searches || [],
          search_volume_trend: computeTrendFromMonthly(item.monthly_searches),
          low_top_of_page_bid: item.low_top_of_page_bid || 0,
          high_top_of_page_bid: item.high_top_of_page_bid || 0,
          categories: item.categories || [],
          core_keyword: null,
          last_updated_time: null,
        });
      }
    }

    logger.debug(`[DataForSEO] Google Ads keywords_for_site returned ${allResults.length} results`);
    return allResults;
  }

  /**
   * Get estimated monthly organic traffic for a list of domains.
   * Endpoint: POST /v3/dataforseo_labs/google/bulk_traffic_estimation/live
   * Max 1000 domains per request.
   * Rate limited under labs category (2000 req/min).
   */
  async bulkTrafficEstimation(
    domains: string[],
    locationCode: number = 2840,
    languageCode: string = 'en'
  ): Promise<Array<{
    target: string;
    organic_etv: number;
    organic_count: number;
    organic_is_new: number;
  }>> {
    if (domains.length === 0) return [];

    logger.debug(`[DataForSEO] Getting bulk_traffic_estimation for ${domains.length} domains`);

    const data = await this.requestWithRetry<any>('/dataforseo_labs/google/bulk_traffic_estimation/live', [
      {
        targets: domains.slice(0, 1000),
        location_code: locationCode,
        language_code: languageCode,
      }
    ]);

    const results: Array<{
      target: string;
      organic_etv: number;
      organic_count: number;
      organic_is_new: number;
    }> = [];

    if (data.tasks?.[0]?.result?.[0]?.items) {
      for (const item of data.tasks[0].result[0].items) {
        results.push({
          target: item.target || '',
          organic_etv: item.metrics?.organic?.etv || 0,
          organic_count: item.metrics?.organic?.count || 0,
          organic_is_new: item.metrics?.organic?.is_new || 0,
        });
      }
    }

    logger.debug(`[DataForSEO] bulk_traffic_estimation returned ${results.length} results`);
    return results;
  }
}

// ─── Config Loader ────────────────────────────────────────────────

import { supabase } from './supabase';

const configCache = new Map<string, any>();
const cacheTimestamps = new Map<string, number>();
const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes

const DEFAULT_CONFIGS: Record<string, DataForSEOConfig> = {
  phase1: {
    location_code: 2840,
    language_code: 'en',
    gmb_search_depth: 20,
    local_pack_keywords: 3,
    enabled: true,
  },
  phase2: {
    location_code: 2840,
    language_code: 'en',
    max_serp_competitors: 5,
    max_ranked_keywords_per_competitor: 100,
    keyword_suggestion_limit: 50,
    keyword_enrichment_batch_size: 100,
    enabled: true,
  },
  phase3: {
    location_code: 2840,
    language_code: 'en',
    max_urls_to_audit: 3,
    enable_javascript_rendering: false,
    max_crawl_pages: 10,
    load_resources: false,
    enabled: true,
  },
};

/**
 * Load DataForSEO configuration for a phase from admin_config
 */
export async function loadDataForSEOConfig(phase: number): Promise<DataForSEOConfig> {
  const configKey = `phase${phase}_dataforseo_params`;

  // Check cache
  const cached = configCache.get(configKey);
  const cacheTime = cacheTimestamps.get(configKey);
  if (cached && cacheTime && (Date.now() - cacheTime < CACHE_EXPIRY)) {
    return cached;
  }

  try {
    const { data, error } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', configKey)
      .single();

    if (!error && data?.config_value) {
      const config = typeof data.config_value === 'object'
        ? data.config_value
        : JSON.parse(data.config_value);

      configCache.set(configKey, config);
      cacheTimestamps.set(configKey, Date.now());

      logger.debug(`[DataForSEO Config] Loaded config for phase ${phase} from database`);
      return config;
    }
  } catch (err) {
    logger.warn(`[DataForSEO Config] Failed to load config for phase ${phase}:`, err);
  }

  // Fallback to defaults
  const fallback = DEFAULT_CONFIGS[`phase${phase}`] || DEFAULT_CONFIGS.phase1;
  configCache.set(configKey, fallback);
  cacheTimestamps.set(configKey, Date.now());

  logger.debug(`[DataForSEO Config] Using default config for phase ${phase}`);
  return fallback;
}

/**
 * Clear DataForSEO config cache
 */
export function clearDataForSEOConfigCache(): void {
  configCache.clear();
  cacheTimestamps.clear();
}
