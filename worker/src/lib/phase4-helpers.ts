import { supabase, supabaseWithRetry } from './supabase';
import { decrypt } from './encryption';
import { UnifiedAuditData } from './seo-data-compiler';
import { logger } from './logger';

const PHASE4_TABLE = 'research_session_phase4';

const SET_PHASE4_RETRIES = 3;
const SET_PHASE4_RETRY_DELAY_MS = 2000;

/** True if the error looks like a transient infra issue (Cloudflare 521, HTML error page, or network). */
function isTransientSupabaseError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return (
    msg.includes('<!doctype') ||
    msg.includes('cloudflare') ||
    msg.includes('521') ||
    msg.includes('web server is down') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    error.code === 'ECONNRESET' ||
    error.code === 'ETIMEDOUT'
  );
}

/** Return a short, safe message for logs/users when Supabase returned HTML or transient error. */
function normalizeSupabaseErrorMessage(error: { message?: string } | null): string {
  if (!error?.message) return 'Supabase request failed.';
  const msg = error.message;
  if (msg.includes('<!doctype') || msg.includes('cloudflare') || msg.includes('521')) {
    return 'Supabase unreachable (Cloudflare 521). Please retry the research run.';
  }
  if (msg.length > 200) return msg.slice(0, 200) + '…';
  return msg;
}

// In-memory cache for phase4_synthesis to avoid redundant DB reads.
// Safe because only one worker processes a given session at a time.
const phase4Cache = new Map<string, Record<string, unknown>>();

/** Load phase4_synthesis from in-memory cache, then dedicated table, then legacy fallback. */
export async function getPhase4Synthesis(sessionId: string): Promise<Record<string, unknown>> {
  const cached = phase4Cache.get(sessionId);
  if (cached) return cached;

  const { data, error } = await supabaseWithRetry(
    () => supabase
      .from(PHASE4_TABLE)
      .select('phase4_synthesis')
      .eq('session_id', sessionId)
      .maybeSingle(),
    'getPhase4Synthesis',
  );
  if (!error && data?.phase4_synthesis != null) {
    const result = data.phase4_synthesis as Record<string, unknown>;
    phase4Cache.set(sessionId, result);
    return result;
  }
  const { data: legacy } = await supabase
    .from('research_sessions')
    .select('phase4_synthesis')
    .eq('id', sessionId)
    .single();
  const result = (legacy?.phase4_synthesis as Record<string, unknown>) || {};
  phase4Cache.set(sessionId, result);
  return result;
}

/** Save phase4_synthesis to dedicated table and update in-memory cache. */
export async function setPhase4Synthesis(sessionId: string, phase4_synthesis: Record<string, unknown>): Promise<void> {
  phase4Cache.set(sessionId, phase4_synthesis);

  let lastError: { message?: string; code?: string } | null = null;
  for (let attempt = 1; attempt <= SET_PHASE4_RETRIES; attempt++) {
    const { error } = await supabase
      .from(PHASE4_TABLE)
      .upsert(
        {
          session_id: sessionId,
          phase4_synthesis,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'session_id' }
      );
    if (!error) return;
    lastError = error;
    if (!isTransientSupabaseError(error) || attempt === SET_PHASE4_RETRIES) {
      throw new Error(`Failed to save phase4_synthesis: ${normalizeSupabaseErrorMessage(error)}`);
    }
    const delay = SET_PHASE4_RETRY_DELAY_MS * attempt;
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(`Failed to save phase4_synthesis: ${normalizeSupabaseErrorMessage(lastError)}`);
}

/** Clear the in-memory cache for a session (call after completion or failure). */
export function clearPhase4Cache(sessionId: string): void {
  phase4Cache.delete(sessionId);
}

export async function updatePhase4Status(
  sessionId: string,
  status: string,
  progress: string,
  currentSubphase: string | null
) {
  logger.debug('[updatePhase4Status] Updating status to:', status, 'subphase:', currentSubphase);

  // Only update the lightweight session row (no heavy JSONB read-modify-write).
  const { error: slimError } = await supabase
    .from('research_sessions')
    .update({ current_phase: 4, status: 'in_progress' })
    .eq('id', sessionId);

  if (slimError) {
    logger.error('[updatePhase4Status] Error updating session status:', slimError);
  }

  logger.debug('[updatePhase4Status] ✅ Status updated successfully');
}

const LOAD_SESSION_RETRIES = 2;
const LOAD_SESSION_RETRY_DELAY_MS = 2000;

export async function loadSession(sessionId: string) {
  const SESSION_META_COLS = 'id, user_id, business_name, industry, primary_service, services, location, city, state, zip_code, tier, phone_number, street_address, operating_hours, website_url, google_business_url, service_area_cities, target_audience, search_radius, location_code, location_name, status, current_phase, created_at, project_type, api_costs, business_type';

  let lastError: any;
  for (let attempt = 1; attempt <= LOAD_SESSION_RETRIES; attempt++) {
    const { data: sessionMeta, error } = await supabaseWithRetry(
      () => supabase
        .from('research_sessions')
        .select(SESSION_META_COLS)
        .eq('id', sessionId)
        .single(),
      'Phase4 loadSession',
    );

    if (!error && sessionMeta) {
      const session: any = { ...sessionMeta };

      // Load phase 1-3 data from dedicated table
      const { data: phaseRows } = await supabaseWithRetry(
        () => supabase
          .from('research_session_phase_data')
          .select('phase, raw_data, summary, citations, dataforseo_data')
          .eq('session_id', sessionId),
        'Phase4 load phase data',
      );

      for (const row of (phaseRows || [])) {
        session[`phase${row.phase}_raw`] = row.raw_data;
        session[`phase${row.phase}_summary`] = row.summary;
        session[`phase${row.phase}_citations`] = row.citations;
        session[`phase${row.phase}_dataforseo`] = row.dataforseo_data;
      }

      // Load DataForSEO data from dedicated table
      const { data: dfData } = await supabaseWithRetry(
        () => supabase
          .from('research_session_dataforseo')
          .select('seo_audit_data, wave_results, location_code, location_name')
          .eq('session_id', sessionId)
          .maybeSingle(),
        'Phase4 load DataForSEO data',
      );

      if (dfData) {
        session.seo_audit_data = dfData.seo_audit_data;
        session.dataforseo_tasks = dfData.wave_results;
        if (dfData.location_code) session.location_code = dfData.location_code;
        if (dfData.location_name) session.location_name = dfData.location_name;
      }

      // Load Phase 4 synthesis
      const phase4 = await getPhase4Synthesis(sessionId).catch(() => ({}));
      if (Object.keys(phase4).length > 0) {
        session.phase4_synthesis = phase4;
      }

      return session;
    }

    lastError = error;
    if (error) {
      logger.error(
        `[loadSession] Attempt ${attempt}/${LOAD_SESSION_RETRIES} failed for ${sessionId}:`,
        error.code,
        error.message
      );
    }
    if (attempt < LOAD_SESSION_RETRIES) {
      logger.warn(`[loadSession] Retrying in ${LOAD_SESSION_RETRY_DELAY_MS}ms...`);
      await new Promise((r) => setTimeout(r, LOAD_SESSION_RETRY_DELAY_MS));
    }
  }

  throw new Error(
    lastError?.message?.includes('PGRST116') || lastError?.code === 'PGRST116'
      ? 'Session not found (row missing or inaccessible). If you retried after a long run, the session may no longer exist — please start a new research.'
      : 'Session not found'
  );
}

export async function loadPreviousPhases(session: any) {
  // Use 'searches' field which contains the array of search results grouped by prompt
  const phase1Searches = session.phase1_summary?.searches || [];
  const phase2Searches = session.phase2_summary?.searches || [];
  const phase3Searches = session.phase3_summary?.searches || [];
  
  // Flatten the sources from all searches for each phase
  const phase1Sources = phase1Searches.flatMap((r: any) => r.sources || []);
  const phase2Sources = phase2Searches.flatMap((r: any) => r.sources || []);
  const phase3Sources = phase3Searches.flatMap((r: any) => r.sources || []);
  
  if (!phase1Sources.length || !phase2Sources.length || !phase3Sources.length) {
    throw new Error('Previous phase data not found');
  }

  // Load DataForSEO structured data (optional - enhances synthesis when available)
  const phase1DataForSEO = session.phase1_dataforseo || null;
  const phase2DataForSEO = session.phase2_dataforseo || null;
  const phase3DataForSEO = session.phase3_dataforseo || null;

  const hasDataForSEO = !!(phase1DataForSEO || phase2DataForSEO || phase3DataForSEO);
  if (hasDataForSEO) {
    logger.debug('[Phase4-Helpers] DataForSEO data available:', {
      phase1: !!phase1DataForSEO,
      phase2: !!phase2DataForSEO,
      phase3: !!phase3DataForSEO,
    });
  }

  // Load compiled SEO audit data for intermediate/advanced tiers
  const tier = session.tier || 'basic';
  const seoAuditData: UnifiedAuditData | null = (tier !== 'basic' && session.seo_audit_data)
    ? session.seo_audit_data as UnifiedAuditData
    : null;

  if (seoAuditData) {
    logger.debug('[Phase4-Helpers] 📊 Unified SEO audit data loaded for tier:', tier);
    logger.debug('[Phase4-Helpers]   Keywords:', seoAuditData.keyword_universe?.total_keywords || 0);
    logger.debug('[Phase4-Helpers]   Competitors:', seoAuditData.competitors?.organic_competitors?.length || 0);
    logger.debug('[Phase4-Helpers]   SEO Readiness Score:', seoAuditData.scoring?.overall_seo_readiness || 0);
  }

  return { phase1Sources, phase2Sources, phase3Sources, phase1DataForSEO, phase2DataForSEO, phase3DataForSEO, hasDataForSEO, seoAuditData, tier };
}

export async function loadAndDecryptKeys(userId: string, sessionId: string) {
  const { data: keys, error } = await supabaseWithRetry(
    () => supabase
      .from('user_api_keys')
      .select('*')
      .eq('user_id', userId)
      .single(),
    'Phase4 load API keys',
  );

  if (error || !keys) {
    throw new Error('API keys not found');
  }

  return {
    claude: decrypt(keys.claude_api_key_encrypted)
  };
}

export async function loadContextDocuments() {
  const { data: contextDocs } = await supabase
    .from('admin_config')
    .select('config_key, config_value')
    .in('config_key', ['context_conversion_optimization', 'context_seo_principles']);

  const croContextDoc = contextDocs?.find(d => d.config_key === 'context_conversion_optimization')?.config_value as { title?: string; content?: string } | undefined;
  const seoContextDoc = contextDocs?.find(d => d.config_key === 'context_seo_principles')?.config_value as { title?: string; content?: string } | undefined;

  return {
    croContext: croContextDoc?.content || '',
    seoContext: seoContextDoc?.content || ''
  };
}

export function replaceVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  
  // Handle conditional blocks {{#if VAR}}...{{/if}}
  result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, varName, content) => {
    const value = variables[varName];
    // Show content if variable is 'true' or has a meaningful value (not 'false', empty, or 'Not specified')
    if (value === 'true' || (value && value !== 'false' && value !== 'Not specified' && value !== '')) {
      return content;
    }
    return '';
  });
  
  // Replace all variables
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }
  
  return result;
}

