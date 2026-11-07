/**
 * Prompt Loader Utility
 * Loads prompts from admin_config database with fallback to hardcoded prompts
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from './secure-logger';

// Cache for prompts to avoid repeated database calls
const promptCache = new Map<string, string>();
const cacheExpiry = 5 * 60 * 1000; // 5 minutes
const cacheTimestamps = new Map<string, number>();

// Create Supabase client with service role for server-side access
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

/**
 * Load a prompt from the database, with fallback to hardcoded prompt
 * @param configKey - The config_key in admin_config table
 * @param fallbackPrompt - The hardcoded prompt to use if database prompt not found
 * @returns The prompt string
 */
export async function loadPrompt(
  configKey: string,
  fallbackPrompt: string
): Promise<string> {
  // Check cache first
  const cached = promptCache.get(configKey);
  const cacheTime = cacheTimestamps.get(configKey);
  
  if (cached && cacheTime && Date.now() - cacheTime < cacheExpiry) {
    return cached;
  }

  try {
    // Try to load from database
    const { data, error } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', configKey)
      .single();

    if (!error && data && data.config_value) {
      // Handle both string and JSONB formats
      let promptText: string;
      
      if (typeof data.config_value === 'string') {
        promptText = data.config_value;
      } else if (typeof data.config_value === 'object' && 'template' in data.config_value) {
        // If stored as JSONB with template property
        promptText = (data.config_value as any).template;
      } else if (typeof data.config_value === 'object') {
        // If stored as plain JSONB string
        promptText = JSON.stringify(data.config_value);
      } else {
        promptText = String(data.config_value);
      }

      // Cache the result
      promptCache.set(configKey, promptText);
      cacheTimestamps.set(configKey, Date.now());
      
      return promptText;
    }
  } catch (error) {
    logger.warn(`Failed to load prompt from database for ${configKey}:`, error);
    // Fall through to fallback
  }

  // Use fallback prompt
  promptCache.set(configKey, fallbackPrompt);
  cacheTimestamps.set(configKey, Date.now());
  
  return fallbackPrompt;
}

/**
 * Clear the prompt cache (useful for testing or forcing reload)
 */
export function clearPromptCache(): void {
  promptCache.clear();
  cacheTimestamps.clear();
}

/**
 * Clear cache for a specific prompt key
 */
export function clearPromptCacheKey(configKey: string): void {
  promptCache.delete(configKey);
  cacheTimestamps.delete(configKey);
}

