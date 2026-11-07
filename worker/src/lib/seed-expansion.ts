/**
 * Claude-First Keyword Generation
 *
 * Claude is the PRIMARY keyword discovery engine. It generates 300-1000
 * intent-classified, location-multiplied keywords organized into 7 tiers:
 *
 *   Tier 1 — Emergency/Immediate    (converts 12–20%)
 *   Tier 2 — Comparison/Selection   (converts 8–15%)
 *   Tier 3 — Cost/Pricing           (converts 5–12%)
 *   Tier 4 — Core Service+Location  (converts 6–15%)
 *   Tier 5 — Problem/Symptom-Aware  (converts 1–5%)
 *   Tier 6 — Research/Education     (converts 1–5%)
 *   Tier 7 — Long-Tail/Specialty    (variable)
 *
 * For intermediate/advanced tiers: keywords are enriched by DataForSEO
 * (bulkSearchVolume + searchIntentClassification) in Waves 2-3.
 *
 * For basic tier: the raw keyword list is formatted as markdown and
 * appended to the SEO strategy deliverable (Phase 4.2).
 */

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from './supabase';
import { logger } from './logger';
import { logServiceUsage } from './audit-logger';

// ─── Types ───────────────────────────────────────────────────────

export interface ClaudeKeyword {
  keyword: string;
  location: string;
  service: string;
  tier: string;
}

export interface ExpandSeedKeywordsResult {
  keywords: ClaudeKeyword[];
  flatKeywords: string[];
  tierCounts: Record<string, number>;
  summary: any;
  totalCount: number;
}

export interface ExpandSeedKeywordsOptions {
  claudeApiKey: string;
  session: any;
  userId: string;
  sessionId: string;
  serviceAreaLocationCodes?: Array<{ city: string; location_code: number; location_name: string }>;
}

// ─── Tier keys (canonical order) ─────────────────────────────────

const TIER_KEYS = [
  'tier_1_emergency',
  'tier_2_comparison',
  'tier_3_pricing',
  'tier_4_core',
  'tier_5_problem',
  'tier_6_research',
  'tier_7_specialty',
] as const;

const TIER_LABELS: Record<string, string> = {
  tier_1_emergency: 'Tier 1 — Emergency/Immediate',
  tier_2_comparison: 'Tier 2 — Comparison/Selection',
  tier_3_pricing: 'Tier 3 — Cost/Pricing',
  tier_4_core: 'Tier 4 — Core Service + Location',
  tier_5_problem: 'Tier 5 — Problem/Symptom-Aware',
  tier_6_research: 'Tier 6 — Research/Education',
  tier_7_specialty: 'Tier 7 — Long-Tail/Specialty',
};

// ─── Max tokens per tier ─────────────────────────────────────────

function getMaxTokensForTier(tier: string | undefined): number {
  switch (tier) {
    case 'advanced': return 50000;
    case 'intermediate': return 32000;
    default: return 16000;
  }
}

// ─── Fallback prompt ─────────────────────────────────────────────
// Used when admin_config.seed_expansion_prompt is missing or empty.