export function formatTavilyResults(results: any[]): string {
  if (!Array.isArray(results) || results.length === 0) {
    return 'No data available';
  }
  
  return results.map((r, i) => `
### Source ${i + 1}: ${r.title || 'Untitled'}
URL: ${r.url || 'No URL'}
${r.content || 'No content'}
`).join('\n');
}

/**
 * Format Phase 1 DataForSEO data (local competitive intelligence) for Claude
 */
export function formatPhase1DataForSEO(data: any): string {
  if (!data || data.error) return '';

  const sections: string[] = [];

  // Seed Keyword Info (if available)
  if (data.seed_keyword) {
    sections.push('## Optimized Search Keyword');
    sections.push(`**Original Input:** "${data.seed_keyword.original_input}"`);
    sections.push(`**Optimized Keyword:** "${data.seed_keyword.optimized_keyword}" (${data.seed_keyword.search_volume > 0 ? `${data.seed_keyword.search_volume.toLocaleString()} monthly searches` : 'volume data unavailable'})`);
    sections.push(`**Source:** ${data.seed_keyword.source.replace(/_/g, ' ')}`);
    sections.push('');
    sections.push('_Note: This optimized keyword was selected to maximize competitor discovery and keyword research effectiveness._');
  }

  // Google My Business results
  if (data.gmb_results?.length > 0) {
    sections.push('## Local Competitors from Google Maps');
    for (const biz of data.gmb_results) {
      const rating = biz.rating ? `⭐ ${biz.rating.value}/5 (${biz.rating.votes_count} reviews)` : 'No ratings';
      sections.push(`- **${biz.title}** (${biz.category})\n  Address: ${biz.address}\n  Phone: ${biz.phone}\n  Website: ${biz.url}\n  Rating: ${rating}\n  Claimed: ${biz.is_claimed ? 'Yes' : 'No'}`);
    }
  }

  // SERP Local Pack results
  if (data.serp_results?.length > 0) {
    sections.push('\n## Google Local Pack Rankings');
    for (const serp of data.serp_results) {
      sections.push(`### Search: "${serp.query}"`);
      if (serp.localPack?.length > 0) {
        sections.push('**Local Pack:**');
        for (const lp of serp.localPack) {
          const rating = lp.rating ? `⭐ ${lp.rating.value}/5 (${lp.rating.votes_count} reviews)` : '';
          sections.push(`- ${lp.title} | ${lp.domain} | ${rating}`);
        }
      }
      if (serp.organic?.length > 0) {
        sections.push('**Top Organic Results:**');
        for (const org of serp.organic.slice(0, 5)) {
          sections.push(`- #${org.rank_group} ${org.title} (${org.domain})`);
        }
      }
    }
  }

  // User's Own Business Profile Analysis (if provided)
  if (data.user_business) {
    sections.push('\n## YOUR Business Profile Analysis');
    sections.push(`**Business Name:** ${data.user_business.title}`);
    sections.push(`**Category:** ${data.user_business.category}`);
    sections.push(`**Address:** ${data.user_business.address}`);
    sections.push(`**Phone:** ${data.user_business.phone}`);
    
    if (data.user_business.rating) {
      sections.push(`**Rating:** ⭐ ${data.user_business.rating.value}/5 (${data.user_business.rating.votes_count} reviews)`);
    } else {
      sections.push(`**Rating:** No ratings yet`);
    }
    
    sections.push(`**Claimed Status:** ${data.user_business.is_claimed ? '✅ Claimed' : '❌ Unclaimed - CRITICAL: Claim your profile immediately!'}`);
    
    if (data.competitive_position) {
      sections.push('\n### Competitive Position Analysis');
      
      if (data.competitive_position.rating_vs_avg !== null && data.user_business.rating) {
        const ratingDiff = data.competitive_position.rating_vs_avg;
        const status = ratingDiff > 0 ? '✅ ABOVE' : '⚠️ BELOW';
        sections.push(`- **Rating Gap:** Your ${data.user_business.rating.value}★ rating is ${status} the competitor average (${data.competitive_position.competitor_avg_rating.toFixed(2)}★) by ${Math.abs(ratingDiff).toFixed(2)} stars`);
      }
      
      if (data.competitive_position.review_count_vs_avg !== null && data.user_business.rating) {
        const reviewDiff = data.competitive_position.review_count_vs_avg;
        const status = reviewDiff > 0 ? '✅ MORE' : '⚠️ FEWER';
        sections.push(`- **Review Count Gap:** You have ${status} reviews than average (${Math.abs(Math.round(reviewDiff))} ${reviewDiff > 0 ? 'more' : 'fewer'} than ${Math.round(data.competitive_position.competitor_avg_reviews)} average)`);
      }
      
      const packStatus = data.competitive_position.in_local_pack ? '✅ YES' : '❌ NO';
      sections.push(`- **Local Pack Presence:** ${packStatus} - You ${data.competitive_position.in_local_pack ? 'appear' : 'do NOT appear'} in local pack results for target keywords`);
      
      if (data.competitive_position.local_pack_positions?.length > 0) {
        sections.push('\n**Your Local Pack Rankings:**');
        for (const pos of data.competitive_position.local_pack_positions) {
          sections.push(`  - "${pos.query}": Position #${pos.position} in local pack`);
        }
      } else if (!data.competitive_position.in_local_pack) {
        sections.push('\n**⚠️ CRITICAL ISSUE:** You are not ranking in the local pack for any target keywords. This is a major visibility problem that must be addressed.');
      }
    }
  }

  // Stats
  sections.push(`\n**Summary:** ${data.total_local_competitors || 0} local competitors identified, ${data.total_local_pack_entries || 0} local pack entries across ${data.serp_results?.length || 0} keywords`);

  return sections.length > 0 ? `\n# DataForSEO Local Competitive Intelligence\n${sections.join('\n')}` : '';
}

/**
 * Format Phase 2 DataForSEO data (keyword research) for Claude
 */
export function formatPhase2DataForSEO(data: any): string {
  if (!data || data.error) return '';

  const sections: string[] = [];

  // Seed Keyword Info (if available)
  if (data.seed_keyword) {
    sections.push('## Seed Keyword Used');
    sections.push(`**Keyword:** "${data.seed_keyword.keyword}"`);
    sections.push(`**Source:** ${data.seed_keyword.source.replace(/_/g, ' ')}`);
    sections.push('');
  }

  // SERP Competitors
  if (data.serp_competitors?.length > 0) {
    sections.push('## Top SERP Competitors');
    for (const comp of data.serp_competitors) {
      sections.push(`- **${comp.domain}** - Avg Position: ${comp.avg_position?.toFixed(1)}, Intersections: ${comp.intersections}`);
    }
  }

  // Enriched Keywords (top by volume)
  if (data.enriched_keywords?.length > 0) {
    sections.push('\n## Top Keywords by Search Volume');
    const topByVolume = [...data.enriched_keywords]
      .sort((a: any, b: any) => b.search_volume - a.search_volume)
      .slice(0, 30);
    
    sections.push('| Keyword | Volume | Difficulty | CPC | Intent |');
    sections.push('|---------|--------|-----------|-----|--------|');
    for (const kw of topByVolume) {
      sections.push(`| ${kw.keyword} | ${kw.search_volume} | ${kw.keyword_difficulty}/100 | $${kw.cpc?.toFixed(2)} | ${kw.search_intent} |`);
    }
  }

  // Low-Hanging Fruit
  if (data.low_hanging_fruit?.length > 0) {
    sections.push('\n## Low-Hanging Fruit Keywords (High Volume, Low Difficulty)');
    sections.push('| Keyword | Volume | Difficulty | CPC | Intent |');
    sections.push('|---------|--------|-----------|-----|--------|');
    for (const kw of data.low_hanging_fruit) {
      sections.push(`| ${kw.keyword} | ${kw.search_volume} | ${kw.keyword_difficulty}/100 | $${kw.cpc?.toFixed(2)} | ${kw.search_intent} |`);
    }
  }

  // Stats
  if (data.stats) {
    sections.push(`\n**Summary:** ${data.stats.total_competitors} competitors, ${data.stats.total_unique_keywords} unique keywords, ${data.stats.total_enriched} enriched, ${data.stats.total_low_hanging_fruit} low-hanging fruit opportunities`);
  }

  return sections.length > 0 ? `\n# DataForSEO Keyword & Competitor Intelligence\n${sections.join('\n')}` : '';
}

/**
 * Format Phase 3 DataForSEO data (on-page benchmarks) for Claude
 */
