/**
 * App-side types for SEO audit data (UnifiedAuditData from worker seo-data-compiler).
 * All top-level sections are optional to support partial/legacy payloads.
 */

// ─── Structured SERP Sub-types ───────────────────────────────────

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

// ─── Organic Keyword Analysis ────────────────────────────────────

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

// ─── Paid Keyword Analysis ───────────────────────────────────────

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
  /** Per-city metrics when multiple service area cities are analyzed. */
  location_metrics?: Record<string, { search_volume: number; cpc: number; competition: number }>;
}

export interface PaidKeywordAnalysis {
  keywords: PaidKeywordEntry[];
  estimated_monthly_spend: number;
  estimated_monthly_clicks: number;
  avg_cpc: number;
  top_opportunities: Array<{ keyword: string; volume: number; cpc: number; competition: string }>;
}

// ─── Competitor Technical Analysis ────────────────────────────────

export interface CompetitorTechnicalEntry {
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
    desktop: {
      performance: number;
      accessibility: number;
      best_practices: number;
      seo: number;
      core_web_vitals?: {
        lcp: number;
        fid: number;
        cls: number;
        fcp: number;
        si: number;
        tbt: number;
        tti: number;
      };
    } | null;
    mobile: {
      performance: number;
      accessibility: number;
      best_practices: number;
      seo: number;
      core_web_vitals?: {
        lcp: number;
        fid: number;
        cls: number;
        fcp: number;
        si: number;
        tbt: number;
        tti: number;
      };
    } | null;
  };
  crawl_summary?: {
    pages_crawled: number;
    pages_with_issues: number;
    avg_onpage_score: number;
  } | null;
  schema_markup?: {
    existing_schemas: string[];
  } | null;
  issues_count?: {
    critical: number;
    warnings: number;
    notices: number;
  } | null;
  link_analysis?: {
    internal_links: number;
    external_links: number;
    broken_links_count: number;
  } | null;
  image_audit?: {
    total_images: number;
    missing_alt: number;
    oversized: number;
  } | null;
  domain_info?: {
    cms: string | null;
    ssl: boolean;
    has_sitemap: boolean;
    has_robots_txt: boolean;
    is_https_redirect: boolean;
    canonicalization: boolean;
  } | null;
  non_indexable?: {
    total: number;
    by_reason: Record<string, number>;
  } | null;
  duplicate_tags?: {
    titles_count: number;
    descriptions_count: number;
  } | null;
  redirect_chains?: {
    total: number;
  } | null;
  keyword_density?: {
    top_terms: Array<{ keyword: string; frequency: number; density: number }>;
  } | null;
  content_structure?: {
    heading_count: number;
    main_topic: string | null;
    has_contact_info: boolean;
  } | null;
  resource_audit?: {
    scripts: { total: number; total_size: number };
    stylesheets: { total: number; total_size: number };
    broken_count: number;
  } | null;
}

// ─── Main UnifiedAuditData ───────────────────────────────────────

