/**
 * Intent-Based Keyword Classifier
 *
 * Classifies keywords using DataForSEO intent labels + phrase-based
 * sub-classification for informational keywords. Applies per-intent
 * minimum search volume (MSV) thresholds to decide keep/filter.
 *
 * Decision tree:
 *   1. DIY phrases → always filter out (regardless of volume)
 *   2. transactional → keep if >= 10 MSV
 *   3. commercial → keep if >= 50 MSV
 *   4. informational + commercial-adjacent phrases → keep if >= 50 MSV (flag: faq_service_page)
 *   5. informational + pure educational phrases → keep if >= 500 MSV (flag: blog_content_only)
 *   6. informational (no sub-match) → keep if >= 50 MSV (flag: faq_service_page)
 *   7. navigational → keep if >= 100 MSV
 *   8. unclassified/unknown → keep if >= 10 MSV (default: service_page)
 */

import { logger } from './logger';

// ─── Content Flag Type ───────────────────────────────────────────

export type ContentFlag = 'service_page' | 'faq_service_page' | 'blog_content_only';

// ─── Classification Result ───────────────────────────────────────

export interface ClassificationResult {
  keep: boolean;
  content_flag: ContentFlag | null;
  filter_reason: string | null;
}

// ─── Filter Stats ────────────────────────────────────────────────

export interface FilterStats {
  raw: number;
  zero_volume: number;
  diy: number;
  low_volume_transactional: number;
  low_volume_commercial: number;
  low_volume_informational_adjacent: number;
  low_volume_informational_educational: number;
  low_volume_navigational: number;
  low_volume_unclassified: number;
  kept: number;
}

// ─── DIY Blocklist (always filter out) ───────────────────────────

const DIY_PHRASES = [
  'how to fix your own',
  'diy ',
  ' diy',
  'do it myself',
  'without a professional',
  'without hiring',
  ' yourself',
  'do it yourself',
];

// ─── Informational Sub-Classifier Phrases ────────────────────────

/** Commercial-adjacent: pricing, process, evaluation — bottom-of-funnel researchers */
const COMMERCIAL_ADJACENT_PHRASES = [
  'how much',
  'cost of',
  'price of',
  'average cost',
  'what does it cost',
  'how long does',
  'what to expect',
  'is it worth',
  'do i need',
  'how do i know if',
  'signs i need',
  'when should i replace',
  'what happens when',
  'how does ',
  'what is included in',
  'when to call',
  'when to hire',
  'signs you need',
  'do you need',
  'should i get',
  'should i replace',
  'is it time to',
  'when to replace',
  'when should i',
  'what to look for',
];

/** Pure educational: no buying intent, only worth pursuing at high volume for blog content */
const PURE_EDUCATIONAL_PHRASES = [
  'how to ',
  'what is a ',
  'what is the ',
  'what are ',
  'why does ',
  'why do ',
  'why is ',
  'can i ',
  'can you ',
  'step by step',
  'tutorial',
  'guide to',
  'tips for',
  'learn about',
  'learn how',
  'difference between',
  'types of ',
  'history of',
  'basics of',
];

// ─── Phrase Matching Helpers ─────────────────────────────────────

function matchesAny(keyword: string, phrases: string[]): boolean {
  for (const phrase of phrases) {
    if (keyword.includes(phrase)) return true;
  }
  return false;
}

// ─── Core Classifier ─────────────────────────────────────────────

/**
 * Classify a single keyword by its DataForSEO intent label and search volume.
 * Returns whether to keep it, what content_flag to assign, and filter reason if dropped.
 */
