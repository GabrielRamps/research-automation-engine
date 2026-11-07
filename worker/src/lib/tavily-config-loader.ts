/**
 * Tavily Configuration Loader (Worker)
 * Loads Tavily search parameters from admin_config database with fallback to defaults
 */

import { supabase } from './supabase';

// Cache for configurations to avoid repeated database calls
const configCache = new Map<string, any>();
const cacheExpiry = 5 * 60 * 1000; // 5 minutes
const cacheTimestamps = new Map<string, number>();

/**
 * Default Tavily configurations for each phase
 */
const DEFAULT_CONFIGS: Record<string, any> = {
  phase1: {
    search_depth: 'advanced',
    topic: 'general',
    time_range: '',
    max_results: 10,
    include_raw_content: false,
    include_images: false,
    include_answer: true,
    include_domains: [],
    exclude_domains: [],
    model: 'auto' // Let Tavily decide based on query complexity
  },
  phase2: {
    search_depth: 'advanced',
    topic: 'general',
    time_range: '',
    max_results: 10,
    include_raw_content: false,
    include_images: false,
    include_answer: true,
    include_domains: [],
    exclude_domains: [],
    model: 'auto' // Let Tavily decide based on query complexity
  },
  phase3: {
    search_depth: 'advanced',
    topic: 'general',
    time_range: '',
    max_results: 10,
    include_raw_content: false,
    include_images: false,
    include_answer: true,
    include_domains: [],
    exclude_domains: [],
    model: 'auto' // Let Tavily decide based on query complexity
  }
};

/**
 * Load Tavily configuration for a phase from the database, with fallback to defaults
 * @param phase - The phase number (1, 2, or 3)
 * @returns The Tavily configuration object
 */
export async function loadTavilyConfig(phase: number): Promise<any> {
  const configKey = `phase${phase}_tavily_params`;
  
  // Check cache first
  const cached = configCache.get(configKey);
  const cacheTime = cacheTimestamps.get(configKey);
  
  if (cached && cacheTime && (Date.now() - cacheTime < cacheExpiry)) {
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
      let config: any;
      
      if (typeof data.config_value === 'object') {
        config = data.config_value;
      } else if (typeof data.config_value === 'string') {
        config = JSON.parse(data.config_value);
      } else {
        throw new Error('Invalid config format');
      }

      // Validate and enforce Tavily API limits
      config = validateTavilyConfig(config);

      // Cache the result
      configCache.set(configKey, config);
      cacheTimestamps.set(configKey, Date.now());
      
      console.log(`[Tavily Config] Loaded config for phase ${phase} from database:`, {
        max_results: config.max_results,
        search_depth: config.search_depth
      });
      
      return config;
    }
  } catch (error) {
    console.warn(`[Tavily Config] Failed to load config from database for phase ${phase}:`, error);
    // Fall through to fallback
  }

  // Use fallback config
  const fallbackConfig = DEFAULT_CONFIGS[`phase${phase}`] || DEFAULT_CONFIGS.phase1;
  configCache.set(configKey, fallbackConfig);
  cacheTimestamps.set(configKey, Date.now());
  
  console.log(`[Tavily Config] Using default config for phase ${phase}`);
  
  return fallbackConfig;
}

/**
 * Validate and enforce Tavily API limits
 * Tavily max_results is limited to 20 sources max per API documentation
 */
function validateTavilyConfig(config: any): any {
  const validated = { ...config };
  
  // Enforce Tavily's max_results limit (20 sources max)
  if (validated.max_results > 20) {
    console.warn(`[Tavily Config] max_results ${validated.max_results} exceeds Tavily limit, capping at 20`);
    validated.max_results = 20;
  }
  
  // Ensure minimum of 1
  if (validated.max_results < 1) {
    validated.max_results = 1;
  }
  
  // Ensure valid search_depth
  if (!['basic', 'advanced'].includes(validated.search_depth)) {
    validated.search_depth = 'advanced';
  }
  
  // Ensure valid model
  if (!['auto', 'pro', 'mini'].includes(validated.model)) {
    validated.model = 'auto';
  }
  
  // Ensure arrays for domains
  if (!Array.isArray(validated.include_domains)) {
    validated.include_domains = [];
  }
  if (!Array.isArray(validated.exclude_domains)) {
    validated.exclude_domains = [];
  }
  
  return validated;
}

/**
 * Clear the config cache (useful for testing or forcing reload)
 */
export function clearConfigCache(): void {
  configCache.clear();
  cacheTimestamps.clear();
}

/**
 * Clear cache for a specific phase
 */
export function clearConfigCacheKey(phase: number): void {
  const configKey = `phase${phase}_tavily_params`;
  configCache.delete(configKey);
  cacheTimestamps.delete(configKey);
}
