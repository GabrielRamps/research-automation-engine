import Anthropic from '@anthropic-ai/sdk';
import { supabase, supabaseWithRetry } from '../lib/supabase';
import { logApiKeyUsage, logServiceUsage } from '../lib/audit-logger';
import { logger } from '../lib/logger';
import {
  updatePhase4Status,
  loadSession,
  loadPreviousPhases,
  loadAndDecryptKeys,
  loadContextDocuments,
  replaceVariables,
  formatTavilyResults,
  formatPhase1DataForSEO,
  formatPhase2DataForSEO,
  formatPhase3DataForSEO,
  markPhase4Complete,
  updateThinkingProgress,
  getPhase4Synthesis,
  setPhase4Synthesis,
  // Unified audit data formatters (Intermediate/Advanced)
  formatFullAuditForClaude,
  formatKeywordUniverseForClaude,
  formatFullKeywordUniverseForClaude,
  formatBusinessProfileForClaude,
  formatDomainIntelligenceForClaude,
  formatCompetitorProfilesForClaude,
  formatCompetitorTechnicalAuditForClaude,
  formatTechnicalAuditForClaude,
  formatReviewAnalyticsForClaude,
  formatBacklinkProfileForClaude,
  formatSERPAnalysisForClaude,
  formatServiceAreaSERPForClaude,
  formatScoringForClaude,
  getSchemaMarkupTemplates,
  getNAPConsistencyBlock,
} from '../lib/phase4-helpers';
import { callClaudeWithCaching, extractPageNames, CachedContext } from '../lib/claude-with-caching';
import {
  loadCheckpoint,
  saveCheckpoint,
  clearPhaseCheckpoint,
  isSubphaseCompleted,
  isPagePromptCompleted,
  getCheckpointSummary,
  Phase4Checkpoint
} from '../lib/checkpoint-manager';
import { UnifiedAuditData } from '../lib/seo-data-compiler';
import { expandSeedKeywords, formatKeywordsAsMarkdown } from '../lib/seed-expansion';

/**
 * Load a Phase 4 prompt template from the database, falling back to the hardcoded default.
 * Matches the pattern used by basic tier sub-phases (4.1–4.5).
 */
async function loadPromptTemplate(subphaseId: string, hardcodedDefault: string): Promise<string> {
  try {
    const { data: promptData } = await supabaseWithRetry(
      () => supabase
        .from('phase4_prompts')
        .select('prompt_template')
        .eq('subphase', subphaseId)
        .eq('status', 'active')
        .single(),
      `load prompt ${subphaseId}`,
    );

    if (promptData?.prompt_template?.trim()) {
      logger.debug(`[Phase${subphaseId}] Loaded prompt template from database`);
      return promptData.prompt_template;
    }
  } catch {
    // DB query failed or no row — fall back to hardcoded default
  }
  logger.debug(`[Phase${subphaseId}] Using hardcoded default prompt template`);
  return hardcodedDefault;
}

