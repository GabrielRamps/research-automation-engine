/**
 * Tavily Prompt Validator
 * Calculates maximum allowed field lengths based on Tavily prompt templates
 * Ensures queries stay under Tavily's 400-character limit
 */

import { createClient } from '@supabase/supabase-js';

// Supabase client with service role for server-side access
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

export interface FieldLimits {
  services: number;
  targetAudience: number;
  industry: number;
  location: number;
}

/**
 * Calculate maximum allowed length for form fields based on Tavily prompt templates
 * Only checks research_prompts table (phases 1-3) since those go to Tavily
 * Claude prompts (phases 4-5) don't have the 400-character limit
 */
export async function calculateTavilyFieldLimits(): Promise<FieldLimits> {
  // Fallback defaults if database query fails
  const fallbackLimits: FieldLimits = {
    services: 150,
    targetAudience: 100,
    industry: 50,
    location: 50
  };

  try {
    // Fetch all active Tavily prompts (phases 1, 2, 3)
    const { data: prompts, error } = await supabase
      .from('research_prompts')
      .select('phase, prompt_template')
      .in('phase', [1, 2, 3])
      .eq('status', 'active');

    if (error) {
      console.error('[Field Limits] Database error:', error);
      return fallbackLimits;
    }

    if (!prompts || prompts.length === 0) {
      console.warn('[Field Limits] No active prompts found, using fallback defaults');
      return fallbackLimits;
    }

    // Track the most restrictive limit for each field
    const limits: FieldLimits = {
      services: 400,
      targetAudience: 400,
      industry: 400,
      location: 400
    };

    // Estimate typical replacement lengths for other variables
    const typicalLengths = {
      industry: 50,
      location: 50,
      targetAudience: 50,
      services: 150,
      searchRadius: 5 // Just a number like "25"
    };

    console.log(`[Field Limits] Analyzing ${prompts.length} active Tavily prompts`);

    // Check each prompt
    for (const prompt of prompts) {
      const template = prompt.prompt_template;
      
      // Calculate base template length (without variable placeholders)
      // Remove all variable placeholders to get the actual text length
      const baseTemplate = template
        .replace(/\{\{SERVICES\}\}/g, '')
        .replace(/\{\{INDUSTRY\}\}/g, '')
        .replace(/\{\{LOCATION\}\}/g, '')
        .replace(/\{\{TARGET_AUDIENCE\}\}/g, '')
        .replace(/\{\{SEARCH_RADIUS\}\}/g, '');
      
      const baseLength = baseTemplate.length;

      // Count which variables are used in this template
      const usesServices = template.includes('{{SERVICES}}');
      const usesIndustry = template.includes('{{INDUSTRY}}');
      const usesLocation = template.includes('{{LOCATION}}');
      const usesTargetAudience = template.includes('{{TARGET_AUDIENCE}}');
      const usesSearchRadius = template.includes('{{SEARCH_RADIUS}}');

      // For each variable used, calculate how much space is available
      if (usesServices) {
        // Calculate space used by other variables
        let otherVarsLength = 0;
        if (usesIndustry) otherVarsLength += typicalLengths.industry;
        if (usesLocation) otherVarsLength += typicalLengths.location;
        if (usesTargetAudience) otherVarsLength += typicalLengths.targetAudience;
        if (usesSearchRadius) otherVarsLength += typicalLengths.searchRadius;

        const remainingSpace = 400 - baseLength - otherVarsLength;
        limits.services = Math.min(limits.services, remainingSpace);
      }

      if (usesIndustry) {
        let otherVarsLength = 0;
        if (usesServices) otherVarsLength += typicalLengths.services;
        if (usesLocation) otherVarsLength += typicalLengths.location;
        if (usesTargetAudience) otherVarsLength += typicalLengths.targetAudience;
        if (usesSearchRadius) otherVarsLength += typicalLengths.searchRadius;

        const remainingSpace = 400 - baseLength - otherVarsLength;
        limits.industry = Math.min(limits.industry, remainingSpace);
      }

      if (usesLocation) {
        let otherVarsLength = 0;
        if (usesServices) otherVarsLength += typicalLengths.services;
        if (usesIndustry) otherVarsLength += typicalLengths.industry;
        if (usesTargetAudience) otherVarsLength += typicalLengths.targetAudience;
        if (usesSearchRadius) otherVarsLength += typicalLengths.searchRadius;

        const remainingSpace = 400 - baseLength - otherVarsLength;
        limits.location = Math.min(limits.location, remainingSpace);
      }

      if (usesTargetAudience) {
        let otherVarsLength = 0;
        if (usesServices) otherVarsLength += typicalLengths.services;
        if (usesIndustry) otherVarsLength += typicalLengths.industry;
        if (usesLocation) otherVarsLength += typicalLengths.location;
        if (usesSearchRadius) otherVarsLength += typicalLengths.searchRadius;

        const remainingSpace = 400 - baseLength - otherVarsLength;
        limits.targetAudience = Math.min(limits.targetAudience, remainingSpace);
      }
    }

    // Add safety buffer (10 chars) and ensure minimums
    const finalLimits: FieldLimits = {
      services: Math.max(50, limits.services - 10),
      targetAudience: Math.max(50, limits.targetAudience - 10),
      industry: Math.max(30, limits.industry - 10),
      location: Math.max(30, limits.location - 10)
    };

    console.log('[Field Limits] Calculated limits:', finalLimits);

    return finalLimits;
  } catch (error: any) {
    console.error('[Field Limits] Error calculating field limits:', error);
    return fallbackLimits;
  }
}
