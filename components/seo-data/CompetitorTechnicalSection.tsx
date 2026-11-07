'use client';

import { useState } from 'react';
import { Users, ChevronDown, ChevronUp, Info, AlertTriangle } from 'lucide-react';
import type { UnifiedAuditData, CompetitorTechnicalEntry } from '@/types/seo-audit';
import { safeString } from './SEODataView';

const cardClass = 'bg-navy-deep/50 p-4 rounded-lg mb-4 border border-white/10 backdrop-blur-sm';
const iconClass = 'w-5 h-5 shrink-0 text-gray-300';

const METRIC_DEFINITIONS: Record<string, string> = {
  'Domain Rank': 'DataForSEO authority metric (0–1000). Higher means more authoritative based on backlink profile and traffic.',
  'Organic Traffic': 'Estimated monthly visitors from unpaid Google search results.',
  'Organic Keywords': 'Total number of keywords the domain currently ranks for in Google.',
  'On-Page Score': 'DataForSEO technical SEO health score (0–100) based on crawl issues, meta tags, and page structure.',
  'Perf (Desktop)': 'Google Lighthouse performance score (0–100) measuring page load speed on desktop.',
  'Perf (Mobile)': 'Google Lighthouse performance score (0–100) measuring page load speed on mobile.',
  'SEO Score': 'Google Lighthouse SEO audit score (0–100) for meta tags, crawlability, and structured data.',
  'Accessibility': 'Google Lighthouse accessibility score (0–100) for screen readers, contrast, and ARIA compliance.',
  'Backlinks': 'Total number of external links from other websites pointing to this domain.',
};

/** Core Web Vitals thresholds per Google */
function cwvColor(metric: 'lcp' | 'fid' | 'cls' | 'fcp' | 'tbt', value: number): string {
  const thresholds: Record<string, [number, number]> = {
    lcp: [2500, 4000],
    fid: [100, 300],
    cls: [0.1, 0.25],
    fcp: [1800, 3000],
    tbt: [200, 600],
  };
  const [good, poor] = thresholds[metric] ?? [0, 0];
  if (value <= good) return 'text-green-400';
  if (value <= poor) return 'text-yellow-400';
  return 'text-red-400';
}

