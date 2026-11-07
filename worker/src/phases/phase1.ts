import { supabase, supabaseWithRetry } from '../lib/supabase';
import { decrypt } from '../lib/encryption';
import { searchWithTavily } from '../lib/tavily-client';
import { DataForSEOClient, loadDataForSEOConfig, DataForSEOCredentials } from '../lib/dataforseo-client';
import { logApiKeyUsage, logServiceUsage } from '../lib/audit-logger';
import { withTimeout, TIMEOUTS } from '../lib/timeout-helper';
import { loadTavilyConfig } from '../lib/tavily-config-loader';
import { loadResearchPrompts, replaceTemplateVariables } from '../lib/research-prompt-loader';
import {
  loadCheckpoint,
  saveCheckpoint,
  clearPhaseCheckpoint,
  isPromptCompleted,
  Phase1Checkpoint
} from '../lib/checkpoint-manager';
import { logger } from '../lib/logger';

/**
 * Discover optimal seed keyword from user input
 * 
 * This function takes user's potentially long/specific input (e.g., "interior and exterior detailing")
 * and finds a better, more searchable keyword (e.g., "auto detailing") that will:
 * 1. Match more businesses in Google My Business
 * 2. Find more SERP competitors
 * 3. Discover more related keywords
 * 
 * Strategy:
 * - Get keyword suggestions for user input
 * - Filter for short, high-volume business category terms
 * - Select highest volume + relevance match
 * - Fallback to industry extraction if needed
 */
async function discoverSeedKeyword(
  userInput: string,
  industry: string,
  dfClient: DataForSEOClient,
  locationCode: number,
  languageCode: string
): Promise<{ keyword: string; source: string; volume: number }> {
  logger.debug(`[Phase1-Keyword-Discovery] User input: "${userInput}"`);
  
  try {
    // Step 1: Get keyword suggestions for user's input
    const suggestions = await dfClient.keywordSuggestions(
      userInput,
      locationCode,
      languageCode,
      50 // Get top 50 suggestions
    );
    
    logger.debug(`[Phase1-Keyword-Discovery] Found ${suggestions.length} suggestions`);
    
    if (suggestions.length === 0) {
      throw new Error('No keyword suggestions found');
    }
    
    // Step 2: Filter for business-category keywords (shorter, higher volume)
    const categoryKeywords = suggestions.filter(kw => {
      const wordCount = kw.keyword.split(' ').length;
      const searchVolume = kw.search_volume || 0;
      const industryWords = industry.toLowerCase().split(' ');
      const keywordLower = kw.keyword.toLowerCase();
      
      // Must be 1-3 words, have decent volume, and relate to industry
      return wordCount <= 3 && 
             searchVolume >= 100 && 
             industryWords.some(word => word.length > 3 && keywordLower.includes(word));
    });
    
    logger.debug(`[Phase1-Keyword-Discovery] Filtered to ${categoryKeywords.length} category keywords`);
    
    // Step 3: Select best seed keyword (highest volume)
    if (categoryKeywords.length > 0) {
      const bestKeyword = categoryKeywords.sort((a, b) => 
        (b.search_volume || 0) - (a.search_volume || 0)
      )[0];
      
      logger.debug(`[Phase1-Keyword-Discovery] ✅ Selected: "${bestKeyword.keyword}" (${bestKeyword.search_volume} vol)`);
      return {
        keyword: bestKeyword.keyword,
        source: 'keyword_suggestions',
        volume: bestKeyword.search_volume || 0
      };
    }
    
    // Step 4: Fallback to any suggestion with decent volume
    const anyGoodKeyword = suggestions.filter(kw => 
      (kw.search_volume || 0) >= 50 && 
      kw.keyword.split(' ').length <= 3
    );
    
    if (anyGoodKeyword.length > 0) {
      const selected = anyGoodKeyword[0];
      logger.debug(`[Phase1-Keyword-Discovery] ⚠️ Using broader fallback: "${selected.keyword}" (${selected.search_volume} vol)`);
      return {
        keyword: selected.keyword,
        source: 'fallback_suggestion',
        volume: selected.search_volume || 0
      };
    }
    
    throw new Error('No suitable keywords found in suggestions');
    
  } catch (error: any) {
    console.warn(`[Phase1-Keyword-Discovery] Error getting suggestions: ${error.message}`);
    
    // Step 5: Ultimate fallback - extract core term from industry
    // e.g., "interior and exterior detailing" → "detailing"
    // e.g., "emergency plumbing services" → "plumbing"
    const words = industry.toLowerCase().split(' ').filter(w => w.length > 3);
    const coreWord = words.find(w => 
      !['interior', 'exterior', 'emergency', 'professional', 'services', 'service'].includes(w)
    ) || words[0] || industry;
    
    logger.debug(`[Phase1-Keyword-Discovery] ⚠️ Using extracted fallback: "${coreWord}"`);
    return {
      keyword: coreWord,
      source: 'extracted_fallback',
      volume: 0
    };
  }
}

