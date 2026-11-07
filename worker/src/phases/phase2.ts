import { supabase, supabaseWithRetry } from '../lib/supabase';
import { decrypt } from '../lib/encryption';
import { searchWithTavily } from '../lib/tavily-client';
import { DataForSEOClient, loadDataForSEOConfig, DataForSEOCredentials } from '../lib/dataforseo-client';
import { logApiKeyUsage, logServiceUsage } from '../lib/audit-logger';
import { withTimeout, TIMEOUTS } from '../lib/timeout-helper';
import { loadTavilyConfig } from '../lib/tavily-config-loader';
// Phase 2 research prompts (from DB) must NOT ask Tavily for keyword volume or CPC so the SEO report can use DataForSEO as the single source of truth for metrics.
import { loadResearchPrompts, replaceTemplateVariables } from '../lib/research-prompt-loader';
import {
  loadCheckpoint,
  saveCheckpoint,
  clearPhaseCheckpoint,
  isPromptCompleted,
  Phase2Checkpoint
} from '../lib/checkpoint-manager';
import { logger } from '../lib/logger';

/**
 * Discover optimal seed keyword for Phase 2 keyword research.
 * Prefers Phase 1's localized_keyword (e.g. "plumber flint michigan") so SERP and
 * keyword suggestions stay local; falls back to optimized_keyword then discovery.
 */
async function getSeedKeywordForPhase2(
  session: any,
  dfClient: DataForSEOClient,
  locationCode: number,
  languageCode: string
): Promise<{ keyword: string; source: string }> {
  const seed = session.phase1_dataforseo?.seed_keyword;
  // Prefer localized seed so DataForSEO returns local SERP and local keyword suggestions
  if (seed?.localized_keyword) {
    logger.debug(`[Phase2-Keyword-Discovery] Using Phase 1 localized seed: "${seed.localized_keyword}"`);
    return { keyword: seed.localized_keyword, source: 'phase1_localized' };
  }
  if (seed?.optimized_keyword) {
    const base = seed.optimized_keyword;
    const locationParts = [session.city, session.state].filter(Boolean).map((s: string) => s.trim());
    const localized = locationParts.length > 0 ? `${base} ${locationParts.join(' ')}`.trim() : base;
    logger.debug(`[Phase2-Keyword-Discovery] Using Phase 1 keyword + location: "${localized}"`);
    return { keyword: localized, source: 'phase1_optimized' };
  }

  // Otherwise, discover from user input using localized query so suggestions are local
  const userInput = session.primary_service || session.industry;
  const locationParts = [session.city, session.state].filter(Boolean).map((s: string) => s.trim());
  const discoveryQuery = locationParts.length > 0 ? `${userInput} ${locationParts.join(' ')}`.trim() : userInput;
  logger.debug(`[Phase2-Keyword-Discovery] Discovering seed from: "${discoveryQuery}"`);

  try {
    const suggestions = await dfClient.keywordSuggestions(
      discoveryQuery,
      locationCode,
      languageCode,
      50
    );

    if (suggestions.length > 0) {
      const categoryKeywords = suggestions.filter(kw =>
        kw.keyword.split(' ').length <= 4 &&
        (kw.search_volume || 0) >= 50
      );
      if (categoryKeywords.length > 0) {
        const best = categoryKeywords.sort((a, b) =>
          (b.search_volume || 0) - (a.search_volume || 0)
        )[0];
        logger.debug(`[Phase2-Keyword-Discovery] Selected: "${best.keyword}" (${best.search_volume} vol)`);
        return { keyword: best.keyword, source: 'keyword_suggestions' };
      }
      logger.debug(`[Phase2-Keyword-Discovery] Using first suggestion: "${suggestions[0].keyword}"`);
      return { keyword: suggestions[0].keyword, source: 'first_suggestion' };
    }
  } catch (error: any) {
    logger.warn(`[Phase2-Keyword-Discovery] Error: ${error.message}`);
  }

  const fallback = locationParts.length > 0 ? `${userInput} ${locationParts.join(' ')}`.trim() : session.industry.split(' ').slice(0, 2).join(' ');
  logger.debug(`[Phase2-Keyword-Discovery] Using fallback: "${fallback}"`);
  return { keyword: fallback, source: 'fallback' };
}

