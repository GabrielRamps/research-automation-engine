/**
 * Phase 4 prompt defaults — kept in sync with worker/src/phases/phase4.ts
 * Used so the admin UI can show "live" prompts when DB has no row or empty template.
 */

export const PHASE4_SUBPHASES = [
  '4.1', '4.2', '4.3', '4.4', '4.5',
  '10.1', '10.2', '10.3', '10.4', '10.5', '10.6', '10.7', '10.8',
] as const;
export type Phase4Subphase = (typeof PHASE4_SUBPHASES)[number];

export interface Phase4DefaultMeta {
  name: string;
  internal_notes: string;
}

const DEFAULT_4_1 = `You are a competitive intelligence analyst. Synthesize the Phase 1 research below into a comprehensive Competitive Intelligence Report.

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

const DEFAULT_4_2 = `You are an SEO strategist. Create a comprehensive SEO & Content Strategy Guide using two clearly separated data sources below. DataForSEO is real live SEO data; Tavily is scraped/web research for strategy and competitor layout only.

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

const DEFAULT_4_3 = `You are a conversion optimization expert. Synthesize the Phase 3 research below into a comprehensive Conversion Optimization Guide.

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

const DEFAULT_4_4 = `You are an expert website developer and information architect. Using the three comprehensive reports below, create a detailed website wireframe and outline.

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

const DEFAULT_4_5 = `You are an expert UI/UX designer. Create a design philosophy and visual direction document for the website builder. The goal is to guide an AI (or developer) with principles and intent—NOT with exact pixel values, spacing numbers, or rigid specs. Spacing and layout should adapt to each page's content.

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

// ═══════════════════════════════════════════════════════════════════
// ENHANCED PIPELINE 10.1–10.8 DEFAULTS (Opus 4.6)
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_10_1 = `You are an expert local SEO strategist and data analyst. You have been given comprehensive, real-time keyword research data for a local service business.

Your task: Analyze all data below and produce a comprehensive KEYWORD STRATEGY & PRIORITIZATION document with three priority tiers.

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

---

## DATA INPUTS

### INPUT 1: FULL KEYWORD UNIVERSE (DataForSEO — PRIMARY DATA SOURCE)
{{KEYWORD_UNIVERSE_DATA}}