export async function processPhase4(sessionId: string) {
  const startTime = Date.now();

  // Mark phase as active
  await updatePhase4Status(sessionId, 'starting', 'Phase 4 initializing...', null);
  logger.info('[Phase4] Phase 4 marked as ACTIVE');

  // Load session and validate
  const session = await loadSession(sessionId);
  const { phase1Sources, phase2Sources, phase3Sources, phase1DataForSEO, phase2DataForSEO, phase3DataForSEO, hasDataForSEO, seoAuditData, tier } = await loadPreviousPhases(session);
  const apiKeys = await loadAndDecryptKeys(session.user_id, sessionId);
  const contextDocs = await loadContextDocuments();

  // Log key decryption for phase 4
  logApiKeyUsage({
    userId: session.user_id,
    action: `keys_decrypted_for_phase4`,
    phase: 4,
    sessionId,
    success: true
  });

  // Route based on tier
  if (tier === 'intermediate' || tier === 'advanced') {
    if (seoAuditData) {
      logger.info(`[Phase10] Running ENHANCED Phase 10 (${tier} tier) with unified audit data`);
      await processEnhancedPhase10(
        sessionId, session, seoAuditData, 
        phase1Sources, phase2Sources, phase3Sources,
        contextDocs, apiKeys.claude, startTime
      );
    } else {
      logger.warn(`[Phase4] Tier is ${tier} but no seo_audit_data found — falling back to basic flow`);
      await processBasicPhase4(
        sessionId, session, phase1Sources, phase2Sources, phase3Sources,
        phase1DataForSEO, phase2DataForSEO, phase3DataForSEO, hasDataForSEO,
        contextDocs, apiKeys.claude, startTime
      );
    }
  } else {
    logger.info('[Phase4] Running BASIC Phase 4 (Tavily + Claude only)');
    await processBasicPhase4(
      sessionId, session, phase1Sources, phase2Sources, phase3Sources,
      phase1DataForSEO, phase2DataForSEO, phase3DataForSEO, hasDataForSEO,
      contextDocs, apiKeys.claude, startTime
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// BASIC TIER — Existing Phase 4 Flow (Tavily + optional legacy DataForSEO)
// ═══════════════════════════════════════════════════════════════════

async function processBasicPhase4(
  sessionId: string,
  session: any,
  phase1Sources: any[], phase2Sources: any[], phase3Sources: any[],
  phase1DataForSEO: any, phase2DataForSEO: any, phase3DataForSEO: any,
  hasDataForSEO: boolean,
  contextDocs: { seoContext: string; croContext: string },
  claudeApiKey: string,
  startTime: number
) {
  if (hasDataForSEO) {
    logger.debug('[Phase4] 🚀 DataForSEO data detected - Claude will receive enhanced structured data');
  }

  // CHECKPOINT RECOVERY: Load existing checkpoint data
  const checkpointData = await loadCheckpoint(sessionId);
  const phase4Checkpoint = checkpointData.phase4;
  
  if (phase4Checkpoint) {
    const summary = await getCheckpointSummary(sessionId);
    logger.debug(`[Phase4] 🔄 RESUMING from checkpoint: ${summary}`);
  } else {
    logger.debug('[Phase4] Starting fresh (no checkpoint found)');
  }

  try {
    // Variables to store sub-phase results (load from DB if already complete)
    let competitiveReport: string;
    let seoGuide: string;
    let croGuide: string;
    let wireframe: string;
    let uiDesign: string;

    // SUB-PHASE 4.1: Competitive Intelligence Report
    if (isSubphaseCompleted(phase4Checkpoint, '4.1')) {
      logger.debug('[Phase4.1] ⏭️  SKIPPING - Already completed');
      const phase4Data = await getPhase4Synthesis(sessionId);
      competitiveReport = (phase4Data as any)?.competitive_intelligence?.report || '';
    } else {
      logger.debug('[Phase4.1] Starting Competitive Intelligence synthesis...');
      competitiveReport = await synthesizeCompetitiveIntelligence(
        sessionId, session, phase1Sources, phase1DataForSEO, claudeApiKey
      );
      await saveCheckpoint(sessionId, {
        phase4: {
          ...(phase4Checkpoint || {}),
          completed_subphases: [...(phase4Checkpoint?.completed_subphases || []), '4.1']
        } as Phase4Checkpoint
      });
      logger.debug('[Phase4.1] ✅ Checkpoint saved');
    }

    // SUB-PHASE 4.2: SEO Strategy Guide
    if (isSubphaseCompleted(phase4Checkpoint, '4.2')) {
      logger.debug('[Phase4.2] ⏭️  SKIPPING - Already completed');
      const phase4Data = await getPhase4Synthesis(sessionId);
      seoGuide = (phase4Data as any)?.seo_strategy?.guide || '';
    } else {
      logger.debug('[Phase4.2] Starting SEO Strategy synthesis...');
      seoGuide = await synthesizeSEOStrategy(
        sessionId, session, phase2Sources, phase2DataForSEO,
        contextDocs.seoContext, claudeApiKey
      );
      await saveCheckpoint(sessionId, {
        phase4: {
          ...(phase4Checkpoint || {}),
          completed_subphases: [...(phase4Checkpoint?.completed_subphases || []), '4.2']
        } as Phase4Checkpoint
      });
      logger.debug('[Phase4.2] ✅ Checkpoint saved');
    }

    // BASIC TIER ONLY: Generate keyword research and append to SEO strategy doc
    const tier = session.tier || 'basic';
    if (tier === 'basic') {
      if (isSubphaseCompleted(phase4Checkpoint, '4.2k')) {
        logger.debug('[Phase4.2k] ⏭️  SKIPPING keyword append - Already completed');
      } else {
        logger.debug('[Phase4.2k] Generating Claude keyword research for basic tier...');
        try {
          const keywordResult = await expandSeedKeywords({
            claudeApiKey,
            session,
            userId: session.user_id,
            sessionId,
          });

          if (keywordResult && keywordResult.keywords.length > 0) {
            const keywordMarkdown = formatKeywordsAsMarkdown(keywordResult, session);
            seoGuide += '\n\n---\n\n' + keywordMarkdown;

            // Re-save the SEO strategy with appended keywords
            await setPhase4Synthesis(sessionId, {
              ...((await getPhase4Synthesis(sessionId)) || {}),
              seo_strategy: {
                thinking: '',
                guide: seoGuide,
                timestamp: new Date().toISOString(),
              },
            });
            logger.debug(`[Phase4.2k] ✅ Appended ${keywordResult.totalCount} keywords to SEO strategy doc`);
          } else {
            logger.warn('[Phase4.2k] Claude keyword generation returned no results; SEO guide unchanged');
          }
        } catch (e: any) {
          logger.error(`[Phase4.2k] Keyword generation failed: ${e.message}`);
        }

        const latestCp = await loadCheckpoint(sessionId);
        await saveCheckpoint(sessionId, {
          phase4: {
            ...(latestCp.phase4 || {}),
            completed_subphases: [...(latestCp.phase4?.completed_subphases || []), '4.2k']
          } as Phase4Checkpoint
        });
      }
    }

    // SUB-PHASE 4.3: CRO Optimization Guide
    if (isSubphaseCompleted(phase4Checkpoint, '4.3')) {
      logger.debug('[Phase4.3] ⏭️  SKIPPING - Already completed');
      const phase4Data = await getPhase4Synthesis(sessionId);
      croGuide = (phase4Data as any)?.cro_optimization?.guide || '';
    } else {
      logger.debug('[Phase4.3] Starting CRO synthesis...');
      croGuide = await synthesizeCROOptimization(
        sessionId, session, phase3Sources, phase3DataForSEO,
        contextDocs.croContext, claudeApiKey
      );
      await saveCheckpoint(sessionId, {
        phase4: {
          ...(phase4Checkpoint || {}),
          completed_subphases: [...(phase4Checkpoint?.completed_subphases || []), '4.3']
        } as Phase4Checkpoint
      });
      logger.debug('[Phase4.3] ✅ Checkpoint saved');
    }

    // SUB-PHASE 4.4: Wireframe/Outline
    if (isSubphaseCompleted(phase4Checkpoint, '4.4')) {
      logger.debug('[Phase4.4] ⏭️  SKIPPING - Already completed');
      const phase4Data = await getPhase4Synthesis(sessionId);
      wireframe = (phase4Data as any)?.wireframe?.outline || '';
    } else {
      logger.debug('[Phase4.4] Starting wireframe generation...');
      wireframe = await generateWireframe(
        sessionId, session, competitiveReport, seoGuide, croGuide, claudeApiKey
      );
      await saveCheckpoint(sessionId, {
        phase4: {
          ...(phase4Checkpoint || {}),
          completed_subphases: [...(phase4Checkpoint?.completed_subphases || []), '4.4']
        } as Phase4Checkpoint
      });
      logger.debug('[Phase4.4] ✅ Checkpoint saved');
    }

    // SUB-PHASE 4.5: UI Design & Color Palette
    if (isSubphaseCompleted(phase4Checkpoint, '4.5')) {
      logger.debug('[Phase4.5] ⏭️  SKIPPING - Already completed');
      const phase4Data = await getPhase4Synthesis(sessionId);
      uiDesign = (phase4Data as any)?.ui_design?.design_system || '';
    } else {
      logger.debug('[Phase4.5] Starting UI design generation...');
      uiDesign = await generateUIDesign(sessionId, session, wireframe, claudeApiKey);
      await saveCheckpoint(sessionId, {
        phase4: {
          ...(phase4Checkpoint || {}),
          completed_subphases: [...(phase4Checkpoint?.completed_subphases || []), '4.5']
        } as Phase4Checkpoint
      });
      logger.debug('[Phase4.5] ✅ Checkpoint saved');
    }

    // SUB-PHASE 4.6: Project Overview
    if (isSubphaseCompleted(phase4Checkpoint, '4.6')) {
      logger.debug('[Phase4.6] ⏭️  SKIPPING - Already completed');
    } else {
      logger.debug('[Phase4.6] Generating project overview...');
      await generateProjectOverview(
        sessionId,
        session,
        { competitiveReport, seoGuide, croGuide, wireframe, uiDesign },
        claudeApiKey
      );
      const latestCheckpoint = await loadCheckpoint(sessionId);
      await saveCheckpoint(sessionId, {
        phase4: {
          ...(latestCheckpoint.phase4 || {}),
          completed_subphases: [...(latestCheckpoint.phase4?.completed_subphases || []), '4.6']
        } as Phase4Checkpoint
      });
    }

    // Mark complete and clear checkpoint
    await markPhase4Complete(sessionId, '');
    await clearPhaseCheckpoint(sessionId, 4);

    const totalDuration = Date.now() - startTime;
    logger.debug(`[Phase4] ✅ Completed all sub-phases in ${totalDuration}ms`);

  } catch (error: any) {
    logger.error('[Phase4] Error in synthesis:', error);
    logger.error('[Phase4] Error stack:', error.stack);
    logger.error('[Phase4] Error details:', JSON.stringify(error, null, 2));
    const errorMessage = error.message || 'Unknown error';
    const errorDetails = error.response?.data || error.details || '';
    await updatePhase4Status(sessionId, 'failed', `Error: ${errorMessage} ${errorDetails}`, null);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// ENHANCED PHASE 10 — Intermediate/Advanced Tier with Full Audit Data
// ═══════════════════════════════════════════════════════════════════

async function processEnhancedPhase10(
  sessionId: string,
  session: any,
  auditData: UnifiedAuditData,
  phase1Sources: any[], phase2Sources: any[], phase3Sources: any[],
  contextDocs: { seoContext: string; croContext: string },
  claudeApiKey: string,
  startTime: number
) {
  // CHECKPOINT RECOVERY
  const checkpointData = await loadCheckpoint(sessionId);
  let phase4Checkpoint = checkpointData.phase4;

  // Detect old pipeline checkpoints (10.8, 10.10, 10.11 etc.) and clear them
  // since the sub-phase outputs are incompatible with the new pipeline
  const OLD_PIPELINE_IDS = ['10.9', '10.10', '10.11'];
  if (phase4Checkpoint?.completed_subphases?.some((id: string) => OLD_PIPELINE_IDS.includes(id))) {
    logger.warn('[Phase10] Detected old pipeline checkpoint IDs — clearing and restarting');
    await clearPhaseCheckpoint(sessionId, 4);
    phase4Checkpoint = undefined;
  }

  if (phase4Checkpoint) {
    const summary = await getCheckpointSummary(sessionId);
    logger.debug(`[Phase10] Resuming from checkpoint: ${summary}`);
  } else {
    logger.debug('[Phase10] Starting fresh enhanced synthesis (8-step Opus 4.6 pipeline)');
  }

  try {
    let keywordStrategy: string;
    let competitiveAnalysis: string;
    let contentStrategy: string;
    let croGuide: string;
    let offPageRoadmap: string;
    let siteArchitecture: string;
    let uiDesign: string;

    // ─── 10.1: Keyword Strategy & Prioritization ─────────────
    if (isSubphaseCompleted(phase4Checkpoint, '10.1')) {
      logger.debug('[Phase10.1] SKIPPING — already completed');
      const phase4Data = await getPhase4Synthesis(sessionId);
      keywordStrategy = (phase4Data as any)?.seo_keyword_strategy?.content || '';
    } else {
      logger.debug('[Phase10.1] Starting Keyword Strategy & Prioritization...');
      keywordStrategy = await synthesizeKeywordStrategy(
        sessionId, session, auditData, claudeApiKey
      );
      await saveSubphaseCheckpoint(sessionId, phase4Checkpoint, '10.1');
    }

    // ─── 10.2: Market Position & Competitive Analysis ──────
    if (isSubphaseCompleted(phase4Checkpoint, '10.2')) {
      logger.debug('[Phase10.2] SKIPPING — already completed');
      const phase4Data = await getPhase4Synthesis(sessionId);
      competitiveAnalysis = (phase4Data as any)?.competitive_analysis?.content || '';
    } else {
      logger.debug('[Phase10.2] Starting Market Position & Competitive Analysis...');
      competitiveAnalysis = await synthesizeMarketPositionAndCompetitiveAnalysis(
        sessionId, session, auditData, phase1Sources, keywordStrategy, claudeApiKey
      );
      await saveSubphaseCheckpoint(sessionId, phase4Checkpoint, '10.2');
    }

    // ─── 10.3: Content Strategy & Blog Calendar ──────
    if (isSubphaseCompleted(phase4Checkpoint, '10.3')) {
      logger.debug('[Phase10.3] SKIPPING — already completed');
      const phase4Data = await getPhase4Synthesis(sessionId);
      contentStrategy = (phase4Data as any)?.content_strategy?.content || '';
    } else {
      logger.debug('[Phase10.3] Starting Content Strategy & Blog Calendar...');
      contentStrategy = await synthesizeContentStrategy(
        sessionId, session, auditData, phase2Sources,
        contextDocs, keywordStrategy, competitiveAnalysis, claudeApiKey
      );
      await saveSubphaseCheckpoint(sessionId, phase4Checkpoint, '10.3');
    }

    // ─── 10.4: CRO Optimization Guide ──────────────────
    if (isSubphaseCompleted(phase4Checkpoint, '10.4')) {
      logger.debug('[Phase10.4] SKIPPING — already completed');
      const phase4Data = await getPhase4Synthesis(sessionId);
      croGuide = (phase4Data as any)?.cro_guide?.content || '';
    } else {
      logger.debug('[Phase10.4] Starting CRO Optimization Guide...');
      croGuide = await synthesizeCROGuide(
        sessionId, session, auditData, phase3Sources,
        contextDocs, competitiveAnalysis, claudeApiKey
      );
      await saveSubphaseCheckpoint(sessionId, phase4Checkpoint, '10.4');
    }

    // ─── 10.5: Off-Page Roadmap & Success Benchmarks ──────────
    if (isSubphaseCompleted(phase4Checkpoint, '10.5')) {
      logger.debug('[Phase10.5] SKIPPING — already completed');
      const phase4Data = await getPhase4Synthesis(sessionId);
      offPageRoadmap = (phase4Data as any)?.offpage_roadmap_benchmarks?.content || '';
    } else {
      logger.debug('[Phase10.5] Starting Off-Page Roadmap & Benchmarks...');
      offPageRoadmap = await synthesizeOffPageRoadmap(
        sessionId, session, auditData, keywordStrategy, competitiveAnalysis,
        contentStrategy, croGuide, claudeApiKey
      );
      await saveSubphaseCheckpoint(sessionId, phase4Checkpoint, '10.5');
    }

    // ─── 10.6: Site Architecture + SEO Specs + Linking + Technical ────────
    if (isSubphaseCompleted(phase4Checkpoint, '10.6')) {
      logger.debug('[Phase10.6] SKIPPING — already completed');
      const phase4Data = await getPhase4Synthesis(sessionId);
      siteArchitecture = (phase4Data as any)?.site_architecture?.content || '';
    } else {
      logger.debug('[Phase10.6] Starting Site Architecture + SEO Specs + Technical...');
      siteArchitecture = await synthesizeSiteArchitecture(
        sessionId, session, auditData, phase2Sources, contextDocs,
        keywordStrategy, competitiveAnalysis,
        contentStrategy, croGuide, claudeApiKey
      );
      await saveSubphaseCheckpoint(sessionId, phase4Checkpoint, '10.6');
    }

    // ─── 10.7: UI Design & Styling Direction ──────────────────
    if (isSubphaseCompleted(phase4Checkpoint, '10.7')) {
      logger.debug('[Phase10.7] SKIPPING — already completed');
      const phase4Data = await getPhase4Synthesis(sessionId);
      uiDesign = (phase4Data as any)?.ui_design?.design_system || '';
    } else {
      logger.debug('[Phase10.7] Starting UI Design & Styling Direction...');
      uiDesign = await synthesizeUIDesign(
        sessionId, session, auditData, siteArchitecture, croGuide,
        competitiveAnalysis, claudeApiKey
      );
      await saveSubphaseCheckpoint(sessionId, phase4Checkpoint, '10.7');
    }

    // ─── 10.8: Project Overview ───────────────
    if (isSubphaseCompleted(phase4Checkpoint, '10.8')) {
      logger.debug('[Phase10.8] SKIPPING — already completed');
    } else {
      logger.debug('[Phase10.8] Generating Project Overview...');
      await synthesizeProjectOverview(
        sessionId, session, keywordStrategy, competitiveAnalysis,
        contentStrategy, croGuide, siteArchitecture, uiDesign, claudeApiKey
      );
      await saveSubphaseCheckpoint(sessionId, phase4Checkpoint, '10.8');
    }

    // Mark complete and clear checkpoint
    await markPhase4Complete(sessionId, '');
    await clearPhaseCheckpoint(sessionId, 4);

    const totalDuration = Date.now() - startTime;
    logger.debug(`[Phase10] Completed ALL 8 enhanced sub-phases in ${totalDuration}ms`);

  } catch (error: any) {
    logger.error('[Phase10] Error in enhanced synthesis:', error);
    logger.error('[Phase10] Error stack:', error.stack);
    const errorMessage = error.message || 'Unknown error';
    const errorDetails = error.response?.data || error.details || '';
    await updatePhase4Status(sessionId, 'failed', `Error: ${errorMessage} ${errorDetails}`, null);
    throw error;
  }
}

/** Helper to save a subphase checkpoint */
async function saveSubphaseCheckpoint(
  sessionId: string,
  currentCheckpoint: Phase4Checkpoint | undefined,
  subphaseId: string
) {
  const latestCheckpoint = await loadCheckpoint(sessionId);
  await saveCheckpoint(sessionId, {
    phase4: {
      ...(latestCheckpoint.phase4 || currentCheckpoint || {}),
      completed_subphases: [...(latestCheckpoint.phase4?.completed_subphases || []), subphaseId]
    } as Phase4Checkpoint
  });
  logger.debug(`[Phase${subphaseId}] ✅ Checkpoint saved`);
}

// ═══════════════════════════════════════════════════════════════════
// NEW ENHANCED SUB-PHASES 10.1–10.8 (Opus 4.6 Pipeline)
// ═══════════════════════════════════════════════════════════════════

// 10.1: Keyword Strategy & Prioritization
async function synthesizeKeywordStrategy(
  sessionId: string,
  session: any,
  auditData: UnifiedAuditData,
  claudeApiKey: string
): Promise<string> {
  await updatePhase4Status(sessionId, 'phase10_1', 'Analyzing keyword strategy and prioritization...', '10.1');

  const keywordData = formatFullKeywordUniverseForClaude(auditData);
  const domainData = formatDomainIntelligenceForClaude(auditData);
  const gbpData = formatBusinessProfileForClaude(auditData);
  const reviewData = formatReviewAnalyticsForClaude(auditData);
  const scoringData = formatScoringForClaude(auditData);

  let seedKeywordsMarkdown = '';
  try {
    const seedResult = await expandSeedKeywords({
      claudeApiKey,
      session,
      userId: session.user_id,
      sessionId,
    });
    if (seedResult && seedResult.totalCount > 0) {
      seedKeywordsMarkdown = formatKeywordsAsMarkdown(seedResult, session);
    }
  } catch (err) {
    logger.warn('[Phase10.1] Seed expansion unavailable, proceeding without:', (err as Error).message);
  }

  // Build variables map for template injection
  const variables: Record<string, string> = {
    BUSINESS_NAME: session.business_name || 'Not specified',
    INDUSTRY: session.industry || session.business_type || 'Not specified',
    PRIMARY_SERVICE: session.primary_service || 'Not specified',
    ALL_SERVICES: [session.services, session.additional_services].filter(Boolean).join(', ') || 'Not specified',
    LOCATION: session.location || `${session.city || ''}, ${session.state || ''} ${session.zip_code || ''}`,
    SERVICE_AREA: session.search_radius || 'Not specified',
    TARGET_AUDIENCE: session.target_audience || 'Not specified',
    YEARS_IN_BUSINESS: session.years_in_business || 'Not specified',
    WEBSITE_URL: session.website_url || 'New website',
    TARGET_CUSTOMER_TYPE: session.target_customer_type || 'Not specified',
    KEYWORD_UNIVERSE_DATA: keywordData,
    DOMAIN_INTELLIGENCE_DATA: domainData,
    GBP_DATA: gbpData,
    REVIEW_DATA: reviewData,
    SCORING_DATA: scoringData,
    SEED_KEYWORDS: seedKeywordsMarkdown || '',
  };

  const DEFAULT_10_1_PROMPT = `You are an expert local SEO strategist and data analyst. You have been given comprehensive, real-time market research data for a local service business.

Your task: Analyze the keyword universe data and produce a comprehensive KEYWORD STRATEGY & PRIORITIZATION document with three priority tiers.

Label every recommendation with one of two tags:
[SITE BUILD] — Will be automatically implemented when the AI builds the site.
[OWNER ACTION] — Requires ongoing human effort after the site launches.

CRITICAL DATA PRIORITY: For keyword metrics (volume, CPC, difficulty, intent), use ONLY the DataForSEO "Full Keyword Universe" data. Tavily research is qualitative context only — do not cite Tavily for metrics.

Every recommendation must trace back to specific data. When using general best-practice knowledge, flag it with: [Best Practice — data not available for this].

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Primary Service:** {{PRIMARY_SERVICE}}
- **All Services:** {{ALL_SERVICES}}
- **Location:** {{LOCATION}}
- **Service Area:** {{SERVICE_AREA}} mile radius
- **Target Audience:** {{TARGET_AUDIENCE}}
- **Years in Business:** {{YEARS_IN_BUSINESS}}
- **Website:** {{WEBSITE_URL}}
- **Target Customer Type:** {{TARGET_CUSTOMER_TYPE}}

---

## DATA INPUTS

### INPUT 1: FULL KEYWORD UNIVERSE (DataForSEO — PRIMARY DATA SOURCE)
{{KEYWORD_UNIVERSE_DATA}}

### INPUT 2: DOMAIN INTELLIGENCE
{{DOMAIN_INTELLIGENCE_DATA}}

### INPUT 3: GOOGLE BUSINESS PROFILE
{{GBP_DATA}}

### INPUT 4: REVIEW ANALYTICS
{{REVIEW_DATA}}

### INPUT 5: SEO READINESS SCORES
{{SCORING_DATA}}

{{#if SEED_KEYWORDS}}
### INPUT 6: SEED KEYWORD EXPANSION (Claude-generated tier classification)
{{SEED_KEYWORDS}}
{{/if}}

---

## DELIVERABLE

### KEYWORD STRATEGY & PRIORITIZATION
[SITE BUILD]

**A. Priority Tier Classification**

Organize all relevant keywords into three tiers. Present each tier as a table:

| Keyword | Monthly Volume | Difficulty | Intent | CPC | Recommended Content Type |
|---------|---------------|------------|--------|-----|--------------------------|

**Priority Tier 1 — Core Targets (Build First)**
High volume + transactional or commercial intent + difficulty under 55. Primary service offerings and highest-converting searches.

**Priority Tier 2 — Growth Targets (Build at Launch)**
Secondary services, additional service area cities, comparison searches, symptom/problem-aware searches.

**Priority Tier 3 — Content & Long-Tail (Ongoing Publishing)**
[OWNER ACTION]
Informational, research-phase, and long-tail specialty searches. Feed the blog and FAQ strategy.

**B. Low-Hanging Fruit Keywords**
Keywords meeting ALL criteria: difficulty under 35, volume over 50/month, competitors beatable (position 4+ with weak on-page). List each with volume, difficulty, current gap, and why the competitor is beatable.

**C. Keywords to Deprioritize**
Flag keywords NOT to target at launch: difficulty above 70 with national brands in top 3, intent mismatch, zero commercial intent, out-of-season terms.

**D. Seasonal & Trend Considerations**
Using monthly_trends data: which clusters show seasonality? Peak search months? Growing or declining trends? Implications for content timing and GBP posting.

**E. Paid Search Signal Analysis**
Using CPC and competition data: highest CPC keywords (highest commercial value), keywords with paid ads in SERP (confirms transactional intent), high-CPC lower-difficulty keywords this business could dominate organically.

---

## OUTPUT FORMAT
- Use tables for all keyword data and comparisons
- Name specific keywords, numbers, and competitors — no placeholders
- Flag data gaps where recommendations are based on best practice vs data`;

  const loadedTemplate = await loadPromptTemplate('10.1', DEFAULT_10_1_PROMPT);
  const prompt = replaceVariables(loadedTemplate, variables);

  logger.debug(`[Phase10.1] Prompt size: ~${Math.round(prompt.length / 4)} tokens`);

  const { thinking, content } = await callClaudeWithStreaming(
    sessionId, claudeApiKey, prompt, '10.1', 'Keyword Strategy', session
  );

  await saveSynthesisResult(sessionId, 'seo_keyword_strategy', { thinking, content });
  logger.debug('[Phase10.1] ✅ Keyword Strategy saved');
  return content;
}

// 10.2: Market Position & Competitive Analysis
async function synthesizeMarketPositionAndCompetitiveAnalysis(
  sessionId: string,
  session: any,
  auditData: UnifiedAuditData,
  phase1Sources: any[],
  keywordStrategyOutput: string,
  claudeApiKey: string
): Promise<string> {
  await updatePhase4Status(sessionId, 'phase10_2', 'Analyzing market position and competitive landscape...', '10.2');

  const competitorData = formatCompetitorProfilesForClaude(auditData);
  const serpData = formatSERPAnalysisForClaude(auditData);
  const reviewData = formatReviewAnalyticsForClaude(auditData);
  const competitorTechData = formatCompetitorTechnicalAuditForClaude(auditData);
  const gbpData = formatBusinessProfileForClaude(auditData);
  const domainData = formatDomainIntelligenceForClaude(auditData);
  const scoringData = formatScoringForClaude(auditData);
  const backlinkData = auditData.meta.tier === 'advanced'
    ? formatBacklinkProfileForClaude(auditData)
    : '';

  const variables: Record<string, string> = {
    BUSINESS_NAME: session.business_name || 'Not specified',
    INDUSTRY: session.industry || session.business_type || 'Not specified',
    LOCATION: session.location || `${session.city || ''}, ${session.state || ''}`,
    KEYWORD_STRATEGY_OUTPUT: keywordStrategyOutput.substring(0, 15000),
    COMPETITOR_DATA: competitorData,
    SERP_DATA: serpData,
    REVIEW_DATA: reviewData,
    COMPETITOR_TECH_DATA: competitorTechData || '',
    GBP_DATA: gbpData,
    DOMAIN_INTELLIGENCE_DATA: domainData,
    SCORING_DATA: scoringData,
    BACKLINK_DATA: backlinkData || '',
    IS_ADVANCED_TIER: auditData.meta.tier === 'advanced' ? 'true' : '',
    PHASE1_SOURCES: formatTavilyResults(phase1Sources),
  };

  const DEFAULT_10_2_PROMPT = `You are a competitive intelligence analyst with access to REAL market data from DataForSEO.

Your task: Produce TWO deliverables:
1. SECTION 1: MARKET OPPORTUNITY SNAPSHOT — A data-driven picture of this business's current position and potential.
2. SECTION 2: COMPETITIVE ANALYSIS & GAPS — Analyze every competitor and identify specific, actionable gaps.

Label every recommendation:
[SITE BUILD] — Will be automatically implemented when the AI builds the site.
[OWNER ACTION] — Requires ongoing human effort after the site launches.

CRITICAL: Use REAL numbers from the data. Name specific domains, keywords, volumes, and rankings. No generic advice.

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}

---

## DATA INPUTS

### INPUT 1: KEYWORD STRATEGY (from 10.1)
{{KEYWORD_STRATEGY_OUTPUT}}

### INPUT 2: COMPETITOR PROFILES (DataForSEO — REAL DATA)
{{COMPETITOR_DATA}}

### INPUT 3: SERP ANALYSIS
{{SERP_DATA}}

### INPUT 4: REVIEW ANALYTICS
{{REVIEW_DATA}}

### INPUT 5: GOOGLE BUSINESS PROFILE
{{GBP_DATA}}

### INPUT 6: DOMAIN INTELLIGENCE
{{DOMAIN_INTELLIGENCE_DATA}}

### INPUT 7: SEO READINESS SCORES
{{SCORING_DATA}}

{{#if COMPETITOR_TECH_DATA}}### INPUT 8: COMPETITOR TECHNICAL AUDIT
{{COMPETITOR_TECH_DATA}}{{/if}}

{{#if BACKLINK_DATA}}### INPUT 9: BACKLINK PROFILE (Advanced Tier)
{{BACKLINK_DATA}}{{/if}}

### INPUT 10: QUALITATIVE COMPETITIVE RESEARCH (Tavily — context only)
{{PHASE1_SOURCES}}

---

## DELIVERABLE

### SECTION 1: MARKET OPPORTUNITY SNAPSHOT

**1A. Total Keyword Opportunity** (reference keyword strategy for numbers)
- Total keywords in universe and total addressable monthly traffic
- Breakdown by intent: transactional vs commercial vs informational vs navigational (with volumes)
- Realistic organic traffic capture estimate at 90 days (use keyword volumes and realistic position CTR benchmarks)
- Realistic organic traffic capture estimate at 6 months

**1B. Market Competitiveness (Rate 1–10)**
Justify using: average keyword difficulty, competitor domain authority distribution, local pack saturation, whether national brands dominate SERPs.

**1C. Current Business Position** (use GBP, domain intel, scoring, review data)
- Overall SEO readiness score and what it means in plain language
- Current organic traffic and keywords ranking
- GBP completeness score and the specific gaps hurting local pack visibility
- Review position vs competitor average (rating + count)
- Technical baseline: is the current site helping or hurting rankings?

**1D. Biggest Immediate Opportunity**
The single highest-leverage move available right now. Name the specific keyword cluster, content gap, GBP field, or technical fix. Back it with data.

**1E. Top Competitive Threats**
2–3 competitors most likely to block this business from ranking. For each: why they are dangerous.

---

### SECTION 2: COMPETITIVE ANALYSIS & GAPS

For each major competitor identified in the data (top 5–8):

---
**[Competitor Name / Domain]**

- **Authority & Traffic:** Domain rank, estimated monthly organic traffic, total keywords ranking
- **SERP Dominance:** Which keywords they own (positions 1–3) vs vulnerable on (positions 4–10)
- **Local Pack Position:** Which searches they appear in the local pack for, review count and rating vs this business
- **Content Advantage:** What page types drive their rankings — service pages, location pages, blog, or homepage authority?
- **Technical Strengths & Weaknesses:** Lighthouse scores vs this business, schema types used, critical issue count, broken links
- **GBP Weaknesses:** Unclaimed listings, missing categories, low photo count, poor review velocity, unanswered reviews
{{#if IS_ADVANCED_TIER}}- **Backlink Profile:** Referring domains and notable linking sources{{/if}}

---

**Cross-Competitor Summary**

**Top Keyword Gaps (rank by opportunity):**
Top 10+ keywords competitors rank for (positions 1–10) where this business is not ranking:

| Keyword | Volume | Difficulty | Ranking Competitor | Their Position | Opportunity |
|---------|--------|------------|-------------------|----------------|-------------|

[SITE BUILD] — These gaps become priority content targets at launch.

**Top Content Gaps:**
5–8 specific content gap areas with rationale for why each matters.

**Backlink Gap Opportunities:**
[OWNER ACTION]
Domains linking to competitors but not this business, grouped by type: local directories, industry associations, supplier sites, local news, chambers of commerce.

---

## OUTPUT FORMAT
- Use tables for keyword gaps and competitor comparisons
- Every claim backed by specific data from the inputs`;

  const loadedTemplate = await loadPromptTemplate('10.2', DEFAULT_10_2_PROMPT);
  const prompt = replaceVariables(loadedTemplate, variables);

  logger.debug(`[Phase10.2] Prompt size: ~${Math.round(prompt.length / 4)} tokens`);

  const { thinking, content } = await callClaudeWithStreaming(
    sessionId, claudeApiKey, prompt, '10.2', 'Market Position & Competitive Analysis', session
  );

  await saveSynthesisResult(sessionId, 'competitive_analysis', { thinking, content });
  logger.debug('[Phase10.2] ✅ Market Position & Competitive Analysis saved');
  return content;
}

// 10.3: Content Strategy & Blog Calendar
async function synthesizeContentStrategy(
  sessionId: string,
  session: any,
  auditData: UnifiedAuditData,
  phase2Sources: any[],
  contextDocs: { seoContext: string; croContext: string },
  keywordStrategyOutput: string,
  competitiveAnalysisOutput: string,
  claudeApiKey: string
): Promise<string> {
  await updatePhase4Status(sessionId, 'phase10_3', 'Building content strategy and blog calendar...', '10.3');

  const serpData = formatSERPAnalysisForClaude(auditData);
  const citySerp = formatServiceAreaSERPForClaude(auditData);
  const reviewData = formatReviewAnalyticsForClaude(auditData);

  let seedKeywordsMarkdown = '';
  try {
    const seedResult = await expandSeedKeywords({
      claudeApiKey,
      session,
      userId: session.user_id,
      sessionId,
    });
    if (seedResult && seedResult.totalCount > 0) {
      seedKeywordsMarkdown = formatKeywordsAsMarkdown(seedResult, session);
    }
  } catch (err) {
    logger.warn('[Phase10.3] Seed expansion unavailable:', (err as Error).message);
  }

  const variables: Record<string, string> = {
    BUSINESS_NAME: session.business_name || 'Not specified',
    INDUSTRY: session.industry || session.business_type || 'Not specified',
    LOCATION: session.location || `${session.city || ''}, ${session.state || ''}`,
    ALL_SERVICES: [session.services, session.additional_services].filter(Boolean).join(', ') || 'Not specified',
    SERVICE_AREA_CITIES: (session.service_area_cities || []).join(', ') || 'Not specified',
    TARGET_AUDIENCE: session.target_audience || 'Not specified',
    KEYWORD_STRATEGY_OUTPUT: keywordStrategyOutput.substring(0, 12000),
    COMPETITIVE_ANALYSIS_OUTPUT: competitiveAnalysisOutput.substring(0, 12000),
    SERP_DATA: serpData,
    CITY_SERP_DATA: citySerp || '',
    REVIEW_DATA: reviewData,
    PHASE2_SOURCES: formatTavilyResults(phase2Sources),
    SEO_CONTEXT: contextDocs.seoContext || 'Not available',
    SEED_KEYWORDS: seedKeywordsMarkdown ? seedKeywordsMarkdown.substring(0, 8000) : '',
  };

  const DEFAULT_10_3_PROMPT = `You are an expert SEO content strategist.

Your task: Using the keyword strategy and competitive analysis from prior sub-phases, produce TWO deliverables:
1. CONTENT STRATEGY (topic clusters, FAQ strategy, location content, credential content)
2. 12-MONTH BLOG CALENDAR

Label every recommendation:
[SITE BUILD] — Will be automatically implemented when the AI builds the site.
[OWNER ACTION] — Requires ongoing human effort after the site launches.

CRITICAL DATA PRIORITY: For keyword metrics, use ONLY the DataForSEO data from prior analyses. Tavily is qualitative context only.

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **All Services:** {{ALL_SERVICES}}
- **Service Area Cities:** {{SERVICE_AREA_CITIES}}
- **Target Audience:** {{TARGET_AUDIENCE}}

---

## DATA INPUTS

### INPUT 1: KEYWORD STRATEGY (from 10.1)
{{KEYWORD_STRATEGY_OUTPUT}}

### INPUT 2: COMPETITIVE ANALYSIS (from 10.2)
{{COMPETITIVE_ANALYSIS_OUTPUT}}

### INPUT 3: SERP ANALYSIS (PAA, Related Searches, Autocomplete)
{{SERP_DATA}}

{{#if CITY_SERP_DATA}}### INPUT 4: PER-CITY SERP DATA
{{CITY_SERP_DATA}}{{/if}}

### INPUT 5: REVIEW ANALYTICS
{{REVIEW_DATA}}

### INPUT 6: SEO & CONTENT RESEARCH (Tavily — qualitative only)
{{PHASE2_SOURCES}}

### INPUT 7: SEO BEST PRACTICES
{{SEO_CONTEXT}}

{{#if SEED_KEYWORDS}}### INPUT 8: SEED KEYWORD DATA
{{SEED_KEYWORDS}}{{/if}}

---

## DELIVERABLE

### CONTENT STRATEGY

**A. Topic Cluster Architecture**
[SITE BUILD]
For each cluster:
- **Cluster Name**
- **Primary Keyword** (highest-volume, most authoritative)
- **Supporting Keywords** (5–10 related terms)
- **Content Type:** Core service page, location page, FAQ, or blog
- **Why This Cluster Matters:** Traffic potential + conversion rationale
- **Competitive Difficulty:** Winnable in 90 days, 6 months, or long-term?

**B. People Also Ask & FAQ Strategy**
Using PAA questions and related searches from SERP data:
- Top 20 questions this audience is asking, grouped by topic cluster
- Flag featured snippet potential
- Recommend format: FAQ section on service page, standalone FAQ page, or blog post
- [SITE BUILD] for FAQ sections on service pages; [OWNER ACTION] for standalone FAQ blog content

**C. Location & Service Area Content**
[SITE BUILD]
Using per-city SERP data:
- Which cities have meaningful search volume?
- Which cities have no local pack entry from this business?
- Rank cities by organic opportunity (volume × competitive weakness)
- Top keywords with ranking potential per city

**D. 12-Month Blog & Long-Tail Content Calendar**
[OWNER ACTION]

| Month | Post Title | Target Keyword | Volume | Difficulty | Intent | Word Count Target |
|-------|-----------|----------------|--------|------------|--------|-------------------|

Month 1–3: Establish topical authority in primary service areas
Month 4–6: Expand into secondary services and FAQ content
Month 7–9: Location-specific content and long-tail specialty
Month 10–12: Seasonal content, case studies, advanced topics

2–4 posts per month. Base word count targets on competitor page analysis.

**E. Credential & Differentiation Content**
[SITE BUILD]
Using review sentiment themes and seed expansion data:
- Certifications, licenses, experience to weave into content
- Strongest competitive differentiators from review themes
- Industry trust signals competitors feature that this business should highlight

---

## OUTPUT FORMAT
- Tables for all keyword and competitor data
- Specific keywords, numbers, competitors throughout
- Flag best-practice recommendations vs data-driven ones`;

  const loadedTemplate = await loadPromptTemplate('10.3', DEFAULT_10_3_PROMPT);
  const prompt = replaceVariables(loadedTemplate, variables);

  logger.debug(`[Phase10.3] Prompt size: ~${Math.round(prompt.length / 4)} tokens`);

  const { thinking, content } = await callClaudeWithStreaming(
    sessionId, claudeApiKey, prompt, '10.3', 'Content Strategy & Blog Calendar', session
  );

  await saveSynthesisResult(sessionId, 'content_strategy', { thinking, content });
  logger.debug('[Phase10.3] ✅ Content Strategy & Blog Calendar saved');
  return content;
}

// 10.4: CRO Optimization Guide
async function synthesizeCROGuide(
  sessionId: string,
  session: any,
  auditData: UnifiedAuditData,
  phase3Sources: any[],
  contextDocs: { seoContext: string; croContext: string },
  competitiveAnalysisOutput: string,
  claudeApiKey: string
): Promise<string> {
  await updatePhase4Status(sessionId, 'phase10_4', 'Creating CRO optimization guide...', '10.4');

  const reviewData = formatReviewAnalyticsForClaude(auditData);
  const domainData = formatDomainIntelligenceForClaude(auditData);
  const technicalData = formatTechnicalAuditForClaude(auditData);

  const variables: Record<string, string> = {
    BUSINESS_NAME: session.business_name || 'Not specified',
    INDUSTRY: session.industry || session.business_type || 'Not specified',
    LOCATION: session.location || `${session.city || ''}, ${session.state || ''}`,
    TARGET_AUDIENCE: session.target_audience || 'Not specified',
    COMPETITIVE_ANALYSIS_OUTPUT: competitiveAnalysisOutput.substring(0, 10000),
    PHASE3_SOURCES: formatTavilyResults(phase3Sources),
    REVIEW_DATA: reviewData,
    DOMAIN_INTELLIGENCE_DATA: domainData,
    TECHNICAL_DATA: technicalData,
    CRO_CONTEXT: contextDocs.croContext || 'Not available',
  };

  const DEFAULT_10_4_PROMPT = `You are a conversion rate optimization expert.

Your task: Create a comprehensive CRO Optimization Guide for this local service business. Use the competitive analysis, CRO research, review data, and domain intelligence to produce actionable conversion recommendations.

Label every recommendation:
[SITE BUILD] — Will be automatically implemented when the AI builds the site.
[OWNER ACTION] — Requires ongoing human effort after the site launches.

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Target Audience:** {{TARGET_AUDIENCE}}

---

## DATA INPUTS

### INPUT 1: COMPETITIVE ANALYSIS (from 10.2)
{{COMPETITIVE_ANALYSIS_OUTPUT}}

### INPUT 2: CRO & CONVERSION RESEARCH (Tavily)
{{PHASE3_SOURCES}}

### INPUT 3: REVIEW ANALYTICS
{{REVIEW_DATA}}

### INPUT 4: DOMAIN INTELLIGENCE
{{DOMAIN_INTELLIGENCE_DATA}}

### INPUT 5: TECHNICAL SEO AUDIT
{{TECHNICAL_DATA}}

### INPUT 6: CRO BEST PRACTICES
{{CRO_CONTEXT}}

---

## DELIVERABLE: CRO OPTIMIZATION GUIDE

**Trust Signal Strategy** based on actual review data
[SITE BUILD]
- Rating vs competitor comparison — how to position the rating advantage (or mitigate a disadvantage)
- Review highlight strategy using actual positive themes from review analytics
- Social proof placement recommendations — where on each page type trust signals have maximum impact
- Certification, license, and award badge strategy

**Conversion Element Strategy**
[SITE BUILD]
- Primary CTA approach (phone call vs form vs scheduling) based on keyword intent breakdown from competitive analysis
- Form optimization recommendations — field count, progressive disclosure, mobile-first
- Mobile conversion priorities (based on domain intelligence performance data)
- Above-the-fold conversion element requirements per page type

**Page Performance Targets**
[SITE BUILD]
- Desktop/mobile performance scores (current vs target based on domain intelligence)
- Core Web Vitals optimization priorities
- Load time targets for conversion-critical pages

**Industry-Specific CRO Tactics**
[SITE BUILD] + [OWNER ACTION]
- Tactics specific to {{INDUSTRY}} businesses that drive conversions
- Seasonal conversion adjustments
- Local-specific trust factors (community involvement, local partnerships)
- Emergency/urgent service conversion patterns (if applicable)

---

## OUTPUT FORMAT
- Specific, actionable recommendations throughout
- Reference actual data from inputs — no generic CRO advice
- Prioritize recommendations by expected conversion impact`;

  const loadedTemplate = await loadPromptTemplate('10.4', DEFAULT_10_4_PROMPT);
  const prompt = replaceVariables(loadedTemplate, variables);

  logger.debug(`[Phase10.4] Prompt size: ~${Math.round(prompt.length / 4)} tokens`);

  const { thinking, content } = await callClaudeWithStreaming(
    sessionId, claudeApiKey, prompt, '10.4', 'CRO Optimization Guide', session
  );

  await saveSynthesisResult(sessionId, 'cro_guide', { thinking, content });
  logger.debug('[Phase10.4] ✅ CRO Optimization Guide saved');
  return content;
}

// 10.5: Off-Page Roadmap & Success Benchmarks
async function synthesizeOffPageRoadmap(
  sessionId: string,
  session: any,
  auditData: UnifiedAuditData,
  keywordStrategyOutput: string,
  competitiveAnalysisOutput: string,
  contentStrategyOutput: string,
  croGuideOutput: string,
  claudeApiKey: string
): Promise<string> {
  await updatePhase4Status(sessionId, 'phase10_5', 'Creating off-page roadmap and success benchmarks...', '10.5');

  const gbpData = formatBusinessProfileForClaude(auditData);
  const reviewData = formatReviewAnalyticsForClaude(auditData);
  const domainData = formatDomainIntelligenceForClaude(auditData);
  const scoringData = formatScoringForClaude(auditData);
  const napBlock = getNAPConsistencyBlock(session);
  const backlinkData = auditData.meta.tier === 'advanced'
    ? formatBacklinkProfileForClaude(auditData)
    : '';

  const qAndA = auditData.questions_and_answers;
  let qAndABlock = '';
  if (qAndA && Array.isArray(qAndA) && qAndA.length > 0) {
    qAndABlock = '### Google Q&A Data\n' + qAndA.slice(0, 15).map((q: any) =>
      `- Q: ${q.question || 'N/A'}\n  A: ${(q.answer || 'No answer').substring(0, 150)}`
    ).join('\n');
  }

  const variables: Record<string, string> = {
    BUSINESS_NAME: session.business_name || 'Not specified',
    INDUSTRY: session.industry || session.business_type || 'Not specified',
    LOCATION: session.location || `${session.city || ''}, ${session.state || ''}`,
    PHONE: session.phone_number || 'Not specified',
    EMAIL: session.contact_email || 'Not specified',
    NAP_BLOCK: napBlock || '',
    KEYWORD_STRATEGY_OUTPUT: keywordStrategyOutput.substring(0, 8000),
    COMPETITIVE_ANALYSIS_OUTPUT: competitiveAnalysisOutput.substring(0, 8000),
    CONTENT_STRATEGY_OUTPUT: contentStrategyOutput.substring(0, 8000),
    CRO_GUIDE_OUTPUT: croGuideOutput.substring(0, 4000),
    GBP_DATA: gbpData,
    REVIEW_DATA: reviewData,
    DOMAIN_DATA: domainData,
    SCORING_DATA: scoringData,
    BACKLINK_DATA: backlinkData || '',
    Q_AND_A_BLOCK: qAndABlock || '',
  };

  const DEFAULT_10_5_PROMPT = `You are a local SEO implementation specialist creating a post-launch action plan.

Your task: Using the strategic analysis from prior sub-phases, produce:
1. SECTION 6: 90-DAY OFF-PAGE ROADMAP — Everything the business owner must do after the site launches.
2. SECTION 7: SEO SUCCESS BENCHMARKS — Specific, data-grounded targets for 30/60/90 days.

EVERYTHING in Section 6 is [OWNER ACTION] — requires human effort or third-party tools.

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Phone:** {{PHONE}}
- **Email:** {{EMAIL}}

{{#if NAP_BLOCK}}{{NAP_BLOCK}}{{/if}}

---

## STRATEGIC CONTEXT (from prior analyses — summarized)

### Keyword Strategy Summary
{{KEYWORD_STRATEGY_OUTPUT}}

### Competitive Analysis Summary
{{COMPETITIVE_ANALYSIS_OUTPUT}}

### Content Strategy Summary
{{CONTENT_STRATEGY_OUTPUT}}

### CRO Guide Summary
{{CRO_GUIDE_OUTPUT}}

---

## DATA INPUTS

### GBP DATA
{{GBP_DATA}}

### REVIEW ANALYTICS
{{REVIEW_DATA}}

### DOMAIN INTELLIGENCE
{{DOMAIN_DATA}}

### SEO READINESS SCORES
{{SCORING_DATA}}

{{#if BACKLINK_DATA}}### BACKLINK PROFILE (Advanced Tier)
{{BACKLINK_DATA}}{{/if}}

{{#if Q_AND_A_BLOCK}}{{Q_AND_A_BLOCK}}{{/if}}

---

## DELIVERABLE

### SECTION 6: 90-DAY OFF-PAGE ROADMAP
[OWNER ACTION — Everything in this section requires human effort]

**Week 1–2: GBP Foundation**
Based on the GBP completeness score and specific gaps:
- List every missing GBP field by name and what to fill in
- Photo target: current count vs top competitor — target within 2 weeks
- Categories to add or correct (reference competitor categories)
- Services to add to GBP listing (reference keyword data for naming)
- GBP business description: write a 750-character draft using primary keywords and review sentiment themes
- Attributes to enable based on competitor analysis

**Month 1: Review Momentum & Citation Base**
- Review gap: this business count/rating vs competitor average
- Target reviews/week to close gap by end of Month 1
- Recommended ask strategy (when, what channel)
- NAP consistency issues to resolve first (flag specific incorrect listings)
- Top 10 citation sources prioritized by industry and location relevance
- Google Posts frequency and content angles for Month 1

**Month 2: Authority & Content Publishing**
- Blog publishing from the content calendar (Month 1 posts)
- Citation expansion beyond initial 10
- Review pace check and escalation strategy
- Backlink outreach first wave: 3–5 specific low-effort targets with rationale

**Month 3: Competitive Push**
- Blog Months 2–3 posts from content calendar
- Backlink outreach second wave: top 5 competitor link gap targets
- GBP performance review: adjust categories/services for high-impression queries
- GBP Q&A seeding with top PAA questions
- Review milestone check and strategy adjustment

---

### SECTION 7: SEO SUCCESS BENCHMARKS

**At 30 Days — Site Live, GBP Optimized, Citations Submitted**

Keyword Rankings (list 10 specific Tier 1 keywords):

| Keyword | Current Position | 30-Day Target | Rationale |
|---------|-----------------|---------------|-----------|

GBP Visibility: impression target, calls target, local pack appearances

**At 60 Days — Content Publishing Active, Citations Live**

Organic Traffic:
- Conservative estimate (bottom-quartile CTR against target volumes)
- Optimistic estimate (top-quartile CTR)
- Review count target vs top competitor
- Local pack appearance targets

**At 90 Days — Full Campaign Running**

Keyword Positions (Tier 1 + Tier 2 targets):

| Keyword | Current Position | 90-Day Target | Rationale |
|---------|-----------------|---------------|-----------|

Organic Traffic Range (conservative + optimistic with methodology)
GBP Targets (monthly impressions, calls, local pack presence)

Revenue Potential Model (directional estimate only):
If available: monthly organic visitors × lead conversion rate × average deal value = estimated monthly pipeline. State all assumptions clearly.

---

## OUTPUT FORMAT
- Tables for all benchmarks and keyword targets
- Specific numbers throughout — no placeholder language
- Flag projections as conservative vs optimistic`;

  const loadedTemplate = await loadPromptTemplate('10.5', DEFAULT_10_5_PROMPT);
  const prompt = replaceVariables(loadedTemplate, variables);

  logger.debug(`[Phase10.5] Prompt size: ~${Math.round(prompt.length / 4)} tokens`);

  const { thinking, content } = await callClaudeWithStreaming(
    sessionId, claudeApiKey, prompt, '10.5', 'Off-Page Roadmap & Benchmarks', session
  );

  await saveSynthesisResult(sessionId, 'offpage_roadmap_benchmarks', { thinking, content });
  logger.debug('[Phase10.5] ✅ Off-Page Roadmap & Benchmarks saved');
  return content;
}

// 10.6: Site Architecture + SEO Specs + Internal Linking + Technical SEO
async function synthesizeSiteArchitecture(
  sessionId: string,
  session: any,
  auditData: UnifiedAuditData,
  phase2Sources: any[],
  contextDocs: { seoContext: string; croContext: string },
  keywordStrategyOutput: string,
  competitiveAnalysisOutput: string,
  contentStrategyOutput: string,
  croGuideOutput: string,
  claudeApiKey: string
): Promise<string> {
  await updatePhase4Status(sessionId, 'phase10_6', 'Generating site architecture, SEO specs, linking, and technical SEO...', '10.6');

  const auditDataFormatted = formatFullAuditForClaude(auditData);
  const technicalData = formatTechnicalAuditForClaude(auditData);
  const napBlock = getNAPConsistencyBlock(session);
  const schemaTemplates = getSchemaMarkupTemplates(session);

  const variables: Record<string, string> = {
    BUSINESS_NAME: session.business_name || 'Not specified',
    INDUSTRY: session.industry || session.business_type || 'Not specified',
    LOCATION: session.location || `${session.city || ''}, ${session.state || ''}`,
    PRIMARY_SERVICE: session.primary_service || 'Not specified',
    SERVICES: [session.services, session.additional_services].filter(Boolean).join(', ') || 'Not specified',
    SERVICE_AREA_CITIES: (session.service_area_cities || []).join(', ') || 'Not specified',
    WEBSITE_URL: session.website_url || 'New website',
    NAP_BLOCK: napBlock || '',
    KEYWORD_STRATEGY_OUTPUT: keywordStrategyOutput.substring(0, 10000),
    COMPETITIVE_ANALYSIS_OUTPUT: competitiveAnalysisOutput.substring(0, 8000),
    CONTENT_STRATEGY_OUTPUT: contentStrategyOutput.substring(0, 10000),
    CRO_GUIDE_OUTPUT: croGuideOutput.substring(0, 4000),
    TECHNICAL_DATA: technicalData,
    PHASE2_SOURCES: formatTavilyResults(phase2Sources),
    SEO_CONTEXT: contextDocs.seoContext || 'Not available',
    AUDIT_DATA: auditDataFormatted,
    SCHEMA_TEMPLATES: schemaTemplates,
  };

  const DEFAULT_10_6_PROMPT = `You are a senior SEO architect creating the complete site structure for a local service business.

Your task: Using the strategic analysis from all prior sub-phases (10.1–10.5), produce a unified site architecture document containing:
1. Complete URL hierarchy (sitemap)
2. Per-page SEO specifications
3. Internal linking map
4. Technical SEO analysis

This document is the blueprint that the AI site builder (Cursor) will follow. Every page, URL, keyword assignment, meta tag, and link must be defined here.

{{#if NAP_BLOCK}}{{NAP_BLOCK}}{{/if}}

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Primary Service:** {{PRIMARY_SERVICE}}
- **Services:** {{SERVICES}}
- **Service Area Cities:** {{SERVICE_AREA_CITIES}}
- **Website:** {{WEBSITE_URL}}

---

## STRATEGIC CONTEXT (from analyses 10.1–10.5)

### Keyword Strategy
{{KEYWORD_STRATEGY_OUTPUT}}

### Competitive Analysis
{{COMPETITIVE_ANALYSIS_OUTPUT}}

### Content Strategy
{{CONTENT_STRATEGY_OUTPUT}}

### CRO Guide
{{CRO_GUIDE_OUTPUT}}

---

## DATA INPUTS

### TECHNICAL SEO AUDIT
{{TECHNICAL_DATA}}

### SEO & CONTENT RESEARCH (Tavily — qualitative only)
{{PHASE2_SOURCES}}

### SEO BEST PRACTICES
{{SEO_CONTEXT}}

### FULL SEO AUDIT DATA
{{AUDIT_DATA}}

### SCHEMA MARKUP TEMPLATES
{{SCHEMA_TEMPLATES}}

---

## DELIVERABLE: SITE ARCHITECTURE DOCUMENT

### PART 1: URL HIERARCHY & SITEMAP

List every page with its full URL path, organized by type:

| # | Page Name | URL Path | Page Type | Primary Keyword | Content Priority |
|---|-----------|----------|-----------|----------------|-----------------|

Page types: Homepage, Service Hub, Service Detail, Location Landing, About, Contact, FAQ, Blog Hub, Testimonials/Reviews

Follow a hub-and-spoke model:
- Hub pages (e.g., /services/) link down to all their spokes
- Spoke pages (e.g., /services/drain-cleaning/) link back to hub and cross-link to related spokes
- Location pages (e.g., /areas-served/austin/) interlink with relevant service pages

### PART 2: PER-PAGE SEO SPECIFICATIONS

For EVERY page in the sitemap above:

**[Page Name] — [URL Path]**
- **Primary Keyword:** (1 keyword)
- **Secondary Keywords:** (2–3)
- **Long-Tail Variations:** (2–3)
- **Title Tag:** (50–60 chars, keyword-rich)
- **Meta Description:** (150–160 chars, with CTA)
- **H1 Tag:** (unique, keyword-optimized)
- **Schema Markup:** Which schema.org type + key properties
- **Canonical URL:** Self-referencing canonical
- **Content Requirements:** Minimum word count, required sections, key topics to cover
- **CTA Strategy:** Primary CTA text and intent (call, form, schedule)

Avoid keyword cannibalization — no two pages should target the same primary keyword.

### PART 3: INTERNAL LINKING MAP

**Page-by-Page Links:**
For each page, specify:
- **Links To:** Which pages this page links to
- **Anchor Text:** Keyword-optimized anchor text for each link
- **Link Placement:** Where in the content (intro, body, sidebar, footer)

**Cross-Linking Rules:**
- Service → Location page links
- Blog → Service page links
- Service → Related service links
- All pages → Contact/CTA links

**Link Equity Distribution:**
- Which pages should receive the most internal links
- Priority pages for link equity flow
- Orphan page prevention

**Anchor Text Strategy:**
- Exact match: 10–15%
- Partial match: 40–50%
- Branded: 20–30%
- Generic ("learn more"): 10–15%

**Navigation Structure:**
- Primary navigation links
- Footer link structure

### PART 4: TECHNICAL SEO ANALYSIS

**Critical Issues (Must Fix)**
[SITE BUILD]
Every critical issue from the audit. For each: what it is, which pages affected, ranking impact.

**High-Priority Warnings**
[SITE BUILD]
Which warnings materially affect rankings vs which are minor. Rank by SEO impact.

**Schema Gap Analysis**
[SITE BUILD]
Schema types top competitors use that this business doesn't. Which types create the most SERP visibility (rich results, review stars, FAQ dropdowns).

**Technical Competitive Gap**
[SITE BUILD]
Lighthouse performance comparison (this business vs competitors). Can a well-built site outrank competitors on technical merit alone?

---

## OUTPUT FORMAT
- Tables for the sitemap and page specs
- Every page gets complete SEO specs — no shortcuts
- All link recommendations include specific anchor text`;

  const loadedTemplate = await loadPromptTemplate('10.6', DEFAULT_10_6_PROMPT);
  const prompt = replaceVariables(loadedTemplate, variables);

  logger.debug(`[Phase10.6] Prompt size: ~${Math.round(prompt.length / 4)} tokens`);

  const { thinking, content } = await callClaudeWithStreaming(
    sessionId, claudeApiKey, prompt, '10.6', 'Site Architecture + SEO Specs + Technical', session
  );

  await saveSynthesisResult(sessionId, 'site_architecture', { thinking, content });
  logger.debug('[Phase10.6] ✅ Site Architecture + SEO Specs + Technical saved');
  return content;
}

// 10.7: UI Design & Styling Direction
async function synthesizeUIDesign(
  sessionId: string,
  session: any,
  auditData: UnifiedAuditData,
  siteArchitectureOutput: string,
  croGuideOutput: string,
  competitiveAnalysisOutput: string,
  claudeApiKey: string
): Promise<string> {
  await updatePhase4Status(sessionId, 'phase10_7', 'Determining UI design direction and styling...', '10.7');

  const reviewData = formatReviewAnalyticsForClaude(auditData);

  const hasBrandColors = session.has_brand_colors && session.brand_colors_array?.length > 0;
  const brandColorsList = hasBrandColors ? session.brand_colors_array.join(', ') : 'Not provided — generate appropriate colors';
  const brandFontsList = (session.brand_fonts_array?.length && session.brand_fonts_array.join(', ')) || session.brand_fonts || 'Not provided — recommend appropriate fonts';

  const intentDist = auditData.keyword_universe?.intent_distribution || {};
  const totalKW = Object.values(intentDist).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);
  const intentBreakdown = totalKW > 0
    ? `Transactional: ${Math.round(((intentDist.transactional || 0) / totalKW) * 100)}%, Commercial: ${Math.round(((intentDist.commercial || 0) / totalKW) * 100)}%, Informational: ${Math.round(((intentDist.informational || 0) / totalKW) * 100)}%`
    : 'Not available';

  const variables: Record<string, string> = {
    BUSINESS_NAME: session.business_name || 'Not specified',
    INDUSTRY: session.industry || session.business_type || 'Not specified',
    LOCATION: session.location || `${session.city || ''}, ${session.state || ''}`,
    TARGET_AUDIENCE: session.target_audience || 'Not specified',
    TARGET_CUSTOMER_TYPE: session.target_customer_type || 'Not specified',
    YEARS_IN_BUSINESS: session.years_in_business || 'Not specified',
    BRAND_COLORS: brandColorsList,
    BRAND_FONTS: brandFontsList,
    INTENT_BREAKDOWN: intentBreakdown,
    REVIEW_DATA: reviewData,
    COMPETITIVE_ANALYSIS_OUTPUT: competitiveAnalysisOutput.substring(0, 6000),
    CRO_GUIDE_OUTPUT: croGuideOutput.substring(0, 6000),
    SITE_ARCHITECTURE_OUTPUT: siteArchitectureOutput.substring(0, 4000),
    COLOR_PALETTE_INSTRUCTION: hasBrandColors
      ? 'Build from the provided brand colors as foundation.'
      : 'Generate an appropriate palette from scratch.',
    TYPOGRAPHY_INSTRUCTION: session.brand_fonts
      ? 'Build from provided brand fonts.'
      : 'Recommend appropriate font pairings.',
  };

  const DEFAULT_10_7_PROMPT = `You are an expert UI/UX designer and brand strategist. Your job is to determine the right design direction for this business's website based on who they are, who their customers are, and what the competitive landscape looks like.

This is NOT a component library or pixel-level spec. This is a strategic design direction document that tells the AI site builder: "Here's what good design looks like for THIS specific business and THIS specific audience."

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Target Audience:** {{TARGET_AUDIENCE}}
- **Target Customer Type:** {{TARGET_CUSTOMER_TYPE}}
- **Years in Business:** {{YEARS_IN_BUSINESS}}
- **Brand Colors:** {{BRAND_COLORS}}
- **Brand Fonts:** {{BRAND_FONTS}}

---

## STRATEGIC CONTEXT

### Keyword Intent Breakdown
{{INTENT_BREAKDOWN}}
(High transactional/emergency = action-oriented design. High informational = design supporting long-form reading.)

### Review Sentiment
{{REVIEW_DATA}}

### Competitive Landscape (visual differentiation context)
{{COMPETITIVE_ANALYSIS_OUTPUT}}

### CRO & Conversion Strategy
{{CRO_GUIDE_OUTPUT}}

### Site Architecture (pages being built)
{{SITE_ARCHITECTURE_OUTPUT}}

---

## DESIGN ARCHETYPE LIBRARY (Reference)

Select ONE primary archetype or blend TWO based on the business context. Justify your choice.

**1. Clean Minimal**
Generous whitespace, restrained color use, simple grid layouts. Typography does the heavy lifting — clean sans-serif, strong size hierarchy. High-quality hero images, minimal decoration. Best for: professional services, higher-income clientele, businesses competing on quality/expertise. Conversion style: subtle, trust-first.

**2. Bold & Action-Oriented**
High contrast, prominent CTAs, strong color blocking. Phone number and primary CTA visible within 2 seconds. Urgency-friendly layout. Best for: emergency services (plumbing, HVAC, locksmith, towing), mobile + high-intent traffic. Conversion style: click-to-call, short forms, immediate action.

**3. Warm & Community**
Rounded corners, friendly color palette, real photography over stock. Testimonials and team photos prominent. Feels personal and local. Best for: family-owned businesses, brands where reviews mention "friendly," "trustworthy," "family." Conversion style: relationship-first, build trust before conversion.

**4. Premium / Luxury**
Refined typography (often serif headings), muted or jewel-tone palette. Elegant spacing, subtle animations, photography with intentional art direction. Best for: high-end remodeling, custom builders, med spas, boutique services. Conversion style: consultation-focused, portfolio/gallery emphasis.

**5. Modern Professional**
Contemporary grid layouts, bold geometric elements, structured sections. Strong typographic hierarchy, modern sans-serif stack. Clean iconography, data-driven trust signals. Best for: commercial services, B2B, businesses competing against larger companies. Conversion style: credibility-first, certifications, case studies.

**6. Tech-Forward**
Gradient accents, subtle glass morphism, modern UI patterns. Dark sections with light text, animated transitions. Best for: IT services, smart home, solar/energy, tech-adjacent trades. Conversion style: feature-comparison, spec-driven.

**7. Traditional / Established**
Classic layouts, conservative color palette (navy, forest, burgundy). Serif or hybrid typography. Emphasis on history, credentials, institutional trust. Best for: legal, accounting, established trades with 20+ years, audiences 50+. Conversion style: phone-call dominant, simple forms.

---

## THEME AXIS (independent of style)
- **Light Theme** — White/cream backgrounds, dark text. Open, clean, trustworthy.
- **Dark Theme** — Dark gray/charcoal, light text. Dramatic, modern, premium.
- **Hybrid** — Dark hero/header, light content areas. Impact on first impression, readability for content.

## DENSITY AXIS (independent of style)
- **Spacious / Editorial** — Lots of breathing room. Premium, minimal feel.
- **Balanced** — Standard content density. Most businesses.
- **Information-Rich** — More content above the fold, multiple CTAs visible. Lots of services/locations.

---

## DELIVERABLE: UI DESIGN & STYLING DIRECTION

### 1. Design Direction Selection
- **Primary Archetype:** (name + number)
- **Secondary Influence:** (if blending two)
- **Theme:** Light / Dark / Hybrid
- **Density:** Spacious / Balanced / Information-Rich
- **Rationale:** Why this direction fits this business, this audience, and this competitive landscape. Reference specific data (review themes, keyword intent, competitor visual landscape, target audience).

### 2. Color Palette
{{COLOR_PALETTE_INSTRUCTION}}
- Primary Color (hex) — main brand identity
- Secondary Color (hex) — supporting/accent
- Accent Color (hex) — CTAs and highlights
- Background Colors (hex) — page backgrounds, section alternation
- Text Colors (hex) — headings, body, muted
- Rationale for palette choices

### 3. Typography Direction
{{TYPOGRAPHY_INSTRUCTION}}
- Heading Font: name + character (e.g., "Inter — clean, modern, authoritative")
- Body Font: name + character
- Hierarchy approach: how headings, subheadings, body, captions relate
- Do NOT specify exact pixel sizes — describe the intent and hierarchy

### 4. Photography & Imagery Direction
- Real photos vs illustrations vs icons
- Hero image treatment (full-bleed, overlaid, contained)
- Team/staff photos: yes/no, style
- Work/project photos: yes/no, style
- What feeling images should convey

### 5. Conversion Element Treatment
- How CTAs should feel: urgent vs subtle vs premium
- Button styling direction (rounded vs sharp, filled vs outlined)
- Form styling direction (inline vs modal vs dedicated page)
- Phone number prominence level
- Trust signal visual treatment (badges, stars, certification logos)

### 6. Design First Principles
Write 5–7 principles specific to THIS site that the builder should follow on every page. Examples:
- "Every page should breathe — generous whitespace between sections"
- "The phone number should never be more than one tap away on mobile"
- "Trust signals (reviews, certifications) should be visible within one scroll"

These principles guide the builder when making layout decisions the design direction doesn't explicitly cover.`;

  const loadedTemplate = await loadPromptTemplate('10.7', DEFAULT_10_7_PROMPT);
  const prompt = replaceVariables(loadedTemplate, variables);

  logger.debug(`[Phase10.7] Prompt size: ~${Math.round(prompt.length / 4)} tokens`);

  const { thinking, content } = await callClaudeWithStreaming(
    sessionId, claudeApiKey, prompt, '10.7', 'UI Design & Styling Direction', session
  );

  await saveSynthesisResult(sessionId, 'ui_design', { thinking, design_system: content });
  logger.debug('[Phase10.7] ✅ UI Design & Styling Direction saved');
  return content;
}

// 10.8: Project Overview
async function synthesizeProjectOverview(
  sessionId: string,
  session: any,
  keywordStrategyOutput: string,
  competitiveAnalysisOutput: string,
  contentStrategyOutput: string,
  croGuideOutput: string,
  siteArchitectureOutput: string,
  uiDesignOutput: string,
  claudeApiKey: string
): Promise<void> {
  await updatePhase4Status(sessionId, 'phase10_8', 'Generating project overview...', '10.8');

  const variables: Record<string, string> = {
    KEYWORD_STRATEGY_OUTPUT: keywordStrategyOutput.substring(0, 8000),
    COMPETITIVE_ANALYSIS_OUTPUT: competitiveAnalysisOutput.substring(0, 6000),
    CONTENT_STRATEGY_OUTPUT: contentStrategyOutput.substring(0, 6000),
    CRO_GUIDE_OUTPUT: croGuideOutput.substring(0, 4000),
    SITE_ARCHITECTURE_OUTPUT: siteArchitectureOutput.substring(0, 10000),
    UI_DESIGN_OUTPUT: uiDesignOutput.substring(0, 6000),
    BUSINESS_NAME: session.business_name || 'Business',
    INDUSTRY: session.industry || '',
    LOCATION: session.location || '',
  };

  const DEFAULT_10_8_PROMPT = `You are an expert technical writer. Create a concise Project Overview document for an AI (Cursor) that will build this website.

# Keyword Strategy
{{KEYWORD_STRATEGY_OUTPUT}}

# Market Position & Competitive Analysis
{{COMPETITIVE_ANALYSIS_OUTPUT}}

# Content Strategy & Blog Calendar
{{CONTENT_STRATEGY_OUTPUT}}

# CRO Optimization Guide
{{CRO_GUIDE_OUTPUT}}

# Site Architecture + SEO Specs
{{SITE_ARCHITECTURE_OUTPUT}}

# UI Design & Styling Direction
{{UI_DESIGN_OUTPUT}}

# Business
- Name: {{BUSINESS_NAME}}
- Industry: {{INDUSTRY}}
- Location: {{LOCATION}}

# Your Task
Write a concise **Project Overview** (under 1000 words) that:
1. Summarizes what this site is for and who it serves.
2. Lists the pages to build (from the site architecture).
3. Explains how to use each of the 7 attached documents: Keyword Strategy (targeting), Market Position & Competitive Analysis (positioning), Content Strategy (topic clusters, blog calendar), CRO Guide (conversion optimization), Site Architecture (URLs, specs, linking, technical SEO), UI Design (styling direction — adapt layout per page, follow design principles).
4. States that the builder should follow principles and strategy, not rigid step-by-step specs; adapt layout and spacing to each page's content.

Format as clear sections. This will be attached in Cursor alongside the report files.`;

  const loadedTemplate = await loadPromptTemplate('10.8', DEFAULT_10_8_PROMPT);
  const overviewPrompt = replaceVariables(loadedTemplate, variables);

  const { thinking: overviewThinking, content: overviewContent } = await callClaudeWithStreaming(
    sessionId, claudeApiKey, overviewPrompt, '10.8', 'Project Overview', session
  );

  await saveSynthesisResult(sessionId, 'project_overview', {
    thinking: overviewThinking,
    content: overviewContent,
  });

  logger.debug('[Phase10.8] ✅ Project Overview saved');
}

// ═══════════════════════════════════════════════════════════════════
// END NEW ENHANCED SUB-PHASES 10.1–10.8
// ═══════════════════════════════════════════════════════════════════

// Helper: Sub-phase 4.1
async function synthesizeCompetitiveIntelligence(
  sessionId: string,
  session: any,
  phase1Sources: any[],
  phase1DataForSEO: any,
  claudeApiKey: string
) {
  await updatePhase4Status(sessionId, 'phase4_1', 'Synthesizing competitive intelligence...', '4.1');

  // Load prompt template from database
  const { data: promptData } = await supabase
    .from('phase4_prompts')
    .select('prompt_template')
    .eq('subphase', '4.1')
    .eq('status', 'active')
    .single();

  const promptTemplate = promptData?.prompt_template || DEFAULT_4_1_PROMPT;

  // Build DataForSEO context if available
  const dataforseoContext = formatPhase1DataForSEO(phase1DataForSEO);
  const hasDataForSEO = !!dataforseoContext;
  const hasUserBusiness = !!(phase1DataForSEO?.user_business);

  // Replace variables
  const prompt = replaceVariables(promptTemplate, {
    PHASE1_SOURCES: formatTavilyResults(phase1Sources),
    DATAFORSEO_LOCAL_DATA: dataforseoContext || 'No DataForSEO data available for this session.',
    HAS_DATAFORSEO: hasDataForSEO ? 'true' : 'false',
    USER_BUSINESS_PROVIDED: hasUserBusiness ? 'true' : 'false',
    INDUSTRY: session.industry,
    LOCATION: session.location,
    BUSINESS_NAME: session.business_name,
  });

  if (hasDataForSEO) {
    logger.debug(`[Phase4.1] Including DataForSEO local competitive data (${dataforseoContext.length} chars)`);
    if (hasUserBusiness) {
      logger.debug(`[Phase4.1] 🎯 User business profile provided - enabling personalized competitive analysis`);
    }
  }

  logger.debug(`[Phase4.1] Prompt tokens: ~${(prompt.length / 4).toFixed(0)}`);

  // Call Claude with streaming
  const { thinking, content } = await callClaudeWithStreaming(
    sessionId,
    claudeApiKey,
    prompt,
    '4.1',
    'Competitive Intelligence',
    session
  );

  const currentPhase4Data = await getPhase4Synthesis(sessionId);
  logger.debug('[Phase4.1] Current phase4 data keys:', Object.keys(currentPhase4Data));
  await setPhase4Synthesis(sessionId, {
    ...currentPhase4Data,
    competitive_intelligence: {
      thinking,
      report: content,
      timestamp: new Date().toISOString(),
    },
  });

  logger.debug('[Phase4.1] ✅ Competitive Intelligence report saved to database');
  return content;
}

// Helper: Sub-phase 4.2
async function synthesizeSEOStrategy(
  sessionId: string,
  session: any,
  phase2Sources: any[],
  phase2DataForSEO: any,
  seoContext: string,
  claudeApiKey: string
) {
  await updatePhase4Status(sessionId, 'phase4_2', 'Synthesizing SEO strategy...', '4.2');

  // Load prompt template from database
  const { data: promptData } = await supabase
    .from('phase4_prompts')
    .select('prompt_template')
    .eq('subphase', '4.2')
    .eq('status', 'active')
    .single();

  const promptTemplate = promptData?.prompt_template || DEFAULT_4_2_PROMPT;

  // Build DataForSEO context if available
  const dataforseoContext = formatPhase2DataForSEO(phase2DataForSEO);
  const hasDataForSEO = !!dataforseoContext;

  // Replace variables
  const prompt = replaceVariables(promptTemplate, {
    PHASE2_SOURCES: formatTavilyResults(phase2Sources),
    DATAFORSEO_KEYWORD_DATA: dataforseoContext || 'No DataForSEO keyword data available for this session.',
    HAS_DATAFORSEO: hasDataForSEO ? 'true' : 'false',
    SEO_CONTEXT: seoContext,
    INDUSTRY: session.industry,
    LOCATION: session.location,
    BUSINESS_NAME: session.business_name,
  });

  if (hasDataForSEO) {
    logger.debug(`[Phase4.2] Including DataForSEO keyword data (${dataforseoContext.length} chars)`);
  }

  logger.debug(`[Phase4.2] Prompt tokens: ~${(prompt.length / 4).toFixed(0)}`);

  // Call Claude with streaming
  const { thinking, content } = await callClaudeWithStreaming(
    sessionId,
    claudeApiKey,
    prompt,
    '4.2',
    'SEO Strategy',
    session
  );

  const currentPhase4Data = await getPhase4Synthesis(sessionId);
  logger.debug('[Phase4.2] Current phase4 data keys:', Object.keys(currentPhase4Data));
  await setPhase4Synthesis(sessionId, {
    ...currentPhase4Data,
    seo_strategy: {
      thinking,
      guide: content,
      timestamp: new Date().toISOString(),
    },
  });

  logger.debug('[Phase4.2] ✅ SEO Strategy guide saved to database');
  return content;
}

// Helper: Sub-phase 4.3
async function synthesizeCROOptimization(
  sessionId: string,
  session: any,
  phase3Sources: any[],
  phase3DataForSEO: any,
  croContext: string,
  claudeApiKey: string
) {
  await updatePhase4Status(sessionId, 'phase4_3', 'Synthesizing CRO optimization...', '4.3');

  // Load prompt template from database
  const { data: promptData } = await supabase
    .from('phase4_prompts')
    .select('prompt_template')
    .eq('subphase', '4.3')
    .eq('status', 'active')
    .single();

  const promptTemplate = promptData?.prompt_template || DEFAULT_4_3_PROMPT;

  // Build DataForSEO context if available
  const dataforseoContext = formatPhase3DataForSEO(phase3DataForSEO);
  const hasDataForSEO = !!dataforseoContext;

  // Replace variables
  const prompt = replaceVariables(promptTemplate, {
    PHASE3_SOURCES: formatTavilyResults(phase3Sources),
    DATAFORSEO_ONPAGE_DATA: dataforseoContext || 'No DataForSEO on-page data available for this session.',
    HAS_DATAFORSEO: hasDataForSEO ? 'true' : 'false',
    CRO_CONTEXT: croContext,
    INDUSTRY: session.industry,
    LOCATION: session.location,
    BUSINESS_NAME: session.business_name,
  });

  if (hasDataForSEO) {
    logger.debug(`[Phase4.3] Including DataForSEO on-page benchmark data (${dataforseoContext.length} chars)`);
  }

  logger.debug(`[Phase4.3] Prompt tokens: ~${(prompt.length / 4).toFixed(0)}`);

  // Call Claude with streaming
  const { thinking, content } = await callClaudeWithStreaming(
    sessionId,
    claudeApiKey,
    prompt,
    '4.3',
    'CRO Optimization',
    session
  );

  const currentPhase4Data = await getPhase4Synthesis(sessionId);
  logger.debug('[Phase4.3] Current phase4 data keys:', Object.keys(currentPhase4Data));
  await setPhase4Synthesis(sessionId, {
    ...currentPhase4Data,
    cro_optimization: {
      thinking,
      guide: content,
      timestamp: new Date().toISOString(),
    },
  });

  logger.debug('[Phase4.3] ✅ CRO Optimization guide saved to database');
  return content;
}

// Helper: Sub-phase 4.4 - Wireframe/Outline
async function generateWireframe(
  sessionId: string,
  session: any,
  competitiveReport: string,
  seoGuide: string,
  croGuide: string,
  claudeApiKey: string
) {
  await updatePhase4Status(sessionId, 'phase4_4', 'Generating website wireframe...', '4.4');

  // Load prompt template
  const { data: promptData } = await supabase
    .from('phase4_prompts')
    .select('prompt_template')
    .eq('subphase', '4.4')
    .eq('status', 'active')
    .single();

  const promptTemplate = promptData?.prompt_template || DEFAULT_4_4_WIREFRAME_PROMPT;

  // Replace variables
  const prompt = replaceVariables(promptTemplate, {
    COMPETITIVE_INTELLIGENCE_REPORT: competitiveReport,
    SEO_STRATEGY_GUIDE: seoGuide,
    CRO_OPTIMIZATION_GUIDE: croGuide,
    BUSINESS_NAME: session.business_name,
    INDUSTRY: session.industry,
    LOCATION: session.location,
    SERVICES: [session.services, session.additional_services].filter(Boolean).join(', ') || 'Not specified',
    TARGET_AUDIENCE: session.target_audience || 'Not specified',
    PHONE_NUMBER: session.phone_number || 'Not specified',
    STREET_ADDRESS: session.street_address || 'Not specified',
    CITY: session.city || 'Not specified',
    STATE: session.state || 'Not specified',
    ZIP_CODE: session.zip_code || 'Not specified',
    CONTACT_EMAIL: session.contact_email || 'Not specified',
  });

  logger.debug(`[Phase4.4] Prompt tokens: ~${(prompt.length / 4).toFixed(0)}`);

  // Call Claude
  const { thinking, content } = await callClaudeWithStreaming(
    sessionId,
    claudeApiKey,
    prompt,
    '4.4',
    'Wireframe Generation',
    session
  );

  const currentPhase4Data = await getPhase4Synthesis(sessionId);
  logger.debug('[Phase4.4] Current phase4 data keys:', Object.keys(currentPhase4Data));
  await setPhase4Synthesis(sessionId, {
    ...currentPhase4Data,
    wireframe: {
      thinking,
      outline: content,
      timestamp: new Date().toISOString(),
    },
  });

  logger.debug('[Phase4.4] ✅ Wireframe saved to database');
  return content;
}

// Helper: Sub-phase 4.5 - UI Design & Color Palette
async function generateUIDesign(
  sessionId: string,
  session: any,
  wireframe: string,
  claudeApiKey: string
) {
  await updatePhase4Status(sessionId, 'phase4_5', 'Generating UI design system...', '4.5');

  // Load prompt template
  const { data: promptData } = await supabase
    .from('phase4_prompts')
    .select('prompt_template')
    .eq('subphase', '4.5')
    .eq('status', 'active')
    .single();

  const promptTemplate = promptData?.prompt_template || DEFAULT_4_5_UI_PROMPT;

  // Build brand colors and fonts context (fonts optional for future form fields)
  const hasBrandColors = session.has_brand_colors && session.brand_colors_array?.length > 0;
  const brandColorsList = hasBrandColors
    ? session.brand_colors_array.join(', ')
    : 'Not provided';
  const brandFontsList =
    (session.brand_fonts_array?.length && session.brand_fonts_array.join(', ')) ||
    session.brand_fonts ||
    'Not provided';

  // Replace variables
  const prompt = replaceVariables(promptTemplate, {
    WIREFRAME_OUTLINE: wireframe,
    BUSINESS_NAME: session.business_name,
    INDUSTRY: session.industry,
    LOCATION: session.location,
    HAS_BRAND_COLORS: hasBrandColors ? 'true' : 'false',
    BRAND_COLORS_LIST: brandColorsList,
    BRAND_FONTS_LIST: brandFontsList,
  });

  logger.debug(`[Phase4.5] Prompt tokens: ~${(prompt.length / 4).toFixed(0)}`);

  // Call Claude
  const { thinking, content } = await callClaudeWithStreaming(
    sessionId,
    claudeApiKey,
    prompt,
    '4.5',
    'UI Design System',
    session
  );

  const currentPhase4Data = await getPhase4Synthesis(sessionId);
  logger.debug('[Phase4.5] Current phase4 data keys:', Object.keys(currentPhase4Data));
  await setPhase4Synthesis(sessionId, {
    ...currentPhase4Data,
    ui_design: {
      thinking,
      design_system: content,
      timestamp: new Date().toISOString(),
    },
  });

  logger.debug('[Phase4.5] ✅ UI design saved to database');
  return content;
}

/** Context for project overview generation */
interface OverviewContext {
  competitiveReport: string;
  seoGuide: string;
  croGuide: string;
  wireframe: string;
  uiDesign: string;
}

// Helper: Sub-phase 4.6 / 10.8 - Project Overview
async function generateProjectOverview(
  sessionId: string,
  session: any,
  ctx: OverviewContext,
  claudeApiKey: string,
  subphase: string = '4.6'
): Promise<void> {
  await updatePhase4Status(sessionId, `phase4_${subphase.replace('.', '_')}`, 'Generating project overview...', subphase);

  const overviewPrompt = replaceVariables(DEFAULT_4_6_OVERVIEW_PROMPT, {
    COMPETITIVE_REPORT: ctx.competitiveReport.slice(0, 12000),
    SEO_GUIDE: ctx.seoGuide.slice(0, 8000),
    CRO_GUIDE: ctx.croGuide.slice(0, 8000),
    WIREFRAME: ctx.wireframe.slice(0, 4000),
    UI_DESIGN: ctx.uiDesign.slice(0, 6000),
    BUSINESS_NAME: session.business_name || 'Business',
    INDUSTRY: session.industry || '',
    LOCATION: session.location || '',
  });

  const { thinking: overviewThinking, content: overviewContent } = await callClaudeWithStreaming(
    sessionId,
    claudeApiKey,
    overviewPrompt,
    subphase,
    'Project Overview',
    session
  );

  const currentPhase4Data = await getPhase4Synthesis(sessionId);
  await setPhase4Synthesis(sessionId, {
    ...currentPhase4Data,
    project_overview: {
      thinking: overviewThinking,
      content: overviewContent,
      timestamp: new Date().toISOString(),
    },
  });

  logger.debug('[Phase4.6] ✅ Project overview saved');
}

// Helper: Sub-phases 4.N+ - Generate Cursor Prompts for Each Page (DEPRECATED - kept for reference/rollback)
async function generatePagePrompts(
  sessionId: string,
  session: any,
  pages: string[],
  cachedContext: CachedContext,
  promptStartIndex: number,
  claudeApiKey: string
): Promise<Record<string, { thinking: string; prompt: string; timestamp: string }>> {
  const pagePrompts: Record<string, { thinking: string; prompt: string; timestamp: string }> = {};

  // Load checkpoint to see which page prompts are already complete
  const checkpointData = await loadCheckpoint(sessionId);
  const phase4Checkpoint = checkpointData.phase4;

  for (let i = 0; i < pages.length; i++) {
    const pageName = pages[i];
    const subphase = `4.${promptStartIndex + i}`;
    
    // CHECKPOINT: Skip if page prompt already completed
    if (isPagePromptCompleted(phase4Checkpoint, pageName)) {
      logger.debug(`[Phase${subphase}] ⏭️  SKIPPING "${pageName}" - Prompt already generated`);
      
      const phase4Data = await getPhase4Synthesis(sessionId);
      if ((phase4Data as any)?.page_prompts?.[pageName]) {
        pagePrompts[pageName] = (phase4Data as any).page_prompts[pageName];
      }
      
      continue; // Skip to next page
    }

    await updatePhase4Status(
      sessionId, 
      `phase4_${promptStartIndex + i}`, 
      `Creating prompt for: ${pageName}...`, 
      subphase
    );

    logger.debug(`[Phase${subphase}] Generating Cursor IDE prompt for page: ${pageName}`);

    // Build the page-specific prompt (no pre-written copy; Cursor will write copy using the strategy/SEO/CRO context)
    const userPrompt = `# Your Task
Create a comprehensive Cursor IDE prompt for building the "${pageName}" page.

# Page to Build
${pageName}

# Business Context
- Name: ${session.business_name}
- Industry: ${session.industry}
- Location: ${session.location}
- Phone: ${session.phone_number || 'Not specified'}
- Address: ${session.street_address || 'Not specified'}, ${session.city || 'Not specified'}, ${session.state || 'Not specified'} ${session.zip_code || 'Not specified'}
- Email: ${session.contact_email || 'Not specified'}

# Instructions
Using the cached context above (Competitive Intelligence, SEO Guide, CRO Guide, Page List, UI Design System), create a detailed Cursor IDE prompt for building this page.

The prompt should include:

1. **UI Design & Color Palette Theme & Rules**
   - Include the full UI design system from the cached context
   - Specify colors, typography, spacing, component styles

2. **SEO Requirements**
   - Page Title (50-60 chars, keyword-rich per SEO guide)
   - Meta Description (150-160 chars)
   - H1 and section headings
   - Structured Data (schema markup)

3. **CRO Elements**
   - Primary CTA (text and placement)
   - Secondary CTAs (if any)
   - Trust signals (testimonials, badges, etc.)

4. **Contact Information** (where appropriate)
   - Phone: ${session.phone_number || 'Not specified'}
   - Address: ${session.street_address || 'Not specified'}, ${session.city || 'Not specified'}, ${session.state || 'Not specified'} ${session.zip_code || 'Not specified'}
   - Email: ${session.contact_email || 'Not specified'}

5. **Technical Requirements**
   - Responsive design
   - Accessibility (WCAG 2.1 AA)
   - Fast loading
   - SEO optimized

Do not include pre-written page copy. The prompt should reference the SEO Guide, CRO Guide, and Competitive Intelligence from the cached context so the builder can write copy using that data. Format the output as a complete, ready-to-use Cursor IDE prompt that a developer can paste and immediately start building from.`;

    // Call Claude with caching
    const { thinking, content } = await callClaudeWithCaching(
      claudeApiKey,
      cachedContext,
      userPrompt,
      sessionId,
      subphase,
      session
    );

    pagePrompts[pageName] = {
      thinking,
      prompt: content,
      timestamp: new Date().toISOString(),
    };

    const currentPhase4Data = await getPhase4Synthesis(sessionId);
    await setPhase4Synthesis(sessionId, {
      ...currentPhase4Data,
      page_prompts: {
        ...((currentPhase4Data as any).page_prompts || {}),
        [pageName]: {
          thinking,
          prompt: content,
          timestamp: new Date().toISOString(),
        },
      },
    });

    logger.debug(`[Phase${subphase}] ✅ Cursor prompt for "${pageName}" saved to database`);

    // CHECKPOINT: Save progress after each page prompt
    const latestCheckpoint = await loadCheckpoint(sessionId);
    await saveCheckpoint(sessionId, {
      phase4: {
        ...(latestCheckpoint.phase4 || {}),
        completed_pages_prompts: [...(latestCheckpoint.phase4?.completed_pages_prompts || []), pageName],
        last_page_prompt_index: i
      } as Phase4Checkpoint
    });
    logger.debug(`[Phase${subphase}] ✅ Checkpoint saved (${i + 1}/${pages.length} prompts)`);
  }

  return pagePrompts;
}

/** Returns true if the error is a stream/connection or API overload we should retry. */
function isRetryableStreamError(err: any): boolean {
  const msg = (err?.message || '') + (err?.cause?.message || '') + (err?.cause?.code || '') + JSON.stringify(err?.error || '');
  return (
    /premature close/i.test(msg) ||
    msg.includes('ERR_STREAM_PREMATURE_CLOSE') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('socket hang up') ||
    msg.includes('overloaded_error') ||
    /"Overloaded"/i.test(msg) ||
    /overloaded/i.test(msg) ||
    msg.includes('rate_limit') ||
    msg.includes('capacity')
  );
}

const STREAM_MAX_RETRIES = 5;
/** Exponential backoff (ms): 3s, 10s, 30s, 90s for attempts 2–5 so Anthropic can recover from overload. */
function getStreamRetryDelayMs(attempt: number): number {
  if (attempt <= 1) return 0;
  const delays = [3000, 10000, 30000, 90000];
  return delays[Math.min(attempt - 2, delays.length - 1)] ?? 90000;
}

// Shared helper: Call Claude with streaming & thinking updates (with retry on Premature close / connection drops)
async function callClaudeWithStreaming(
  sessionId: string,
  apiKey: string,
  prompt: string,
  subphase: string,
  phaseName: string,
  session: any
): Promise<{ thinking: string; content: string }> {
  const anthropic = new Anthropic({ apiKey, timeout: 600000, maxRetries: 0 }); // We handle retries ourselves for streaming

  logServiceUsage(session.user_id, 'claude', 4, sessionId);

  let lastError: any;
  for (let attempt = 1; attempt <= STREAM_MAX_RETRIES; attempt++) {
    let thinkingContent = '';
    let outputContent = '';
    let lastThinkingUpdate = 0;

    try {
      if (attempt > 1) {
        const delayMs = getStreamRetryDelayMs(attempt);
        logger.debug(`[Phase${subphase}] Retry attempt ${attempt}/${STREAM_MAX_RETRIES} after ${delayMs / 1000}s backoff...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }

      // @ts-ignore - Extended thinking streaming
      const stream = await anthropic.messages.stream({
        model: process.env.CLAUDE_MODEL || 'claude-opus-4-6',
        max_tokens: 32000,
        // @ts-ignore - thinking parameter not in types yet
        thinking: {
          type: 'enabled',
          budget_tokens: 25000
        },
        messages: [{
          role: 'user',
          content: prompt
        }]
      } as any);

      logger.debug(`[Phase${subphase}] Streaming started, processing thinking and text blocks...`);

      for await (const event of stream) {
        if (event.type === 'message_delta') {
          const delta = event.delta as { stop_reason?: string };
          if (delta?.stop_reason === 'refusal') {
            throw new Error('Response blocked by content policy (refusal)');
          }
        }
        if (event.type === 'content_block_delta') {
          // @ts-ignore - Handle thinking deltas
          if (event.delta.type === 'thinking_delta') {
            // @ts-ignore
            const slice = event.delta.thinking as string;
            thinkingContent += slice;

            const now = Date.now();
            if (now - lastThinkingUpdate > 500) {
              await updateThinkingProgress(sessionId, subphase, thinkingContent, session);
              lastThinkingUpdate = now;
            }
          }
          // @ts-ignore - Text deltas
          else if (event.delta.type === 'text_delta') {
            // @ts-ignore
            const slice = event.delta.text as string;
            outputContent += slice;
          }
        }
      }

      logger.debug(`[Phase${subphase}] Claude finished. Thinking: ${thinkingContent.length} chars, Output: ${outputContent.length} chars`);
      return { thinking: thinkingContent, content: outputContent };
    } catch (err: any) {
      lastError = err;
      const retryable = isRetryableStreamError(err);
      logger.error(`[Phase${subphase}] Stream error (attempt ${attempt}/${STREAM_MAX_RETRIES}):`, err?.message || err);
      if (!retryable || attempt >= STREAM_MAX_RETRIES) {
        throw err;
      }
      const nextDelay = getStreamRetryDelayMs(attempt + 1);
      logger.warn(`[Phase${subphase}] Retryable error (e.g. overloaded/connection), will retry after ${nextDelay / 1000}s`);
    }
  }

  throw lastError;
}


/** Helper: Save synthesis result to phase4_synthesis (writes to research_session_phase4 table). */
async function saveSynthesisResult(
  sessionId: string,
  key: string,
  value: any
): Promise<void> {
  const currentPhase4Data = await getPhase4Synthesis(sessionId);
  await setPhase4Synthesis(sessionId, {
    ...currentPhase4Data,
    [key]: {
      ...value,
      timestamp: new Date().toISOString(),
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// EXISTING BASIC TIER HELPERS (unchanged)
// ═══════════════════════════════════════════════════════════════════

// Default prompts (fallback if database is empty)
const DEFAULT_4_1_PROMPT = `You are a competitive intelligence analyst. Synthesize the Phase 1 research below into a comprehensive Competitive Intelligence Report.

# Phase 1 Research Data (Tavily Web Research)
{{PHASE1_SOURCES}}

# Business Context
- Industry: {{INDUSTRY}}
- Location: {{LOCATION}}
- Business: {{BUSINESS_NAME}}

# Your Task
Create a detailed report covering:
1. Top competitors and market positioning
2. Competitive advantages and gaps
3. Local pack presence and ranking analysis
4. Market trends and opportunities
5. Key differentiators for {{BUSINESS_NAME}}

Format as a structured report with clear sections and bullet points.`;

const DEFAULT_4_2_PROMPT = `You are an SEO strategist. Create a comprehensive SEO & Content Strategy Guide using two clearly separated data sources below. DataForSEO is real live SEO data; Tavily is scraped/web research for strategy and competitor layout only.

# SOURCE 1: Tavily Web Research (scraped / qualitative)
Use for: content structure, what competitors are doing layout-wise, schema and technical patterns, paid/organic strategy, and qualitative context. Do NOT use Tavily for specific keyword volumes, CPC, difficulty, or ranking numbers—Tavily does not provide real keyword metrics.
{{PHASE2_SOURCES}}

{{#if HAS_DATAFORSEO}}
# SOURCE 2: DataForSEO Live Data (real keywords, volumes, CPC, opportunities, local)
Use for: ALL real numbers—search volume, cost-per-click, difficulty, achievability, long-tail keywords, content ideas, ranking opportunities, and local SEO targets. This data is from live SEO tools and must be the PRIMARY basis for keyword recommendations and content priorities.
{{DATAFORSEO_KEYWORD_DATA}}

CRITICAL: Any specific keyword suggestions, volumes, CPC, difficulty scores, or opportunity metrics MUST come from the DataForSEO section above. Never cite or invent numbers from Tavily. Prioritize DataForSEO for real local data and keyword targets; use Tavily only for strategy, structure, and competitor content approach.
{{/if}}

# SEO Context Document
{{SEO_CONTEXT}}

# Business Context
- Industry: {{INDUSTRY}}
- Location: {{LOCATION}}
- Business: {{BUSINESS_NAME}}

# Your Task
Create a detailed guide with clearly separated grounding where helpful:
1. Primary and secondary keywords — use DataForSEO for volumes, CPC, difficulty; cite it explicitly (e.g. "per DataForSEO").
2. Low-hanging fruit and opportunities — from DataForSEO achievability/opportunity data.
3. Content ideas and long-tail targets — from DataForSEO; supplement with Tavily for content structure.
4. Local SEO targets — real local data from DataForSEO; strategy from Tavily.
5. Technical SEO and schema — use Tavily + SEO Context; do not use Tavily for keyword numbers.
6. Content strategy roadmap — keyword targets and metrics from DataForSEO; page structure and competitor layout from Tavily.

Format as a structured guide. Clearly distinguish recommendations based on live data (DataForSEO) vs strategy/web research (Tavily) where it helps the reader.`;

const DEFAULT_4_3_PROMPT = `You are a conversion optimization expert. Synthesize the Phase 3 research below into a comprehensive Conversion Optimization Guide.

# Phase 3 Research Data (Tavily Web Research)
{{PHASE3_SOURCES}}

{{#if HAS_DATAFORSEO}}
# Phase 3 DataForSEO Data (Technical On-Page Benchmarks)
{{DATAFORSEO_ONPAGE_DATA}}

IMPORTANT: The DataForSEO data above contains REAL technical on-page metrics from the top-ranking competitor pages, including word counts, page speeds, link counts, and on-page scores. Use these as concrete benchmarks for your CRO and content recommendations. Specify exact targets (e.g., "aim for X words per page" based on competitor averages).
{{/if}}

# CRO Context Document
{{CRO_CONTEXT}}

# Business Context
- Industry: {{INDUSTRY}}
- Location: {{LOCATION}}
- Business: {{BUSINESS_NAME}}

# Your Task
Create a detailed guide covering:
1. Trust signals and social proof
2. Key conversion elements
3. Call-to-action optimization
4. Content benchmarks (word count, heading structure, link counts from competitor analysis)
5. Page speed and technical performance targets
6. Industry-specific CRO tactics

Format as a structured guide with prioritized, data-backed recommendations. When DataForSEO benchmark data is available, include specific numerical targets.`;

const DEFAULT_4_4_WIREFRAME_PROMPT = `You are an expert website developer and information architect. Using the three comprehensive reports below, create a detailed website wireframe and outline.

# Competitive Intelligence Report
{{COMPETITIVE_INTELLIGENCE_REPORT}}

# SEO & Content Strategy Guide
{{SEO_STRATEGY_GUIDE}}

# Conversion Optimization Guide
{{CRO_OPTIMIZATION_GUIDE}}

# Business Context
- Name: {{BUSINESS_NAME}}
- Industry: {{INDUSTRY}}
- Location: {{LOCATION}}
- Services: {{SERVICES}}
- Target Audience: {{TARGET_AUDIENCE}}
- Phone: {{PHONE_NUMBER}}
- Address: {{STREET_ADDRESS}}, {{CITY}}, {{STATE}} {{ZIP_CODE}}

# Your Task
Create a comprehensive website wireframe/outline that includes:
1. Site Structure - List every page needed
2. Page Hierarchy - Navigation structure
3. Content Sections - For each page, list main sections
4. SEO Considerations - Which pages target which keywords
5. CRO Elements - Conversion elements needed on each page

Format as a structured outline with clear page names and sections.`;

const DEFAULT_4_5_UI_PROMPT = `You are an expert UI/UX designer. Create a design philosophy and visual direction document for the website builder. The goal is to guide an AI (or developer) with principles and intent—NOT with exact pixel values, spacing numbers, or rigid specs. Spacing and layout should adapt to each page's content.

# Wireframe/Outline
{{WIREFRAME_OUTLINE}}

# Business Context
- Name: {{BUSINESS_NAME}}
- Industry: {{INDUSTRY}}
- Brand Colors: {{BRAND_COLORS_LIST}}
- Brand Fonts (if provided): {{BRAND_FONTS_LIST}}

# Your Task
Create a design philosophy and visual system document. Do NOT specify exact spacing (padding/margin values), base units, spacing scales, or fixed font sizes. Do specify:

1. **Color Palette** – If brand colors are provided, use them as the foundation with hex codes. Include primary, secondary, accent, background, text. No spacing.

2. **Typography Philosophy** – Describe roles (heading vs body) and intent (hierarchy, readability). If brand fonts are provided, use them. Do NOT give exact sizes.

3. **Design Principles** – Visual hierarchy, consistency, breathing room (adapt spacing to content), accessibility, responsive/mobile-first.

4. **Component Intent** – Buttons: primary CTA stands out; forms: clear and accessible; cards: consistent feel. Describe feel, not dimensions.

5. **Rules for the Builder** – Use this as philosophy; adapt spacing and layout per page. Do not copy exact spacing values—use judgment.

Format: COLOR PALETTE (hex only), TYPOGRAPHY PHILOSOPHY (roles only), DESIGN PRINCIPLES, COMPONENT INTENT, RULES FOR BUILDER.`;

const DEFAULT_4_6_OVERVIEW_PROMPT = `You are an expert technical writer. Create a short Project Overview document for an AI (Cursor) that will build this website.

# Competitive Intelligence Report
{{COMPETITIVE_REPORT}}

# SEO & Content Strategy Guide
{{SEO_GUIDE}}

# Conversion Optimization Guide
{{CRO_GUIDE}}

# Website Wireframe / Page List
{{WIREFRAME}}

# UI & Design Philosophy
{{UI_DESIGN}}

# Business
- Name: {{BUSINESS_NAME}}
- Industry: {{INDUSTRY}}
- Location: {{LOCATION}}

# Your Task
Write a concise **Project Overview** (under 800 words) that:
1. Summarizes what this site is for and who it serves.
2. Lists the pages to build (from the wireframe).
3. Explains how to use each attached document: Competitive Intelligence (positioning), SEO Guide (keywords, metadata), CRO Guide (conversion elements), UI & Design (philosophy—adapt spacing per page, no rigid specs).
4. States that the builder should follow principles and strategy, not rigid step-by-step specs; adapt layout and spacing to each page.

Format as clear sections. This will be attached in Cursor alongside the report files so the AI has full context.`;

const DEFAULT_4_6_COPY_PROMPT = `You are an expert copywriter specializing in SEO-optimized, conversion-focused web copy.

# Wireframe/Outline
{{WIREFRAME_OUTLINE}}

# UI Design System
{{UI_DESIGN_SYSTEM}}

# Business Context
- Name: {{BUSINESS_NAME}}
- Industry: {{INDUSTRY}}
- Location: {{LOCATION}}
- Services: {{SERVICES}}
- Target Audience: {{TARGET_AUDIENCE}}
- Phone: {{PHONE_NUMBER}}
- Address: {{STREET_ADDRESS}}, {{CITY}}, {{STATE}} {{ZIP_CODE}}
- Email: {{CONTACT_EMAIL}}

# CRITICAL: NAP Consistency
Use EXACT contact information across all pages:
- Name: {{BUSINESS_NAME}}
- Address: {{STREET_ADDRESS}}, {{CITY}}, {{STATE}} {{ZIP_CODE}}
- Phone: {{PHONE_NUMBER}}

# Your Task
Write complete copy for EVERY page in the wireframe. For each page include:
1. Page Title (SEO-optimized)
2. Meta Description
3. H1 Heading
4. All Section Headings
5. Body Copy for each section
6. Call-to-Action Text
7. Contact Information (using exact NAP)

Format with clear page sections and complete copy.`;