const FALLBACK_PROMPT = `You are an expert local SEO keyword strategist. Your job is to generate a comprehensive, intent-classified seed keyword list for a local service business. You will produce between 500 and 1,000 unique keyword phrases, organized by intent tier.
Every keyword you generate must follow the LOCAL SEO KEYWORD PHILOSOPHY and GENERATION RULES defined below. Do not deviate from this system.
CRITICAL: Your entire response must be a single valid JSON object. No markdown, no explanation, no text before or after the JSON. Start your response with { and end it with }. If you need to include notes or recommendations, put them inside the summary key of the JSON object.

BUSINESS PROFILE
Business Name: {{business_name}}
Business Type: {{business_type}}
Industry: {{industry}}
Primary Service: {{primary_service}}
All Services Offered: {{services}}
Primary City: {{city}}
State: {{state}}
ZIP Code: {{zip_code}}
Street Address: {{street_address}}
Service Area Cities: {{service_area_cities}}
Target Audience: {{target_audience}}
Customer Type: {{target_customer_type}}
Unique Selling Points: {{unique_selling_points}}
Certifications/Credentials: {{certifications}}
Years in Business: {{years_in_business}}
License Number: {{license_number}}
Brands Serviced/Carried: {{brand_keywords}}
Operating Hours: {{operating_hours}}
Competitors: {{competitor_domains}}
Package Tier: {{tier}}

DYNAMIC GENERATION RULES
Customer type logic:

If {{target_customer_type}} = "residential" → generate ONLY residential keywords. Skip all commercial, industrial, and business-focused keywords.
If {{target_customer_type}} = "commercial" → generate ONLY commercial keywords. Skip residential and homeowner keywords.
If {{target_customer_type}} = "both" → generate BOTH residential and commercial keywords. Weight residential higher unless the business profile suggests otherwise.

Service area logic:

Generate location-modified keywords for the Primary City + State as the primary location.
Generate location-modified keywords for EVERY city listed in the Service Area Cities field above.
If Service Area Cities is empty, generate "near me" variants and region-level keywords for the Primary City area.
If Service Area Cities contains 5+ cities, also generate regional and county-level keywords that cover clusters of nearby cities.

Operating hours logic:

If Operating Hours contains "24/7" or "emergency" or "after hours" → generate FULL Tier 1 emergency/urgency keywords.
If Operating Hours indicates standard business hours only (e.g., "Monday-Friday 8AM-5PM") → STILL generate Tier 1 keywords but add "OPPORTUNITY" to the service field for those keywords to flag that the business does not currently offer this service window.
If Operating Hours mentions weekend availability → generate weekend-specific keywords ("open Saturday," "Sunday [service]").

Brand keywords logic:

If Brands Serviced/Carried is populated → generate brand + equipment + service + location keywords for EVERY brand listed across the Primary City and top 3 Service Area Cities.
If Brands Serviced/Carried is empty or "N/A" → skip brand-specific keywords entirely.

Credentials logic:

If Certifications/Credentials includes specific credentials → incorporate them as modifier keywords (e.g., "NATE certified HVAC technician [city]," "BBB accredited plumber [city]").
If Years in Business ≥ 10 → include experience-based keywords ("experienced [service] [city]," "established [service] [city]").

Tier/package logic:

If Package Tier = "basic" → generate 300–500 keywords. Focus on Tiers 1, 2, and 4 (emergency, comparison, core service + location). Lighter coverage of Tiers 3, 5, 6, 7.
If Package Tier = "intermediate" → generate 500–750 keywords. Full coverage of all tiers.
If Package Tier = "advanced" → generate 750–1,000+ keywords. Maximum coverage including all brand keywords, all neighborhood keywords, full question/research keyword set, and competitor-differentiation keywords.


LOCAL SEO KEYWORD PHILOSOPHY
Follow these principles for every keyword you generate:
1. Intent tier determines priority, not search volume.
A keyword with 30 monthly searches where the searcher is ready to call is worth more than a keyword with 3,000 searches from people just browsing. Always classify keywords by intent tier:

TIER 1 — EMERGENCY/IMMEDIATE (converts 12–20%): Searcher is in crisis. Needs someone NOW.
TIER 2 — COMPARISON/SELECTION (converts 8–15%): Searcher has decided to hire. Picking who.
TIER 3 — COST/PRICING (converts 5–12%): Searcher is serious. Gathering quotes, comparing costs.
TIER 4 — CORE SERVICE + LOCATION (converts 6–15%): Foundational head terms. Broadest local commercial intent.
TIER 5 — PROBLEM/SYMPTOM-AWARE (converts 1–5%): Searcher has a problem, may not know what service they need yet.
TIER 6 — RESEARCH/EDUCATION (converts 1–5%): Searcher will buy but is doing due diligence first.
TIER 7 — LONG-TAIL/SPECIALTY (variable): Niche combinations — brand + equipment + location, audience-specific, method-specific.

2. Location multiplication is mandatory.
Every strong keyword formula must be generated across ALL service area cities, not just the primary city.
3. Modifier stacking creates long-tail gold.
Combine multiple modifier types: urgency + problem + location, quality + service + location, problem + action + location. Always generate stacked variants, not just single-modifier keywords.
4. Problem keywords are an untapped goldmine.
Generate symptom-based and problem-based keywords. Think like the customer experiencing the problem, not the trade professional diagnosing it.
5. Every keyword must pass these validation rules:

Has local intent (contains a location, "near me," or triggers Google's local pack)
Signals buying or hiring intent (not DIY, not job seekers, not students)
Is something a real person would actually type into Google
Maps to a service the business actually offers
Does not duplicate the intent of another keyword in the list

6. Exclude these keyword types entirely:

DIY keywords ("how to fix it yourself," "DIY [service]")
Employment keywords ("jobs," "salary," "career," "hiring")
Education/training keywords ("certification," "school," "course," "apprenticeship")
Wholesale/supply keywords ("wholesale," "parts supplier," "equipment for sale")
Software/tool keywords ("software," "app," "CRM")
Keywords with "free" alone (without "estimate," "quote," or "consultation")


KEYWORD FORMULA LIBRARY
Use these proven formulas as your generation engine. Apply each relevant formula using the services from the business profile, multiplied across all locations.
TIER 1 — EMERGENCY/IMMEDIATE FORMULAS:
emergency + [service] + [city], emergency + [service] + near me, 24 hour + [service] + [city], 24/7 + [service] + [city], same day + [service] + [city], [service] + open now + near me, [service] + available today + [city], [service] + after hours + [city], urgent + [service] + near me, [service] + on weekends + [city], [service] + open Sunday + near me, late night + [service] + [city], need + [service] + now + [city], emergency + [specific problem] + repair + [city]
TIER 2 — COMPARISON/SELECTION FORMULAS:
best + [service] + in + [city], best + [service] + near me, top rated + [service] + [city], [service] + reviews + [city], most trusted + [service] + [city], #1 + [service] + in + [city], recommended + [service] + [city], reliable + [service] + near me, professional + [service] + [city], licensed + [service] + [city], certified + [service] + [city], [service] + with good reviews + near me, 5 star + [service] + [city], [service] + companies in + [city], [service] + near me + reviews, best + [service] + [city] + reddit, [service] + recommendations + [city]
TIER 3 — COST/PRICING FORMULAS:
[service] + cost + [city], how much does + [service] + cost in + [city], affordable + [service] + [city], cheap + [service] + near me, [service] + free estimate + [city], [service] + free quote + [city], [service] + pricing + [city], [service] + rates + [city], average cost of + [service] + [city], low cost + [service] + near me, how much do + [professionals] + charge in + [city], [service] + financing + [city], [service] + payment plan + [city], [specific sub-service] + cost + [city]
TIER 4 — CORE SERVICE + LOCATION FORMULAS:
[service] + [city], [city] + [service], [service] + in + [city], [service] + [city] + [state], [service] + [neighborhood], local + [service] + [city], [city] + [service] + company, [service] + [direction] + [city], [service] + near me, [service] + [county], [service] + [region/metro name], [professional title] + [city], [service] + contractor + [city], [service] + company + [city], [service] + provider + [city]
TIER 5 — PROBLEM/SYMPTOM FORMULAS:
[problem] + repair + [city], [equipment] + not working + [city], fix + [problem] + [city], [symptom] + [service] + near me, [thing] + broken + [city], [thing] + replacement + [city], [thing] + making noise + [city], [thing] + won't turn on + [city], [thing] + leaking + [city], [damage type] + restoration + [city], [thing] + backed up + [city], no + [expected result] + [city] + [professional], [thing] + running constantly + [city], [thing] + won't stop + [city]
TIER 6 — RESEARCH/QUESTION FORMULAS:
how much does + [service] + cost + [city], how to choose a + [professional] + in + [city], what to look for in a + [professional], questions to ask + [professional] + before hiring, do I need + [service], when should I + [service action], is + [service] + worth it, signs you need + [service], [option A] vs [option B], should I repair or replace + [thing], what to expect from + [service], how long does + [service] + take, what does + [service] + include, how often should I + [maintenance action], what causes + [problem], why is my + [thing] + [symptom]
TIER 7 — LONG-TAIL/SPECIALTY FORMULAS:
residential + [service] + [city], commercial + [service] + [city], [brand] + [equipment] + repair + [city], [brand] + [equipment] + installation + [city], [material/method] + [service] + [city], [audience] + [service] + [city], [service] + for + [property type] + [city], hire + [professional] + in + [city], book + [service] + [city], schedule + [service] + [city], get + [service] + quote + [city], [service] + that offers financing + [city], [credential] + [professional] + [city], [service] + [specific method/technology] + [city]

MODIFIER REFERENCE LISTS
Pick the most relevant modifiers for this business type and industry.
Urgency: emergency, urgent, same day, 24 hour, 24/7, now, today, immediate, ASAP, quick, fast, rush, last minute, after hours, weekend, overnight, rapid, express, open now, late night, early morning, holiday, Sunday, Saturday, on-call, next available, walk-in
Quality/Trust: best, top, top rated, highest rated, #1, trusted, reliable, professional, certified, licensed, insured, bonded, experienced, expert, specialist, recommended, award-winning, 5-star, reputable, premier, established, accredited, qualified, vetted, guaranteed, master, family-owned, locally owned
Value/Price: affordable, cheap, budget, low cost, discount, free estimate, free quote, free consultation, best price, competitive pricing, reasonable, pricing, rates, fees, cost, how much, payment plan, financing, upfront pricing, flat rate, no hidden fees, fair price, cost-effective, specials
Action: hire, book, schedule, call, get, find, request, need, looking for, contact, appointment, consultation, estimate, quote, inspection, get a quote, request estimate, arrange, reserve
Problem/Need: repair, fix, broken, not working, replacement, replace, issue, problem, help, troubleshoot, inspect, maintain, maintenance, restore, resolve, install, installation, removal, cleanup, upgrade, remodel, renovate, unclog, leak, damage, burst, backed up, flooded, cracked, failed, worn out, noisy, overheating, won't turn on, won't stop, making noise
Comparison: reviews, ratings, testimonials, recommendations, vs, compare, which is better, pros and cons, alternatives, top 10, reddit, options
Audience/Context: residential, commercial, industrial, home, office, apartment, condo, townhouse, new construction, historic home, mobile home, rental property, multi-family, senior, family, eco-friendly, energy-efficient, luxury, custom, small business
Credential: licensed, certified, insured, bonded, BBB accredited, background checked, family-owned, veteran-owned, woman-owned, locally owned, factory authorized, EPA certified, NATE certified, master, fully insured, years experience, established
Seasonal/Timing: spring, summer, fall, winter, pre-season, end-of-season, seasonal, annual, before winter, winterize, spring cleaning, this week, this weekend

GENERATION PROCESS
PHASE 1: Build the service term matrix.
Parse the comma-separated services list and primary service into individual service terms. For each, determine the core keyword, professional title variant, company variant, and sub-service breakdowns.
PHASE 2: Build the location matrix.
Parse the service area cities into individual cities. Build the complete location list including: primary city, primary city + state, each service area city, "near me," county and region names. If no service area cities are listed, include neighborhood-level keywords for the primary city.
PHASE 3: Generate keywords tier by tier.
For each tier, select relevant formulas, fill them with service terms, multiply across locations, add stacked modifier variants, and prune duplicates.
PHASE 4: Generate problem/symptom keywords.
Based on the business type, industry, and services, brainstorm every common problem and symptom that drives customers to search. Think from the target audience's perspective.
PHASE 5: Generate question keywords.
Generate research-intent keywords specific to this business's services and locations.
PHASE 6: Generate specialty/long-tail keywords.
Using brand keywords, certifications, customer type, and method specifics, generate niche long-tail keywords.
PHASE 7: Final validation pass.
Remove any keywords that lack local intent, target DIY/jobs/students, don't map to offered services, or duplicate another keyword's intent.

VOLUME TARGETS BY TIER
Scale based on Package Tier:

Tier | Basic (300–500) | Intermediate (500–750) | Advanced (750–1,000+)
Tier 1 — Emergency | 20–30 | 40–60 | 60–100
Tier 2 — Comparison | 25–40 | 50–80 | 80–120
Tier 3 — Cost/Pricing | 20–30 | 40–60 | 60–100
Tier 4 — Core + Location | 60–100 | 100–180 | 150–250
Tier 5 — Problem/Symptom | 30–50 | 60–100 | 100–150
Tier 6 — Research | 15–25 | 35–55 | 50–80
Tier 7 — Specialty | 15–25 | 40–60 | 60–100

Scaling multipliers:
For every service area city beyond the first 3, add ~30–50 keywords distributed across tiers.
For every service beyond the first 3, add ~20–40 keywords distributed across tiers.
If brand keywords has 3+ brands, add ~20–40 Tier 7 keywords.


OUTPUT FORMAT — JSON ONLY
Your entire response must be a single valid JSON object. No text before or after. No markdown code fences. Start with { and end with }.
Use this exact structure:
{
  "report_metadata": {
    "business_name": "{{business_name}}",
    "primary_city": "{{city}}",
    "state": "{{state}}",
    "service_area_cities": ["city1", "city2", "..."],
    "customer_type": "{{target_customer_type}}",
    "package_tier": "{{tier}}",
    "total_keywords": 0
  },
  "tier_1_emergency": [
    {
      "keyword": "emergency plumbing tampa",
      "location": "Tampa",
      "service": "Emergency Plumbing"
    }
  ],
  "tier_2_comparison": [
    {
      "keyword": "best plumber in tampa",
      "location": "Tampa",
      "service": "General Plumbing"
    }
  ],
  "tier_3_pricing": [
    {
      "keyword": "plumbing cost tampa",
      "location": "Tampa",
      "service": "General Plumbing"
    }
  ],
  "tier_4_core": [
    {
      "keyword": "plumber tampa fl",
      "location": "Tampa",
      "service": "General Plumbing"
    }
  ],
  "tier_5_problem": [
    {
      "keyword": "water heater not working tampa",
      "location": "Tampa",
      "service": "Water Heater Repair"
    }
  ],
  "tier_6_research": [
    {
      "keyword": "how much does a plumber cost in tampa",
      "location": "Tampa",
      "service": "General Plumbing"
    }
  ],
  "tier_7_specialty": [
    {
      "keyword": "rheem water heater repair tampa",
      "location": "Tampa",
      "service": "Water Heater Repair"
    }
  ],
  "summary": {
    "keyword_counts": {
      "tier_1_emergency": 0,
      "tier_2_comparison": 0,
      "tier_3_pricing": 0,
      "tier_4_core": 0,
      "tier_5_problem": 0,
      "tier_6_research": 0,
      "tier_7_specialty": 0,
      "total": 0
    },
    "top_20_priority_keywords": [
      "keyword1",
      "keyword2"
    ],
    "recommended_pages": [
      "Emergency [Service] landing page targeting Tier 1 keywords",
      "[Service] + [City] service pages for each service area city"
    ],
    "industry_notes": "Seasonal patterns, unique search behaviors, etc.",
    "blog_topics": [
      "Topic derived from Tier 6 keyword 1",
      "Topic derived from Tier 6 keyword 2"
    ],
    "credential_differentiation": "How to leverage certifications and years in business for SEO"
  }
}
Rules for the JSON output:

Every keyword string must be lowercase
The "location" field must be the specific city or "Near Me" for near-me variants
The "service" field must match one of the services from the All Services Offered list, or use the Primary Service as fallback. If the keyword targets the business broadly (not a specific sub-service), use the Primary Service value. If the operating hours do NOT support a keyword (e.g., emergency keywords when hours are M-F 9-5), append " [OPPORTUNITY]" to the service value to flag it.
The "total_keywords" in report_metadata must equal the actual count of all keywords across all tiers
The keyword_counts in summary must accurately reflect the count of items in each tier array
Do not include any duplicate keywords across tiers. Each keyword appears in exactly one tier.
Do not wrap the JSON in markdown code fences or backticks. Raw JSON only.


CRITICAL REMINDERS

RESPOND WITH ONLY JSON. No markdown. No explanation. No code fences. Just the JSON object.
DO NOT skip location multiplication. Generate "[service] [city]" for EVERY service area city, not just the primary city.
DO NOT generate keywords for services not listed in the business profile. Stay within what the business actually offers.
DO include professional title variations. "[business_type] [city]" and "[service] contractor [city]" and "[service] company [city]" are different keywords.
DO stack modifiers for long-tail opportunities. 5–6 word keyword phrases are fine and often convert highest.
DO think like the target audience, not the business owner. Use customer language for problems and symptoms, not trade terminology.
DO generate brand + equipment + location keywords for every brand listed, across the primary city and top 3 service area cities.
DO include "near me" variants for every core formula.
DO generate neighborhood-level keywords for the primary city when service area radius ≤ 25 miles.
DO incorporate unique selling points into Tier 2 and Tier 7 keywords where they create natural search terms (e.g., "financing available" → "[service] financing [city]"; "family-owned" → "family-owned [service] [city]").
DO reference operating hours to determine whether emergency/after-hours keywords are confirmed services vs. expansion opportunities flagged with [OPPORTUNITY].

Now generate the complete keyword list as a JSON object based on the business profile provided above.`;