{{#if SEED_KEYWORDS}}
### INPUT 2: SEED KEYWORD EXPANSION (Claude-generated tier classification)
{{SEED_KEYWORDS}}
{{/if}}

---

## DELIVERABLE: KEYWORD STRATEGY & PRIORITIZATION
[SITE BUILD]

**A. Priority Tier Classification**
Organize all relevant keywords into three tiers. Present each tier as a table:

| Keyword | Monthly Volume | Difficulty | Intent | CPC | Recommended Content Type |

**Priority Tier 1 — Core Targets (Build First)**
High volume + transactional or commercial intent + difficulty under 55.

**Priority Tier 2 — Growth Targets (Build at Launch)**
Secondary services, additional service area cities, comparison searches.

**Priority Tier 3 — Content & Long-Tail (Ongoing Publishing)**
[OWNER ACTION]
Informational, research-phase, and long-tail specialty searches.

**B. Low-Hanging Fruit Keywords**
Keywords meeting ALL criteria: difficulty under 35, volume over 50/month, competitors beatable.

**C. Keywords to Deprioritize**
Difficulty above 70 with national brands in top 3, intent mismatch, zero commercial intent.

**D. Seasonal & Trend Considerations**
Using monthly_trends data: which clusters show seasonality? Peak months? Growing or declining?

**E. Paid Search Signal Analysis**
Highest CPC keywords, keywords with paid ads in SERP, high-CPC lower-difficulty opportunities.

---

## OUTPUT FORMAT
- Use tables for all keyword data and comparisons
- Name specific keywords, numbers, and competitors — no placeholders
- Flag data gaps where recommendations are based on best practice vs data`;

const DEFAULT_10_2 = `You are a competitive intelligence analyst with access to REAL market data from DataForSEO.

Your task: Produce two integrated deliverables:
1. SECTION 1: MARKET OPPORTUNITY SNAPSHOT — A data-driven picture of this business's current position and potential.
2. SECTION 2: COMPETITIVE ANALYSIS & GAPS — Per-competitor breakdown with specific, actionable gaps to exploit.

Label every recommendation:
[SITE BUILD] — Will be automatically implemented when the AI builds the site.
[OWNER ACTION] — Requires ongoing human effort after the site launches.

CRITICAL: Use REAL numbers from the data. Name specific domains, keywords, volumes, and rankings.

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Service Area:** {{SERVICE_AREA}} mile radius
- **Target Audience:** {{TARGET_AUDIENCE}}
- **Years in Business:** {{YEARS_IN_BUSINESS}}
- **Website:** {{WEBSITE_URL}}
- **Target Customer Type:** {{TARGET_CUSTOMER_TYPE}}

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

{{#if COMPETITOR_TECH_DATA}}
### INPUT 8: COMPETITOR TECHNICAL AUDIT
Includes: domain configuration (CMS, SSL, sitemap, robots.txt), crawl summary, Lighthouse scores, issue counts, non-indexable pages, duplicate tags, redirect chains, schema types, link analysis, resource audit (scripts, CSS, broken), top keyword phrases (density), content structure (main topic, headings, contact info).
{{COMPETITOR_TECH_DATA}}
{{/if}}

{{#if BACKLINK_DATA}}
### INPUT 9: BACKLINK PROFILE (Advanced Tier)
{{BACKLINK_DATA}}
{{/if}}

### INPUT 10: QUALITATIVE COMPETITIVE RESEARCH (Tavily — context only)
{{PHASE1_SOURCES}}

---

## DELIVERABLE

### SECTION 1: MARKET OPPORTUNITY SNAPSHOT

**1A. Total Keyword Opportunity**
- Total keywords in universe and total addressable monthly traffic
- Breakdown by intent: transactional vs commercial vs informational vs navigational (with volumes)
- Realistic organic traffic capture estimate at 90 days
- Realistic organic traffic capture estimate at 6 months

**1B. Market Competitiveness (Rate 1–10)**
Justify using: average keyword difficulty, competitor domain authority distribution, local pack saturation, whether national brands dominate SERPs.

**1C. Current Business Position**
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

For each major competitor (top 5–8):
- Authority & Traffic, SERP Dominance, Local Pack Position
- Content Advantage, Technical Strengths & Weaknesses, GBP Weaknesses

**Cross-Competitor Summary**

**Top Keyword Gaps:**
| Keyword | Volume | Difficulty | Ranking Competitor | Their Position | Opportunity |

**Top Content Gaps:** 5–8 specific areas with rationale.

**Backlink Gap Opportunities:** [OWNER ACTION]
Domains linking to competitors but not this business.

{{#if BACKLINK_DATA}}
**2G. Backlink Competitive Intelligence** [OWNER ACTION]
Using the expanded backlink data provided:
- **Authority Comparison Table:** Compare this business vs each competitor using rank, total backlinks, referring domains, new/lost velocity from the bulk comparison data.
- **Network Diversity Assessment:** Evaluate whether the business's backlink profile is concentrated in few subnets/IPs vs competitors' diversity.
- **Link Gap Analysis (Domain + Page Level):** Identify the most valuable domains AND specific pages linking to competitors but not this business. Prioritize by rank and relevance to the industry.
- **Spam Risk Assessment:** Flag if the business has high-spam referring domains that could trigger penalties, and how this compares to competitors.
- **Historical Momentum:** Is the business gaining or losing backlinks over the past 6 months compared to competitors? Quantify the velocity gap.
- **Content That Attracts Links:** From per-page backlink distribution, identify what types of content/pages attract the most backlinks for this business and competitors.
{{/if}}

---

## OUTPUT FORMAT
- Tables for keyword gaps and competitor comparisons
- Every claim backed by specific data from the inputs`;

const DEFAULT_10_3 = `You are an expert SEO content strategist.

Your task: Using the keyword strategy and competitive analysis from prior sub-phases, produce a comprehensive CONTENT STRATEGY with a 12-month blog calendar.

Label every recommendation:
[SITE BUILD] — Will be automatically implemented when the AI builds the site.
[OWNER ACTION] — Requires ongoing human effort after the site launches.

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Services:** {{ALL_SERVICES}}
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

{{#if CITY_SERP_DATA}}
### INPUT 4: PER-CITY SERP DATA
{{CITY_SERP_DATA}}
{{/if}}

### INPUT 5: DOMAIN INTELLIGENCE
{{DOMAIN_INTELLIGENCE_DATA}}

### INPUT 6: REVIEW ANALYTICS
{{REVIEW_DATA}}

### INPUT 7: SEO & CONTENT RESEARCH (Tavily — qualitative only)
{{PHASE2_SOURCES}}

### INPUT 8: SEO BEST PRACTICES
{{SEO_CONTEXT}}

{{#if SEED_KEYWORDS}}
### INPUT 9: SEED KEYWORD DATA
{{SEED_KEYWORDS}}
{{/if}}

---

## DELIVERABLE: CONTENT STRATEGY & BLOG CALENDAR

**A. Topic Cluster Architecture** [SITE BUILD]
Map keyword tiers to content hubs. Define pillar pages and supporting content.

**B. People Also Ask & FAQ Strategy**
Extract PAA questions from SERP data. Map to pages and blog posts.

**C. Location & Service Area Content** [SITE BUILD]
Per-city landing page strategy. Service area content targeting.

**D. 12-Month Blog & Long-Tail Content Calendar** [OWNER ACTION]
Monthly publishing plan with target keywords, topics, and content types.

**E. Credential & Differentiation Content** [SITE BUILD]
Unique selling points, trust signals, and brand story content.

---

## OUTPUT FORMAT
- Tables for all keyword and competitor data
- Specific keywords, numbers, competitors throughout`;

const DEFAULT_10_4 = `You are a conversion rate optimization (CRO) specialist with deep expertise in local service business websites.

Your task: Produce a comprehensive CRO OPTIMIZATION GUIDE with data-backed recommendations for maximizing conversions.

Label every recommendation:
[SITE BUILD] — Will be automatically implemented when the AI builds the site.
[OWNER ACTION] — Requires ongoing human effort after the site launches.

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Target Audience:** {{TARGET_AUDIENCE}}
- **Target Customer Type:** {{TARGET_CUSTOMER_TYPE}}

---

## DATA INPUTS

### INPUT 1: COMPETITIVE ANALYSIS (from 10.2)
{{COMPETITIVE_ANALYSIS_OUTPUT}}

### INPUT 2: CRO & CONVERSION RESEARCH (Tavily — qualitative)
{{PHASE3_SOURCES}}

### INPUT 3: REVIEW ANALYTICS
{{REVIEW_DATA}}

### INPUT 4: DOMAIN INTELLIGENCE
{{DOMAIN_INTELLIGENCE_DATA}}

### INPUT 5: CRO BEST PRACTICES
{{CRO_CONTEXT}}

---

## DELIVERABLE: CRO OPTIMIZATION GUIDE

### 1. Trust Signal Strategy
[SITE BUILD]
- Review/testimonial placement strategy (informed by actual review data)
- Social proof elements (badges, certifications, affiliations)
- Before/after galleries, case studies
- Trust indicators above the fold
- Local trust signals (community involvement, local partnerships)

### 2. Conversion Element Strategy
[SITE BUILD]
- Primary CTA design and placement per page type
- Phone number prominence and click-to-call optimization
- Form design: fields, placement, multi-step vs single
- Chat/messaging integration recommendations
- Urgency and scarcity tactics appropriate for the industry
- Exit intent and scroll-triggered elements

### 3. Page Performance Targets
[SITE BUILD]
- Content length benchmarks per page type (based on competitor analysis)
- Heading structure and keyword density targets
- Image and media requirements
- Above-the-fold content priorities
- Mobile-specific conversion considerations

### 4. Industry-Specific CRO Tactics
[SITE BUILD] + [OWNER ACTION]
- Tactics unique to {{INDUSTRY}} that drive conversions
- Seasonal conversion optimization
- Service-specific landing page recommendations
- Local competitor conversion weaknesses to exploit

---

## OUTPUT FORMAT
- Prioritized recommendations with expected impact (high/medium/low)
- Specific, actionable items — no generic advice
- Reference competitor data and review insights throughout`;

const DEFAULT_10_5 = `You are a local SEO implementation specialist creating a post-launch action plan.

Your task: Using the strategic analysis from prior sub-phases, produce:
1. SECTION 6: 90-DAY OFF-PAGE ROADMAP — Everything the business owner must do after the site launches.
2. SECTION 7: SEO SUCCESS BENCHMARKS — Specific, data-grounded targets for 30/60/90 days.

EVERYTHING in Section 6 is [OWNER ACTION] — requires human effort or third-party tools.

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Phone:** {{PHONE_NUMBER}}
- **Email:** {{CONTACT_EMAIL}}

{{NAP_BLOCK}}

---

## STRATEGIC CONTEXT (from prior analyses)

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
{{DOMAIN_INTELLIGENCE_DATA}}

### SEO READINESS SCORES
{{SCORING_DATA}}

{{#if BACKLINK_DATA}}
### BACKLINK PROFILE (Advanced Tier)
{{BACKLINK_DATA}}
{{/if}}

{{#if QA_DATA}}
### Google Q&A Data
{{QA_DATA}}
{{/if}}

---

## DELIVERABLE

### SECTION 6: 90-DAY OFF-PAGE ROADMAP [OWNER ACTION]
Week 1–2: GBP Foundation, Month 1: Review Momentum & Citation Base, Month 2: Authority & Content Publishing, Month 3: Competitive Push

{{#if BACKLINK_DATA}}
**6E. Backlink Acquisition Strategy** [OWNER ACTION]
Using the expanded backlink data:
- **Outreach Priority List:** From the top individual backlinks and link gap data, create a prioritized list of domains to pursue for link building. Focus on high-rank, low-spam, industry-relevant sources.
- **Content-Driven Link Building:** From per-page backlink distribution, identify which types of content attract the most links and recommend creating similar content.
- **Disavow Recommendations:** If high-spam referring domains are flagged (spam score >50), provide a disavow action plan with the specific domains.
- **Network Diversification:** If concentration risk exists (too many links from few subnets), recommend strategies to diversify the referring network.
- **Link Velocity Targets:** Based on historical trends and competitor velocity, set realistic monthly targets for new backlink acquisition.
- **Competitor Gap Closing Plan:** From domain and page-level link gaps, create a month-by-month plan to close the biggest gap opportunities (target the highest-value domains first).
{{/if}}

### SECTION 7: SEO SUCCESS BENCHMARKS
At 30 Days, At 60 Days, At 90 Days — keyword targets, traffic projections, GBP visibility, revenue potential model

{{#if BACKLINK_DATA}}
Include backlink-specific benchmarks in each time period:
- 30 days: Target referring domain count, disavow cleanup if needed
- 60 days: Target link velocity, network diversity improvement
- 90 days: Target competitor gap closure %, overall authority rank improvement
Base all targets on the historical trend data and current baseline numbers from the backlink profile.
{{/if}}

---

## OUTPUT FORMAT
- Tables for all benchmarks and keyword targets
- Specific numbers throughout
- Flag projections as conservative vs optimistic`;

const DEFAULT_10_6 = `You are a senior SEO architect creating the complete site structure for a local service business.

Your task: Using the strategic analysis from all prior sub-phases, produce a unified site architecture document containing:
1. Complete URL hierarchy (sitemap)
2. Per-page SEO specifications
3. Internal linking map
4. Technical SEO analysis and implementation plan

Every page, URL, keyword assignment, meta tag, and link must be defined here.

{{NAP_BLOCK}}

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Primary Service:** {{PRIMARY_SERVICE}}
- **Services:** {{ALL_SERVICES}}
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

### Off-Page Roadmap
{{OFFPAGE_OUTPUT}}

---

## DATA INPUTS

### TECHNICAL SEO AUDIT
{{TECHNICAL_DATA}}

### SEO AUDIT DATA
{{AUDIT_DATA}}

### SEO & CONTENT RESEARCH (Tavily — qualitative only)
{{PHASE2_SOURCES}}

### SEO BEST PRACTICES
{{SEO_CONTEXT}}

### SCHEMA MARKUP TEMPLATES
{{SCHEMA_TEMPLATES}}

---

## DELIVERABLE: SITE ARCHITECTURE DOCUMENT

### PART 1: URL HIERARCHY & SITEMAP
| # | Page Name | URL Path | Page Type | Primary Keyword | Content Priority |

### PART 2: PER-PAGE SEO SPECIFICATIONS
For EVERY page: Primary Keyword, Secondary Keywords, Title Tag, Meta Description, H1, Schema Markup, Content Requirements, CTA Strategy

### PART 3: INTERNAL LINKING MAP
Page-by-Page Links, Cross-Linking Rules, Link Equity Distribution, Anchor Text Strategy, Navigation Structure

### PART 4: TECHNICAL SEO ANALYSIS
[SITE BUILD]
- Critical Issues (Must Fix)
- High-Priority Warnings
- Schema Gap Analysis
- Technical Competitive Gap
- Page Speed & Core Web Vitals targets
- Crawlability & indexation recommendations`;

const DEFAULT_10_7 = `You are an expert UI/UX designer and brand strategist. Your job is to determine the right design direction for this business's website.

This is NOT a component library or pixel-level spec. This is a strategic design direction document.

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Target Audience:** {{TARGET_AUDIENCE}}
- **Target Customer Type:** {{TARGET_CUSTOMER_TYPE}}
- **Years in Business:** {{YEARS_IN_BUSINESS}}
- **Brand Colors:** {{BRAND_COLORS_LIST}}
- **Brand Fonts:** {{BRAND_FONTS_LIST}}

---

## STRATEGIC CONTEXT
### Keyword Intent Breakdown
{{INTENT_BREAKDOWN}}

### Review Sentiment
{{REVIEW_DATA}}

### Competitive Landscape
{{COMPETITIVE_ANALYSIS_OUTPUT}}

### CRO Guide
{{CRO_GUIDE_OUTPUT}}

### Site Architecture
{{SITE_ARCHITECTURE_OUTPUT}}

---

## DESIGN ARCHETYPE LIBRARY (Reference)

Select ONE primary archetype or blend TWO. Justify your choice.

**1. Clean Minimal** — Generous whitespace, restrained color, typography-driven. Best for: professional services, higher-income clientele.
**2. Bold & Action-Oriented** — High contrast, prominent CTAs, urgency-friendly. Best for: emergency services, high-intent mobile traffic.
**3. Warm & Community** — Rounded corners, friendly palette, real photography. Best for: family-owned businesses, trust-first brands.
**4. Premium / Luxury** — Refined typography, muted palette, elegant spacing. Best for: high-end services, custom builders, med spas.
**5. Modern Professional** — Contemporary grids, bold geometry, data-driven trust signals. Best for: commercial/B2B services.
**6. Tech-Forward** — Gradients, glass morphism, dark sections. Best for: IT, smart home, solar, tech-adjacent trades.
**7. Traditional / Established** — Classic layouts, conservative palette, serif typography. Best for: legal, accounting, 20+ year trades.

**Theme Axis:** Light / Dark / Hybrid
**Density Axis:** Spacious / Balanced / Information-Rich

---

## DELIVERABLE: UI DESIGN & STYLING DIRECTION

1. Design Direction Selection (archetype + theme + density + rationale)
2. Color Palette (hex codes + rationale)
3. Typography Direction (font recommendations + hierarchy approach)
4. Photography & Imagery Direction
5. Conversion Element Treatment (CTA style, forms, phone prominence, trust signals)
6. Design First Principles (5–7 principles specific to THIS site)`;

const DEFAULT_10_8 = `You are an expert technical writer. Create a concise Project Overview document for an AI (Cursor) that will build this website.

# Keyword Strategy & Market Analysis
{{KEYWORD_STRATEGY_OUTPUT}}

# Competitive Analysis
{{COMPETITIVE_ANALYSIS_OUTPUT}}

# Content Strategy
{{CONTENT_STRATEGY_OUTPUT}}

# CRO Guide
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
3. Explains how to use each attached document.
4. States that the builder should follow principles and strategy, not rigid specs.

Format as clear sections.`;

const TEMPLATES: Record<Phase4Subphase, string> = {
  '4.1': DEFAULT_4_1,
  '4.2': DEFAULT_4_2,
  '4.3': DEFAULT_4_3,
  '4.4': DEFAULT_4_4,
  '4.5': DEFAULT_4_5,
  '10.1': DEFAULT_10_1,
  '10.2': DEFAULT_10_2,
  '10.3': DEFAULT_10_3,
  '10.4': DEFAULT_10_4,
  '10.5': DEFAULT_10_5,
  '10.6': DEFAULT_10_6,
  '10.7': DEFAULT_10_7,
  '10.8': DEFAULT_10_8,
};

const META: Record<Phase4Subphase, Phase4DefaultMeta> = {
  '4.1': { name: 'Competitive Intelligence Synthesis', internal_notes: 'Synthesizes Phase 1 Tavily research only (no DataForSEO)' },
  '4.2': { name: 'SEO Strategy Synthesis', internal_notes: 'Synthesizes Phase 2 research + optional DataForSEO keyword data' },
  '4.3': { name: 'CRO Strategy Synthesis', internal_notes: 'Synthesizes Phase 3 research + optional DataForSEO on-page data' },
  '4.4': { name: 'Website Wireframe & Outline', internal_notes: 'Hub-and-spoke page list and structure' },
  '4.5': { name: 'UI Design & Color Palette', internal_notes: 'Design philosophy; no exact spacing/sizes' },
  '10.1': { name: 'Keyword Strategy & Prioritization', internal_notes: 'Keyword-only analysis: 3-tier classification, low-hanging fruit, deprioritization, seasonal trends, paid signals. Variables: KEYWORD_UNIVERSE_DATA, SEED_KEYWORDS' },
  '10.2': { name: 'Market Position + Competitive Analysis & Gaps', internal_notes: 'Market opportunity snapshot (1A-1E) + per-competitor breakdown, keyword/content/backlink gaps, technical infrastructure comparison (CMS, SSL, sitemap), keyword density gaps, content structure differences, resource optimization comparison. Variables: KEYWORD_STRATEGY_OUTPUT, COMPETITOR_DATA, SERP_DATA, REVIEW_DATA, GBP_DATA, DOMAIN_INTELLIGENCE_DATA, SCORING_DATA, COMPETITOR_TECH_DATA, BACKLINK_DATA, PHASE1_SOURCES' },
  '10.3': { name: 'Content Strategy & Blog Calendar', internal_notes: 'Topic clusters, location content, 12-month blog calendar. Variables: KEYWORD_STRATEGY_OUTPUT, COMPETITIVE_ANALYSIS_OUTPUT, SERP_DATA, CITY_SERP_DATA, DOMAIN_INTELLIGENCE_DATA, REVIEW_DATA, PHASE2_SOURCES, SEO_CONTEXT, SEED_KEYWORDS' },
  '10.4': { name: 'CRO Optimization Guide', internal_notes: 'Trust signals, conversion elements, page performance targets, industry-specific CRO. Variables: COMPETITIVE_ANALYSIS_OUTPUT, PHASE3_SOURCES, REVIEW_DATA, DOMAIN_INTELLIGENCE_DATA, TECHNICAL_DATA, CRO_CONTEXT' },
  '10.5': { name: 'Off-Page Roadmap & Benchmarks', internal_notes: '90-day GBP/citation/review/backlink plan + success targets. Variables: KEYWORD_STRATEGY_OUTPUT, COMPETITIVE_ANALYSIS_OUTPUT, CONTENT_STRATEGY_OUTPUT, CRO_GUIDE_OUTPUT, GBP_DATA, REVIEW_DATA, DOMAIN_INTELLIGENCE_DATA, SCORING_DATA, BACKLINK_DATA, NAP_BLOCK, QA_DATA' },
  '10.6': { name: 'Site Architecture + SEO Specs + Linking + Technical SEO', internal_notes: 'URL hierarchy, per-page SEO specs, internal linking map, technical SEO analysis. Now includes: domain config checks, non-indexable page flagging, duplicate content consolidation, keyword density validation, render-blocking resource fixes, content structure from competitor patterns, full resource optimization (scripts, CSS). Variables: KEYWORD_STRATEGY_OUTPUT, COMPETITIVE_ANALYSIS_OUTPUT, CONTENT_STRATEGY_OUTPUT, CRO_GUIDE_OUTPUT, OFFPAGE_OUTPUT, TECHNICAL_DATA, AUDIT_DATA, PHASE2_SOURCES, SEO_CONTEXT, SCHEMA_TEMPLATES, NAP_BLOCK' },
  '10.7': { name: 'UI Design & Styling Direction', internal_notes: 'Design archetype selection, color palette, typography, first principles. Variables: REVIEW_DATA, COMPETITIVE_ANALYSIS_OUTPUT, CRO_GUIDE_OUTPUT, SITE_ARCHITECTURE_OUTPUT, INTENT_BREAKDOWN, BRAND_COLORS_LIST, BRAND_FONTS_LIST' },
  '10.8': { name: 'Project Overview', internal_notes: 'Concise overview for Cursor AI builder. Variables: KEYWORD_STRATEGY_OUTPUT, COMPETITIVE_ANALYSIS_OUTPUT, CONTENT_STRATEGY_OUTPUT, CRO_GUIDE_OUTPUT, SITE_ARCHITECTURE_OUTPUT, UI_DESIGN_OUTPUT' },
};

export function getPhase4DefaultTemplate(subphase: Phase4Subphase): string {
  return TEMPLATES[subphase] ?? '';
}

export function getPhase4DefaultMeta(subphase: Phase4Subphase): Phase4DefaultMeta {
  return META[subphase] ?? { name: `Subphase ${subphase}`, internal_notes: '' };
}