export function formatPhase3DataForSEO(data: any): string {
  if (!data || data.error) return '';

  const sections: string[] = [];

  // On-page audit results
  if (data.audit_results?.length > 0) {
    sections.push('## On-Page SEO Audit of Top Competitors');
    for (const audit of data.audit_results) {
      if (audit.error) {
        sections.push(`\n### ${audit.url}\n⚠️ Audit failed: ${audit.error}`);
        continue;
      }
      sections.push(`\n### ${audit.url}`);
      if (audit.pages?.length > 0) {
        const mainPage = audit.pages[0];
        sections.push(`- **On-Page Score:** ${mainPage.onpage_score}/100`);
        sections.push(`- **Word Count:** ${mainPage.content?.plain_text_word_count || 'N/A'}`);
        sections.push(`- **DOM Size:** ${mainPage.total_dom_size ? (mainPage.total_dom_size / 1024).toFixed(0) + ' KB' : 'N/A'}`);
        sections.push(`- **Internal Links:** ${mainPage.links?.internal || 0}`);
        sections.push(`- **External Links:** ${mainPage.links?.external || 0}`);
        sections.push(`- **Images:** ${mainPage.images?.total || 0} (${mainPage.images?.without_alt || 0} missing alt)`);
        if (mainPage.meta) {
          sections.push(`- **Title:** ${mainPage.meta.title || 'N/A'}`);
          sections.push(`- **Meta Description:** ${mainPage.meta.description || 'N/A'}`);
          sections.push(`- **H1 Tags:** ${mainPage.meta.h1?.join(', ') || 'None'}`);
        }
        if (mainPage.page_timing) {
          sections.push(`- **DOM Complete:** ${mainPage.page_timing.dom_complete}ms`);
          sections.push(`- **LCP:** ${mainPage.page_timing.largest_contentful_paint}ms`);
        }
      }
    }
  }

  // Benchmarks
  if (data.benchmarks) {
    const b = data.benchmarks;
    sections.push('\n## Industry Benchmarks (Averages from Top Competitors)');
    sections.push(`- **Average Word Count:** ${b.avg_word_count}`);
    sections.push(`- **Average On-Page Score:** ${b.avg_onpage_score}/100`);
    sections.push(`- **Average Internal Links:** ${b.avg_internal_links}`);
    sections.push(`- **Average External Links:** ${b.avg_external_links}`);
    sections.push(`- **Average Images:** ${b.avg_images}`);
    sections.push(`- **Average DOM Size:** ${(b.avg_dom_size / 1024).toFixed(0)} KB`);
  }

  // Stats
  if (data.stats) {
    sections.push(`\n**Summary:** ${data.stats.urls_audited} URLs audited, ${data.stats.successful_audits} successful, ${data.stats.total_pages_analyzed} pages analyzed`);
  }

  return sections.length > 0 ? `\n# DataForSEO On-Page Technical Benchmarks\n${sections.join('\n')}` : '';
}

export async function markPhase4Complete(sessionId: string, finalContent: string) {
  const currentPhase4Data = await getPhase4Synthesis(sessionId);
  logger.debug('[markPhase4Complete] Phase4 data before completion:', {
    has_competitive: !!currentPhase4Data.competitive_intelligence,
    has_seo: !!currentPhase4Data.seo_strategy,
    has_cro: !!currentPhase4Data.cro_optimization,
    has_final: !!currentPhase4Data.final_synthesis,
    all_keys: Object.keys(currentPhase4Data)
  });

  const merged = {
    ...currentPhase4Data,
    status: 'complete',
    progress: 'Phase 4 complete!',
    current_subphase: null,
    timestamp: new Date().toISOString(),
  };
  await setPhase4Synthesis(sessionId, merged);
  clearPhase4Cache(sessionId);
  logger.debug('[markPhase4Complete] ✅ Phase 4 marked as complete');
}

// ─── Unified Audit Data Formatters (Intermediate/Advanced Tiers) ─────────────

/**
 * Load the compiled SEO audit data for intermediate/advanced tiers
 */
export async function loadSeoAuditData(sessionId: string): Promise<UnifiedAuditData | null> {
  const { data } = await supabaseWithRetry(
    () => supabase
      .from('research_session_dataforseo')
      .select('seo_audit_data')
      .eq('session_id', sessionId)
      .maybeSingle(),
    'load SEO audit data',
  );
  return data?.seo_audit_data || null;
}

/**
 * Format the FULL audit data into a Claude-consumable summary.
 * Used as input context for intermediate/advanced tier synthesis sub-phases.
 */
export function formatFullAuditForClaude(data: UnifiedAuditData): string {
  const sections: string[] = [];
  sections.push('# Comprehensive SEO Audit Data\n');
  sections.push(formatBusinessProfileForClaude(data));
  sections.push(formatDomainIntelligenceForClaude(data));
  sections.push(formatReviewAnalyticsForClaude(data));
  sections.push(formatKeywordUniverseForClaude(data));
  sections.push(formatCompetitorProfilesForClaude(data));
  sections.push(formatSERPAnalysisForClaude(data));
  sections.push(formatTechnicalAuditForClaude(data));

  if (data.meta.tier === 'advanced' && data.backlinks) {
    sections.push(formatBacklinkProfileForClaude(data));
  }

  sections.push(formatScoringForClaude(data));

  // Include Tavily qualitative research
  if (data.tavily_research) {
    sections.push(formatTavilyResearchForClaude(data));
  }

  return sections.filter(Boolean).join('\n\n');
}

/**
 * Build a trimmed "report" subset of seo_audit_data for AI (sites/reports).
 * Contains only the structured blocks needed for the model to:
 * - Recommend which keywords to target
 * - Recommend what content to write
 * - Recommend how to position vs competitors
 * - Recommend whether to lean on organic, Google Ads, or LSA
 * Use this when passing context to Claude for strategy/recommendation tasks.
 */
export function formatReportForAI(data: UnifiedAuditData): string {
  const sections: string[] = [];
  sections.push('# SEO Audit Report (for AI recommendations)\n');
  sections.push('Use this report to recommend: (1) which keywords to target, (2) what content to write, (3) how to position vs competitors, (4) whether to lean on organic, Google Ads, or LSA.\n');

  sections.push(formatKeywordUniverseForClaude(data));
  sections.push(formatSERPAnalysisForClaude(data));
  sections.push(formatReviewAnalyticsForClaude(data));
  sections.push(formatCompetitorProfilesForClaude(data));

  return sections.filter(Boolean).join('\n\n');
}

export function formatBusinessProfileForClaude(data: UnifiedAuditData): string {
  const bp = data.business_profile;
  const lines = [
    '## Business Profile',
    `- **Name:** ${bp.name}`,
    `- **Category:** ${bp.category}`,
    bp.subcategories?.length ? `- **Subcategories:** ${bp.subcategories.join(', ')}` : '',
    `- **Address:** ${bp.address}`,
    `- **Phone:** ${bp.phone}`,
    `- **Website:** ${bp.website}`,
    `- **Claimed:** ${bp.is_claimed ? '✅ Yes' : '❌ No — CRITICAL: Must claim immediately'}`,
    `- **Photos:** ${bp.photos_count}`,
    `- **GBP Completeness Score:** ${Math.round(bp.gbp_completeness_score * 100)}%`,
  ];
  if (bp.gbp_completeness_gaps?.length) {
    lines.push(`- **GBP Gaps:** ${bp.gbp_completeness_gaps.join(', ')}`);
  }
  return lines.filter(Boolean).join('\n');
}

export function formatDomainIntelligenceForClaude(data: UnifiedAuditData): string {
  const di = data.domain_intelligence;
  const lines = [
    '## Domain Intelligence',
    `- **Organic Traffic:** ${di.organic_traffic.toLocaleString()}/month`,
    `- **Paid Traffic:** ${di.paid_traffic.toLocaleString()}/month`,
    `- **Organic Keywords:** ${di.organic_keywords_count.toLocaleString()}`,
    `- **Backlinks:** ${di.backlinks_count.toLocaleString()}`,
    `- **Referring Domains:** ${di.referring_domains_count.toLocaleString()}`,
    `- **Domain Rank:** ${di.domain_rank}`,
  ];

  if (di.lighthouse?.desktop) {
    const lh = di.lighthouse.desktop;
    lines.push(`\n### Lighthouse Desktop`);
    lines.push(`- Performance: ${lh.performance}, Accessibility: ${lh.accessibility}, Best Practices: ${lh.best_practices}, SEO: ${lh.seo}`);
  }
  if (di.lighthouse?.mobile) {
    const lh = di.lighthouse.mobile;
    lines.push(`### Lighthouse Mobile`);
    lines.push(`- Performance: ${lh.performance}, Accessibility: ${lh.accessibility}, Best Practices: ${lh.best_practices}, SEO: ${lh.seo}`);
  }

  return lines.join('\n');
}

export function formatReviewAnalyticsForClaude(data: UnifiedAuditData): string {
  const rv = data.reviews;
  const lines = [
    '## Review Analytics',
    `- **Total Reviews:** ${rv.total_count}`,
    `- **Average Rating:** ${rv.average_rating}★`,
    `- **Rating Distribution:** 5★:${rv.rating_distribution['5'] || 0}, 4★:${rv.rating_distribution['4'] || 0}, 3★:${rv.rating_distribution['3'] || 0}, 2★:${rv.rating_distribution['2'] || 0}, 1★:${rv.rating_distribution['1'] || 0}`,
    `- **Review Velocity:** ${rv.review_velocity.last_30_days} in last 30 days, ${rv.review_velocity.last_90_days} in last 90 days`,
  ];

  if (rv.competitor_comparison) {
    const cc = rv.competitor_comparison;
    lines.push(`\n### Competitor Comparison`);
    lines.push(`- Avg Competitor Rating: ${cc.avg_competitor_rating}★`);
    lines.push(`- Avg Competitor Review Count: ${cc.avg_competitor_review_count}`);
    lines.push(`- Your Rating Gap: ${cc.rating_gap > 0 ? '+' : ''}${cc.rating_gap}★`);
    lines.push(`- Your Review Count Gap: ${cc.review_count_gap > 0 ? '+' : ''}${cc.review_count_gap}`);
  }

  if (rv.sentiment_summary?.positive_themes?.length) {
    lines.push(`- **Positive Themes:** ${rv.sentiment_summary.positive_themes.join(', ')}`);
  }
  if (rv.sentiment_summary?.negative_themes?.length) {
    lines.push(`- **Negative Themes:** ${rv.sentiment_summary.negative_themes.join(', ')}`);
  }

  // Include recent reviews (abbreviated)
  if (rv.recent_reviews?.length > 0) {
    lines.push(`\n### Recent Reviews (${Math.min(rv.recent_reviews.length, 10)} shown)`);
    for (const review of rv.recent_reviews.slice(0, 10)) {
      lines.push(`- ${review.rating}★ "${(review.text || '').substring(0, 150)}..." — ${review.profile_name || 'Anonymous'}`);
    }
  }

  return lines.join('\n');
}

