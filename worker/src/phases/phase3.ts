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
  Phase3Checkpoint
} from '../lib/checkpoint-manager';
import { logger } from '../lib/logger';

export interface PhaseOptions {
  /** Skip DataForSEO calls (used when intermediate/advanced pipeline handles DataForSEO separately) */
  skipDataForSEO?: boolean;
}

export async function processPhase3(sessionId: string, options?: PhaseOptions) {
  const startTime = Date.now();

  // CRITICAL: Mark phase as active IMMEDIATELY so frontend can connect to stream
  await supabase
    .from('research_sessions')
    .update({
      current_phase: 3,
      status: 'in_progress'
    })
    .eq('id', sessionId);

  logger.debug('[Phase3] ✅ Phase 3 marked as ACTIVE');

  const { data: sessionRaw, error: sessionError } = await supabaseWithRetry(
    () => supabase
      .from('research_sessions')
      .select('id, user_id, business_name, industry, primary_service, services, location, city, state, zip_code, tier, phone_number, street_address, operating_hours, website_url, google_business_url, service_area_cities, target_audience, search_radius, location_code, location_name')
      .eq('id', sessionId)
      .single(),
    'Phase3 load session',
  );

  if (sessionError || !sessionRaw) {
    throw new Error('Session not found');
  }

  const session: any = { ...sessionRaw };

  // Load phase 1-2 data from dedicated table
  const { data: phaseRows } = await supabaseWithRetry(
    () => supabase
      .from('research_session_phase_data')
      .select('phase, summary, citations, dataforseo_data')
      .eq('session_id', sessionId)
      .in('phase', [1, 2]),
    'Phase3 load phase 1-2 data',
  );

  for (const row of (phaseRows || [])) {
    session[`phase${row.phase}_summary`] = row.summary;
    session[`phase${row.phase}_citations`] = row.citations;
    session[`phase${row.phase}_dataforseo`] = row.dataforseo_data;
  }

  const phase1Summary = session.phase1_summary?.content || '';
  const phase2Summary = session.phase2_summary?.content || '';
  
  logger.debug('[Phase3] Checking for previous phase data:', {
    hasPhase1Summary: !!phase1Summary,
    hasPhase2Summary: !!phase2Summary,
    phase1SummaryLength: phase1Summary.length,
    phase2SummaryLength: phase2Summary.length,
    phase1Structure: session.phase1_summary ? Object.keys(session.phase1_summary) : 'null',
    phase2Structure: session.phase2_summary ? Object.keys(session.phase2_summary) : 'null'
  });
  
  if (!phase1Summary || !phase2Summary) {
    logger.error('[Phase3] Missing previous phase summaries!', {
      phase1Summary: session.phase1_summary,
      phase2Summary: session.phase2_summary
    });
    throw new Error('Previous phase summaries not found');
  }

  // Load user's API keys
  const { data: keys, error: keysError } = await supabaseWithRetry(
    () => supabase
      .from('user_api_keys')
      .select('*')
      .eq('user_id', session.user_id)
      .single(),
    'Phase3 load API keys',
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
    logger.debug('[Phase3] DataForSEO credentials found - on-page audit will be performed');
  }

  // Log key decryption for phase 3
  logApiKeyUsage({
    userId: session.user_id,
    action: `keys_decrypted_for_phase3`,
    phase: 3,
    sessionId,
    success: true
  });

  // Step 1: Load dynamic research prompts from database
  const prompts = await loadResearchPrompts(3);
  const tavilyConfig = await loadTavilyConfig(3);
  
  logger.debug(`[Phase3] Running ${prompts.length} research prompts in parallel...`);
  logger.debug(`[Phase3] Global Tavily config:`, {
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
  const phase3Checkpoint = checkpointData.phase3;
  
  // Load existing results from previous session if available
  let existingResults: any[] = [];
  if (phase3Checkpoint && phase3Checkpoint.completed_prompts.length > 0) {
    const { data: previousSession } = await supabase
      .from('research_sessions')
      .select('phase3_raw')
      .eq('id', sessionId)
      .single();
    
    existingResults = previousSession?.phase3_raw?.searches || [];
    logger.debug(`[Phase3] 🔄 RESUMING: ${phase3Checkpoint.completed_prompts.length}/${preparedPrompts.length} prompts already completed`);
  }

  // Filter prompts: only run incomplete ones
  const remainingPrompts = preparedPrompts.filter(
    prompt => !isPromptCompleted(phase3Checkpoint, prompt.id)
  );
  
  logger.debug(`[Phase3] Executing ${remainingPrompts.length} remaining prompts...`);

  // Initialize checkpoint if this is the first run
  if (!phase3Checkpoint) {
    await saveCheckpoint(sessionId, {
      phase3: {
        completed_prompts: [],
        last_prompt_index: -1,
        total_prompts: preparedPrompts.length
      }
    });
  }

  // Step 3: Execute remaining prompts in parallel
  logServiceUsage(session.user_id, 'tavily', 3, sessionId);
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
        `Phase 3: Tavily search timed out for prompt "${prompt.name}"`
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
      phase3: {
        completed_prompts: allCompletedPromptIds,
        last_prompt_index: preparedPrompts.length - 1,
        total_prompts: preparedPrompts.length
      }
    });
    logger.debug('[Phase3] ✅ All prompts completed, checkpoint saved');
  }

  const tavilyDuration = Date.now() - tavilyStart;
  const totalSources = results.reduce((sum, r) => sum + r.sources.length, 0);
  
  logger.debug(`[Phase3] Completed ${prompts.length} prompts in ${tavilyDuration}ms, gathered ${totalSources} sources`);

  // Flatten all sources for citations
  const allSources = results.flatMap(r => r.sources);

  // Build update data
  const updateData: any = {
    phase3_raw: {
      searches: results,
      totalSources,
      duration: tavilyDuration,
      timestamp: new Date().toISOString()
    },
    phase3_summary: {
      searches: results,
      totalSources,
      duration: tavilyDuration,
      content: `Phase 3 complete - ${totalSources} sources from ${prompts.length} focused searches`,
      timestamp: new Date().toISOString()
    },
    phase3_citations: allSources.map(r => ({
      url: r.url,
      title: r.title,
      snippet: r.content.substring(0, 200),
      published_date: r.published_date
    }))
  };

  // ─── DataForSEO On-Page Audit (if credentials available and not skipped) ───────
  // When running intermediate/advanced pipelines, DataForSEO is handled by the wave system
  // to avoid duplicate API calls and billing
  if (dataforseoCredentials && !options?.skipDataForSEO) {
    try {
      const dfConfig = await loadDataForSEOConfig(3);
      
      if (dfConfig.enabled !== false) {
        logServiceUsage(session.user_id, 'dataforseo', 3, sessionId);
        const dfClient = new DataForSEOClient(dataforseoCredentials);
        const dfStartTime = Date.now();

        // Get top-ranking URLs from Phase 2 DataForSEO data
        let urlsToAudit: string[] = [];
        
        // Try to get URLs from Phase 2 SERP competitors
        const phase2DataForSEO = session.phase2_dataforseo;
        if (phase2DataForSEO?.serp_competitors) {
          for (const comp of phase2DataForSEO.serp_competitors) {
            if (comp.domain && !urlsToAudit.some(u => u.includes(comp.domain))) {
              urlsToAudit.push(`https://${comp.domain}`);
            }
          }
        }

        // Fallback: extract domains from Phase 2 Tavily results
        if (urlsToAudit.length === 0) {
          const phase2Searches = session.phase2_summary?.searches || [];
          const phase2Sources = phase2Searches.flatMap((r: any) => r.sources || []);
          const seenDomains = new Set<string>();
          for (const source of phase2Sources) {
            try {
              const domain = new URL(source.url).hostname;
              if (!seenDomains.has(domain)) {
                seenDomains.add(domain);
                urlsToAudit.push(source.url);
              }
            } catch {}
          }
        }

        const maxUrls = Math.min(urlsToAudit.length, dfConfig.max_urls_to_audit || 3);
        urlsToAudit = urlsToAudit.slice(0, maxUrls);

        if (urlsToAudit.length > 0) {
          logger.debug('[Phase3-DataForSEO] Running on-page technical audits...');

          const auditResults: any[] = [];

          for (let i = 0; i < urlsToAudit.length; i++) {
            const url = urlsToAudit[i];
            try {
              logger.debug(`[Phase3-DataForSEO] Auditing ${i + 1}/${urlsToAudit.length}: ${url}`);

              logger.debug(`[Phase3-DataForSEO] Auditing page ${i + 1}/${urlsToAudit.length}: ${url}...`);

              // Create audit task
              const taskId = await dfClient.onPageTaskPost(
                url,
                dfConfig.max_crawl_pages || 10,
                dfConfig.enable_javascript_rendering || false,
                dfConfig.load_resources || false
              );

              // Poll for results
              const result = await dfClient.onPageResults(taskId);
              
              if (result) {
                auditResults.push({
                  url,
                  task_id: taskId,
                  ...result
                });
              }
            } catch (err: any) {
              console.warn(`[Phase3-DataForSEO] Audit failed for ${url}:`, err.message);
              auditResults.push({
                url,
                error: err.message
              });
            }
          }

          const dfDuration = Date.now() - dfStartTime;

          // Calculate benchmark averages from audit results
          const successfulAudits = auditResults.filter(a => a.pages && a.pages.length > 0);
          const allPages = successfulAudits.flatMap(a => a.pages || []);
          
          const benchmarks = allPages.length > 0 ? {
            avg_word_count: Math.round(allPages.reduce((sum: number, p: any) => sum + (p.content?.plain_text_word_count || 0), 0) / allPages.length),
            avg_onpage_score: Math.round(allPages.reduce((sum: number, p: any) => sum + (p.onpage_score || 0), 0) / allPages.length * 10) / 10,
            avg_internal_links: Math.round(allPages.reduce((sum: number, p: any) => sum + (p.links?.internal || 0), 0) / allPages.length),
            avg_external_links: Math.round(allPages.reduce((sum: number, p: any) => sum + (p.links?.external || 0), 0) / allPages.length),
            avg_images: Math.round(allPages.reduce((sum: number, p: any) => sum + (p.images?.total || 0), 0) / allPages.length),
            avg_dom_size: Math.round(allPages.reduce((sum: number, p: any) => sum + (p.total_dom_size || 0), 0) / allPages.length),
          } : null;

          updateData.phase3_dataforseo = {
            audit_results: auditResults,
            benchmarks,
            stats: {
              urls_audited: urlsToAudit.length,
              successful_audits: successfulAudits.length,
              total_pages_analyzed: allPages.length,
            },
            api_cost: dfClient.getCost(),
            api_calls: dfClient.getCallCount(),
            duration: dfDuration,
            timestamp: new Date().toISOString()
          };

          updateData.phase3_summary.content += ` | DataForSEO: ${successfulAudits.length} on-page audits completed`;
          updateData.phase3_summary.has_dataforseo = true;
          updateData.phase3_summary.dataforseo_status = 'complete';

          logger.debug(`[Phase3-DataForSEO] Completed in ${dfDuration}ms - ${successfulAudits.length} audits`);
        } else {
          logger.debug('[Phase3-DataForSEO] No URLs found to audit');
        }
      }
    } catch (dfError: any) {
      logger.error('[Phase3-DataForSEO] Error (non-fatal):', dfError.message);
      updateData.phase3_dataforseo = {
        error: dfError.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  const { error: updateError } = await supabase
    .from('research_session_phase_data')
    .upsert({
      session_id: sessionId,
      phase: 3,
      raw_data: updateData.phase3_raw,
      summary: updateData.phase3_summary,
      citations: updateData.phase3_citations || [],
      dataforseo_data: updateData.phase3_dataforseo || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'session_id,phase' });

  if (updateError) {
    logger.error('[Phase3] Failed to save phase data:', updateError);
    throw new Error(`Phase 3 data save failed: ${updateError.message}`);
  }

  const totalDuration = Date.now() - startTime;
  logger.debug(`[Phase3] Completed in ${totalDuration}ms - ${totalSources} sources from ${prompts.length} prompts`);
}