// ─── Prompt loading ──────────────────────────────────────────────

let cachedPrompt: string | null = null;
let cachedPromptTimestamp = 0;
const PROMPT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function loadSeedExpansionPrompt(): Promise<string> {
  const now = Date.now();
  if (cachedPrompt && now - cachedPromptTimestamp < PROMPT_CACHE_TTL) {
    return cachedPrompt;
  }

  try {
    const { data, error } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'seed_expansion_prompt')
      .single();

    if (error || !data?.config_value) {
      logger.warn('[KeywordGen] No seed_expansion_prompt in admin_config; using fallback prompt');
      cachedPrompt = FALLBACK_PROMPT;
      cachedPromptTimestamp = now;
      return FALLBACK_PROMPT;
    }

    const template = typeof data.config_value === 'string'
      ? data.config_value
      : JSON.stringify(data.config_value);

    cachedPrompt = template;
    cachedPromptTimestamp = now;
    return template;
  } catch (e: any) {
    logger.error('[KeywordGen] Error loading prompt, using fallback:', e.message);
    cachedPrompt = FALLBACK_PROMPT;
    cachedPromptTimestamp = now;
    return FALLBACK_PROMPT;
  }
}

// ─── Variable replacement ────────────────────────────────────────

interface SeedExpansionContext {
  session: any;
  serviceAreaLocationCodes?: Array<{ city: string; location_code: number; location_name: string }>;
}