export interface PhaseOptions {
  /** Skip DataForSEO calls (used when intermediate/advanced pipeline handles DataForSEO separately) */
  skipDataForSEO?: boolean;
}

export async function processPhase2(sessionId: string, options?: PhaseOptions) {
  const startTime = Date.now();

  // CRITICAL: Mark phase as active IMMEDIATELY so frontend can connect to stream
  await supabase
    .from('research_sessions')
    .update({
      current_phase: 2,
      status: 'in_progress'
    })
    .eq('id', sessionId);

  logger.debug('[Phase2] ✅ Phase 2 marked as ACTIVE');

  const { data: session, error: sessionError } = await supabaseWithRetry(
    () => supabase
      .from('research_sessions')
      .select('id, user_id, business_name, industry, primary_service, services, location, city, state, zip_code, tier, phone_number, street_address, operating_hours, website_url, google_business_url, service_area_cities, target_audience, search_radius, location_code, location_name')
      .eq('id', sessionId)
      .single(),
    'Phase2 load session',
  );

  if (sessionError || !session) {
    throw new Error('Session not found');
  }

  // Load Phase 1 summary from dedicated table
  const { data: phase1Row } = await supabaseWithRetry(
    () => supabase
      .from('research_session_phase_data')
      .select('summary, citations, dataforseo_data')
      .eq('session_id', sessionId)
      .eq('phase', 1)
      .maybeSingle(),
    'Phase2 load phase1 data',
  );

  const phase1Summary = phase1Row?.summary?.content || '';
  if (!phase1Summary) {
    throw new Error('Phase 1 summary not found');
  }

  // Attach to session for backward compat
  (session as any).phase1_summary = phase1Row?.summary;
  (session as any).phase1_citations = phase1Row?.citations;
  (session as any).phase1_dataforseo = phase1Row?.dataforseo_data;

  const { data: keys, error: keysError } = await supabaseWithRetry(
    () => supabase
      .from('user_api_keys')
      .select('*')
      .eq('user_id', session.user_id)
      .single(),
    'Phase2 load API keys',
  );

  if (keysError || !keys) {
    throw new Error('API keys not found');
  }

  // Decrypt keys
  const apiKeys = {
    claude: decrypt(keys.claude_api_key_encrypted),
    tavily: decrypt(keys.tavily_api_key_encrypted),
  };

  // Check for DataForSEO credentials (optional)
  let dataforseoCredentials: DataForSEOCredentials | null = null;
  if (keys.dataforseo_login_encrypted && keys.dataforseo_password_encrypted) {
    dataforseoCredentials = {
      login: decrypt(keys.dataforseo_login_encrypted),
      password: decrypt(keys.dataforseo_password_encrypted),
    };
    logger.debug('[Phase2] DataForSEO credentials found - enhanced keyword data will be collected');
  }

  // Log key decryption for phase 2
  logApiKeyUsage({
    userId: session.user_id,
    action: `keys_decrypted_for_phase2`,
    phase: 2,
    sessionId,
    success: true
  });

  // Step 1: Load dynamic research prompts from database
  const prompts = await loadResearchPrompts(2);
  const tavilyConfig = await loadTavilyConfig(2);
  
  logger.debug(`[Phase2] Running ${prompts.length} research prompts in parallel...`);
  logger.debug(`[Phase2] Global Tavily config:`, {
    maxResults: tavilyConfig.max_results,
    searchDepth: tavilyConfig.search_depth
  });

  // Step 2: Prepare prompts with variable replacement
  const preparedPrompts = prompts.map(prompt => ({
    id: prompt.id,
    name: prompt.name,
    query: replaceTemplateVariables(prompt.prompt_template, session),
    maxResults: prompt.override_max_results || tavilyConfig.max_results
  }));

  // CHECKPOINT RECOVERY: Load checkpoint and filter out completed prompts
  const checkpointData = await loadCheckpoint(sessionId);
  const phase2Checkpoint = checkpointData.phase2;
  
  // Load existing results from previous session if available
  let existingResults: any[] = [];
  if (phase2Checkpoint && phase2Checkpoint.completed_prompts.length > 0) {
    const { data: previousSession } = await supabase
      .from('research_sessions')
      .select('phase2_raw')
      .eq('id', sessionId)
      .single();
    
    existingResults = previousSession?.phase2_raw?.searches || [];
    logger.debug(`[Phase2] 🔄 RESUMING: ${phase2Checkpoint.completed_prompts.length}/${preparedPrompts.length} prompts already completed`);
  }

  // Filter prompts: only run incomplete ones
  const remainingPrompts = preparedPrompts.filter(
    prompt => !isPromptCompleted(phase2Checkpoint, prompt.id)
  );
  
  logger.debug(`[Phase2] Executing ${remainingPrompts.length} remaining prompts...`);

  // Initialize checkpoint if this is the first run
  if (!phase2Checkpoint) {
    await saveCheckpoint(sessionId, {
      phase2: {
        completed_prompts: [],
        last_prompt_index: -1,
        total_prompts: preparedPrompts.length
      }
    });
  }

  // Step 3: Execute remaining prompts in parallel
  logServiceUsage(session.user_id, 'tavily', 2, sessionId);
  const tavilyStart = Date.now();
  
  const newResults = await Promise.all(
    remainingPrompts.map(prompt =>
      withTimeout(
        searchWithTavily(apiKeys.tavily, {
          query: prompt.query,
          searchDepth: tavilyConfig.search_depth || 'advanced',
          maxResults: prompt.maxResults,
          model: tavilyConfig.model || 'auto'
        }),
        TIMEOUTS.TAVILY,
        `Phase 2: Tavily search timed out for prompt "${prompt.name}"`
      ).then(result => ({
        promptId: prompt.id,
        promptName: prompt.name,
        sources: result.results
      }))
    )
  );

  // Combine existing and new results
  const results = [...existingResults, ...newResults];
  
  // CHECKPOINT: Save completion for all prompts
  if (remainingPrompts.length > 0) {
    const allCompletedPromptIds = preparedPrompts.map(p => p.id);
    await saveCheckpoint(sessionId, {
      phase2: {
        completed_prompts: allCompletedPromptIds,
        last_prompt_index: preparedPrompts.length - 1,
        total_prompts: preparedPrompts.length
      }
    });
    logger.debug('[Phase2] ✅ All prompts completed, checkpoint saved');
  }

  const tavilyDuration = Date.now() - tavilyStart;
  const totalSources = results.reduce((sum, r) => sum + r.sources.length, 0);
  
  logger.debug(`[Phase2] Completed ${prompts.length} prompts in ${tavilyDuration}ms, gathered ${totalSources} sources`);

  // Flatten all sources for citations
  const allSources = results.flatMap(r => r.sources);

  // Build update data
  const updateData: any = {
    phase2_raw: {
      searches: results,
      totalSources,
      duration: tavilyDuration,
      timestamp: new Date().toISOString()
    },
    phase2_summary: {
      searches: results,
      totalSources,
      duration: tavilyDuration,
      content: `Phase 2 complete - ${totalSources} sources from ${prompts.length} focused searches`,
      timestamp: new Date().toISOString()
    },
    phase2_citations: allSources.map(r => ({
      url: r.url,
      title: r.title,
      snippet: r.content.substring(0, 200),
      published_date: r.published_date
    }))
  };

  // ─── DataForSEO Enrichment (if credentials available and not skipped) ───────
  // When running intermediate/advanced pipelines, DataForSEO is handled by the wave system
  // to avoid duplicate API calls and billing
  if (dataforseoCredentials && !options?.skipDataForSEO) {
    try {
      const dfConfig = await loadDataForSEOConfig(2);
      
      if (dfConfig.enabled !== false) {
        logServiceUsage(session.user_id, 'dataforseo', 2, sessionId);
        const dfClient = new DataForSEOClient(dataforseoCredentials);
        const dfStartTime = Date.now();

        let locationCode = dfConfig.location_code || 2840;
        const languageCode = dfConfig.language_code || 'en';

        // Resolve location from session city/state instead of using default 2840 (US)
        // First check if Phase 1 already resolved and stored it
        if (session.location_code && session.location_code !== 2840) {
          locationCode = session.location_code;
          logger.debug(`[Phase2-DataForSEO] Using Phase 1 resolved location code: ${locationCode}`);
        } else if (session.city && session.state) {
          try {
            const zip = session.zip_code?.trim() || null;
            const resolved = await dfClient.resolveLocationWithFallback(session.city, session.state, zip);
            locationCode = resolved.location_code;
            logger.debug(`[Phase2-DataForSEO] Resolved location: ${resolved.location_name} (${locationCode})`);
            await supabase
              .from('research_sessions')
              .update({ location_code: locationCode, location_name: resolved.location_name })
              .eq('id', sessionId);
          } catch (locError: any) {
            logger.warn(`[Phase2-DataForSEO] Location resolution failed, using default:`, locError.message);
          }
        }

        // Sub-step 0: Get optimal seed keyword (reuse from Phase 1 if available)
        const seedKeywordData = await getSeedKeywordForPhase2(
          session,
          dfClient,
          locationCode,
          languageCode
        );
        const seedKeyword = seedKeywordData.keyword;
        logger.debug(`[Phase2-DataForSEO] Using seed keyword: "${seedKeyword}" (source: ${seedKeywordData.source})`);

        // Sub-step 2a: Find SERP Competitors
        logger.debug(`[Phase2-DataForSEO] Identifying SERP competitors for "${seedKeyword}"...`);

        const serpCompetitors = await dfClient.serpCompetitors(
          seedKeyword,
          locationCode,
          languageCode,
          dfConfig.max_serp_competitors || 5
        );
        logger.debug(`[Phase2-DataForSEO] Found ${serpCompetitors.length} SERP competitors for "${seedKeyword}"`);

        // Sub-step 2b: Get Ranked Keywords for top competitors
        logger.debug('[Phase2-DataForSEO] Extracting competitor keywords...');

        const maxCompetitors = Math.min(serpCompetitors.length, dfConfig.max_serp_competitors || 5);
        const allRankedKeywords: any[] = [];
        
        for (let i = 0; i < maxCompetitors; i++) {
          const comp = serpCompetitors[i];
          try {
            const keywords = await dfClient.rankedKeywords(
              comp.domain,
              locationCode,
              languageCode,
              dfConfig.max_ranked_keywords_per_competitor || 100
            );
            allRankedKeywords.push({
              domain: comp.domain,
              keywords: keywords,
              count: keywords.length
            });
          } catch (err: any) {
            logger.warn(`[Phase2-DataForSEO] Failed to get keywords for ${comp.domain}:`, err.message);
          }
        }

        // Deduplicate keywords across competitors
        const keywordMap = new Map<string, any>();
        for (const comp of allRankedKeywords) {
          for (const kw of comp.keywords) {
            if (!keywordMap.has(kw.keyword)) {
              keywordMap.set(kw.keyword, kw);
            }
          }
        }
        const uniqueKeywords = Array.from(keywordMap.values());
        logger.debug(`[Phase2-DataForSEO] ${uniqueKeywords.length} unique keywords from ${allRankedKeywords.length} competitors`);

        // Sub-step 2c: Keyword Suggestions
        logger.debug('[Phase2-DataForSEO] Discovering keyword opportunities...');

        let keywordSuggestions: any[] = [];
        try {
          keywordSuggestions = await dfClient.keywordSuggestions(
            seedKeyword,
            locationCode,
            languageCode,
            dfConfig.keyword_suggestion_limit || 50
          );
        } catch (err: any) {
          logger.warn('[Phase2-DataForSEO] Keyword suggestions failed:', err.message);
        }

        // Sub-step 2d: Enrich with metrics via Keyword Overview
        logger.debug('[Phase2-DataForSEO] Enriching keywords with metrics...');

        // Combine and deduplicate all keywords for enrichment
        const allKeywordStrings = new Set<string>();
        for (const kw of uniqueKeywords) allKeywordStrings.add(kw.keyword);
        for (const kw of keywordSuggestions) allKeywordStrings.add(kw.keyword);
        
        const batchSize = dfConfig.keyword_enrichment_batch_size || 100;
        const keywordsToEnrich = Array.from(allKeywordStrings).slice(0, batchSize);

        let enrichedKeywords: any[] = [];
        if (keywordsToEnrich.length > 0) {
          try {
            enrichedKeywords = await dfClient.keywordOverview(
              keywordsToEnrich,
              locationCode,
              languageCode
            );
          } catch (err: any) {
            logger.warn('[Phase2-DataForSEO] Keyword enrichment failed:', err.message);
          }
        }

        // Identify low-hanging fruit (high volume, low difficulty)
        const lowHangingFruit = enrichedKeywords
          .filter(kw => kw.search_volume > 50 && kw.keyword_difficulty < 40)
          .sort((a, b) => b.search_volume - a.search_volume)
          .slice(0, 20);

        const dfDuration = Date.now() - dfStartTime;

        // Store DataForSEO results (seed_keyword is localized for local SERP/suggestions)
        updateData.phase2_dataforseo = {
          seed_keyword: {
            keyword: seedKeyword,
            source: seedKeywordData.source,
            location_code: locationCode,
            location_name: session.location_name || null
          },
          serp_competitors: serpCompetitors,
          ranked_keywords_by_competitor: allRankedKeywords,
          keyword_suggestions: keywordSuggestions,
          enriched_keywords: enrichedKeywords,
          low_hanging_fruit: lowHangingFruit,
          stats: {
            total_competitors: serpCompetitors.length,
            total_unique_keywords: uniqueKeywords.length,
            total_suggestions: keywordSuggestions.length,
            total_enriched: enrichedKeywords.length,
            total_low_hanging_fruit: lowHangingFruit.length,
          },
          api_cost: dfClient.getCost(),
          api_calls: dfClient.getCallCount(),
          duration: dfDuration,
          timestamp: new Date().toISOString()
        };

        updateData.phase2_summary.content += ` | DataForSEO: ${serpCompetitors.length} competitors, ${uniqueKeywords.length} keywords, ${lowHangingFruit.length} opportunities (seed: "${seedKeyword}")`;
        updateData.phase2_summary.has_dataforseo = true;
        updateData.phase2_summary.dataforseo_status = 'complete';
        updateData.phase2_summary.seed_keyword = seedKeyword;

        logger.debug(`[Phase2-DataForSEO] Completed in ${dfDuration}ms - ${serpCompetitors.length} competitors, ${enrichedKeywords.length} enriched keywords using "${seedKeyword}"`);
      }
    } catch (dfError: any) {
      logger.error('[Phase2-DataForSEO] Error (non-fatal):', dfError.message);
      updateData.phase2_dataforseo = {
        error: dfError.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  const { error: updateError } = await supabase
    .from('research_session_phase_data')
    .upsert({
      session_id: sessionId,
      phase: 2,
      raw_data: updateData.phase2_raw,
      summary: updateData.phase2_summary,
      citations: updateData.phase2_citations || [],
      dataforseo_data: updateData.phase2_dataforseo || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'session_id,phase' });

  if (updateError) {
    logger.error('[Phase2] Failed to save phase data:', updateError);
    throw new Error(`Phase 2 data save failed: ${updateError.message}`);
  }

  const totalDuration = Date.now() - startTime;
  logger.debug(`[Phase2] ✅ Completed in ${totalDuration}ms - ${totalSources} sources from ${prompts.length} prompts`);
}
