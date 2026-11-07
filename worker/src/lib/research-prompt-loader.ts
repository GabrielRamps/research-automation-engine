/**
 * Research Prompt Loader (Worker)
 * Loads research prompts from admin_config database with fallback to hardcoded defaults
 * Supports dynamic prompt management via admin UI
 */

import { supabase } from './supabase';

// Cache for prompts (5 min expiry)
const promptCache = new Map<number, any[]>();
const cacheTimestamps = new Map<number, number>();
const cacheExpiry = 5 * 60 * 1000; // 5 minutes


/**
 * Load active research prompts for a phase from database
 * Falls back to hardcoded defaults if database fails
 * @param phase - The phase number (1, 2, or 3)
 * @returns Array of prompt objects
 * @remarks Phase 2 prompts must NOT ask Tavily for keyword volume or cost-per-click so the SEO report can use DataForSEO as the single source of truth for metrics.
 */
export async function loadResearchPrompts(phase: number): Promise<any[]> {
  // Check cache first
  const cached = promptCache.get(phase);
  const cacheTime = cacheTimestamps.get(phase);
  
  if (cached && cacheTime && (Date.now() - cacheTime < cacheExpiry)) {
    console.log(`[Prompt Loader] Using cached prompts for phase ${phase}`);
    return cached;
  }

  try {
    // Load from database
    const { data: prompts, error } = await supabase
      .from('research_prompts')
      .select('*')
      .eq('phase', phase)
      .eq('status', 'active')
      .order('order_index', { ascending: true });

    if (error) {
      console.error(`[Prompt Loader] Database error loading prompts for phase ${phase}:`, error);
      throw new Error(`Failed to load prompts from database: ${error.message}`);
    }
    
    if (!prompts || prompts.length === 0) {
      console.error(`[Prompt Loader] No active prompts found for phase ${phase}`);
      throw new Error(`No active prompts configured for phase ${phase}. Please configure prompts at /admin/research-prompts`);
    }

    // Cache and return
    promptCache.set(phase, prompts);
    cacheTimestamps.set(phase, Date.now());
    console.log(`[Prompt Loader] Loaded ${prompts.length} prompts for phase ${phase} from database`);
    return prompts;
  } catch (error: any) {
    console.error(`[Prompt Loader] Failed to load prompts for phase ${phase}:`, error);
    throw error; // Re-throw to fail the phase execution
  }
}

/**
 * Replace template variables in prompt
 * @param template - Prompt template with {{VARIABLE}} placeholders
 * @param session - Research session data
 * @returns Prompt with variables replaced
 */
export function replaceTemplateVariables(template: string, session: any): string {
  return template
    .replace(/\{\{INDUSTRY\}\}/g, session.industry || '')
    .replace(/\{\{LOCATION\}\}/g, session.location || '')
    .replace(/\{\{SERVICES\}\}/g, session.services || '')
    .replace(/\{\{ADDITIONAL_SERVICES\}\}/g, session.additional_services || '')
    .replace(/\{\{ALL_SERVICES\}\}/g, [session.services, session.additional_services].filter(Boolean).join(', ') || '')
    .replace(/\{\{TARGET_AUDIENCE\}\}/g, session.target_audience || '')
    .replace(/\{\{SEARCH_RADIUS\}\}/g, session.search_radius?.toString() || '25');
}

// Hardcoded fallback prompts removed - system now requires prompts to be configured
// in the research_prompts table via /admin/research-prompts UI

/**
 * Clear the prompt cache (useful for testing or forcing reload)
 */
export function clearPromptCache(): void {
  promptCache.clear();
  cacheTimestamps.clear();
}

/**
 * Clear cache for a specific phase
 */
export function clearPromptCacheKey(phase: number): void {
  promptCache.delete(phase);
  cacheTimestamps.delete(phase);
}
