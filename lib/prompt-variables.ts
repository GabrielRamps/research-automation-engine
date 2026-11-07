/**
 * Prompt variable reference for admin UI — required/optional variables per prompt type
 * so editors don't break the system by removing placeholders.
 */

export interface VariableSpec {
  /** e.g. INDUSTRY */
  name: string;
  /** Whether the prompt will break if this is missing */
  required: boolean;
  /** Short description for the UI */
  description?: string;
}

export type PromptKind = 'research_1' | 'research_2' | 'research_3' | 'claude_summary_1' | 'claude_summary_2' | 'claude_summary_3' | 'phase4_4.1' | 'phase4_4.2' | 'phase4_4.3' | 'phase4_4.4' | 'phase4_4.5' | 'phase4_4.6' | 'phase4_10.1' | 'phase4_10.2' | 'phase4_10.3' | 'phase4_10.4' | 'phase4_10.5' | 'phase4_10.6' | 'phase4_10.7';

/** Variables for Phase 1–3 Tavily research prompts */
export const RESEARCH_PROMPT_VARIABLES: VariableSpec[] = [
  { name: 'INDUSTRY', required: true, description: 'Business industry' },
  { name: 'LOCATION', required: true, description: 'City/region' },
  { name: 'SERVICES', required: false, description: 'Services offered' },
  { name: 'TARGET_AUDIENCE', required: false, description: 'Target customer' },
  { name: 'SEARCH_RADIUS', required: false, description: 'Miles radius' },
];

/** Variables for Phase 1–3 Claude summary prompts (single placeholder) */
export const CLAUDE_SUMMARY_VARIABLES: VariableSpec[] = [
  { name: 'RESEARCH_DATA', required: true, description: 'Injected raw research content' },
];

/** Variables per Phase 4 subphase — required for correct substitution */
export const PHASE4_VARIABLES: Record<string, VariableSpec[]> = {
  '4.1': [
    { name: 'PHASE1_SOURCES', required: true, description: 'Tavily Phase 1 results' },
    { name: 'DATAFORSEO_LOCAL_DATA', required: false, description: 'DataForSEO local pack data (inside {{#if HAS_DATAFORSEO}})' },
    { name: 'HAS_DATAFORSEO', required: false, description: 'Conditional: "true" shows DataForSEO block' },
    { name: 'USER_BUSINESS_PROVIDED', required: false, description: 'Conditional: user GBP data present' },
    { name: 'INDUSTRY', required: true },
    { name: 'LOCATION', required: true },
    { name: 'BUSINESS_NAME', required: true },
  ],
  '4.2': [
    { name: 'PHASE2_SOURCES', required: true, description: 'Tavily Phase 2 results' },
    { name: 'DATAFORSEO_KEYWORD_DATA', required: false, description: 'Inside {{#if HAS_DATAFORSEO}}' },
    { name: 'HAS_DATAFORSEO', required: false },
    { name: 'SEO_CONTEXT', required: true, description: 'SEO context document' },
    { name: 'INDUSTRY', required: true },
    { name: 'LOCATION', required: true },
    { name: 'BUSINESS_NAME', required: true },
  ],
  '4.3': [
    { name: 'PHASE3_SOURCES', required: true, description: 'Tavily Phase 3 results' },
    { name: 'DATAFORSEO_ONPAGE_DATA', required: false, description: 'Inside {{#if HAS_DATAFORSEO}}' },
    { name: 'HAS_DATAFORSEO', required: false },
    { name: 'CRO_CONTEXT', required: true, description: 'CRO context document' },
    { name: 'INDUSTRY', required: true },
    { name: 'LOCATION', required: true },
    { name: 'BUSINESS_NAME', required: true },
  ],
  '4.4': [
    { name: 'COMPETITIVE_INTELLIGENCE_REPORT', required: true },
    { name: 'SEO_STRATEGY_GUIDE', required: true },
    { name: 'CRO_OPTIMIZATION_GUIDE', required: true },
    { name: 'BUSINESS_NAME', required: true },
    { name: 'INDUSTRY', required: true },
    { name: 'LOCATION', required: true },
    { name: 'SERVICES', required: false },
    { name: 'TARGET_AUDIENCE', required: false },
    { name: 'PHONE_NUMBER', required: false },
    { name: 'STREET_ADDRESS', required: false },
    { name: 'CITY', required: false },
    { name: 'STATE', required: false },
    { name: 'ZIP_CODE', required: false },
  ],
  '4.5': [
    { name: 'WIREFRAME_OUTLINE', required: true },
    { name: 'BUSINESS_NAME', required: true },
    { name: 'INDUSTRY', required: true },
    { name: 'BRAND_COLORS_LIST', required: false },
    { name: 'BRAND_FONTS_LIST', required: false },
  ],
};