export function classifyKeywordIntent(
  keyword: string,
  searchVolume: number,
  intentLabel: string
): ClassificationResult {
  const lower = keyword.toLowerCase();
  const intent = (intentLabel || 'unknown').toLowerCase();
  const vol = searchVolume || 0;

  // ── Step 1: Always filter DIY regardless of intent or volume ──
  if (matchesAny(lower, DIY_PHRASES)) {
    return { keep: false, content_flag: null, filter_reason: 'diy' };
  }

  // ── Step 2: Apply per-intent MSV thresholds ──

  switch (intent) {
    case 'transactional':
      if (vol >= 10) {
        return { keep: true, content_flag: 'service_page', filter_reason: null };
      }
      return { keep: false, content_flag: null, filter_reason: 'low_volume_transactional' };

    case 'commercial':
      if (vol >= 50) {
        return { keep: true, content_flag: 'service_page', filter_reason: null };
      }
      return { keep: false, content_flag: null, filter_reason: 'low_volume_commercial' };

    case 'informational':
      // Sub-classify: commercial-adjacent vs pure educational
      // Check commercial-adjacent FIRST (more specific patterns like "how much" before "how to")
      if (matchesAny(lower, COMMERCIAL_ADJACENT_PHRASES)) {
        if (vol >= 50) {
          return { keep: true, content_flag: 'faq_service_page', filter_reason: null };
        }
        return { keep: false, content_flag: null, filter_reason: 'low_volume_informational_adjacent' };
      }
      if (matchesAny(lower, PURE_EDUCATIONAL_PHRASES)) {
        if (vol >= 500) {
          return { keep: true, content_flag: 'blog_content_only', filter_reason: null };
        }
        return { keep: false, content_flag: null, filter_reason: 'low_volume_informational_educational' };
      }
      // Informational with no sub-match: default to commercial-adjacent threshold
      if (vol >= 50) {
        return { keep: true, content_flag: 'faq_service_page', filter_reason: null };
      }
      return { keep: false, content_flag: null, filter_reason: 'low_volume_informational_adjacent' };

    case 'navigational':
      if (vol >= 100) {
        return { keep: true, content_flag: 'service_page', filter_reason: null };
      }
      return { keep: false, content_flag: null, filter_reason: 'low_volume_navigational' };

    default:
      // Unknown / unclassified: treat as transactional (most lenient)
      if (vol >= 10) {
        return { keep: true, content_flag: 'service_page', filter_reason: null };
      }
      return { keep: false, content_flag: null, filter_reason: 'low_volume_unclassified' };
  }
}

// ─── Batch Filter ────────────────────────────────────────────────

export interface KeywordWithIntent {
  keyword: string;
  search_volume: number;
  intent_label: string;
  [key: string]: any;
}

export interface FilterResult<T> {
  kept: T[];
  stats: FilterStats;
}

/**
 * Filter an array of keywords using intent-based classification.
 * Each keyword must have `keyword`, `search_volume`, and `intent_label` fields.
 * Returns the kept keywords (with `content_flag` and `search_intent` attached)
 * and filter statistics for logging.
 */
export function filterKeywordsByIntent<T extends KeywordWithIntent>(
  keywords: T[],
  rawCount?: number
): FilterResult<T & { content_flag: ContentFlag | null; search_intent: string }> {
  const stats: FilterStats = {
    raw: rawCount ?? keywords.length,
    zero_volume: (rawCount ?? keywords.length) - keywords.length,
    diy: 0,
    low_volume_transactional: 0,
    low_volume_commercial: 0,
    low_volume_informational_adjacent: 0,
    low_volume_informational_educational: 0,
    low_volume_navigational: 0,
    low_volume_unclassified: 0,
    kept: 0,
  };

  const kept: (T & { content_flag: ContentFlag | null; search_intent: string })[] = [];

  for (const kw of keywords) {
    const result = classifyKeywordIntent(kw.keyword, kw.search_volume, kw.intent_label);

    if (result.keep) {
      kept.push({
        ...kw,
        content_flag: result.content_flag,
        search_intent: kw.intent_label || 'unknown',
      });
    } else if (result.filter_reason) {
      const reason = result.filter_reason as keyof FilterStats;
      if (reason in stats && typeof stats[reason] === 'number') {
        (stats[reason] as number)++;
      }
    }
  }

  stats.kept = kept.length;

  logger.debug(
    `[KeywordClassifier] Filtered ${stats.raw} → ${stats.kept} keywords ` +
    `(zero_vol=${stats.zero_volume}, diy=${stats.diy}, ` +
    `low_txn=${stats.low_volume_transactional}, low_com=${stats.low_volume_commercial}, ` +
    `low_info_adj=${stats.low_volume_informational_adjacent}, ` +
    `low_info_edu=${stats.low_volume_informational_educational}, ` +
    `low_nav=${stats.low_volume_navigational}, low_unk=${stats.low_volume_unclassified})`
  );

  return { kept, stats };
}
