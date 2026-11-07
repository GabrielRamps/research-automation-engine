/**
 * Claude API Helper with Prompt Caching
 * 
 * This module provides a wrapper around Claude API calls that implements
 * prompt caching for massive cost savings (90% discount on cached tokens).
 * 
 * Used in Phase 4 for page-by-page prompt generation.
 */

import Anthropic from '@anthropic-ai/sdk';
import { updateThinkingProgress } from './phase4-helpers';

/**
 * Cached Context Interface
 * Contains all the large documents that will be cached and reused
 * 
 * NOTE: Claude API has a hard limit of 4 blocks with cache_control.
 * We use 3 blocks to stay under the limit:
 * 1. Strategic Reports (competitive + SEO + CRO combined)
 *    — For Intermediate/Advanced: also includes website architecture + SEO specs
 * 2. Page List (site structure)
 * 3. UI Design System (colors, typography, components)
 */
export interface CachedContext {
  keywordStrategy: string;
  competitiveAnalysis: string;
  contentStrategy: string;
  croGuide: string;
  siteArchitecture: string;
  uiDesign: string;
  // Legacy fields (kept for backward compatibility with basic tier)
  competitiveReport?: string;
  seoGuide?: string;
  pageList?: string;
  schemaMarkupTemplates?: string;
  napBlock?: string;
}

/**
 * Call Claude with Prompt Caching
 * 
 * This function wraps Claude API calls with prompt caching enabled.
 * The cached context (reports, guides, page list, UI design) is marked
 * with cache_control and will be reused across multiple calls, providing
 * 90% cost savings on those tokens.
 * 
 * @param apiKey - Claude API key
 * @param cachedContext - Large documents to cache (reports, guides, etc.)
 * @param userPrompt - The specific prompt for this request (NOT cached)
 * @param sessionId - Session ID for thinking updates
 * @param subphase - Current subphase (e.g., '4.6', '4.7')
 * @param session - Session data for thinking updates
 * @returns Object with thinking and content strings
 */