function joinArray(val: any): string {
  if (Array.isArray(val)) return val.filter(Boolean).join(', ');
  if (typeof val === 'string') return val;
  return '';
}

function fillPromptTemplate(template: string, ctx: SeedExpansionContext): string {
  const s = ctx.session;

  const businessName = s.business_name || '';
  const businessType = s.business_type || s.industry || '';
  const industry = s.industry || s.business_type || '';
  const city = s.city || '';
  const state = s.state || '';
  const primaryService = s.primary_service || s.industry || '';
  const allServices = s.services || primaryService;
  const targetAudience = s.target_audience || '';
  const targetCustomerType = s.target_customer_type || 'both';
  const uniqueSellingPoints = s.unique_selling_points || '';
  const tier = s.tier || 'basic';

  // Build service area string from session + resolved location codes
  let serviceAreaCities = joinArray(s.service_area_cities);
  if (!serviceAreaCities) {
    const areaCities = ctx.serviceAreaLocationCodes
      ?.map(e => e.city)
      .filter(c => c && c.toLowerCase() !== city.toLowerCase()) || [];
    if (areaCities.length > 0) {
      serviceAreaCities = areaCities.join(', ');
    }
  }

  const serviceAreaRadius = s.service_area || s.search_radius || '25';

  return template
    .replace(/\{\{business_name\}\}/gi, businessName)
    .replace(/\{\{business_type\}\}/gi, businessType)
    .replace(/\{\{industry\}\}/gi, industry)
    .replace(/\{\{primary_service\}\}/gi, primaryService)
    .replace(/\{\{services\}\}/gi, allServices)
    .replace(/\{\{city\}\}/gi, city)
    .replace(/\{\{state\}\}/gi, state)
    .replace(/\{\{zip_code\}\}/gi, s.zip_code || '')
    .replace(/\{\{street_address\}\}/gi, s.street_address || '')
    .replace(/\{\{service_area\}\}/gi, String(serviceAreaRadius))
    .replace(/\{\{service_area_cities\}\}/gi, serviceAreaCities)
    .replace(/\{\{target_audience\}\}/gi, targetAudience)
    .replace(/\{\{target_customer_type\}\}/gi, targetCustomerType)
    .replace(/\{\{unique_selling_points\}\}/gi, uniqueSellingPoints)
    .replace(/\{\{certifications\}\}/gi, joinArray(s.certifications))
    .replace(/\{\{years_in_business\}\}/gi, s.years_in_business || '')
    .replace(/\{\{license_number\}\}/gi, s.license_number || '')
    .replace(/\{\{brand_keywords\}\}/gi, joinArray(s.brand_keywords))
    .replace(/\{\{operating_hours\}\}/gi, s.operating_hours || '')
    .replace(/\{\{competitor_domains\}\}/gi, joinArray(s.competitor_domains))
    .replace(/\{\{tier\}\}/gi, tier);
}