export interface PhaseOptions {
  /** Skip DataForSEO calls (used when intermediate/advanced pipeline handles DataForSEO separately) */
  skipDataForSEO?: boolean;
}

export async function processPhase1(sessionId: string, options?: PhaseOptions) {
  const startTime = Date.now();

  // CRITICAL: Mark phase as active IMMEDIATELY so frontend can connect to stream
  await supabase
    .from('research_sessions')
    .update({
      current_phase: 1,
      status: 'in_progress'
    })
    .eq('id', sessionId);

  logger.debug('[Phase1] ✅ Phase 1 marked as ACTIVE');

  const { data: session, error: sessionError } = await supabaseWithRetry(
    () => supabase
      .from('research_sessions')
      .select('id, user_id, business_name, industry, primary_service, services, location, city, state, zip_code, tier, phone_number, street_address, operating_hours, website_url, google_business_url, service_area_cities, target_audience, search_radius, location_code, location_name')
      .eq('id', sessionId)
      .single(),
    'Phase1 load session',
  );

  if (sessionError || !session) {
    throw new Error('Session not found');
  }

  const { data: keys, error: keysError } = await supabaseWithRetry(
    () => supabase
      .from('user_api_keys')
      .select('*')
      .eq('user_id', session.user_id)
      .single(),
    'Phase1 load API keys',
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
    logger.debug('[Phase1] DataForSEO credentials found - enhanced SEO data will be collected');
  } else {
    logger.debug('[Phase1] No DataForSEO credentials - running Tavily-only mode');
  }

  // Log key decryption for phase 1
  logApiKeyUsage({
    userId: session.user_id,
    action: `keys_decrypted_for_phase1`,
    phase: 1,
    sessionId,
    success: true
  });

  // Step 1: Load dynamic research prompts from database
  const prompts = await loadResearchPrompts(1);
  const tavilyConfig = await loadTavilyConfig(1);
  
  logger.debug(`[Phase1] Running ${prompts.length} research prompts in parallel...`);
  logger.debug(`[Phase1] Global Tavily config:`, {
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
  const phase1Checkpoint = checkpointData.phase1;
  
  // Load existing results from previous session if available
  let existingResults: any[] = [];
  if (phase1Checkpoint && phase1Checkpoint.completed_prompts.length > 0) {
    const { data: previousSession } = await supabase
      .from('research_sessions')
      .select('phase1_raw')
      .eq('id', sessionId)
      .single();
    
    existingResults = previousSession?.phase1_raw?.searches || [];
    logger.debug(`[Phase1] 🔄 RESUMING: ${phase1Checkpoint.completed_prompts.length}/${preparedPrompts.length} prompts already completed`);
  }

  // Filter prompts: only run incomplete ones
  const remainingPrompts = preparedPrompts.filter(
    prompt => !isPromptCompleted(phase1Checkpoint, prompt.id)
  );
  
  logger.debug(`[Phase1] Executing ${remainingPrompts.length} remaining prompts...`);

  // Initialize checkpoint if this is the first run
  if (!phase1Checkpoint) {
    await saveCheckpoint(sessionId, {
      phase1: {
        completed_prompts: [],
        last_prompt_index: -1,
        total_prompts: preparedPrompts.length
      }
    });
  }

  // Step 3: Execute remaining prompts in parallel
  logServiceUsage(session.user_id, 'tavily', 1, sessionId);
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
        `Phase 1: Tavily search timed out for prompt "${prompt.name}"`
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
      phase1: {
        completed_prompts: allCompletedPromptIds,
        last_prompt_index: preparedPrompts.length - 1,
        total_prompts: preparedPrompts.length
      }
    });
    logger.debug('[Phase1] ✅ All prompts completed, checkpoint saved');
  }

  const tavilyDuration = Date.now() - tavilyStart;
  const totalSources = results.reduce((sum, r) => sum + r.sources.length, 0);
  
  logger.debug(`[Phase1] Completed ${prompts.length} prompts in ${tavilyDuration}ms, gathered ${totalSources} sources`);

  // Flatten all sources for citations
  const allSources = results.flatMap(r => r.sources);

  // Store Tavily results grouped by prompt
  const updateData: any = {
    phase1_raw: {
      searches: results,
      totalSources,
      duration: tavilyDuration,
      timestamp: new Date().toISOString()
    },
    phase1_summary: {
      searches: results,
      totalSources,
      duration: tavilyDuration,
      content: `Phase 1 complete - ${totalSources} sources from ${prompts.length} focused searches`,
      timestamp: new Date().toISOString()
    },
    phase1_citations: allSources.map(r => ({
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
      const dfConfig = await loadDataForSEOConfig(1);
      
      if (dfConfig.enabled !== false) {
        logServiceUsage(session.user_id, 'dataforseo', 1, sessionId);
        const dfClient = new DataForSEOClient(dataforseoCredentials);
        const dfStartTime = Date.now();

        // Resolve location from session city/state instead of using default 2840 (US)
        let locationCode = dfConfig.location_code || 2840;
        let languageCode = dfConfig.language_code || 'en';
        
        if (session.city && session.state) {
          try {
            const zip = session.zip_code?.trim() || null;
            const resolved = await dfClient.resolveLocationWithFallback(session.city, session.state, zip);
            locationCode = resolved.location_code;
            logger.debug(`[Phase1-DataForSEO] Resolved location: ${resolved.location_name} (${locationCode})`);
            
            // Update session with resolved location for downstream phases
            await supabase
              .from('research_sessions')
              .update({ location_code: locationCode, location_name: resolved.location_name })
              .eq('id', sessionId);
          } catch (locError: any) {
            console.warn(`[Phase1-DataForSEO] Location resolution failed, using default:`, locError.message);
          }
        }

        logger.debug('[Phase1-DataForSEO] Discovering optimal search keywords...');

        // Sub-step 0: Discover optimal seed keyword
        const userInput = session.primary_service || session.industry;
        const seedKeywordData = await discoverSeedKeyword(
          userInput,
          session.industry,
          dfClient,
          locationCode,
          languageCode
        );
        
        const keyword = seedKeywordData.keyword;
        logger.debug(`[Phase1-DataForSEO] Using seed keyword: "${keyword}" (from: ${seedKeywordData.source}, volume: ${seedKeywordData.volume})`);

        logger.debug(`[Phase1-DataForSEO] Fetching local competitors for "${keyword}"...`);

        // Sub-step 1a: Google My Business search
        const locationQuery = `${session.city || ''} ${session.state || session.location || ''}`.trim();
        logger.debug(`[Phase1-DataForSEO] GMB search: "${keyword}" in "${locationQuery}"`);

        const gmbResults = await dfClient.searchGoogleMyBusiness(
          `${keyword} ${locationQuery}`,
          locationCode,
          languageCode,
          dfConfig.gmb_search_depth || 20
        );

        logger.debug('[Phase1-DataForSEO] Analyzing local pack rankings...');

        // Sub-step 1b: SERP Local Pack
        const localPackKeywords = Math.min(dfConfig.local_pack_keywords || 3, 5);
        
        // Build SERP queries using the optimized keyword as primary
        const serpQueries = [keyword]; // Start with optimized keyword
        
        // Add variations from services if available
        if (session.services) {
          const serviceList = session.services.split(',').map((s: string) => s.trim()).filter(Boolean);
          // For each service, try to use the core keyword + service modifier
          for (const service of serviceList.slice(0, localPackKeywords - 1)) {
            // If service is short, use it directly; otherwise combine with keyword
            if (service.split(' ').length <= 2) {
              serpQueries.push(service);
            } else {
              // Extract key term from service and combine with optimized keyword
              serpQueries.push(`${keyword} ${service.split(' ')[0]}`);
            }
          }
        }

        const serpResults = [];
        for (const query of serpQueries.slice(0, localPackKeywords)) {
          const serpData = await dfClient.serpLocalPack(
            `${query} ${locationQuery}`,
            locationCode,
            languageCode
          );
          serpResults.push({ query: `${query} ${locationQuery}`, ...serpData });
        }

        // ─── User's Own Business Analysis (if URL provided) ───────
        let userBusinessData = null;
        let competitivePosition = null;
        
        if (session.google_business_url) {
          try {
            logger.debug('[Phase1-DataForSEO] Fetching user\'s GMB profile...');
            
            userBusinessData = await dfClient.getBusinessDataByUrl(session.google_business_url);
            
            if (userBusinessData) {
              logger.debug(`[Phase1-DataForSEO] User business found: ${userBusinessData.title}`);
              
              // Calculate competitive position metrics
              const competitorRatings = gmbResults
                .filter(r => r.rating)
                .map(r => r.rating!.value);
              const competitorReviewCounts = gmbResults
                .filter(r => r.rating)
                .map(r => r.rating!.votes_count);
              
              const avgCompetitorRating = competitorRatings.length > 0
                ? competitorRatings.reduce((sum, r) => sum + r, 0) / competitorRatings.length
                : 0;
              const avgCompetitorReviews = competitorReviewCounts.length > 0
                ? competitorReviewCounts.reduce((sum, r) => sum + r, 0) / competitorReviewCounts.length
                : 0;
              
              // Check if user appears in local pack results
              const localPackPositions = serpResults.map(r => {
                const position = r.localPack.findIndex(lp => 
                  lp.url === session.google_business_url || 
                  lp.title.toLowerCase() === userBusinessData!.title.toLowerCase()
                );
                return {
                  query: r.query,
                  position: position + 1 // 0 = not found, 1-3 = position in pack
                };
              }).filter(p => p.position > 0);
              
              competitivePosition = {
                rating_vs_avg: userBusinessData.rating 
                  ? userBusinessData.rating.value - avgCompetitorRating 
                  : null,
                review_count_vs_avg: userBusinessData.rating 
                  ? userBusinessData.rating.votes_count - avgCompetitorReviews 
                  : null,
                in_local_pack: localPackPositions.length > 0,
                local_pack_positions: localPackPositions,
                competitor_avg_rating: avgCompetitorRating,
                competitor_avg_reviews: avgCompetitorReviews
              };
              
              logger.debug('[Phase1-DataForSEO] User business analysis complete:', {
                rating_gap: competitivePosition.rating_vs_avg?.toFixed(2),
                review_gap: competitivePosition.review_count_vs_avg,
                in_local_pack: competitivePosition.in_local_pack,
                local_pack_count: localPackPositions.length
              });
            } else {
              console.warn('[Phase1-DataForSEO] Could not fetch user business data from provided URL');
            }
          } catch (userBizError: any) {
            logger.error('[Phase1-DataForSEO] Error fetching user GMB data (non-fatal):', userBizError.message);
            // Don't throw - this is optional enhancement
          }
        }

        const dfDuration = Date.now() - dfStartTime;

        // Build localized seed for downstream phases (local SERP + keyword suggestions)
        const locationParts = [session.city, session.state].filter(Boolean).map((s: string) => s.trim());
        const localizedKeyword = locationParts.length > 0
          ? `${keyword} ${locationParts.join(' ')}`.trim()
          : keyword;

        // Store DataForSEO results (including user business analysis if available)
        updateData.phase1_dataforseo = {
          seed_keyword: {
            original_input: userInput,
            optimized_keyword: keyword,
            localized_keyword: localizedKeyword,
            source: seedKeywordData.source,
            search_volume: seedKeywordData.volume
          },
          gmb_results: gmbResults,
          serp_results: serpResults,
          user_business: userBusinessData,
          competitive_position: competitivePosition,
          total_local_competitors: gmbResults.length,
          total_local_pack_entries: serpResults.reduce((sum, r) => sum + r.localPack.length, 0),
          total_organic_results: serpResults.reduce((sum, r) => sum + r.organic.length, 0),
          api_cost: dfClient.getCost(),
          api_calls: dfClient.getCallCount(),
          duration: dfDuration,
          timestamp: new Date().toISOString()
        };

        // Update summary to reflect DataForSEO data
        updateData.phase1_summary.content += ` | DataForSEO: ${gmbResults.length} local competitors, ${serpResults.reduce((sum: number, r: any) => sum + r.localPack.length, 0)} local pack entries (using "${keyword}")`;
        updateData.phase1_summary.has_dataforseo = true;
        updateData.phase1_summary.dataforseo_status = 'complete';
        updateData.phase1_summary.optimized_keyword = keyword;

        logger.debug(`[Phase1-DataForSEO] Completed in ${dfDuration}ms - ${gmbResults.length} GMB results, ${serpResults.length} SERP queries using keyword "${keyword}"`);
      }
    } catch (dfError: any) {
      logger.error('[Phase1-DataForSEO] Error (non-fatal):', dfError.message);
      updateData.phase1_dataforseo = {
        error: dfError.message,
        timestamp: new Date().toISOString()
      };
      // Don't throw - DataForSEO failure is non-fatal, Tavily data is still available
    }
  }

  const { error: updateError } = await supabase
    .from('research_session_phase_data')
    .upsert({
      session_id: sessionId,
      phase: 1,
      raw_data: updateData.phase1_raw,
      summary: updateData.phase1_summary,
      citations: updateData.phase1_citations || [],
      dataforseo_data: updateData.phase1_dataforseo || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'session_id,phase' });

  if (updateError) {
    logger.error('[Phase1] Failed to save phase data:', updateError);
    throw new Error(`Phase 1 data save failed: ${updateError.message}`);
  }

  const totalDuration = Date.now() - startTime;
  logger.debug(`[Phase1] ✅ Completed in ${totalDuration}ms - ${totalSources} sources from ${prompts.length} prompts`);
}
