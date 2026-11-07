/**
 * Default "Build Your Site" master prompt.
 * Displayed on the results page for users to copy into Claude with their research files.
 * Admin-editable via the "Build" tab in /admin/research-prompts.
 * Stored in admin_config with key 'build_site_master_prompt'.
 */

export const BUILD_SITE_MASTER_PROMPT_DEFAULT = `You are an expert web developer and AI prompt engineer. I'm going to give you a set of research and strategy documents that were generated for a local business website project. Your job is to read through ALL of the attached files and create a complete set of sequential build prompts that I can use in Cursor, Claude Code, or another AI coding assistant to build the entire website from scratch.

## What You'll Receive

The attached files contain:
- **Keyword Strategy** — Target keywords, search volumes, and prioritization tiers
- **Competitive Analysis** — Competitor breakdown, market positioning, and gaps
- **Content Strategy** — Topic clusters, content calendar, and page-level content direction
- **CRO Guide** — Conversion optimization recommendations, trust signals, and CTAs
- **Off-Page Roadmap** — Local SEO, citations, GBP optimization, and review strategy
- **Site Architecture** — URL hierarchy, page structure, internal linking map, and per-page SEO specs
- **UI Design Direction** — Design archetype, color palette, typography, and styling principles
- **Project Overview** — Concise summary of the entire project for an AI builder

Some files may also include raw SEO data (keyword volumes, competitor rankings, on-page audit results).

## Your Task

Create a numbered sequence of build prompts (one per step) that, when executed in order in an AI coding tool, will build the complete website. Each prompt should:

1. **Reference specific files** — Tell the AI builder which research files to look at for context (e.g., "Refer to the Site Architecture document for this page's URL, meta title, meta description, and heading structure")
2. **Be self-contained** — Each prompt should include enough context and instructions to complete its step without ambiguity
3. **Build incrementally** — Each step should build on the previous ones
4. **Include all technical details** — Framework setup, folder structure, component architecture, styling tokens, responsive breakpoints, SEO meta tags, schema markup, etc.

## Prompt Sequence Structure

Generate prompts in this order:

### Setup & Foundation
- **Prompt 1**: Project scaffolding (Next.js/framework setup, Tailwind config, folder structure, dependencies)
- **Prompt 2**: Design system setup (global styles, color palette from UI Design file, typography scale, component tokens, responsive breakpoints)
- **Prompt 3**: Layout components (header, footer, navigation, responsive mobile menu, overall page shell)

### Core Pages
- **Prompt 4+**: One prompt per page defined in the Site Architecture document. For each page:
  - Reference the Site Architecture file for URL, meta tags, heading structure
  - Reference the Keyword Strategy for target keywords to weave into content
  - Reference the Content Strategy for content direction and messaging
  - Reference the CRO Guide for conversion elements, CTAs, and trust signals
  - Reference the UI Design Direction for visual treatment
  - Include specific sections, components, and content blocks for that page
  - Include SEO meta tags, Open Graph tags, and JSON-LD schema markup

### Blog & Content
- **Blog template prompt**: Blog listing page + individual post template with proper SEO
- **Seed content prompt**: 2-3 starter blog posts based on the Content Strategy calendar

### Technical SEO & Polish
- **SEO infrastructure prompt**: Sitemap generation, robots.txt, canonical URLs, internal linking implementation
- **Performance prompt**: Image optimization, lazy loading, Core Web Vitals optimization
- **Schema markup prompt**: Organization schema, Local Business schema, BreadcrumbList, FAQ schema where applicable

## Important Rules

- Use the EXACT colors, fonts, and design tokens from the UI Design Direction file
- Use the EXACT URL structure from the Site Architecture file
- Use the EXACT keywords and meta descriptions from the Keyword Strategy and Site Architecture files
- Each prompt should tell the AI builder to reference the relevant attached files by name
- Make prompts detailed enough that someone with no context about the business could execute them
- Optimize for a local business website that needs to rank well in local search results
- Include mobile-responsive design in every prompt
- Include accessibility best practices (ARIA labels, semantic HTML, proper heading hierarchy)

Now read through all of the attached research files and generate the complete prompt sequence.`;