export interface UnifiedAuditData {
  meta?: {
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
  business_profile?: {
    name: string;
    category: string;
    subcategories: string[];
    address: string;
    phone: string;
    website: string;
    hours: unknown;
    attributes: string[];
    photos_count: number;
    is_claimed: boolean;
    gbp_completeness_score: number;
    gbp_completeness_gaps: string[];
  };
  domain_intelligence?: {
    organic_traffic: number;
    paid_traffic: number;
    organic_keywords_count: number;
    backlinks_count: number;
    referring_domains_count: number;
    domain_rank: number;
    lighthouse: {
      desktop: { performance: number; accessibility: number; best_practices: number; seo: number; core_web_vitals: unknown } | null;
      mobile: { performance: number; accessibility: number; best_practices: number; seo: number; core_web_vitals: unknown } | null;
    };
  };
  reviews?: {
    total_count: number;
    average_rating: number;
    rating_distribution: Record<string, number>;
    recent_reviews: unknown[];
    sentiment_summary: { positive_themes: string[]; negative_themes: string[]; neutral_themes: string[] };
    review_velocity: { last_30_days: number; last_90_days: number };
    competitor_comparison: {
      avg_competitor_rating: number;
      avg_competitor_review_count: number;
      rating_gap: number;
      review_count_gap: number;
    };
  };
  questions_and_answers?: unknown[];
  keyword_universe?: {
    total_keywords: number;
    keywords: Array<{
      keyword: string;
      search_volume: number;
      keyword_difficulty: number;
      cpc: number;
      competition: number;
      competition_level?: string | null;
      search_intent: string;
      foreign_intents?: string[];
      monthly_trends: unknown[];
      search_volume_trend?: { monthly: number; quarterly: number; yearly: number } | null;
      low_top_of_page_bid?: number;
      high_top_of_page_bid?: number;
      categories?: number[];
      core_keyword?: string | null;
      priority_score: number;
      source: string;
      current_rank: number | null;
      target_page: string | null;
      content_flag?: 'service_page' | 'faq_service_page' | 'blog_content_only' | null;
      location_metrics?: Record<string, { search_volume: number; cpc: number; competition: number }>;
    }>;
    intent_distribution: Record<string, number>;
    by_intent?: Record<string, unknown[]>;
    by_difficulty?: { low: unknown[]; medium: unknown[]; high: unknown[] };
    clusters: unknown[];
  };
  /** Organic (SEO) keyword analysis — keywords scored for organic ranking opportunity. */
  organic_keyword_analysis?: OrganicKeywordAnalysis;
  /** Paid (SEM) keyword analysis — keywords scored for ad spend opportunity. */
  paid_keyword_analysis?: PaidKeywordAnalysis;
  competitors?: {
    organic_competitors: Array<{ domain: string; avg_position: number; intersections: number; estimated_monthly_traffic?: number | null; [k: string]: unknown }>;
    serp_competitors: unknown[];
    local_competitors: unknown[];
    backlink_competitors: unknown[];
    competitor_profiles?: Array<{ key: string; business_info: unknown; reviews: unknown[] }>;
  };
  serp_analysis?: {
    /** Structured organic results per keyword with rankings and SERP feature badges. */
    organic_results: SerpOrganicEntry[];
    /** Structured Maps results per keyword with business details. */
    maps_results: SerpMapsEntry[];
    /** Structured Local Finder results per keyword with business details. */
    local_finder_results: SerpLocalFinderEntry[];
    serp_features: {
      local_pack_present: boolean;
      featured_snippets: unknown[];
      people_also_ask: unknown[];
      knowledge_panel: unknown;
    };
    paid_results?: Array<{ keyword: string; title?: string; domain?: string; description?: string; url?: string; rank?: number }>;
    related_searches?: Array<{ keyword: string; items: unknown[] }>;
    people_also_search?: Array<{ keyword: string; title?: string; items: unknown[] }>;
    local_services_ads?: Array<{ keyword: string; [k: string]: unknown }>;
    discussions_and_forums?: Array<{ keyword: string; title?: string; url?: string; domain?: string; [k: string]: unknown }>;
    find_results_on?: Array<{ keyword: string; [k: string]: unknown }>;
    google_posts?: Array<{ keyword: string; [k: string]: unknown }>;
    google_reviews?: Array<{ keyword: string; [k: string]: unknown }>;
    local_pack_dominance?: Array<{
      keyword: string;
      pack: Array<{ rank: number; title?: string; domain?: string; cid?: string; place_id?: string; rating?: { value?: number; votes_count?: number } | null; category?: string }>;
      your_position: number | null;
    }>;
    /** Autocomplete suggestions grouped by seed keyword. */
    autocomplete_suggestions: SerpAutocompleteEntry[];
    /** @deprecated Raw organic results for backward compatibility with legacy payloads. */
    _raw_organic_results?: unknown;
    /** @deprecated Raw maps results for backward compatibility with legacy payloads. */
    _raw_maps_results?: unknown;
    /** @deprecated Raw local finder results for backward compatibility. */
    _raw_local_finder_results?: unknown;
  };
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
      paid_results?: unknown[];
      related_searches?: unknown[];
      people_also_search?: unknown[];
      local_pack_dominance?: unknown[];
    };
  }>;
  technical_audit?: {
    crawl_summary: {
      pages_crawled: number;
      pages_with_issues: number;
      avg_onpage_score: number;
    };
    issues: { critical: unknown[]; warnings: unknown[]; notices: unknown[] };
    duplicate_tags: { titles: unknown[]; descriptions: unknown[] };
    link_analysis: {
      internal_links: number;
      external_links: number;
      broken_links: unknown[];
      redirect_chains: unknown[];
    };
    schema_markup: { existing_schemas: string[]; recommended_schemas: string[] };
    image_audit: { total_images: number; missing_alt: number; oversized: number };
    page_details: unknown[];
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
  competitor_technical_audit?: CompetitorTechnicalEntry[];
  backlinks?: {
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
    top_referring_domains: unknown[];
    anchor_text_distribution: unknown[];
    individual_backlinks: unknown[];
    domain_pages: unknown[];
    referring_networks: unknown[];
    history: unknown[];
    timeseries: unknown[];
    new_lost_timeseries: unknown[];
    link_gap: {
      competitor_only_domains: unknown[];
      page_level_gaps: unknown[];
      shared_domains: unknown[];
      opportunity_score: number;
    };
    competitor_comparison: {
      bulk_ranks: unknown[];
      bulk_backlinks: unknown[];
      bulk_referring_domains: unknown[];
      bulk_new_lost: unknown[];
    };
    spam_analysis: {
      referring_domain_spam_scores: unknown[];
      avg_spam_score: number;
      high_spam_count: number;
      low_spam_count: number;
    };
  };
  tavily_research?: {
    phase1_sources: unknown[];
    phase2_sources: unknown[];
    phase3_sources: unknown[];
    phase1_summary: string;
    phase2_summary: string;
    phase3_summary: string;
  };
  scoring?: {
    keyword_prioritization: { method: string; weights: Record<string, number>; top_50_keywords: unknown[] };
    gbp_completeness: number;
    technical_health: number;
    competitive_position: number;
    overall_seo_readiness: number;
  };
}