function formatCwv(metric: 'lcp' | 'fid' | 'cls' | 'fcp' | 'tbt' | 'si' | 'tti', value: number | undefined): string {
  if (value == null) return '--';
  if (metric === 'cls') return value.toFixed(3);
  if (metric === 'lcp' || metric === 'fcp' || metric === 'si' || metric === 'tti') return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function scoreColor(score: number | undefined): string {
  if (score == null) return 'text-gray-500';
  if (score >= 90) return 'text-green-400';
  if (score >= 50) return 'text-yellow-400';
  return 'text-red-400';
}

function MetricLabel({ label }: { label: string }) {
  const definition = METRIC_DEFINITIONS[label];
  if (!definition) return <span>{label}</span>;

  return (
    <span className="inline-flex items-center gap-1 group relative">
      {label}
      <span className="relative">
        <Info className="w-3 h-3 text-gray-500 cursor-help" />
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 px-2.5 py-1.5 rounded bg-gray-900 border border-white/10 text-gray-300 text-xs leading-relaxed opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-10 whitespace-normal">
          {definition}
        </span>
      </span>
    </span>
  );
}

function hasCrawlData(comp: CompetitorTechnicalEntry): boolean {
  return !!(comp.crawl_summary || comp.link_analysis || comp.image_audit || comp.schema_markup || comp.domain_info);
}

function BoolBadge({ value }: { value: boolean | undefined }) {
  if (value === true) return <span className="text-green-400 text-xs">Yes</span>;
  if (value === false) return <span className="text-red-400 text-xs">No</span>;
  return <span className="text-gray-500 text-xs">--</span>;
}

function CompetitorDetailCard({ comp }: { comp: CompetitorTechnicalEntry }) {
  const [expanded, setExpanded] = useState(false);
  const crawlIncomplete = !hasCrawlData(comp);

  return (
    <div className="border border-white/5 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-white/5 transition-colors"
      >
        <div className="min-w-0 flex items-center gap-2">
          <div>
            <span className="text-gray-200 font-medium text-sm truncate block">{safeString(comp.business_name || comp.domain)}</span>
            <span className="text-gray-500 text-xs">{safeString(comp.domain)}</span>
          </div>
          {crawlIncomplete && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 text-[10px] shrink-0">
              <AlertTriangle className="w-3 h-3" />
              Crawl incomplete
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-3 text-sm border-t border-white/5 pt-3">
          {crawlIncomplete && (
            <p className="text-yellow-400/80 text-xs flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              On-page crawl did not finish in time. Links, images, and schema data are unavailable for this competitor.
            </p>
          )}
          {comp.schema_markup && comp.schema_markup.existing_schemas.length > 0 && (
            <div>
              <h5 className="text-gray-400 mb-1">Schema markup</h5>
              <div className="flex flex-wrap gap-1">
                {comp.schema_markup.existing_schemas.map(s => (
                  <span key={s} className="px-2 py-0.5 rounded bg-white/5 text-gray-300 text-xs">{s}</span>
                ))}
              </div>
            </div>
          )}
          {comp.issues_count && (
            <div>
              <h5 className="text-gray-400 mb-1">Issues</h5>
              <p className="text-gray-300">
                Critical: <span className="text-red-400">{comp.issues_count.critical}</span> · Warnings: <span className="text-yellow-400">{comp.issues_count.warnings}</span> · Notices: {comp.issues_count.notices}
              </p>
            </div>
          )}
          {comp.link_analysis && (
            <div>
              <h5 className="text-gray-400 mb-1">Links</h5>
              <p className="text-gray-300">
                Internal: {comp.link_analysis.internal_links.toLocaleString()} · External: {comp.link_analysis.external_links.toLocaleString()} · Broken: {comp.link_analysis.broken_links_count}
              </p>
            </div>
          )}
          {comp.image_audit && (
            <div>
              <h5 className="text-gray-400 mb-1">Images</h5>
              <p className="text-gray-300">
                Total: {comp.image_audit.total_images} · Missing alt: {comp.image_audit.missing_alt} · Oversized: {comp.image_audit.oversized}
              </p>
            </div>
          )}
          {comp.domain_info && (
            <div>
              <h5 className="text-gray-400 mb-1">Domain configuration</h5>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span>SSL: <BoolBadge value={comp.domain_info.ssl} /></span>
                <span>Sitemap: <BoolBadge value={comp.domain_info.has_sitemap} /></span>
                <span>Robots.txt: <BoolBadge value={comp.domain_info.has_robots_txt} /></span>
                <span>HTTPS: <BoolBadge value={comp.domain_info.is_https_redirect} /></span>
                <span>Canonical: <BoolBadge value={comp.domain_info.canonicalization} /></span>
                {comp.domain_info.cms && <span className="text-gray-500">CMS: {safeString(comp.domain_info.cms)}</span>}
              </div>
            </div>
          )}
          {comp.non_indexable && comp.non_indexable.total > 0 && (
            <div>
              <h5 className="text-gray-400 mb-1">Non-indexable pages ({comp.non_indexable.total})</h5>
              <div className="flex flex-wrap gap-1">
                {Object.entries(comp.non_indexable.by_reason).map(([reason, count]) => (
                  <span key={reason} className="bg-red-500/10 text-red-300 px-2 py-0.5 rounded text-xs">
                    {reason}: {count as number}
                  </span>
                ))}
              </div>
            </div>
          )}
          {comp.duplicate_tags && (
            <div>
              <h5 className="text-gray-400 mb-1">Duplicate tags</h5>
              <p className="text-gray-300 text-xs">
                Titles: {comp.duplicate_tags.titles_count} · Descriptions: {comp.duplicate_tags.descriptions_count}
              </p>
            </div>
          )}
          {comp.redirect_chains && comp.redirect_chains.total > 0 && (
            <div>
              <h5 className="text-gray-400 mb-1">Redirect chains</h5>
              <p className="text-gray-300 text-xs">{comp.redirect_chains.total} chain{comp.redirect_chains.total > 1 ? 's' : ''}</p>
            </div>
          )}
          {comp.resource_audit && (
            <div>
              <h5 className="text-gray-400 mb-1">Resources</h5>
              <p className="text-gray-300 text-xs">
                Scripts: {comp.resource_audit.scripts.total} ({(comp.resource_audit.scripts.total_size / 1024).toFixed(0)}KB) · CSS: {comp.resource_audit.stylesheets.total} ({(comp.resource_audit.stylesheets.total_size / 1024).toFixed(0)}KB) · Broken: {comp.resource_audit.broken_count}
              </p>
            </div>
          )}
          {comp.keyword_density?.top_terms && comp.keyword_density.top_terms.length > 0 && (
            <div>
              <h5 className="text-gray-400 mb-1">Top keywords</h5>
              <div className="flex flex-wrap gap-1">
                {comp.keyword_density.top_terms.slice(0, 10).map((k, i) => (
                  <span key={i} className="bg-blue-500/10 text-blue-300 px-2 py-0.5 rounded text-xs">
                    &quot;{k.keyword}&quot; ({k.frequency}x)
                  </span>
                ))}
              </div>
            </div>
          )}
          {comp.content_structure && (
            <div>
              <h5 className="text-gray-400 mb-1">Content structure</h5>
              <p className="text-gray-300 text-xs">
                Topic: {safeString(comp.content_structure.main_topic) || '—'} · Headings: {comp.content_structure.heading_count} · Contact info: {comp.content_structure.has_contact_info ? 'Yes' : 'No'}
              </p>
            </div>
          )}
          {comp.lighthouse?.desktop?.core_web_vitals && (
            <div>
              <h5 className="text-gray-400 mb-1">Core Web Vitals (Desktop)</h5>
              <div className="grid grid-cols-3 gap-2">
                {(['lcp', 'fid', 'cls'] as const).map(m => {
                  const val = comp.lighthouse!.desktop!.core_web_vitals![m];
                  return (
                    <div key={m}>
                      <span className="text-gray-500 text-xs uppercase">{m}</span>
                      <span className={`ml-1 text-xs font-mono ${cwvColor(m, val)}`}>{formatCwv(m, val)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {comp.lighthouse?.mobile?.core_web_vitals && (
            <div>
              <h5 className="text-gray-400 mb-1">Core Web Vitals (Mobile)</h5>
              <div className="grid grid-cols-3 gap-2">
                {(['lcp', 'fid', 'cls'] as const).map(m => {
                  const val = comp.lighthouse!.mobile!.core_web_vitals![m];
                  return (
                    <div key={m}>
                      <span className="text-gray-500 text-xs uppercase">{m}</span>
                      <span className={`ml-1 text-xs font-mono ${cwvColor(m, val)}`}>{formatCwv(m, val)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CompetitorTechnicalSection({ data }: { data: UnifiedAuditData }) {
  const competitors = data.competitor_technical_audit;
  if (!competitors || competitors.length === 0) return null;

  const userDi = data.domain_intelligence;
  const userTa = data.technical_audit;
  const hasDomain = !!data.meta?.domain;

  type MetricRow = {
    label: string;
    userValue: string;
    competitorValues: string[];
    highlight?: 'high-is-good' | 'low-is-good';
  };

  const getNum = (v: number | undefined | null): string =>
    v != null ? v.toLocaleString() : '--';

  const getScore = (v: number | undefined | null): string =>
    v != null ? String(Math.round(v)) : '--';

  const rows: MetricRow[] = [
    {
      label: 'Domain Rank',
      userValue: hasDomain ? getNum(userDi?.domain_rank) : '--',
      competitorValues: competitors.map(c => getNum(c.domain_rank?.domain_rank)),
      highlight: 'high-is-good',
    },
    {
      label: 'Organic Traffic',
      userValue: hasDomain ? getNum(userDi?.organic_traffic) : '--',
      competitorValues: competitors.map(c => getNum(c.domain_rank?.organic_traffic)),
      highlight: 'high-is-good',
    },
    {
      label: 'Organic Keywords',
      userValue: hasDomain ? getNum(userDi?.organic_keywords_count) : '--',
      competitorValues: competitors.map(c => getNum(c.domain_rank?.organic_keywords_count)),
      highlight: 'high-is-good',
    },
    {
      label: 'On-Page Score',
      userValue: hasDomain ? getScore(userTa?.crawl_summary?.avg_onpage_score) : '--',
      competitorValues: competitors.map(c => getScore(c.crawl_summary?.avg_onpage_score)),
      highlight: 'high-is-good',
    },
    {
      label: 'Perf (Desktop)',
      userValue: hasDomain ? getScore((userDi?.lighthouse?.desktop as any)?.performance) : '--',
      competitorValues: competitors.map(c => getScore(c.lighthouse?.desktop?.performance)),
      highlight: 'high-is-good',
    },
    {
      label: 'Perf (Mobile)',
      userValue: hasDomain ? getScore((userDi?.lighthouse?.mobile as any)?.performance) : '--',
      competitorValues: competitors.map(c => getScore(c.lighthouse?.mobile?.performance)),
      highlight: 'high-is-good',
    },
    {
      label: 'SEO Score',
      userValue: hasDomain ? getScore((userDi?.lighthouse?.desktop as any)?.seo) : '--',
      competitorValues: competitors.map(c => getScore(c.lighthouse?.desktop?.seo)),
      highlight: 'high-is-good',
    },
    {
      label: 'Accessibility',
      userValue: hasDomain ? getScore((userDi?.lighthouse?.desktop as any)?.accessibility) : '--',
      competitorValues: competitors.map(c => getScore(c.lighthouse?.desktop?.accessibility)),
      highlight: 'high-is-good',
    },
    {
      label: 'Backlinks',
      userValue: hasDomain ? getNum(userDi?.backlinks_count) : '--',
      competitorValues: competitors.map(c => getNum(c.domain_rank?.backlinks)),
      highlight: 'high-is-good',
    },
    {
      label: 'Non-Indexable',
      userValue: hasDomain ? getNum((userTa as any)?.non_indexable?.total ?? 0) : '--',
      competitorValues: competitors.map(c => getNum(c.non_indexable?.total ?? null)),
      highlight: 'low-is-good',
    },
    {
      label: 'Scripts',
      userValue: hasDomain ? getNum((userTa as any)?.resource_audit?.scripts?.total ?? null) : '--',
      competitorValues: competitors.map(c => getNum(c.resource_audit?.scripts?.total ?? null)),
    },
    {
      label: 'Broken Resources',
      userValue: hasDomain ? getNum((userTa as any)?.resource_audit?.broken?.total ?? null) : '--',
      competitorValues: competitors.map(c => getNum(c.resource_audit?.broken_count ?? null)),
      highlight: 'low-is-good',
    },
  ];

  function getBest(row: MetricRow): number | null {
    const vals = (hasDomain ? [row.userValue, ...row.competitorValues] : row.competitorValues)
      .map(v => {
        const n = Number(v.replace(/,/g, ''));
        return isNaN(n) ? null : n;
      })
      .filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    return row.highlight === 'high-is-good' ? Math.max(...vals) : Math.min(...vals);
  }

  function cellColor(value: string, best: number | null): string {
    if (best == null || value === '--') return 'text-gray-300';
    const n = Number(value.replace(/,/g, ''));
    if (isNaN(n)) return 'text-gray-300';
    return n === best ? 'text-green-400 font-medium' : 'text-gray-300';
  }

  return (
    <div className={cardClass}>
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <Users className={iconClass} />
        Competitor technical analysis
      </h3>
      <p className="text-gray-400 text-xs mb-4">
        Technical comparison of top {competitors.length} local competitor{competitors.length > 1 ? 's' : ''} from local finder results.
        {!hasDomain && ' No domain provided — showing competitor data only.'}
      </p>

      {/* Scorecard Comparison Table */}
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left text-gray-400 font-normal py-2 pr-3">Metric</th>
              {hasDomain && (
                <th className="text-right text-gray-400 font-normal py-2 px-2 whitespace-nowrap">
                  Your Site
                </th>
              )}
              {competitors.map(c => (
                <th key={c.domain} className="text-right text-gray-400 font-normal py-2 px-2 whitespace-nowrap max-w-[120px] truncate" title={c.domain}>
                  {c.business_name || c.domain}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const best = getBest(row);
              return (
                <tr key={row.label} className="border-b border-white/5">
                  <td className="text-gray-400 py-1.5 pr-3">
                    <MetricLabel label={row.label} />
                  </td>
                  {hasDomain && (
                    <td className={`text-right py-1.5 px-2 font-mono text-xs ${cellColor(row.userValue, best)}`}>
                      {row.userValue}
                    </td>
                  )}
                  {row.competitorValues.map((val, i) => (
                    <td key={i} className={`text-right py-1.5 px-2 font-mono text-xs ${cellColor(val, best)}`}>
                      {val}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Core Web Vitals Comparison */}
      {competitors.some(c => c.lighthouse?.desktop?.core_web_vitals || c.lighthouse?.mobile?.core_web_vitals) && (
        <div className="mb-4">
          <h4 className="text-gray-300 font-medium mb-2 text-sm">Core Web Vitals</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-gray-500 font-normal py-1.5 pr-3">Domain</th>
                  <th className="text-right text-gray-500 font-normal py-1.5 px-2">LCP</th>
                  <th className="text-right text-gray-500 font-normal py-1.5 px-2">FID</th>
                  <th className="text-right text-gray-500 font-normal py-1.5 px-2">CLS</th>
                  <th className="text-right text-gray-500 font-normal py-1.5 px-2">FCP</th>
                  <th className="text-right text-gray-500 font-normal py-1.5 px-2">TBT</th>
                  <th className="text-left text-gray-500 font-normal py-1.5 px-2">Device</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map(c => {
                  const cwvRows: Array<{ device: string; cwv: any }> = [];
                  if (c.lighthouse?.desktop?.core_web_vitals) cwvRows.push({ device: 'Desktop', cwv: c.lighthouse.desktop.core_web_vitals });
                  if (c.lighthouse?.mobile?.core_web_vitals) cwvRows.push({ device: 'Mobile', cwv: c.lighthouse.mobile.core_web_vitals });
                  if (cwvRows.length === 0) return null;
                  return cwvRows.map((row, i) => (
                    <tr key={`${c.domain}-${row.device}`} className="border-b border-white/5">
                      {i === 0 && (
                        <td rowSpan={cwvRows.length} className="text-gray-300 py-1.5 pr-3 align-top whitespace-nowrap">
                          {c.business_name || c.domain}
                        </td>
                      )}
                      <td className={`text-right py-1.5 px-2 font-mono ${cwvColor('lcp', row.cwv.lcp)}`}>{formatCwv('lcp', row.cwv.lcp)}</td>
                      <td className={`text-right py-1.5 px-2 font-mono ${cwvColor('fid', row.cwv.fid)}`}>{formatCwv('fid', row.cwv.fid)}</td>
                      <td className={`text-right py-1.5 px-2 font-mono ${cwvColor('cls', row.cwv.cls)}`}>{formatCwv('cls', row.cwv.cls)}</td>
                      <td className={`text-right py-1.5 px-2 font-mono ${cwvColor('fcp', row.cwv.fcp)}`}>{formatCwv('fcp', row.cwv.fcp)}</td>
                      <td className={`text-right py-1.5 px-2 font-mono ${cwvColor('tbt', row.cwv.tbt)}`}>{formatCwv('tbt', row.cwv.tbt)}</td>
                      <td className="text-gray-500 py-1.5 px-2">{row.device}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-Competitor Technical Details (collapsible) */}
      <div>
        <h4 className="text-gray-300 font-medium mb-2 text-sm">Technical details per competitor</h4>
        <div className="space-y-2">
          {competitors.map(c => (
            <CompetitorDetailCard key={c.domain} comp={c} />
          ))}
        </div>
      </div>
    </div>
  );
}