/** Variables per Enhanced Pipeline sub-phase (10.1–10.8) */
export const PHASE10_VARIABLES: Record<string, VariableSpec[]> = {
  '10.1': [
    { name: 'BUSINESS_NAME', required: true, description: 'Business name' },
    { name: 'INDUSTRY', required: true, description: 'Business industry' },
    { name: 'PRIMARY_SERVICE', required: false, description: 'Primary service offering' },
    { name: 'ALL_SERVICES', required: false, description: 'All services (comma-separated)' },
    { name: 'LOCATION', required: true, description: 'Business location' },
    { name: 'SERVICE_AREA', required: false, description: 'Service area radius in miles' },
    { name: 'TARGET_AUDIENCE', required: false, description: 'Target audience' },
    { name: 'YEARS_IN_BUSINESS', required: false, description: 'Years in business' },
    { name: 'WEBSITE_URL', required: false, description: 'Website URL' },
    { name: 'TARGET_CUSTOMER_TYPE', required: false, description: 'B2B, B2C, etc.' },
    { name: 'KEYWORD_UNIVERSE_DATA', required: true, description: 'Full keyword universe from DataForSEO' },
    { name: 'DOMAIN_INTELLIGENCE_DATA', required: true, description: 'Domain authority, backlinks, etc.' },
    { name: 'SEED_KEYWORDS', required: false, description: 'Conditional: seed keyword expansion data' },
  ],
  '10.2': [
    { name: 'BUSINESS_NAME', required: true },
    { name: 'INDUSTRY', required: true },
    { name: 'LOCATION', required: true },
    { name: 'KEYWORD_STRATEGY_OUTPUT', required: true, description: 'Chained from 10.1 output' },
    { name: 'COMPETITOR_DATA', required: true, description: 'Competitor profiles from DataForSEO' },
    { name: 'SERP_DATA', required: true, description: 'SERP analysis data' },
    { name: 'REVIEW_DATA', required: true, description: 'Review analytics' },
    { name: 'GBP_DATA', required: true, description: 'Google Business Profile data' },
    { name: 'DOMAIN_INTELLIGENCE_DATA', required: true, description: 'Domain authority baseline' },
    { name: 'SCORING_DATA', required: true, description: 'SEO readiness scores' },
    { name: 'COMPETITOR_TECH_DATA', required: false, description: 'Conditional: competitor technical audit (domain config, keyword density, content structure, resources, non-indexable, schema)' },
    { name: 'BACKLINK_DATA', required: false, description: 'Conditional: backlink profile (advanced tier)' },
    { name: 'PHASE1_SOURCES', required: false, description: 'Tavily Phase 1 qualitative research' },
  ],
  '10.3': [
    { name: 'BUSINESS_NAME', required: true },
    { name: 'INDUSTRY', required: true },
    { name: 'LOCATION', required: true },
    { name: 'ALL_SERVICES', required: false },
    { name: 'SERVICE_AREA_CITIES', required: false, description: 'Nearby cities in service area' },
    { name: 'TARGET_AUDIENCE', required: false },
    { name: 'KEYWORD_STRATEGY_OUTPUT', required: true, description: 'Chained from 10.1' },
    { name: 'COMPETITIVE_ANALYSIS_OUTPUT', required: true, description: 'Chained from 10.2' },
    { name: 'SERP_DATA', required: true, description: 'PAA, autocomplete, forums, related searches' },
    { name: 'CITY_SERP_DATA', required: false, description: 'Conditional: per-city SERP data' },
    { name: 'PHASE2_SOURCES', required: false, description: 'Tavily Phase 2 SEO/content research' },
    { name: 'SEO_CONTEXT', required: false, description: 'SEO best practices document' },
    { name: 'SEED_KEYWORDS', required: false },
  ],
  '10.4': [
    { name: 'BUSINESS_NAME', required: true },
    { name: 'INDUSTRY', required: true },
    { name: 'LOCATION', required: true },
    { name: 'TARGET_AUDIENCE', required: false },
    { name: 'COMPETITIVE_ANALYSIS_OUTPUT', required: true, description: 'Chained from 10.2' },
    { name: 'PHASE3_SOURCES', required: true, description: 'Tavily Phase 3 CRO research (primary driver)' },
    { name: 'REVIEW_DATA', required: true, description: 'Review analytics for trust signals' },
    { name: 'DOMAIN_INTELLIGENCE_DATA', required: true, description: 'Performance baselines' },
    { name: 'TECHNICAL_DATA', required: false, description: 'Technical audit data (page speed, content structure, resources)' },
    { name: 'CRO_CONTEXT', required: false, description: 'CRO best practices document' },
  ],
  '10.5': [
    { name: 'BUSINESS_NAME', required: true },
    { name: 'INDUSTRY', required: true },
    { name: 'LOCATION', required: true },
    { name: 'PHONE_NUMBER', required: false },
    { name: 'CONTACT_EMAIL', required: false },
    { name: 'NAP_BLOCK', required: false, description: 'Name, Address, Phone block' },
    { name: 'KEYWORD_STRATEGY_OUTPUT', required: true, description: 'Chained from 10.1' },
    { name: 'COMPETITIVE_ANALYSIS_OUTPUT', required: true, description: 'Chained from 10.2' },
    { name: 'CONTENT_STRATEGY_OUTPUT', required: true, description: 'Chained from 10.3' },
    { name: 'CRO_GUIDE_OUTPUT', required: true, description: 'Chained from 10.4' },
    { name: 'GBP_DATA', required: true },
    { name: 'REVIEW_DATA', required: true },
    { name: 'DOMAIN_INTELLIGENCE_DATA', required: true },
    { name: 'SCORING_DATA', required: true },
    { name: 'BACKLINK_DATA', required: false, description: 'Conditional: backlink profile' },
    { name: 'Q_AND_A_BLOCK', required: false, description: 'Conditional: Google Q&A data' },
  ],
  '10.6': [
    { name: 'BUSINESS_NAME', required: true },
    { name: 'INDUSTRY', required: true },
    { name: 'LOCATION', required: true },
    { name: 'PRIMARY_SERVICE', required: false },
    { name: 'ALL_SERVICES', required: false },
    { name: 'SERVICE_AREA_CITIES', required: false },
    { name: 'WEBSITE_URL', required: false },
    { name: 'NAP_BLOCK', required: false },
    { name: 'KEYWORD_STRATEGY_OUTPUT', required: true, description: 'Chained from 10.1' },
    { name: 'COMPETITIVE_ANALYSIS_OUTPUT', required: true, description: 'Chained from 10.2' },
    { name: 'CONTENT_STRATEGY_OUTPUT', required: true, description: 'Chained from 10.3' },
    { name: 'CRO_GUIDE_OUTPUT', required: true, description: 'Chained from 10.4' },
    { name: 'AUDIT_DATA', required: false, description: 'Full SEO audit data (domain info, non-indexable, duplicate content, keyword density, waterfall, content structure, resources)' },
    { name: 'TECHNICAL_DATA', required: false, description: 'Technical SEO audit data (domain config, non-indexable, duplicate content, keyword density, page speed, content structure, full resource breakdown)' },
    { name: 'SCHEMA_TEMPLATES', required: false, description: 'Schema markup templates' },
    { name: 'PHASE2_SOURCES', required: false, description: 'Tavily Phase 2 SEO research' },
    { name: 'SEO_CONTEXT', required: false, description: 'SEO best practices document' },
  ],
  '10.7': [
    { name: 'BUSINESS_NAME', required: true },
    { name: 'INDUSTRY', required: true },
    { name: 'LOCATION', required: true },
    { name: 'TARGET_AUDIENCE', required: false },
    { name: 'TARGET_CUSTOMER_TYPE', required: false },
    { name: 'YEARS_IN_BUSINESS', required: false },
    { name: 'BRAND_COLORS', required: false, description: 'User-provided brand colors' },
    { name: 'BRAND_FONTS', required: false, description: 'User-provided brand fonts' },
    { name: 'INTENT_BREAKDOWN', required: false, description: 'Keyword intent breakdown' },
    { name: 'REVIEW_DATA', required: true },
    { name: 'COMPETITIVE_ANALYSIS_OUTPUT', required: true, description: 'Chained from 10.2' },
    { name: 'CRO_GUIDE_OUTPUT', required: true, description: 'Chained from 10.4' },
    { name: 'SITE_ARCHITECTURE_OUTPUT', required: true, description: 'Chained from 10.6' },
    { name: 'COLOR_PALETTE_INSTRUCTION', required: false, description: 'Auto-generated color instruction' },
    { name: 'TYPOGRAPHY_INSTRUCTION', required: false, description: 'Auto-generated typography instruction' },
  ],
  '10.8': [
    { name: 'BUSINESS_NAME', required: true },
    { name: 'INDUSTRY', required: true },
    { name: 'LOCATION', required: true },
    { name: 'KEYWORD_STRATEGY_OUTPUT', required: true, description: 'Chained from 10.1' },
    { name: 'COMPETITIVE_ANALYSIS_OUTPUT', required: true, description: 'Chained from 10.2' },
    { name: 'CONTENT_STRATEGY_OUTPUT', required: true, description: 'Chained from 10.3' },
    { name: 'CRO_GUIDE_OUTPUT', required: true, description: 'Chained from 10.4' },
    { name: 'SITE_ARCHITECTURE_OUTPUT', required: true, description: 'Chained from 10.6' },
    { name: 'UI_DESIGN_OUTPUT', required: true, description: 'Chained from 10.7' },
  ],
};

