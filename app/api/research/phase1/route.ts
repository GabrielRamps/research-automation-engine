import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { SessionManager } from '@/lib/session-manager';
import { loadUserApiKeys, logServiceUsage } from '@/lib/api-keys';
import { researchWithTavily } from '@/lib/tavily-client';
import { detectBalanceError } from '@/lib/balance-error-detector';
import { rateLimitMiddleware } from '@/lib/rate-limit';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase-server';
import { injectSessionData } from '@/lib/prompt-injector';

export async function POST(request: NextRequest) {
  // Research normally runs in the background worker (USE_QUEUE_SYSTEM=true).
  // This direct route is an old fallback, so it is switched off in queue mode
  // and otherwise only runs for the logged-in owner of the session.
  if (process.env.USE_QUEUE_SYSTEM === 'true') {
    return NextResponse.json({ error: 'Research runs in the background worker.' }, { status: 410 });
  }
  const auth = await getAuthenticatedUser(request);
  if (!auth) {
    return unauthorizedResponse();
  }
  const startTime = Date.now();
  let sessionId: string = '';
  
  try {
    const body = (await request.json()) as { sessionId?: string };
    sessionId = body.sessionId ?? '';

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    const session = await SessionManager.getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }
    if (session.user_id !== auth.userId) {
      return forbiddenResponse();
    }

    const rateLimitResponse = await rateLimitMiddleware(request, session.user_id);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const apiKeys = await loadUserApiKeys(session.user_id, {
      phase: 1,
      sessionId,
      request,
      logUsage: true
    });

    logServiceUsage(session.user_id, 'tavily', 1, sessionId, request);
    
    logger.info(`[Phase 1] Starting deep Tavily research with extraction & summarization...`);

    // Load Tavily configuration and research prompts from admin settings
    const supabase = await createClient();
    
    // Load active research prompts for Phase 1 from research_prompts table
    const { data: prompts, error: promptError } = await supabase
      .from('research_prompts')
      .select('*')
      .eq('phase', 1)
      .eq('status', 'active')
      .order('order_index', { ascending: true });

    if (promptError) {
      logger.error(`[Phase 1] Error loading prompts:`, promptError);
      throw new Error(`Failed to load Phase 1 prompts: ${promptError.message}`);
    }

    if (!prompts || prompts.length === 0) {
      logger.error(`[Phase 1] No active prompts configured for Phase 1`);
      throw new Error('No active prompts configured for Phase 1. Please configure prompts at /admin/research-prompts');
    }

    // Use first active prompt
    const promptTemplate = prompts[0].prompt_template;
    logger.info(`[Phase 1] Using prompt: "${prompts[0].name}" (${prompts.length} total active prompts)`);

    // Inject session data into prompt
    const researchQuery = injectSessionData(promptTemplate, session);
    const { data: tavilyConfigData } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'phase1_tavily_params')
      .maybeSingle();

    // Use configured parameters or defaults
    const tavilyConfig = tavilyConfigData?.config_value || {
      search_depth: 'advanced',
      topic: 'general',
      max_results: 50,
      include_raw_content: true,
      include_images: false,
      include_answer: true,
      include_domains: [],
      exclude_domains: []
    };

    const researchResults = await researchWithTavily(apiKeys.tavily, {
      query: researchQuery.trim(),
      searchDepth: tavilyConfig.search_depth || 'advanced',
      maxResults: tavilyConfig.max_results || 50,
      includeAnswer: tavilyConfig.include_answer !== false ? tavilyConfig.include_answer : true,
      topic: tavilyConfig.topic || 'general',
      timeRange: tavilyConfig.time_range,
      includeRawContent: tavilyConfig.include_raw_content !== false ? tavilyConfig.include_raw_content : true,
      includeImages: tavilyConfig.include_images || false,
      includeDomains: tavilyConfig.include_domains || [],
      excludeDomains: tavilyConfig.exclude_domains || [],
      model: tavilyConfig.model || 'auto'
    });

    logger.info(`[Phase 1] Tavily research complete - ${researchResults.results.length} sources extracted, AI summary: ${researchResults.answer?.length || 0} chars`);

    // Prepare citations with relevance scores
    const citations = researchResults.results.map(r => ({
      url: r.url,
      title: r.title,
      snippet: r.content.substring(0, 300), // Longer snippets
      published_date: r.published_date,
      score: r.score // Relevance score
    }));

    // Store results with AI summary AND raw sources
    await SessionManager.updatePhase(sessionId, 1, {
      raw: {
        content: JSON.stringify(researchResults.results), // All extracted sources
        timestamp: new Date().toISOString()
      },
      summary: {
        content: researchResults.answer || JSON.stringify(researchResults.results), // AI-generated summary!
        followUpQuestions: researchResults.follow_up_questions,
        sourceCount: researchResults.results.length,
        timestamp: new Date().toISOString()
      },
      citations,
      nextPhase: 2,
      apiCost: 0.02 // Research API costs more but delivers WAY more value
    });

    const phaseTime = Date.now() - startTime;

    // CRITICAL FIX: Don't trigger Phase 2 when using queue system
    // The worker will handle phase progression automatically
    const USE_QUEUE_SYSTEM = process.env.USE_QUEUE_SYSTEM === 'true';
    
    if (!USE_QUEUE_SYSTEM) {
      const phase2Url = `${process.env.NEXT_PUBLIC_SITE_URL}/api/research/phase2`;
      
      if (!process.env.NEXT_PUBLIC_SITE_URL) {
        logger.error('[Phase 1] CRITICAL: NEXT_PUBLIC_SITE_URL is not set! Phase chaining will fail.');
      }
      
      logger.info(`[Phase 1] Triggering Phase 2 at: ${phase2Url} for session ${sessionId}`);
      
      fetch(phase2Url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      }).then(() => {
        logger.info(`[Phase 1] Successfully triggered Phase 2 for session ${sessionId}`);
      }).catch(err => {
        logger.error(`[Phase 1] Failed to trigger Phase 2 for session ${sessionId}:`, {
          error: err.message,
          url: phase2Url,
          siteUrlSet: !!process.env.NEXT_PUBLIC_SITE_URL
        });
      });
    } else {
      logger.info(`[Phase 1] Queue system enabled - worker will handle Phase 2 progression for session ${sessionId}`);
    }

    return NextResponse.json({
      success: true,
      phase: 1,
      timeMs: phaseTime,
      nextPhase: 2,
      sourceCount: researchResults.results.length,
      hasAISummary: !!researchResults.answer,
      summaryLength: researchResults.answer?.length || 0
    });

  } catch (error: any) {
    logger.error('Phase 1 error:', error);
    
    const balanceError = detectBalanceError(error);
    
    if (balanceError && sessionId) {
      await SessionManager.logBalanceError(sessionId, 1, {
        ...balanceError,
        phase: 1,
        timestamp: new Date().toISOString()
      });

      return NextResponse.json(
        { 
          error: 'Insufficient API balance',
          balanceError: balanceError,
          phase: 1
        },
        { status: 402 }
      );
    }
    
    const errorDetails = {
      message: error.message || 'Unknown error',
      name: error.name || 'Error',
      stack: error.stack?.split('\n').slice(0, 3).join('\n') || 'No stack trace'
    };
    
    if (sessionId) {
      await SessionManager.logError(sessionId, 1, JSON.stringify(errorDetails));
    }

    return NextResponse.json(
      { 
        error: 'Phase 1 failed', 
        details: error.message,
        errorName: error.name,
        fullError: errorDetails
      },
      { status: 500 }
    );
  }
}