export function formatKeywordUniverseForClaude(data: UnifiedAuditData): string {
  const ku = data.keyword_universe;
  const lines = [
    '## Keyword Universe',
    `- **Total Keywords Discovered:** ${ku.total_keywords}`,
    `- **Intent Distribution:** Informational: ${ku.intent_distribution.informational || 0}, Commercial: ${ku.intent_distribution.commercial || 0}, Transactional: ${ku.intent_distribution.transactional || 0}, Navigational: ${ku.intent_distribution.navigational || 0}`,
  ];

  // Top 50 keywords table
  const topKW = ku.keywords.slice(0, 50);
  if (topKW.length > 0) {
    lines.push(`\n### Top ${topKW.length} Keywords by Priority Score`);
    lines.push('| Keyword | Volume | Difficulty | CPC | Intent | Priority |');
    lines.push('|---------|--------|-----------|-----|--------|----------|');
    for (const kw of topKW) {
      lines.push(`| ${kw.keyword} | ${kw.search_volume} | ${kw.keyword_difficulty}/100 | $${(kw.cpc || 0).toFixed(2)} | ${kw.search_intent} | ${kw.priority_score} |`);
    }
  }

  // Low-hanging fruit (high volume, low difficulty)
  const lowHanging = ku.keywords
    .filter(kw => kw.keyword_difficulty < 30 && kw.search_volume > 100)
    .slice(0, 15);
  if (lowHanging.length > 0) {
    lines.push(`\n### Low-Hanging Fruit Keywords (Difficulty < 30, Volume > 100)`);
    lines.push('| Keyword | Volume | Difficulty | Intent |');
    lines.push('|---------|--------|-----------|--------|');
    for (const kw of lowHanging) {
      lines.push(`| ${kw.keyword} | ${kw.search_volume} | ${kw.keyword_difficulty}/100 | ${kw.search_intent} |`);
    }
  }

  if (ku.by_intent && Object.keys(ku.by_intent).length > 0) {
    lines.push(`\n### Keywords by Intent`);
    for (const [intent, kws] of Object.entries(ku.by_intent)) {
      const arr = Array.isArray(kws) ? kws : [];
      if (arr.length) lines.push(`- ${intent}: ${arr.length} keyword(s). Use \`keyword_universe.by_intent.${intent}\` in full JSON for list.`);
    }
  }
  if (ku.by_difficulty && (ku.by_difficulty.low?.length || ku.by_difficulty.medium?.length || ku.by_difficulty.high?.length)) {
    const d = ku.by_difficulty;
    lines.push(`\n### Keywords by Difficulty Band`);
    lines.push(`- Low (0–33): ${d.low?.length || 0} | Medium (34–66): ${d.medium?.length || 0} | High (67–100): ${d.high?.length || 0}. Use \`keyword_universe.by_difficulty\` in full JSON.`);
  }

  return lines.join('\n');
}