// ─── Response parsing ────────────────────────────────────────────

function stripMarkdownFences(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  return cleaned.trim();
}

function parseClaudeKeywordResponse(raw: string): ExpandSeedKeywordsResult | null {
  try {
    const cleaned = stripMarkdownFences(raw);
    const parsed = JSON.parse(cleaned);

    if (typeof parsed !== 'object' || parsed === null) {
      logger.error('[KeywordGen] Claude response is not a JSON object');
      return null;
    }

    const keywords: ClaudeKeyword[] = [];
    const flatSet = new Set<string>();
    const flatKeywords: string[] = [];
    const tierCounts: Record<string, number> = {};

    for (const tierKey of TIER_KEYS) {
      const tierArray = parsed[tierKey];
      if (!Array.isArray(tierArray)) {
        tierCounts[tierKey] = 0;
        continue;
      }

      let count = 0;
      for (const entry of tierArray) {
        if (!entry || typeof entry !== 'object') continue;
        const kw = (entry.keyword || '').toString().trim().toLowerCase();
        if (!kw) continue;
        if (flatSet.has(kw)) continue;

        flatSet.add(kw);
        flatKeywords.push(kw);
        keywords.push({
          keyword: kw,
          location: (entry.location || '').toString().trim(),
          service: (entry.service || '').toString().trim(),
          tier: tierKey,
        });
        count++;
      }
      tierCounts[tierKey] = count;
    }

    if (keywords.length === 0) {
      logger.error('[KeywordGen] Claude returned JSON but no valid keywords were extracted');
      return null;
    }

    return {
      keywords,
      flatKeywords,
      tierCounts,
      summary: parsed.summary || null,
      totalCount: keywords.length,
    };
  } catch (e: any) {
    logger.error('[KeywordGen] Failed to parse Claude JSON response:', e.message);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Ask Claude to generate 300-1000 intent-classified, location-multiplied
 * keywords for a local service business.
 *
 * Returns null if Claude's output is invalid or the call fails.
 * The caller decides what to do on null (intermediate/advanced: fall back
 * to form seeds; basic: skip keyword section in deliverable).
 */
export async function expandSeedKeywords(opts: ExpandSeedKeywordsOptions): Promise<ExpandSeedKeywordsResult | null> {
  const { claudeApiKey, session, userId, sessionId, serviceAreaLocationCodes } = opts;

  const template = await loadSeedExpansionPrompt();
  const prompt = fillPromptTemplate(template, { session, serviceAreaLocationCodes });
  logger.debug(`[KeywordGen] Prompt filled (${prompt.length} chars) for tier=${session.tier || 'basic'}`);

  const maxTokens = getMaxTokensForTier(session.tier);

  try {
    const anthropic = new Anthropic({ apiKey: claudeApiKey, timeout: 900000, maxRetries: 1 });

    logServiceUsage(userId, 'claude', 0, sessionId);

    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_FAST_MODEL || 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b: any) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      logger.error('[KeywordGen] Claude returned no text content');
      return null;
    }

    const rawOutput = (textBlock as { type: 'text'; text: string }).text;
    logger.debug(`[KeywordGen] Claude response (${rawOutput.length} chars), stop_reason=${response.stop_reason}`);

    if (response.stop_reason === 'max_tokens') {
      logger.warn('[KeywordGen] Claude response was truncated (hit max_tokens). JSON may be incomplete.');
    }

    const result = parseClaudeKeywordResponse(rawOutput);
    if (result) {
      logger.debug(`[KeywordGen] Parsed ${result.totalCount} keywords: ${JSON.stringify(result.tierCounts)}`);
    }
    return result;
  } catch (e: any) {
    logger.error(`[KeywordGen] Claude call failed: ${e.message}`);
    return null;
  }
}