export async function callClaudeWithCaching(
  apiKey: string,
  cachedContext: CachedContext,
  userPrompt: string,
  sessionId: string,
  subphase: string,
  session: any
): Promise<{ thinking: string; content: string }> {
  const anthropic = new Anthropic({ 
    apiKey, 
    timeout: 600000, // 10 minutes
    maxRetries: 2 
  });

  let thinkingContent = '';
  let outputContent = '';
  let lastThinkingUpdate = 0;

  console.log(`[Phase${subphase}] Calling Claude with caching...`);
  console.log(`[Phase${subphase}] Cached context size: ~${Math.round((
    (cachedContext.keywordStrategy || cachedContext.competitiveReport || '').length +
    (cachedContext.competitiveAnalysis || cachedContext.seoGuide || '').length +
    (cachedContext.contentStrategy || '').length +
    (cachedContext.croGuide || '').length +
    (cachedContext.siteArchitecture || cachedContext.pageList || '').length +
    (cachedContext.uiDesign || '').length
  ) / 4)} tokens`);
  console.log(`[Phase${subphase}] User prompt size: ~${Math.round(userPrompt.length / 4)} tokens`);
  console.log(`[Phase${subphase}] Using 3 cached blocks (under 4-block limit)`);

  // Build strategic block from new pipeline outputs (10.1-10.3) or legacy fields
  let strategicBlock = '# Strategic Research & Analysis\n';
  if (cachedContext.keywordStrategy) {
    strategicBlock += `\n## Keyword Strategy & Market Analysis\n${cachedContext.keywordStrategy}`;
  } else if (cachedContext.competitiveReport) {
    strategicBlock += `\n## Competitive Intelligence Report\n${cachedContext.competitiveReport}`;
  }
  if (cachedContext.competitiveAnalysis) {
    strategicBlock += `\n\n## Competitive Analysis\n${cachedContext.competitiveAnalysis}`;
  } else if (cachedContext.seoGuide) {
    strategicBlock += `\n\n## SEO Strategy Guide\n${cachedContext.seoGuide}`;
  }
  if (cachedContext.contentStrategy) {
    strategicBlock += `\n\n## Content Strategy\n${cachedContext.contentStrategy}`;
  }
  if (cachedContext.croGuide) {
    strategicBlock += `\n\n## CRO Optimization Guide\n${cachedContext.croGuide}`;
  }

  // Build site architecture block (new pipeline) or page list (legacy)
  let siteBlock = cachedContext.siteArchitecture
    ? `# Site Architecture\n\n${cachedContext.siteArchitecture}`
    : `# Page List\n\n${cachedContext.pageList || ''}`;
  if (cachedContext.napBlock) {
    siteBlock += `\n\n${cachedContext.napBlock}`;
  }
  if (cachedContext.schemaMarkupTemplates) {
    siteBlock += `\n\n${cachedContext.schemaMarkupTemplates}`;
  }

  // @ts-ignore - Extended thinking streaming with caching
  const stream = await anthropic.messages.stream({
    model: process.env.CLAUDE_MODEL || 'claude-opus-4-6',
    max_tokens: 32000,
    // @ts-ignore - thinking parameter not in types yet
    thinking: {
      type: 'enabled',
      budget_tokens: 25000
    },
    messages: [{
      role: 'user',
      content: [
        // CACHED BLOCK 1: Combined Strategic Reports
        {
          type: 'text',
          text: strategicBlock,
          cache_control: { type: 'ephemeral' }
        },
        // CACHED BLOCK 2: Site Architecture + NAP + Schema
        {
          type: 'text',
          text: siteBlock,
          cache_control: { type: 'ephemeral' }
        },
        // CACHED BLOCK 3: UI Design System
        {
          type: 'text',
          text: `# UI Design System\n\n${cachedContext.uiDesign}`,
          cache_control: { type: 'ephemeral' }
        },
        // NOT CACHED - This changes per request
        {
          type: 'text',
          text: userPrompt
        }
      ]
    }]
  } as any);

  console.log(`[Phase${subphase}] Streaming started, processing thinking and text blocks...`);

  for await (const event of stream) {
    if (event.type === 'message_delta') {
      const delta = event.delta as { stop_reason?: string };
      if (delta?.stop_reason === 'refusal') {
        throw new Error('Response blocked by content policy (refusal)');
      }
    }
    if (event.type === 'content_block_delta') {
      // @ts-ignore - Handle thinking deltas
      if (event.delta.type === 'thinking_delta') {
        // @ts-ignore
        const slice = event.delta.thinking as string;
        thinkingContent += slice;

        const now = Date.now();
        if (now - lastThinkingUpdate > 500) {
          await updateThinkingProgress(sessionId, subphase, thinkingContent, session);
          lastThinkingUpdate = now;
        }
      }
      // @ts-ignore - Text deltas
      else if (event.delta.type === 'text_delta') {
        // @ts-ignore
        const slice = event.delta.text as string;
        outputContent += slice;
      }
    }
  }

  console.log(`[Phase${subphase}] Claude finished. Thinking: ${thinkingContent.length} chars, Output: ${outputContent.length} chars`);

  // Check for cache usage in response metadata
  // @ts-ignore - Cache usage not in types yet
  const usage = stream.response?.usage;
  if (usage) {
    console.log(`[Phase${subphase}] Token usage:`, {
      input_tokens: usage.input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      output_tokens: usage.output_tokens
    });
    
    if (usage.cache_read_input_tokens > 0) {
      const savings = Math.round((usage.cache_read_input_tokens / (usage.input_tokens + usage.cache_read_input_tokens)) * 100);
      console.log(`[Phase${subphase}] 🎉 Cache hit! ${savings}% of input tokens from cache (90% cost savings)`);
    }
  }

  return { thinking: thinkingContent, content: outputContent };
}

/**
 * Extract Page Names from Site Architecture or Page List
 * 
 * Parses the site architecture output (10.5) or legacy wireframe to extract page names.
 * Handles multiple formats:
 * - Markdown tables: | # | Page Name | URL Path | ...
 * - Numbered lists: 1. Homepage, 2. About Us
 * - Bold page headers: **Homepage — /**
 * 
 * Filters out schema markup, technical notes, and non-page items.
 * 
 * @param siteArchitecture - The site architecture or page list string
 * @returns Array of page names
 */