export function formatCompetitorProfilesForClaude(data: UnifiedAuditData): string {
  const comp = data.competitors;
  const lines = ['## Competitive Landscape'];

  if (comp.organic_competitors?.length > 0) {
    lines.push(`\n### Organic Competitors (${comp.organic_competitors.length})`);
    for (const c of comp.organic_competitors.slice(0, 10)) {
      lines.push(`\n#### ${c.domain}`);
      lines.push(`- Avg Position: ${c.avg_position?.toFixed(1)}`);
      lines.push(`- Keyword Intersections: ${c.intersections}`);
      lines.push(`- Unique Keywords (they rank, you don't): ${c.unique_keywords || 0}`);
      if (c.keyword_gaps?.length > 0) {
        const gapKWs = c.keyword_gaps.slice(0, 10).map((g: any) => g.keyword || g.target2_keyword || 'unknown');
        lines.push(`- Top Keyword Gaps: ${gapKWs.join(', ')}`);
      }
      if (c.top_keywords?.length > 0) {
        const topKWs = c.top_keywords.slice(0, 5).map((k: any) => `${k.keyword} (#${k.rank_absolute})`);
        lines.push(`- Top Ranked Keywords: ${topKWs.join(', ')}`);
      }
    }
  }

  if (comp.serp_competitors?.length > 0) {
    lines.push(`\n### SERP Competitors (${comp.serp_competitors.length})`);
    for (const c of comp.serp_competitors.slice(0, 5)) {
      lines.push(`- **${c.domain || c.se_domain}** — Avg Position: ${c.avg_position?.toFixed(1)}, Visibility: ${c.visibility?.toFixed(4) || 'N/A'}`);
    }
  }

  if (comp.local_competitors?.length > 0) {
    lines.push(`\n### Local Competitors from Google Maps (${comp.local_competitors.length})`);
    for (const c of comp.local_competitors.slice(0, 5)) {
      const rating = c.rating ? `${c.rating.value}★ (${c.rating.votes_count} reviews)` : 'No rating';
      lines.push(`- **${c.title}** — ${c.category || 'N/A'} | ${rating} | ${c.is_claimed ? 'Claimed' : 'Unclaimed'}`);
    }
  }

  const profiles = comp.competitor_profiles;
  if (profiles && profiles.length > 0) {
    lines.push(`\n### Competitor Profiles (Local Pack: reviews + GBP)`);
    for (const p of profiles.slice(0, 10)) {
      const biz = p.business_info;
      const name = biz?.title || biz?.name || p.key;
      const rating = biz?.rating ? `⭐ ${biz.rating.value}/5 (${biz.rating.votes_count} reviews)` : 'No rating';
      lines.push(`- **${name}** — ${rating}`);
      if (Array.isArray(p.reviews) && p.reviews.length > 0) {
        lines.push(`  - Recent reviews: ${p.reviews.length} (use full audit JSON for sentiment/themes).`);
      }
      if (biz?.hours || biz?.attributes?.length || biz?.posts?.length) {
        const parts = [];
        if (biz.hours) parts.push('hours');
        if (biz.attributes?.length) parts.push(`${biz.attributes.length} attributes`);
        if (biz.posts?.length) parts.push(`${biz.posts.length} posts`);
        if (parts.length) lines.push(`  - GBP: ${parts.join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}

export function formatSERPAnalysisForClaude(data: UnifiedAuditData): string {
  const serp = data.serp_analysis;
  const lines = ['## SERP & Local Search Analysis'];

  lines.push(`- **Local Pack Present:** ${serp.serp_features.local_pack_present ? '✅ Yes' : '❌ No'}`);

  if (serp.serp_features.featured_snippets?.length > 0) {
    lines.push(`- **Featured Snippets:** ${serp.serp_features.featured_snippets.length} found`);
  }

  if (serp.local_pack_dominance?.length > 0) {
    lines.push(`\n### Local Pack Dominance (transactional/commercial keywords)`);
    for (const ld of serp.local_pack_dominance.slice(0, 8)) {
      const pos = ld.your_position != null ? `Your position: #${ld.your_position}` : 'Not in pack';
      lines.push(`- **${ld.keyword}** — ${ld.pack.length} in pack; ${pos}`);
    }
  }

  if (serp.paid_results?.length > 0) {
    const byKw = new Map<string, number>();
    for (const p of serp.paid_results) {
      byKw.set(p.keyword, (byKw.get(p.keyword) || 0) + 1);
    }
    lines.push(`\n### Paid Results (PPC)`);
    for (const [kw, count] of Array.from(byKw.entries()).slice(0, 5)) {
      lines.push(`- ${kw}: ${count} paid ad(s)`);
    }
  }

  if (serp.local_services_ads?.length > 0) {
    lines.push(`\n### Local Service Ads (LSA)`);
    for (const lsa of serp.local_services_ads.slice(0, 8)) {
      const title = typeof lsa.title === 'string' ? lsa.title : (lsa as { domain?: string }).domain ?? '—';
      lines.push(`- ${lsa.keyword}: ${title}`);
    }
  }

  if (serp.discussions_and_forums?.length > 0) {
    lines.push(`\n### Discussions & Forums`);
    for (const d of serp.discussions_and_forums.slice(0, 10)) {
      const title = d.title || (d as { domain?: string }).domain || d.url || '—';
      lines.push(`- ${d.keyword}: ${title}`);
    }
  }

  if (serp.related_searches?.length > 0) {
    lines.push(`\n### Related Searches`);
    for (const rs of serp.related_searches.slice(0, 5)) {
      const items = Array.isArray(rs.items) ? rs.items.slice(0, 5).map((i: any) => typeof i === 'string' ? i : i.title || i.query || JSON.stringify(i)) : [];
      if (items.length) lines.push(`- ${rs.keyword}: ${items.join('; ')}`);
    }
  }

  if (serp.people_also_search?.length > 0) {
    lines.push(`\n### People Also Search`);
    for (const pas of serp.people_also_search.slice(0, 5)) {
      const items = Array.isArray(pas.items) ? pas.items.length : 0;
      if (items) lines.push(`- ${pas.keyword}: ${items} related search(es)`);
    }
  }

  if (serp.serp_features.people_also_ask?.length > 0) {
    lines.push(`\n### People Also Ask`);
    for (const paa of serp.serp_features.people_also_ask.slice(0, 10)) {
      lines.push(`- ${typeof paa === 'string' ? paa : paa.question || paa.title || JSON.stringify(paa)}`);
    }
  }

  if (serp.autocomplete_suggestions?.length > 0) {
    lines.push(`\n### Autocomplete Suggestions (${serp.autocomplete_suggestions.length})`);
    for (const sug of serp.autocomplete_suggestions.slice(0, 15)) {
      lines.push(`- ${typeof sug === 'string' ? sug : sug.keyword ? `${sug.keyword}: ${(sug.suggestions || []).slice(0, 5).join(', ')}` : JSON.stringify(sug)}`);
    }
  }

  if (data.serp_by_service_area_city && Object.keys(data.serp_by_service_area_city).length > 0) {
    const cities = Object.keys(data.serp_by_service_area_city).join(', ');
    lines.push(`\n### Per–Service-Area SERP Data`);
    lines.push(`SERP data is available **per service area city** for: ${cities}.`);
    lines.push(`Use \`serp_by_service_area_city\` in the full audit JSON (organic_results, maps_results, local_finder_results, autocomplete_results per city) to give location-specific SERP and local pack recommendations for each service area.`);
  }

  return lines.join('\n');
}

export function formatTechnicalAuditForClaude(data: UnifiedAuditData): string {
  const ta = data.technical_audit;
  if (!ta) return '## Technical SEO Audit\nNo technical audit data available.';

  const lines = [
    '## Technical SEO Audit',
    `- **Pages Crawled:** ${ta.crawl_summary.pages_crawled}`,
    `- **Pages With Issues:** ${ta.crawl_summary.pages_with_issues}`,
    `- **Avg On-Page Score:** ${ta.crawl_summary.avg_onpage_score}/100`,
  ];

  // Domain info
  if (ta.domain_info) {
    const di = ta.domain_info;
    lines.push(`\n### Domain Configuration`);
    lines.push(`- CMS: ${di.cms || 'Not detected'}`);
    lines.push(`- SSL: ${di.ssl ? 'Valid' : 'MISSING/Invalid'}`);
    lines.push(`- Sitemap: ${di.has_sitemap ? 'Present' : 'MISSING'}`);
    lines.push(`- Robots.txt: ${di.has_robots_txt ? 'Present' : 'MISSING'}`);
    lines.push(`- HTTPS Redirect: ${di.is_https_redirect ? 'Yes' : 'No'}`);
    lines.push(`- WWW Redirect: ${di.is_www_redirect ? 'Yes' : 'No'}`);
    lines.push(`- Canonical: ${di.canonicalization ? 'Properly set' : 'Issues detected'}`);
    lines.push(`- 404 Test: ${di.test_404 ? 'Pass' : 'FAIL'}`);
  }

  if ((ta.issues.critical as any[])?.length > 0) {
    lines.push(`\n### Critical Issues (${(ta.issues.critical as any[]).length})`);
    for (const issue of (ta.issues.critical as any[]).slice(0, 10)) {
      lines.push(`- ${issue.check}: ${issue.count} occurrences`);
    }
  }

  if ((ta.issues.warnings as any[])?.length > 0) {
    lines.push(`\n### Warnings (${(ta.issues.warnings as any[]).length})`);
    for (const issue of (ta.issues.warnings as any[]).slice(0, 10)) {
      lines.push(`- ${issue.check}: ${issue.count} occurrences`);
    }
  }

  // Non-indexable pages
  if (ta.non_indexable && ta.non_indexable.total > 0) {
    lines.push(`\n### Non-Indexable Pages (${ta.non_indexable.total})`);
    for (const [reason, count] of Object.entries(ta.non_indexable.by_reason)) {
      lines.push(`- ${reason}: ${count} pages`);
    }
  }

  // Duplicate content
  if (ta.duplicate_content && ta.duplicate_content.total_duplicate_pages > 0) {
    lines.push(`\n### Duplicate Content (${ta.duplicate_content.total_duplicate_pages} pages with similar content)`);
    for (const p of ta.duplicate_content.pages.slice(0, 5)) {
      lines.push(`- ${p.url} (${p.similarity}/10 similar to ${p.similar_to})`);
    }
  }

  // Schema markup
  lines.push(`\n### Schema Markup`);
  if (ta.schema_markup.existing_schemas?.length > 0) {
    lines.push(`- **Existing:** ${ta.schema_markup.existing_schemas.join(', ')}`);
  } else {
    lines.push(`- **Existing:** None detected`);
  }
  lines.push(`- **Recommended:** ${ta.schema_markup.recommended_schemas.join(', ')}`);

  // Link analysis
  lines.push(`\n### Link Analysis`);
  lines.push(`- Internal Links: ${ta.link_analysis.internal_links}`);
  lines.push(`- External Links: ${ta.link_analysis.external_links}`);
  lines.push(`- Broken Links: ${(ta.link_analysis.broken_links as any[])?.length || 0}`);
  lines.push(`- Redirect Chains: ${(ta.link_analysis.redirect_chains as any[])?.length || 0}`);

  // Resource audit (full breakdown)
  if (ta.resource_audit) {
    const ra = ta.resource_audit;
    lines.push(`\n### Resource Audit`);
    lines.push(`- Images: ${ra.images.total} (${ra.images.missing_alt} missing alt, ${ra.images.oversized} oversized)`);
    lines.push(`- Scripts: ${ra.scripts.total} (${(ra.scripts.total_size / 1024).toFixed(0)}KB total, ${ra.scripts.unminified} unminified)`);
    lines.push(`- Stylesheets: ${ra.stylesheets.total} (${(ra.stylesheets.total_size / 1024).toFixed(0)}KB total)`);
    lines.push(`- Broken Resources: ${ra.broken.total}`);
  } else {
    lines.push(`\n### Image Audit`);
    lines.push(`- Total Images: ${ta.image_audit.total_images}`);
    lines.push(`- Missing Alt Text: ${ta.image_audit.missing_alt}`);
    lines.push(`- Oversized (>200KB): ${ta.image_audit.oversized}`);
  }

  // Page speed waterfall
  if (ta.waterfall) {
    const wf = ta.waterfall;
    lines.push(`\n### Page Speed Analysis`);
    lines.push(`- Homepage Load Time: ${(wf.homepage_load_time / 1000).toFixed(2)}s`);
    lines.push(`- Render-Blocking Resources: ${wf.render_blocking_count}`);
    if (wf.render_blocking_resources.length > 0) {
      lines.push(`- Top render-blocking:`);
      for (const r of wf.render_blocking_resources.slice(0, 5)) {
        lines.push(`  - ${r.type}: ${r.url.split('/').pop()} (${(r.duration / 1000).toFixed(2)}s)`);
      }
    }
    if (Object.keys(wf.transfer_size_by_type).length > 0) {
      lines.push(`- Transfer size by type:`);
      for (const [type, size] of Object.entries(wf.transfer_size_by_type)) {
        lines.push(`  - ${type}: ${((size as number) / 1024).toFixed(0)}KB`);
      }
    }
  }

  // Keyword density
  if (ta.keyword_density) {
    const kd = ta.keyword_density;
    if (kd.two_word.length > 0) {
      lines.push(`\n### Top Keyword Phrases (2-word)`);
      for (const k of kd.two_word.slice(0, 15)) {
        lines.push(`- "${k.keyword}" — ${k.frequency}x (density: ${(k.density * 100).toFixed(2)}%)`);
      }
    }
    if (kd.three_word.length > 0) {
      lines.push(`\n### Top Keyword Phrases (3-word)`);
      for (const k of kd.three_word.slice(0, 15)) {
        lines.push(`- "${k.keyword}" — ${k.frequency}x (density: ${(k.density * 100).toFixed(2)}%)`);
      }
    }
  }

  // Content structure
  if (ta.content_structure) {
    const cs = ta.content_structure;
    lines.push(`\n### Content Structure (Homepage)`);
    lines.push(`- Main Topic: ${cs.main_topic || 'Not detected'}`);
    lines.push(`- Contact Info Present: ${cs.has_contact_info ? 'Yes' : 'No'}`);
    lines.push(`- Ratings/Reviews Present: ${cs.has_ratings ? 'Yes' : 'No'}`);
    if (cs.heading_hierarchy.length > 0) {
      lines.push(`- Heading Hierarchy:`);
      for (const h of cs.heading_hierarchy.slice(0, 10)) {
        lines.push(`  - <${h.tag}>: ${h.text}`);
      }
    }
  }

  return lines.join('\n');
}

export function formatBacklinkProfileForClaude(data: UnifiedAuditData): string {
  const bl = data.backlinks;
  if (!bl || (bl.summary.total_backlinks === 0 && bl.top_referring_domains?.length === 0)) {
    return '## Backlink Profile\nNo backlink data available (Basic/Intermediate tier).';
  }

  const lines = [
    '## Backlink Profile (Advanced)',
    '',
    '### Summary',
    `- **Total Backlinks:** ${bl.summary.total_backlinks.toLocaleString()}`,
    `- **Referring Domains:** ${bl.summary.referring_domains.toLocaleString()}`,
    `- **Dofollow Ratio:** ${Math.round(bl.summary.dofollow_ratio * 100)}%`,
    `- **Avg Domain Rank:** ${bl.summary.avg_domain_rank}`,
    `- **Domain Spam Score:** ${bl.summary.spam_score}`,
    `- **Broken Backlinks:** ${bl.summary.broken_backlinks.toLocaleString()}`,
    `- **Referring IPs:** ${bl.summary.referring_ips.toLocaleString()}`,
    `- **Referring Subnets:** ${bl.summary.referring_subnets.toLocaleString()}`,
  ];

  // Link type breakdown
  if (bl.summary.link_types && Object.keys(bl.summary.link_types).length > 0) {
    lines.push(`\n### Link Type Distribution`);
    for (const [type, count] of Object.entries(bl.summary.link_types)) {
      lines.push(`- **${type}:** ${(count as number).toLocaleString()}`);
    }
  }

  // Platform type breakdown
  if (bl.summary.platform_types && Object.keys(bl.summary.platform_types).length > 0) {
    lines.push(`\n### Platform Type Distribution`);
    for (const [platform, count] of Object.entries(bl.summary.platform_types)) {
      lines.push(`- **${platform}:** ${(count as number).toLocaleString()}`);
    }
  }

  // Geographic distribution
  if (bl.summary.country_distribution && Object.keys(bl.summary.country_distribution).length > 0) {
    lines.push(`\n### Geographic Distribution (Top 10)`);
    const sortedCountries = Object.entries(bl.summary.country_distribution)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 10);
    for (const [country, count] of sortedCountries) {
      lines.push(`- **${country}:** ${(count as number).toLocaleString()} backlinks`);
    }
  }

  // Top referring domains
  if (bl.top_referring_domains?.length > 0) {
    lines.push(`\n### Top Referring Domains (${bl.top_referring_domains.length})`);
    for (const rd of (bl.top_referring_domains as any[]).slice(0, 15)) {
      const spamNote = rd.backlinks_spam_score > 50 ? ' ⚠️ HIGH SPAM' : '';
      lines.push(`- **${rd.domain || rd.target}** — Rank: ${rd.rank || 'N/A'}, Backlinks: ${rd.backlinks || 'N/A'}, Spam: ${rd.backlinks_spam_score ?? 'N/A'}${spamNote}`);
    }
  }

  // Anchor text distribution
  if (bl.anchor_text_distribution?.length > 0) {
    lines.push(`\n### Anchor Text Distribution (Top ${Math.min(bl.anchor_text_distribution.length, 15)})`);
    for (const anchor of (bl.anchor_text_distribution as any[]).slice(0, 15)) {
      lines.push(`- "${anchor.anchor || anchor.text || 'N/A'}" — ${anchor.backlinks || anchor.count || 0} links, ${anchor.referring_domains || 0} domains`);
    }
  }

  // Individual backlinks (highest quality)
  if (bl.individual_backlinks?.length > 0) {
    lines.push(`\n### Top Individual Backlinks (${Math.min((bl.individual_backlinks as any[]).length, 10)} highest-rank)`);
    for (const link of (bl.individual_backlinks as any[]).slice(0, 10)) {
      const follow = link.dofollow ? 'dofollow' : 'nofollow';
      const broken = link.is_broken ? ' [BROKEN]' : '';
      lines.push(`- **${link.domain_from}** → ${link.url_to || 'homepage'}`);
      lines.push(`  Anchor: "${link.anchor || '(none)'}" | ${follow}${broken} | Rank: ${link.rank || 'N/A'} | Spam: ${link.backlink_spam_score ?? 'N/A'} | Type: ${link.item_type || 'anchor'} | Location: ${link.semantic_location || 'N/A'}`);
    }
  }

  // Per-page backlink distribution
  if (bl.domain_pages?.length > 0) {
    lines.push(`\n### Per-Page Backlink Distribution (Top ${Math.min((bl.domain_pages as any[]).length, 10)})`);
    for (const page of (bl.domain_pages as any[]).slice(0, 10)) {
      lines.push(`- **${page.page || 'N/A'}** — Backlinks: ${page.backlinks || 0}, Referring Domains: ${page.referring_domains || 0}, Rank: ${page.rank || 'N/A'}, Spam: ${page.backlinks_spam_score ?? 'N/A'}`);
    }
  }

  // Network diversity
  if (bl.referring_networks?.length > 0) {
    const uniqueNetworks = (bl.referring_networks as any[]).length;
    const topNetwork = (bl.referring_networks as any[])[0];
    const topNetworkPct = bl.summary.total_backlinks > 0
      ? Math.round(((topNetwork?.backlinks || 0) / bl.summary.total_backlinks) * 100)
      : 0;
    const concentrationRisk = topNetworkPct > 30;
    lines.push(`\n### Network Diversity`);
    lines.push(`- **Unique Subnets:** ${uniqueNetworks}`);
    lines.push(`- **Top Network:** ${topNetwork?.network_address || 'N/A'} (${topNetworkPct}% of backlinks)${concentrationRisk ? ' ⚠️ CONCENTRATION RISK' : ''}`);
    for (const net of (bl.referring_networks as any[]).slice(0, 5)) {
      lines.push(`  - ${net.network_address}: ${net.backlinks || 0} backlinks, ${net.referring_domains || 0} domains`);
    }
  }

  // Historical trends
  if (bl.history?.length > 0) {
    const hist = bl.history as any[];
    lines.push(`\n### Historical Backlink Trends (${hist.length} months)`);
    const recent = hist.slice(-6);
    if (recent.length >= 2) {
      const oldest = recent[0];
      const newest = recent[recent.length - 1];
      const blChange = (newest.backlinks || 0) - (oldest.backlinks || 0);
      const rdChange = (newest.referring_domains || 0) - (oldest.referring_domains || 0);
      const direction = blChange > 0 ? '📈 Growing' : blChange < 0 ? '📉 Declining' : '➡️ Stable';
      lines.push(`- **6-Month Trend:** ${direction}`);
      lines.push(`- **Backlinks Change:** ${blChange > 0 ? '+' : ''}${blChange.toLocaleString()}`);
      lines.push(`- **Referring Domains Change:** ${rdChange > 0 ? '+' : ''}${rdChange.toLocaleString()}`);
    }
    lines.push(`- Monthly snapshots (last 6):`);
    for (const h of recent) {
      lines.push(`  - ${h.date}: BL: ${(h.backlinks || 0).toLocaleString()}, RD: ${h.referring_domains || 0}, New: +${h.new_backlinks || 0}, Lost: -${h.lost_backlinks || 0}`);
    }
  }

  // New/lost timeseries velocity
  if (bl.new_lost_timeseries?.length > 0) {
    const nlt = bl.new_lost_timeseries as any[];
    const recent = nlt.slice(-6);
    if (recent.length > 0) {
      const avgNew = Math.round(recent.reduce((s: number, e: any) => s + (e.new_backlinks || 0), 0) / recent.length);
      const avgLost = Math.round(recent.reduce((s: number, e: any) => s + (e.lost_backlinks || 0), 0) / recent.length);
      lines.push(`\n### Link Velocity (6-month avg)`);
      lines.push(`- **Avg New Backlinks/mo:** +${avgNew.toLocaleString()}`);
      lines.push(`- **Avg Lost Backlinks/mo:** -${avgLost.toLocaleString()}`);
      lines.push(`- **Net Velocity:** ${(avgNew - avgLost) > 0 ? '+' : ''}${(avgNew - avgLost).toLocaleString()}/mo`);
    }
  }

  // Link gap — domain level
  if (bl.link_gap.competitor_only_domains?.length > 0) {
    lines.push(`\n### Link Gap Opportunities — Domain Level (${bl.link_gap.competitor_only_domains.length} domains)`);
    lines.push(`- **Opportunity Score:** ${bl.link_gap.opportunity_score}/100`);
    lines.push(`- Top domains linking to competitors but NOT you:`);
    for (const d of (bl.link_gap.competitor_only_domains as any[]).slice(0, 10)) {
      lines.push(`  - ${d.domain || d.target || JSON.stringify(d)}`);
    }
  }

  // Link gap — page level
  if (bl.link_gap.page_level_gaps?.length > 0) {
    lines.push(`\n### Link Gap Opportunities — Page Level (${(bl.link_gap.page_level_gaps as any[]).length} pages)`);
    lines.push(`- Competitor pages getting links you don't have:`);
    for (const p of (bl.link_gap.page_level_gaps as any[]).slice(0, 10)) {
      const url = p.url_from || p.page || JSON.stringify(p);
      lines.push(`  - ${url}`);
    }
  }

  // Competitor backlink comparison
  const comp = bl.competitor_comparison;
  if (comp && comp.bulk_ranks?.length > 0) {
    lines.push(`\n### Competitor Backlink Comparison`);
    lines.push(`| Domain | Rank | Backlinks | Referring Domains | New (recent) | Lost (recent) |`);
    lines.push(`|--------|------|-----------|-------------------|--------------|---------------|`);
    const ranksMap = new Map((comp.bulk_ranks as any[]).map((r: any) => [r.target, r.rank || 0]));
    const blMap = new Map((comp.bulk_backlinks as any[]).map((r: any) => [r.target, r.backlinks || 0]));
    const rdMap = new Map((comp.bulk_referring_domains as any[]).map((r: any) => [r.target, r.referring_domains || 0]));
    const nlMap = new Map((comp.bulk_new_lost as any[]).map((r: any) => [r.target, { new: r.new_backlinks || 0, lost: r.lost_backlinks || 0 }]));

    for (const [target] of ranksMap) {
      const nl = nlMap.get(target) || { new: 0, lost: 0 };
      lines.push(`| ${target} | ${ranksMap.get(target)} | ${(blMap.get(target) || 0).toLocaleString()} | ${rdMap.get(target) || 0} | +${nl.new.toLocaleString()} | -${nl.lost.toLocaleString()} |`);
    }
  }

  // Spam assessment
  const spam = bl.spam_analysis;
  if (spam && (spam.high_spam_count > 0 || spam.avg_spam_score > 0)) {
    lines.push(`\n### Spam Assessment`);
    lines.push(`- **Avg Spam Score (referring domains):** ${spam.avg_spam_score}`);
    lines.push(`- **High Spam Domains (>50):** ${spam.high_spam_count}${spam.high_spam_count > 10 ? ' ⚠️ Consider disavow review' : ''}`);
    lines.push(`- **Low Spam Domains (<20):** ${spam.low_spam_count}`);
    if (spam.high_spam_count > 0) {
      const highSpam = (spam.referring_domain_spam_scores as any[])
        .filter((s: any) => (s.spam_score || 0) > 50)
        .slice(0, 10);
      if (highSpam.length > 0) {
        lines.push(`- **Top spam-flagged referring domains (consider disavow):**`);
        for (const s of highSpam) {
          lines.push(`  - ${s.target}: spam score ${s.spam_score}`);
        }
      }
    }
  }

  return lines.join('\n');
}

export function formatScoringForClaude(data: UnifiedAuditData): string {
  const sc = data.scoring;
  return [
    '## SEO Readiness Scores',
    `- **Overall SEO Readiness:** ${sc.overall_seo_readiness}/100`,
    `- **GBP Completeness:** ${Math.round(sc.gbp_completeness * 100)}%`,
    `- **Technical Health:** ${Math.round(sc.technical_health * 100)}%`,
    `- **Competitive Position:** ${Math.round(sc.competitive_position * 100)}%`,
    `- **Keyword Prioritization Method:** ${sc.keyword_prioritization.method}`,
    `- **Weights:** Volume: ${sc.keyword_prioritization.weights.search_volume || 0.3}, Difficulty⁻¹: ${sc.keyword_prioritization.weights.keyword_difficulty_inverse || 0.25}, CPC: ${sc.keyword_prioritization.weights.cpc || 0.15}, Intent: ${sc.keyword_prioritization.weights.intent_alignment || 0.2}, Local: ${sc.keyword_prioritization.weights.local_relevance || 0.1}`,
  ].join('\n');
}

/**
 * Full keyword universe formatter — sends ALL keywords (up to 2,000) organized by cluster and intent.
 * Used by the 10.1 Market Position & Keyword Strategy sub-phase where comprehensive keyword
 * prioritization is the core task.
 */
export function formatFullKeywordUniverseForClaude(data: UnifiedAuditData): string {
  const ku = data.keyword_universe;
  const lines = [
    '## Full Keyword Universe',
    `- **Total Keywords Discovered:** ${ku.total_keywords}`,
    `- **Intent Distribution:** Informational: ${ku.intent_distribution.informational || 0}, Commercial: ${ku.intent_distribution.commercial || 0}, Transactional: ${ku.intent_distribution.transactional || 0}, Navigational: ${ku.intent_distribution.navigational || 0}`,
  ];

  const d = ku.by_difficulty;
  if (d) {
    lines.push(`- **Difficulty Bands:** Low (0–33): ${d.low?.length || 0}, Medium (34–66): ${d.medium?.length || 0}, High (67–100): ${d.high?.length || 0}`);
  }

  if (ku.clusters && ku.clusters.length > 0) {
    lines.push(`\n### Keyword Clusters (${ku.clusters.length})`);
    for (const cluster of ku.clusters) {
      const name = cluster.name || cluster.cluster_name || 'Unnamed';
      const kws = cluster.keywords || [];
      lines.push(`\n#### Cluster: ${name} (${kws.length} keywords)`);
      if (kws.length > 0) {
        lines.push('| Keyword | Volume | Difficulty | CPC | Intent | Priority | Current Rank |');
        lines.push('|---------|--------|-----------|-----|--------|----------|-------------|');
        for (const kw of kws) {
          const rank = kw.current_rank != null ? `#${kw.current_rank}` : 'Not ranking';
          lines.push(`| ${kw.keyword} | ${kw.search_volume} | ${kw.keyword_difficulty}/100 | $${(kw.cpc || 0).toFixed(2)} | ${kw.search_intent} | ${kw.priority_score} | ${rank} |`);
        }
      }
    }
  }

  const unclustered = ku.clusters && ku.clusters.length > 0
    ? ku.keywords.filter(kw => !ku.clusters!.some(c => (c.keywords || []).some((ck: any) => ck.keyword === kw.keyword)))
    : ku.keywords;

  if (unclustered.length > 0) {
    lines.push(`\n### All Keywords by Priority Score (${unclustered.length > 0 && ku.clusters?.length ? 'unclustered' : 'complete list'})`);
    lines.push('| Keyword | Volume | Difficulty | CPC | Intent | Priority | Current Rank | Trend |');
    lines.push('|---------|--------|-----------|-----|--------|----------|-------------|-------|');
    for (const kw of unclustered) {
      const rank = kw.current_rank != null ? `#${kw.current_rank}` : '—';
      let trend = '—';
      if (kw.monthly_trends && Array.isArray(kw.monthly_trends) && kw.monthly_trends.length >= 2) {
        const recent = kw.monthly_trends.slice(-3).reduce((s: number, v: any) => s + (v?.search_volume || 0), 0) / 3;
        const older = kw.monthly_trends.slice(0, 3).reduce((s: number, v: any) => s + (v?.search_volume || 0), 0) / 3;
        if (older > 0) {
          const pctChange = (recent - older) / older;
          trend = pctChange > 0.1 ? `↑${Math.round(pctChange * 100)}%` : pctChange < -0.1 ? `↓${Math.round(Math.abs(pctChange) * 100)}%` : 'Stable';
        }
      }
      lines.push(`| ${kw.keyword} | ${kw.search_volume} | ${kw.keyword_difficulty}/100 | $${(kw.cpc || 0).toFixed(2)} | ${kw.search_intent} | ${kw.priority_score} | ${rank} | ${trend} |`);
    }
  }

  const lowHanging = ku.keywords
    .filter(kw => kw.keyword_difficulty < 35 && kw.search_volume > 50)
    .sort((a, b) => b.search_volume - a.search_volume)
    .slice(0, 25);
  if (lowHanging.length > 0) {
    lines.push(`\n### Low-Hanging Fruit (Difficulty < 35, Volume > 50)`);
    lines.push('| Keyword | Volume | Difficulty | CPC | Intent | Current Rank |');
    lines.push('|---------|--------|-----------|-----|--------|-------------|');
    for (const kw of lowHanging) {
      const rank = kw.current_rank != null ? `#${kw.current_rank}` : 'Not ranking';
      lines.push(`| ${kw.keyword} | ${kw.search_volume} | ${kw.keyword_difficulty}/100 | $${(kw.cpc || 0).toFixed(2)} | ${kw.search_intent} | ${rank} |`);
    }
  }

  if (ku.by_intent && Object.keys(ku.by_intent).length > 0) {
    lines.push(`\n### Keywords Grouped by Intent`);
    for (const [intent, kws] of Object.entries(ku.by_intent)) {
      const arr = Array.isArray(kws) ? kws : [];
      if (arr.length > 0) {
        lines.push(`\n#### ${intent.charAt(0).toUpperCase() + intent.slice(1)} Intent (${arr.length} keywords)`);
        lines.push('| Keyword | Volume | Difficulty | Priority |');
        lines.push('|---------|--------|-----------|----------|');
        for (const kw of arr.slice(0, 50)) {
          lines.push(`| ${kw.keyword} | ${kw.search_volume} | ${kw.keyword_difficulty}/100 | ${kw.priority_score} |`);
        }
        if (arr.length > 50) lines.push(`_...and ${arr.length - 50} more ${intent} keywords_`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Competitor technical audit formatter — per-competitor Lighthouse scores, schema usage, issues.
 * Used by 10.2 Competitive Analysis to identify technical weaknesses to exploit.
 */
export function formatCompetitorTechnicalAuditForClaude(data: UnifiedAuditData): string {
  const audits = (data as any).competitor_technical_audit;
  if (!audits || !Array.isArray(audits) || audits.length === 0) return '';

  const lines = ['## Competitor Technical Audit'];

  for (const audit of audits.slice(0, 10)) {
    const domain = audit.domain || audit.target || 'Unknown';
    lines.push(`\n### ${domain}`);

    if (audit.crawl_summary) {
      const cs = audit.crawl_summary;
      lines.push(`- Pages Crawled: ${cs.pages_crawled || 'N/A'}, Pages with Issues: ${cs.pages_with_issues || 'N/A'}, Avg On-Page Score: ${cs.avg_onpage_score ? `${Math.round(cs.avg_onpage_score)}/100` : 'N/A'}`);
    }

    // Domain configuration
    if (audit.domain_info) {
      const di = audit.domain_info;
      lines.push(`- CMS: ${di.cms || 'Not detected'}, SSL: ${di.ssl ? 'Yes' : 'No'}, Sitemap: ${di.has_sitemap ? 'Yes' : 'No'}, Robots.txt: ${di.has_robots_txt ? 'Yes' : 'No'}, HTTPS Redirect: ${di.is_https_redirect ? 'Yes' : 'No'}, Canonical: ${di.canonicalization ? 'Yes' : 'No'}`);
    }

    if (audit.lighthouse) {
      const lh = audit.lighthouse;
      if (lh.desktop) {
        lines.push(`- Lighthouse Desktop — Performance: ${lh.desktop.performance}, Accessibility: ${lh.desktop.accessibility}, Best Practices: ${lh.desktop.best_practices}, SEO: ${lh.desktop.seo}`);
      }
      if (lh.mobile) {
        lines.push(`- Lighthouse Mobile — Performance: ${lh.mobile.performance}, Accessibility: ${lh.mobile.accessibility}, Best Practices: ${lh.mobile.best_practices}, SEO: ${lh.mobile.seo}`);
      }
    }

    if (audit.issues_count) {
      lines.push(`- Issues — Critical: ${audit.issues_count.critical}, Warnings: ${audit.issues_count.warnings}, Notices: ${audit.issues_count.notices}`);
    }

    // Non-indexable
    if (audit.non_indexable && audit.non_indexable.total > 0) {
      lines.push(`- Non-Indexable Pages: ${audit.non_indexable.total}`);
    }

    // Duplicate tags
    if (audit.duplicate_tags) {
      lines.push(`- Duplicate Tags — Titles: ${audit.duplicate_tags.titles_count}, Descriptions: ${audit.duplicate_tags.descriptions_count}`);
    }

    // Redirect chains
    if (audit.redirect_chains && audit.redirect_chains.total > 0) {
      lines.push(`- Redirect Chains: ${audit.redirect_chains.total}`);
    }

    if (audit.schema_markup) {
      const existing = audit.schema_markup.existing_schemas || [];
      if (existing.length > 0) lines.push(`- Schema Types: ${existing.join(', ')}`);
    }

    if (audit.link_analysis) {
      const la = audit.link_analysis;
      lines.push(`- Links — Internal: ${la.internal_links || 0}, External: ${la.external_links || 0}, Broken: ${la.broken_links_count || (la.broken_links || []).length || 0}`);
    }

    // Resource audit
    if (audit.resource_audit) {
      const ra = audit.resource_audit;
      lines.push(`- Resources — Scripts: ${ra.scripts.total} (${(ra.scripts.total_size / 1024).toFixed(0)}KB), CSS: ${ra.stylesheets.total} (${(ra.stylesheets.total_size / 1024).toFixed(0)}KB), Broken: ${ra.broken_count}`);
    }

    // Keyword density
    if (audit.keyword_density?.top_terms?.length > 0) {
      lines.push(`- Top Keyword Phrases: ${audit.keyword_density.top_terms.slice(0, 5).map((k: any) => `"${k.keyword}" (${k.frequency}x)`).join(', ')}`);
    }

    // Content structure
    if (audit.content_structure) {
      const cs = audit.content_structure;
      lines.push(`- Content — Topic: ${cs.main_topic || 'N/A'}, Headings: ${cs.heading_count}, Contact Info: ${cs.has_contact_info ? 'Yes' : 'No'}`);
    }
  }

  return lines.join('\n');
}

/**
 * Per-city SERP data formatter for service area analysis.
 * Used by 10.3 Content Strategy to identify which cities have the most organic opportunity.
 */
export function formatServiceAreaSERPForClaude(data: UnifiedAuditData): string {
  const cityData = data.serp_by_service_area_city;
  if (!cityData || typeof cityData !== 'object' || Object.keys(cityData).length === 0) return '';

  const lines = ['## SERP Analysis by Service Area City'];

  for (const [city, serp] of Object.entries(cityData)) {
    lines.push(`\n### ${city}`);
    const s = serp as any;

    if (s.organic_results?.length > 0) {
      lines.push(`- Organic Results: ${s.organic_results.length} listings`);
      for (const r of s.organic_results.slice(0, 5)) {
        lines.push(`  - #${r.rank_absolute || r.position || '?'}: ${r.domain || r.url || 'Unknown'} — "${(r.title || '').substring(0, 80)}"`);
      }
    }

    if (s.maps_results?.length > 0) {
      lines.push(`- Maps/Local Pack: ${s.maps_results.length} businesses`);
      for (const m of s.maps_results.slice(0, 5)) {
        const rating = m.rating ? `${m.rating.value}★ (${m.rating.votes_count} reviews)` : 'No rating';
        lines.push(`  - ${m.title || m.domain || 'Unknown'} — ${rating}`);
      }
    }

    if (s.local_finder_results) {
      const total = s.local_finder_results.total_count || (s.local_finder_results.items || []).length || 0;
      lines.push(`- Local Finder: ${total} total results`);
    }

    if (s.autocomplete_results?.length > 0) {
      const suggestions = s.autocomplete_results.slice(0, 5).map((a: any) => typeof a === 'string' ? a : a.suggestion || a.query || '');
      if (suggestions.filter(Boolean).length > 0) {
        lines.push(`- Autocomplete: ${suggestions.filter(Boolean).join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}

function formatTavilyResearchForClaude(data: UnifiedAuditData): string {
  const tr = data.tavily_research;
  const lines = ['## Qualitative Web Research (Tavily)'];

  const addSources = (sources: any[], label: string) => {
    if (sources?.length > 0) {
      lines.push(`\n### ${label} (${sources.length} sources)`);
      for (const src of sources.slice(0, 5)) {
        lines.push(`- **${src.title || 'Untitled'}** (${src.url || 'N/A'}): ${(src.content || '').substring(0, 200)}...`);
      }
    }
  };

  addSources(tr.phase1_sources, 'Competitive Intelligence Sources');
  addSources(tr.phase2_sources, 'SEO & Keyword Sources');
  addSources(tr.phase3_sources, 'CRO & Technical Sources');

  return lines.join('\n');
}

/**
 * Get schema markup templates for Cursor prompts
 * Returns ready-to-use JSON-LD templates based on business type
 */
export function getSchemaMarkupTemplates(session: any): string {
  const bizName = session.business_name || 'Business Name';
  const address = `${session.street_address || ''}, ${session.city || ''}, ${session.state || ''} ${session.zip_code || ''}`.trim();
  const phone = session.phone_number || '';
  const email = session.contact_email || '';
  const website = session.website_url || '';
  const industry = session.industry || session.business_type || '';

  // Determine LocalBusiness subtype
  const subtypeMap: Record<string, string> = {
    plumbing: 'Plumber', plumber: 'Plumber',
    electrical: 'Electrician', electrician: 'Electrician',
    hvac: 'HVACBusiness', 'air conditioning': 'HVACBusiness',
    dental: 'Dentist', dentist: 'Dentist',
    legal: 'LegalService', lawyer: 'Attorney', attorney: 'Attorney',
    restaurant: 'Restaurant', 'real estate': 'RealEstateAgent',
    roofing: 'RoofingContractor', roofer: 'RoofingContractor',
    automotive: 'AutoRepair', 'auto repair': 'AutoRepair',
    landscaping: 'LandscapingBusiness', 
    cleaning: 'HousePainter', // closest match
    moving: 'MovingCompany',
    insurance: 'InsuranceAgency',
    accounting: 'AccountingService',
  };

  const industryLower = industry.toLowerCase();
  let localBizType = 'LocalBusiness';
  for (const [key, value] of Object.entries(subtypeMap)) {
    if (industryLower.includes(key)) {
      localBizType = value;
      break;
    }
  }

  return `
## Schema Markup Templates

### 1. LocalBusiness Schema (Homepage / About / Contact)
\`\`\`json
{
  "@context": "https://schema.org",
  "@type": "${localBizType}",
  "name": "${bizName}",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "${session.street_address || ''}",
    "addressLocality": "${session.city || ''}",
    "addressRegion": "${session.state || ''}",
    "postalCode": "${session.zip_code || ''}",
    "addressCountry": "US"
  },
  "telephone": "${phone}",
  "email": "${email}",
  "url": "${website}",
  "image": "[LOGO_URL]",
  "openingHoursSpecification": "[HOURS_ARRAY]",
  "geo": { "@type": "GeoCoordinates", "latitude": "[LAT]", "longitude": "[LNG]" },
  "areaServed": { "@type": "City", "name": "${session.city || ''}" },
  "priceRange": "$$"
}
\`\`\`

### 2. Service Schema (Each Service Page)
\`\`\`json
{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "[SERVICE_NAME]",
  "provider": { "@type": "${localBizType}", "name": "${bizName}" },
  "areaServed": { "@type": "City", "name": "${session.city || ''}" },
  "description": "[SERVICE_DESCRIPTION]",
  "url": "[PAGE_URL]"
}
\`\`\`

### 3. FAQPage Schema (FAQ Sections)
\`\`\`json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "[QUESTION]",
      "acceptedAnswer": { "@type": "Answer", "text": "[ANSWER]" }
    }
  ]
}
\`\`\`

### 4. BreadcrumbList Schema (All Pages)
\`\`\`json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "${website}" },
    { "@type": "ListItem", "position": 2, "name": "[PAGE_NAME]", "item": "[PAGE_URL]" }
  ]
}
\`\`\`

### 5. AggregateRating Schema (If Applicable)
\`\`\`json
{
  "@context": "https://schema.org",
  "@type": "AggregateRating",
  "ratingValue": "[AVG_RATING]",
  "reviewCount": "[REVIEW_COUNT]",
  "bestRating": "5",
  "worstRating": "1"
}
\`\`\`
`;
}

/**
 * Get NAP consistency enforcement block for prompts
 */
export function getNAPConsistencyBlock(session: any): string {
  return `
## ⚠️ CRITICAL: NAP CONSISTENCY REQUIREMENT

You MUST use the EXACT business information below on EVERY page. Do NOT vary the format, abbreviate, or paraphrase any of these details. NAP consistency across all pages is a critical local SEO ranking factor.

**Name:** ${session.business_name}
**Address:** ${session.street_address || 'Not specified'}, ${session.city || 'Not specified'}, ${session.state || 'Not specified'} ${session.zip_code || 'Not specified'}
**Phone:** ${session.phone_number || 'Not specified'}
**Email:** ${session.contact_email || 'Not specified'}

Use this EXACT format everywhere contact information appears. No abbreviations (e.g., "St" vs "Street"), no variations (e.g., different phone formats).
`;
}

export async function updateThinkingProgress(
  sessionId: string,
  subphase: string,
  thinking: string,
  session: any
) {
  // Map subphase to field name
  const fieldMap: Record<string, string> = {
    '4.1': 'competitive_intelligence',
    '4.2': 'seo_strategy',
    '4.3': 'cro_optimization',
    '4.4': 'wireframe',
    '4.5': 'ui_design',
    '4.6': 'all_copy',
    '4.7': 'page_prompts',
    '4.8': 'page_prompts',
    '4.9': 'page_prompts'
  };
  
  const field = fieldMap[subphase] || 'final_synthesis';

  // Update in-memory cache only (no DB write). Thinking content is ephemeral
  // and streamed to the frontend via Redis pub/sub, not persisted.
  const currentPhase4Data = (await getPhase4Synthesis(sessionId).catch(() => ({}))) as Record<string, unknown>;
  const updated = {
    ...currentPhase4Data,
    current_subphase: subphase,
    [field]: {
      ...((currentPhase4Data[field] as object) || {}),
      thinking
    }
  };
  phase4Cache.set(sessionId, updated);

}