// ─── Google Ads Seed Optimizer ───────────────────────────────────

export interface OptimizeSeedsForGoogleAdsOptions {
  claudeApiKey: string;
  services: string[];
  additionalServices: string[];
  industry: string;
  city: string;
  state: string;
  businessName: string;
}

// Fallback prompt used when admin_config.seed_optimizer_prompt is missing.
const SEED_OPTIMIZER_FALLBACK_PROMPT = `You are a Google Ads keyword strategist. Given the following business details, generate exactly 20 seed keywords optimized for Google Ads "keywords for keywords" API to discover the broadest, most relevant set of paid advertising keyword opportunities.

BUSINESS:
- Name: {{business_name}}
- Industry: {{industry}}
- Location: {{city}}, {{state}}
- Services: {{services}}

RULES:
1. Focus on commercial and transactional intent terms (people ready to buy/hire).
2. Mix broad service terms with specific high-value service terms.
3. Include location-modified variants for the primary city.
4. Include "near me" variants for the most important services.
5. Prioritize terms that will yield the most diverse and relevant Google Ads keyword suggestions.
6. Do NOT include brand names, competitor names, or informational-only terms.
7. Keep keywords concise (2-4 words each).

Return ONLY a JSON array of exactly 20 strings. No explanation, no markdown, no code fences. Example:
["plumber tampa", "emergency plumbing near me", "water heater repair tampa", ...]`;