/** Get variables for the given prompt kind (for editor UI) */
export function getVariablesForPrompt(phase: number, subphase?: string): VariableSpec[] {
  if (phase >= 1 && phase <= 3 && !subphase) return RESEARCH_PROMPT_VARIABLES;
  if (phase === 0 && subphase === 'claude_summary') return CLAUDE_SUMMARY_VARIABLES;
  if (phase === 4 && subphase) return PHASE4_VARIABLES[subphase] ?? [];
  if (phase === 10 && subphase) return PHASE10_VARIABLES[subphase] ?? [];
  return [];
}

/**
 * Extract {{VAR}} and {{#if VAR}}...{{/if}} variable names from a template string.
 */
export function extractVariablesFromTemplate(template: string): string[] {
  const names = new Set<string>();
  // {{VAR}}
  const simple = template.matchAll(/\{\{(\w+)\}\}/g);
  for (const m of simple) names.add(m[1]);
  // {{#if VAR}}
  const conditional = template.matchAll(/\{\{#if\s+(\w+)\}\}/g);
  for (const m of conditional) names.add(m[1]);
  return Array.from(names);
}

/**
 * Validate template: return list of required variable names that are missing.
 */
export function getMissingRequiredVariables(
  template: string,
  variables: VariableSpec[]
): string[] {
  const required = variables.filter((v) => v.required).map((v) => v.name);
  const present = extractVariablesFromTemplate(template);
  return required.filter((name) => !present.includes(name));
}