export function extractPageNames(siteArchitecture: string): string[] {
  const pages: string[] = [];
  
  const NON_PAGE_PATTERNS = [
    /schema/i, /json-?ld/i, /structured\s*data/i, /searchaction/i,
    /breadcrumb(list)?/i, /markup/i, /microdata/i, /open\s*graph/i,
    /og:/i, /meta\s*(tag|description|title)/i, /canonical/i,
    /robots\.txt/i, /noindex/i, /nofollow/i, /hreflang/i,
    /rich\s*snippet/i, /\bseo\s*(spec|requirement|implementation|optimization)/i,
    /\bcta\b/i, /internal\s*link/i, /anchor\s*text/i,
    /\burl\s*(structure|hierarchy|path)/i, /navigation\s*(structure|menu)/i,
    /\bfooter\s*(link|section|content)/i, /\bheader\s*(section|component)/i,
    /trust\s*signal/i, /conversion\s*(element|strategy)/i,
    /keyword\s*(target|mapping|strategy)/i,
    /content\s*(type|strategy|requirement|cluster)/i,
    /link\s*(equity|juice|building)/i, /\badditional\b/i,
    /^\s*sitemap\s*$/i,
  ];

  // Strategy 1: Parse markdown table rows (from 10.5 site architecture)
  // Matches: | 1 | Homepage | / | Homepage | ... or | Homepage | /index | ...
  const tableRows = siteArchitecture.match(/^\|[^|]+\|[^|]+\|[^|]+\|.*$/gm);
  if (tableRows && tableRows.length > 0) {
    for (const row of tableRows) {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;
      // Skip header rows (contain dashes or header keywords)
      if (cells.some(c => /^[-:]+$/.test(c))) continue;
      if (cells.some(c => /^(#|Page Name|URL|Page Type|Primary Keyword|Content Priority)$/i.test(c))) continue;
      
      // The page name is typically the 2nd cell (after # column) or 1st if no # column
      let pageName = cells.length >= 3 && /^\d+$/.test(cells[0]) ? cells[1] : cells[0];
      pageName = pageName.replace(/\*\*/g, '').replace(/`/g, '').trim();
      
      if (pageName && pageName.length <= 80 && !pageName.includes('---')) {
        pages.push(pageName);
      }
    }
  }

  // Strategy 2: Parse bold page headers (from per-page SEO specs section)
  // Matches: **Homepage — /** or **About Us — /about/**
  if (pages.length === 0) {
    const boldHeaders = siteArchitecture.match(/\*\*(.+?)\s*[—–-]\s*\/[^*]*\*\*/g);
    if (boldHeaders && boldHeaders.length > 0) {
      for (const header of boldHeaders) {
        const pageName = header.replace(/\*\*/g, '').replace(/\s*[—–-]\s*\/.*$/, '').trim();
        if (pageName && pageName.length <= 80) {
          pages.push(pageName);
        }
      }
    }
  }

  // Strategy 3: Parse numbered list items (legacy wireframe format)
  if (pages.length === 0) {
    const numberedMatches = siteArchitecture.match(/^\s*\d+\.\s+(.+?)(?:\s*-\s*.*)?$/gm);
    if (numberedMatches && numberedMatches.length > 0) {
      for (const match of numberedMatches) {
        const pageName = match
          .replace(/^\s*\d+\.\s+/, '')
          .replace(/\s*-\s*.*$/, '')
          .replace(/\s*\(.*?\)\s*$/, '')
          .replace(/\*\*/g, '')
          .trim();
        if (pageName && pageName.length <= 80 && !pageName.includes('[')) {
          pages.push(pageName);
        }
      }
    }
  }

  // Filter out non-page items
  const filtered = pages.filter(pageName => {
    const isNonPage = NON_PAGE_PATTERNS.some(pattern => pattern.test(pageName));
    if (isNonPage) {
      console.log(`[extractPageNames] Filtered out non-page item: "${pageName}"`);
    }
    return !isNonPage;
  });

  // Deduplicate (case-insensitive)
  const seen = new Set<string>();
  const deduped = filtered.filter(page => {
    const key = page.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const MAX_PAGES = 30;
  if (deduped.length > MAX_PAGES) {
    console.warn(`[extractPageNames] Capping pages from ${deduped.length} to ${MAX_PAGES}`);
  }
  const finalPages = deduped.slice(0, MAX_PAGES);
  
  if (finalPages.length === 0) {
    console.warn('[extractPageNames] Could not parse page list, using default pages');
    return ['Homepage', 'About Us', 'Services', 'Contact'];
  }
  
  console.log(`[extractPageNames] Extracted ${finalPages.length} pages:`, finalPages);
  return finalPages;
}