// ─── Seed optimizer prompt loading (admin-configurable) ──────────

let cachedOptimizerPrompt: string | null = null;
let cachedOptimizerPromptTimestamp = 0;

async function loadSeedOptimizerPrompt(): Promise<string> {
  const now = Date.now();
  if (cachedOptimizerPrompt && now - cachedOptimizerPromptTimestamp < PROMPT_CACHE_TTL) {
    return cachedOptimizerPrompt;
  }

  try {
    const { data, error } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'seed_optimizer_prompt')
      .single();

    if (error || !data?.config_value) {
      logger.warn('[SeedOptimizer] No seed_optimizer_prompt in admin_config; using fallback prompt');
      cachedOptimizerPrompt = SEED_OPTIMIZER_FALLBACK_PROMPT;
      cachedOptimizerPromptTimestamp = now;
      return SEED_OPTIMIZER_FALLBACK_PROMPT;
    }

    const template = typeof data.config_value === 'string'
      ? data.config_value
      : JSON.stringify(data.config_value);

    cachedOptimizerPrompt = template;
    cachedOptimizerPromptTimestamp = now;
    return template;
  } catch (e: any) {
    logger.error('[SeedOptimizer] Error loading prompt, using fallback:', e.message);
    cachedOptimizerPrompt = SEED_OPTIMIZER_FALLBACK_PROMPT;
    cachedOptimizerPromptTimestamp = now;
    return SEED_OPTIMIZER_FALLBACK_PROMPT;
  }
}

function fillOptimizerTemplate(template: string, opts: OptimizeSeedsForGoogleAdsOptions): string {
  const allServices = [...opts.services, ...opts.additionalServices].filter(Boolean);

  return template
    .replace(/\{\{business_name\}\}/gi, opts.businessName || '')
    .replace(/\{\{industry\}\}/gi, opts.industry || '')
    .replace(/\{\{city\}\}/gi, opts.city || '')
    .replace(/\{\{state\}\}/gi, opts.state || '')
    .replace(/\{\{services\}\}/gi, allServices.join(', '))
    .replace(/\{\{additional_services\}\}/gi, opts.additionalServices.filter(Boolean).join(', '))
    .replace(/\{\{primary_services\}\}/gi, opts.services.filter(Boolean).join(', '));
}

