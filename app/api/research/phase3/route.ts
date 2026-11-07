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
      phase: 3,
      sessionId,
      request,
      logUsage: true
    });

    logServiceUsage(session.user_id, 'tavily', 3, sessionId, request);
    
    logger.info(`[Phase 3] Starting deep industry intelligence research with extraction & summarization...`);

    // Load Tavily configuration and research prompts from admin settings
    const supabase = await createClient();
    
    // Load active research prompts for Phase 3 from research_prompts table
    const { data: prompts, error: promptError } = await supabase
      .from('research_prompts')
      .select('*')
      .eq('phase', 3)
      .eq('status', 'active')
      .order('order_index', { ascending: true });

    if (promptError) {
      logger.error(`[Phase 3] Error loading prompts:`, promptError);
      throw new Error(`Failed to load Phase 3 prompts: ${promptError.message}`);
    }

    if (!prompts || prompts.length === 0) {
      logger.error(`[Phase 3] No active prompts configured for Phase 3`);
      throw new Error('No active prompts configured for Phase 3. Please configure prompts at /admin/research-prompts');
    }

    // Use first active prompt
    const promptTemplate = prompts[0].prompt_template;
    logger.info(`[Phase 3] Using prompt: "${prompts[0].name}" (${prompts.length} total active prompts)`);

    // Inject session data into prompt
    const researchQuery = injectSessionData(promptTemplate, session);
    const { data: tavilyConfigData } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'phase3_tavily_params')
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

    logger.info(`[Phase 3] Industry research complete - ${researchResults.results.length} sources extracted, AI summary: ${researchResults.answer?.length || 0} chars`);

    // Prepare citations with relevance scores
    const citations = researchResults.results.map(r => ({
      url: r.url,
      title: r.title,
      snippet: r.content.substring(0, 300), // Longer snippets
      published_date: r.published_date,
      score: r.score // Relevance score
    }));

    // Store results with AI summary AND raw sources
    await SessionManager.updatePhase(sessionId, 3, {
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
      nextPhase: 4,
      apiCost: 0.02 // Research API costs more but delivers WAY more value
    });

    const phaseTime = Date.now() - startTime;

    // Phase 4 is always handled by the Railway worker (queue system)
    // No need to trigger any API endpoint - worker handles phase progression automatically
    logger.info(`[Phase 3] Complete - worker will handle Phase 4 for session ${sessionId}`);

    return NextResponse.json({
      success: true,
      phase: 3,
      timeMs: phaseTime,
      nextPhase: 4,
      sourceCount: researchResults.results.length,
      hasAISummary: !!researchResults.answer,
      summaryLength: researchResults.answer?.length || 0
    });

  } catch (error: any) {
    logger.error('Phase 3 error:', error);
    
    const balanceError = detectBalanceError(error);
    
    if (balanceError && sessionId) {
      await SessionManager.logBalanceError(sessionId, 3, {
        ...balanceError,
        phase: 3,
        timestamp: new Date().toISOString()
      });

      return NextResponse.json(
        { 
          error: 'Insufficient API balance',
          balanceError: balanceError,
          phase: 3
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
      await SessionManager.logError(sessionId, 3, JSON.stringify(errorDetails));
    }

    return NextResponse.json(
      { 
        error: 'Phase 3 failed', 
        details: error.message,
        errorName: error.name,
        fullError: errorDetails
      },
      { status: 500 }
    );
  }
}
