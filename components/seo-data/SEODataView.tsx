'use client';

import { Component, type ReactNode } from 'react';
import type { UnifiedAuditData } from '@/types/seo-audit';
import { SEOMetaCard } from './SEOMetaCard';
import { BusinessProfileCard } from './BusinessProfileCard';
import { DomainIntelligenceCard } from './DomainIntelligenceCard';
import { ReviewsSection } from './ReviewsSection';
import { QuestionsAnswersSection } from './QuestionsAnswersSection';
import { KeywordUniverseTable } from './KeywordUniverseTable';
import { CompetitorsSection } from './CompetitorsSection';
import { SerpAnalysisSection } from './SerpAnalysisSection';
import { TechnicalAuditSection } from './TechnicalAuditSection';
import { CompetitorTechnicalSection } from './CompetitorTechnicalSection';
import { BacklinksSection } from './BacklinksSection';
import { TavilyResearchSummary } from './TavilyResearchSummary';
import { ScoringCard } from './ScoringCard';

/**
 * Safely convert any value to a renderable string.
 * Prevents React error #31 (objects rendered as children).
 */
export function safeString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return '[object]'; }
  }
  return String(value);
}

class SEODataErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
          <p className="text-red-400 font-medium mb-2">Failed to render SEO data</p>
          <p className="text-gray-400 text-sm">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-3 px-4 py-1.5 rounded bg-red-500/20 text-red-300 text-sm hover:bg-red-500/30 transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export interface SEODataViewProps {
  data: UnifiedAuditData;
  tier?: string;
  /** Pass session.api_costs?.dataforseo so cost/calls show correctly (audit meta is often 0) */
  dataforseoCost?: number;
  dataforseoApiCalls?: number;
}

export function SEODataView({ data, tier, dataforseoCost, dataforseoApiCalls }: SEODataViewProps) {
  if (!data || typeof data !== 'object') return null;

  const isAdvanced = tier === 'advanced';
  const hasBacklinks = isAdvanced && data.backlinks != null;

  return (
    <SEODataErrorBoundary>
      <div className="space-y-0">
        <SEOMetaCard
          data={data}
          dataforseoCost={dataforseoCost}
          dataforseoApiCalls={dataforseoApiCalls}
        />
        <ScoringCard data={data} />
        <BusinessProfileCard data={data} />
        <DomainIntelligenceCard data={data} />
        <ReviewsSection data={data} />
        <QuestionsAnswersSection data={data} />
        <KeywordUniverseTable data={data} />
        <CompetitorsSection data={data} />
        <SerpAnalysisSection data={data} />
        <TechnicalAuditSection data={data} />
        <CompetitorTechnicalSection data={data} />
        {hasBacklinks && <BacklinksSection data={data} />}
        <TavilyResearchSummary data={data} />
      </div>
    </SEODataErrorBoundary>
  );
}