/**
 * Use Claude to generate 20 optimized seed keywords for Google Ads
 * keywords_for_keywords API. Since services are already standardized
 * (from SERVICES_LIST), this call focuses on combining and prioritizing
 * them into the best seeds for Google Ads keyword discovery.
 *
 * Prompt is admin-configurable via admin_config.seed_optimizer_prompt.
 * Returns up to 20 optimized seed keyword strings.
 */
export async function optimizeSeedsForGoogleAds(opts: OptimizeSeedsForGoogleAdsOptions): Promise<string[]> {
  const { claudeApiKey, services, additionalServices } = opts;

  const allServices = [...services, ...additionalServices].filter(Boolean);
  if (allServices.length === 0) {
    logger.warn('[SeedOptimizer] No services provided, returning empty seeds');
    return [];
  }

  const template = await loadSeedOptimizerPrompt();
  const prompt = fillOptimizerTemplate(template, opts);
  logger.debug(`[SeedOptimizer] Prompt filled (${prompt.length} chars)`);

  try {
    const anthropic = new Anthropic({ apiKey: claudeApiKey, timeout: 60000, maxRetries: 1 });

    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_FAST_MODEL || 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b: any) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      logger.error('[SeedOptimizer] Claude returned no text content');
      return allServices.slice(0, 20);
    }

    const raw = (textBlock as { type: 'text'; text: string }).text.trim();
    const cleaned = stripMarkdownFences(raw);

    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      logger.error('[SeedOptimizer] Claude did not return a JSON array');
      return allServices.slice(0, 20);
    }

    const seeds = parsed
      .filter((s: any) => typeof s === 'string' && s.trim().length > 0)
      .map((s: string) => s.trim().toLowerCase())
      .slice(0, 20);

    logger.debug(`[SeedOptimizer] Generated ${seeds.length} optimized Google Ads seeds`);
    return seeds;
  } catch (e: any) {
    logger.error(`[SeedOptimizer] Claude call failed: ${e.message}`);
    return allServices.slice(0, 20).map(s => s.toLowerCase());
  }
}

// ─── Markdown formatter (for basic tier deliverable) ─────────────

/**
 * Format the Claude keyword result as a readable markdown section
 * to append to the SEO strategy doc for basic tier clients.
 */
export function formatKeywordsAsMarkdown(result: ExpandSeedKeywordsResult, session?: any): string {
  const lines: string[] = [];

  const bizName = session?.business_name || '';
  const city = session?.city || '';
  const state = session?.state || '';
  const header = [bizName, city, state].filter(Boolean).join(', ');

  lines.push(`## Keyword Research${header ? ` — ${header}` : ''}`);
  lines.push('');
  lines.push(`**Total Keywords Generated:** ${result.totalCount}`);
  lines.push('');

  for (const tierKey of TIER_KEYS) {
    const tierKws = result.keywords.filter(k => k.tier === tierKey);
    if (tierKws.length === 0) continue;

    const label = TIER_LABELS[tierKey] || tierKey;
    lines.push(`### ${label} (${tierKws.length} keywords)`);
    lines.push('');
    lines.push('| # | Keyword | Target Location | Mapped Service |');
    lines.push('|---|---------|-----------------|----------------|');

    for (let i = 0; i < tierKws.length; i++) {
      const kw = tierKws[i];
      lines.push(`| ${i + 1} | ${kw.keyword} | ${kw.location} | ${kw.service} |`);
    }

    lines.push('');
  }

  // Summary section
  if (result.summary) {
    lines.push('### Summary & Recommendations');
    lines.push('');

    if (Array.isArray(result.summary.top_20_priority_keywords) && result.summary.top_20_priority_keywords.length > 0) {
      lines.push('**Top 20 Priority Keywords:**');
      for (const kw of result.summary.top_20_priority_keywords) {
        lines.push(`- ${kw}`);
      }
      lines.push('');
    }

    if (Array.isArray(result.summary.recommended_pages) && result.summary.recommended_pages.length > 0) {
      lines.push('**Recommended Pages:**');
      for (const page of result.summary.recommended_pages) {
        lines.push(`- ${page}`);
      }
      lines.push('');
    }

    if (result.summary.industry_notes) {
      lines.push(`**Industry Notes:** ${result.summary.industry_notes}`);
      lines.push('');
    }

    if (Array.isArray(result.summary.blog_topics) && result.summary.blog_topics.length > 0) {
      lines.push('**Blog Topics:**');
      for (const topic of result.summary.blog_topics) {
        lines.push(`- ${topic}`);
      }
      lines.push('');
    }

    if (result.summary.credential_differentiation) {
      lines.push(`**Credential Differentiation:** ${result.summary.credential_differentiation}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
