'use client';

import { useState, useMemo } from 'react';
import { Key, TrendingUp, DollarSign, Search, MapPin, Info } from 'lucide-react';
import type { UnifiedAuditData, OrganicKeywordEntry, PaidKeywordEntry } from '@/types/seo-audit';

const cardClass = 'bg-navy-deep/50 p-4 rounded-lg mb-4 border border-white/10 backdrop-blur-sm';
const iconClass = 'w-5 h-5 shrink-0 text-gray-300';

type TabMode = 'organic' | 'paid' | 'all';

type AllSortKey =
  | 'keyword'
  | 'search_volume'
  | 'keyword_difficulty'
  | 'cpc'
  | 'priority_score'
  | 'search_intent'
  | 'source'
  | 'competition_level'
  | 'high_top_of_page_bid'
  | 'yearly_trend'
  | 'content_flag';

type OrganicSortKey = 'keyword' | 'search_volume' | 'keyword_difficulty' | 'search_intent' | 'opportunity_score' | 'yearly_trend';
type PaidSortKey = 'keyword' | 'search_volume' | 'cpc' | 'competition' | 'high_top_of_page_bid' | 'projected_clicks' | 'projected_cost' | 'opportunity_score';

type ViewMode = 'all' | 'intent' | 'difficulty' | 'competition' | 'page_type';

interface KwRow {
  keyword: string;
  search_volume?: number;
  keyword_difficulty?: number;
  cpc?: number;
  search_intent?: string;
  priority_score?: number;
  source?: string;
  competition_level?: string | null;
  low_top_of_page_bid?: number;
  high_top_of_page_bid?: number;
  search_volume_trend?: { monthly: number; quarterly: number; yearly: number } | null;
  foreign_intents?: string[];
  categories?: number[];
  core_keyword?: string | null;
  content_flag?: 'service_page' | 'faq_service_page' | 'blog_content_only' | null;
}

function CompetitionBadge({ level }: { level?: string | null }) {
  if (!level) return <span className="text-gray-500">—</span>;
  const upper = level.toUpperCase();
  const colors: Record<string, string> = {
    LOW: 'bg-green-500/20 text-green-400 border-green-500/30',
    MEDIUM: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    HIGH: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${colors[upper] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
      {upper}
    </span>
  );
}

function IntentBadge({ intent }: { intent?: string | null }) {
  if (!intent || intent === 'unknown') return <span className="text-gray-500">—</span>;
  const lower = intent.toLowerCase();
  const colors: Record<string, string> = {
    transactional: 'bg-green-500/20 text-green-400 border-green-500/30',
    commercial: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    informational: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    navigational: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${colors[lower] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
      {lower}
    </span>
  );
}

function ContentFlagBadge({ flag }: { flag?: string | null }) {
  if (!flag) return <span className="text-gray-500">—</span>;
  const labels: Record<string, string> = {
    service_page: 'Service Page',
    faq_service_page: 'FAQ / Service',
    blog_content_only: 'Blog Content',
  };
  const colors: Record<string, string> = {
    service_page: 'bg-green-500/20 text-green-400 border-green-500/30',
    faq_service_page: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    blog_content_only: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${colors[flag] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
      {labels[flag] || flag}
    </span>
  );
}

function TrendIndicator({ trend }: { trend?: { monthly: number; quarterly: number; yearly: number } | null }) {
  if (!trend || trend.yearly == null) return <span className="text-gray-500">—</span>;
  const pct = trend.yearly;
  const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
  const color = pct > 0 ? 'text-green-400' : pct < 0 ? 'text-red-400' : 'text-gray-400';
  return <span className={color}>{arrow} {Math.abs(pct).toFixed(0)}%</span>;
}

function DifficultyBar({ value }: { value: number }) {
  const color = value <= 33 ? 'bg-green-500' : value <= 66 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-xs">{value}</span>
    </div>
  );
}

function OpportunityScore({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-gray-500">—</span>;
  const color = score >= 7 ? 'text-green-400' : score >= 4 ? 'text-yellow-400' : 'text-gray-400';
  return <span className={`font-medium ${color}`}>{score.toFixed(1)}</span>;
}

const PAGE_SIZE = 200;

// ─── Organic Keywords Tab ────────────────────────────────────

function OrganicTab({ data, filter, selectedCity }: { data: UnifiedAuditData; filter: string; selectedCity: string }) {
  const organic = data.organic_keyword_analysis;
  const [sortKey, setSortKey] = useState<OrganicSortKey>('opportunity_score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showAll, setShowAll] = useState(false);

  if (!organic?.keywords?.length) {
    return <p className="text-gray-500 text-sm py-4">No organic keyword analysis available.</p>;
  }

  const getVolume = (k: OrganicKeywordEntry): number => {
    if (selectedCity && (k as any).location_metrics?.[selectedCity]) {
      return (k as any).location_metrics[selectedCity].search_volume ?? 0;
    }
    return k.search_volume ?? 0;
  };

  const sorted = useMemo(() => {
    let list = [...organic.keywords];
    if (filter.trim()) {
      const f = filter.trim().toLowerCase();
      list = list.filter(k => k.keyword.toLowerCase().includes(f));
    }
    list.sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;
      if (sortKey === 'keyword') { aVal = a.keyword; bVal = b.keyword; }
      else if (sortKey === 'yearly_trend') { aVal = a.search_volume_trend?.yearly ?? 0; bVal = b.search_volume_trend?.yearly ?? 0; }
      else if (sortKey === 'search_volume') { aVal = getVolume(a); bVal = getVolume(b); }
      else { aVal = (a as any)[sortKey] ?? 0; bVal = (b as any)[sortKey] ?? 0; }
      const cmp = typeof aVal === 'string' ? aVal.localeCompare(String(bVal)) : (Number(aVal) - Number(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [organic.keywords, sortKey, sortDir, filter, selectedCity]);

  const displayed = showAll ? sorted : sorted.slice(0, PAGE_SIZE);
  const hasMore = sorted.length > PAGE_SIZE;

  const toggleSort = (key: OrganicSortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'keyword' ? 'asc' : 'desc'); }
  };

  const displayLocation = selectedCity || data.meta?.google_ads_location_name;
  const isLocalData = displayLocation && displayLocation !== 'United States';
  const volLabel = isLocalData ? (selectedCity || 'Local Vol.') : 'Volume';

  const cols: Array<{ key: OrganicSortKey; label: string }> = [
    { key: 'keyword', label: 'Keyword' },
    { key: 'search_volume', label: volLabel },
    { key: 'keyword_difficulty', label: 'Difficulty' },
    { key: 'search_intent', label: 'Intent' },
    { key: 'yearly_trend', label: 'Trend (YoY)' },
    { key: 'opportunity_score', label: 'Opportunity' },
  ];

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white/5 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-400">Total Keywords</div>
          <div className="text-lg font-semibold text-white">{organic.keywords.length.toLocaleString()}</div>
        </div>
        <div className="bg-white/5 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-400">Addressable Traffic</div>
          <div className="text-lg font-semibold text-cyan-400">{(organic.total_addressable_traffic ?? 0).toLocaleString()}</div>
        </div>
        <div className="bg-white/5 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-400">Avg Difficulty</div>
          <div className="text-lg font-semibold text-white">{organic.avg_difficulty ?? 0}/100</div>
        </div>
        <div className="bg-white/5 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-400">Keyword Gaps</div>
          <div className="text-lg font-semibold text-orange-400">{organic.keyword_gaps?.length || 0}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-white/10">
              {cols.map(({ key, label }) => (
                <th key={key} className="py-2 pr-2 cursor-pointer hover:text-cyan-electric whitespace-nowrap" onClick={() => toggleSort(key)}>
                  {label}{sortKey === key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-gray-300">
            {displayed.map((k, i) => (
              <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                <td className="py-1.5 pr-2 break-words">{k.keyword}</td>
                <td className="py-1.5 pr-2">{getVolume(k).toLocaleString()}</td>
                <td className="py-1.5 pr-2"><DifficultyBar value={k.keyword_difficulty ?? 0} /></td>
                <td className="py-1.5 pr-2"><IntentBadge intent={k.search_intent} /></td>
                <td className="py-1.5 pr-2"><TrendIndicator trend={k.search_volume_trend} /></td>
                <td className="py-1.5 pr-2"><OpportunityScore score={k.opportunity_score} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => setShowAll(v => !v)} className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors bg-cyan-electric/10 border-cyan-electric/30 text-cyan-electric hover:bg-cyan-electric/20">
            {showAll ? `Show first ${PAGE_SIZE}` : `Show all ${sorted.length.toLocaleString()}`}
          </button>
          <span className="text-gray-500 text-sm">Showing {displayed.length.toLocaleString()} of {sorted.length.toLocaleString()}</span>
        </div>
      )}
    </>
  );
}

// ─── Paid Keywords Tab ───────────────────────────────────────

function PaidTab({ data, filter, selectedCity }: { data: UnifiedAuditData; filter: string; selectedCity: string }) {
  const paid = data.paid_keyword_analysis;
  const [sortKey, setSortKey] = useState<PaidSortKey>('opportunity_score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showAll, setShowAll] = useState(false);

  if (!paid?.keywords?.length) {
    return <p className="text-gray-500 text-sm py-4">No paid keyword analysis available.</p>;
  }

  const getVolume = (k: PaidKeywordEntry): number => {
    if (selectedCity && k.location_metrics?.[selectedCity]) {
      return k.location_metrics[selectedCity].search_volume ?? 0;
    }
    return k.search_volume ?? 0;
  };

  const getCpc = (k: PaidKeywordEntry): number => {
    if (selectedCity && k.location_metrics?.[selectedCity]) {
      return k.location_metrics[selectedCity].cpc ?? k.cpc ?? 0;
    }
    return k.cpc ?? 0;
  };

  const sorted = useMemo(() => {
    let list = [...paid.keywords];
    if (filter.trim()) {
      const f = filter.trim().toLowerCase();
      list = list.filter(k => k.keyword.toLowerCase().includes(f));
    }
    list.sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;
      if (sortKey === 'keyword') { aVal = a.keyword; bVal = b.keyword; }
      else if (sortKey === 'competition') {
        const levels: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        aVal = levels[a.competition?.toUpperCase()] || 0;
        bVal = levels[b.competition?.toUpperCase()] || 0;
      }
      else if (sortKey === 'search_volume') { aVal = getVolume(a); bVal = getVolume(b); }
      else if (sortKey === 'cpc') { aVal = getCpc(a); bVal = getCpc(b); }
      else { aVal = (a as any)[sortKey] ?? 0; bVal = (b as any)[sortKey] ?? 0; }
      const cmp = typeof aVal === 'string' ? aVal.localeCompare(String(bVal)) : (Number(aVal) - Number(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [paid.keywords, sortKey, sortDir, filter, selectedCity]);

  const displayed = showAll ? sorted : sorted.slice(0, PAGE_SIZE);
  const hasMore = sorted.length > PAGE_SIZE;

  const toggleSort = (key: PaidSortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'keyword' ? 'asc' : 'desc'); }
  };

  const displayLocation = selectedCity || data.meta?.google_ads_location_name;
  const isLocalData = displayLocation && displayLocation !== 'United States';
  const volLabel = isLocalData ? (selectedCity || 'Local Vol.') : 'Volume';

  const cols: Array<{ key: PaidSortKey; label: string }> = [
    { key: 'keyword', label: 'Keyword' },
    { key: 'search_volume', label: volLabel },
    { key: 'cpc', label: 'CPC' },
    { key: 'competition', label: 'Competition' },
    { key: 'high_top_of_page_bid', label: 'Top Bid' },
    { key: 'projected_clicks', label: 'Proj. Clicks' },
    { key: 'projected_cost', label: 'Proj. Cost' },
    { key: 'opportunity_score', label: 'Opportunity' },
  ];

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white/5 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-400">Total Keywords</div>
          <div className="text-lg font-semibold text-white">{paid.keywords.length.toLocaleString()}</div>
        </div>
        <div className="bg-white/5 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-400">Est. Monthly Spend</div>
          <div className="text-lg font-semibold text-green-400">${(paid.estimated_monthly_spend ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
        <div className="bg-white/5 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-400">Est. Monthly Clicks</div>
          <div className="text-lg font-semibold text-cyan-400">{(paid.estimated_monthly_clicks ?? 0).toLocaleString()}</div>
        </div>
        <div className="bg-white/5 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-400">Avg CPC</div>
          <div className="text-lg font-semibold text-white">${(paid.avg_cpc ?? 0).toFixed(2)}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-white/10">
              {cols.map(({ key, label }) => (
                <th key={key} className="py-2 pr-2 cursor-pointer hover:text-cyan-electric whitespace-nowrap" onClick={() => toggleSort(key)}>
                  {label}{sortKey === key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-gray-300">
            {displayed.map((k, i) => {
              const vol = getVolume(k);
              const cpc = getCpc(k);
              return (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-1.5 pr-2 break-words">{k.keyword}</td>
                  <td className="py-1.5 pr-2">{vol.toLocaleString()}</td>
                  <td className="py-1.5 pr-2">{cpc > 0 ? `$${cpc.toFixed(2)}` : '—'}</td>
                  <td className="py-1.5 pr-2"><CompetitionBadge level={k.competition} /></td>
                  <td className="py-1.5 pr-2">{k.high_top_of_page_bid != null && k.high_top_of_page_bid > 0 ? `$${k.high_top_of_page_bid.toFixed(2)}` : '—'}</td>
                  <td className="py-1.5 pr-2">{k.projected_clicks != null ? k.projected_clicks.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</td>
                  <td className="py-1.5 pr-2">{k.projected_cost != null ? `$${k.projected_cost.toFixed(2)}` : '—'}</td>
                  <td className="py-1.5 pr-2"><OpportunityScore score={k.opportunity_score} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => setShowAll(v => !v)} className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors bg-cyan-electric/10 border-cyan-electric/30 text-cyan-electric hover:bg-cyan-electric/20">
            {showAll ? `Show first ${PAGE_SIZE}` : `Show all ${sorted.length.toLocaleString()}`}
          </button>
          <span className="text-gray-500 text-sm">Showing {displayed.length.toLocaleString()} of {sorted.length.toLocaleString()}</span>
        </div>
      )}
    </>
  );
}

// ─── All Keywords Tab (original) ─────────────────────────────

function AllTab({ data, filter, selectedCity }: { data: UnifiedAuditData; filter: string; selectedCity: string }) {
  const ku = data.keyword_universe;
  const [sortKey, setSortKey] = useState<AllSortKey>('search_volume');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [intentFilter, setIntentFilter] = useState('transactional');
  const [difficultyFilter, setDifficultyFilter] = useState<'low' | 'medium' | 'high'>('low');
  const [competitionFilter, setCompetitionFilter] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('LOW');
  const [pageTypeFilter, setPageTypeFilter] = useState<'service_page' | 'faq_service_page' | 'blog_content_only'>('service_page');
  const [showAll, setShowAll] = useState(false);

  if (!ku?.keywords?.length) {
    return <p className="text-gray-500 text-sm py-4">No keyword data available.</p>;
  }

  const baseList = useMemo((): KwRow[] => {
    if (viewMode === 'intent' && ku.by_intent?.[intentFilter]) {
      return (ku.by_intent[intentFilter] as KwRow[]) ?? [];
    }
    if (viewMode === 'difficulty' && ku.by_difficulty?.[difficultyFilter]) {
      return (ku.by_difficulty[difficultyFilter] as KwRow[]) ?? [];
    }
    if (viewMode === 'competition') {
      return (ku.keywords as KwRow[]).filter(
        (kw) => (kw.competition_level || '').toUpperCase() === competitionFilter
      );
    }
    if (viewMode === 'page_type') {
      return (ku.keywords as KwRow[]).filter(
        (kw) => kw.content_flag === pageTypeFilter
      );
    }
    return (ku.keywords ?? []) as KwRow[];
  }, [ku.keywords, ku.by_intent, ku.by_difficulty, viewMode, intentFilter, difficultyFilter, competitionFilter, pageTypeFilter]);

  const getAllVolume = (row: KwRow): number => {
    if (selectedCity && (row as any).location_metrics?.[selectedCity]) {
      return (row as any).location_metrics[selectedCity].search_volume ?? 0;
    }
    return row.search_volume ?? 0;
  };

  const getSortValue = (row: KwRow, key: AllSortKey): string | number => {
    if (key === 'search_volume') return getAllVolume(row);
    if (key === 'yearly_trend') return row.search_volume_trend?.yearly ?? 0;
    if (key === 'competition_level') {
      const levels: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      return levels[(row.competition_level || '').toUpperCase()] || 0;
    }
    return (row as any)[key] ?? 0;
  };

  const sortedList = useMemo(() => {
    let list = [...baseList];
    if (filter.trim()) {
      const f = filter.trim().toLowerCase();
      list = list.filter((k) => k.keyword.toLowerCase().includes(f));
    }
    list.sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      const cmp = typeof aVal === 'string' ? String(aVal).localeCompare(String(bVal)) : (Number(aVal) - Number(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [baseList, sortKey, sortDir, filter, selectedCity]);

  const keywords = showAll ? sortedList : sortedList.slice(0, PAGE_SIZE);
  const hasMore = sortedList.length > PAGE_SIZE;

  const toggleSort = (key: AllSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'keyword' ? 'asc' : 'desc');
    }
  };

  const intentOptions = ku.by_intent ? Object.keys(ku.by_intent).filter((k) => Array.isArray(ku.by_intent?.[k]) && (ku.by_intent as Record<string, unknown[]>)[k].length > 0) : [];

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2 items-center">
        <span className="text-gray-400 text-sm">Filter:</span>
        {(['all', 'intent', 'difficulty', 'competition', 'page_type'] as ViewMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setViewMode(m)}
            className={`px-3 py-1 rounded text-sm ${viewMode === m ? 'bg-cyan-electric/30 text-white border border-cyan-electric' : 'bg-white/5 text-gray-400 border border-white/10 hover:border-white/20'}`}
          >
            {m === 'all' ? 'All' : m === 'intent' ? 'By intent' : m === 'difficulty' ? 'By difficulty' : m === 'competition' ? 'By competition' : 'By page type'}
          </button>
        ))}
        {viewMode === 'intent' && intentOptions.length > 0 && (
          <select value={intentFilter} onChange={(e) => setIntentFilter(e.target.value)} className="bg-navy-deep border border-white/20 rounded px-2 py-1 text-sm text-gray-300">
            {intentOptions.map((intent) => (<option key={intent} value={intent}>{intent}</option>))}
          </select>
        )}
        {viewMode === 'difficulty' && (
          <select value={difficultyFilter} onChange={(e) => setDifficultyFilter(e.target.value as 'low' | 'medium' | 'high')} className="bg-navy-deep border border-white/20 rounded px-2 py-1 text-sm text-gray-300">
            <option value="low">Low (0–33)</option><option value="medium">Medium (34–66)</option><option value="high">High (67–100)</option>
          </select>
        )}
        {viewMode === 'competition' && (
          <select value={competitionFilter} onChange={(e) => setCompetitionFilter(e.target.value as 'LOW' | 'MEDIUM' | 'HIGH')} className="bg-navy-deep border border-white/20 rounded px-2 py-1 text-sm text-gray-300">
            <option value="LOW">Low competition</option><option value="MEDIUM">Medium competition</option><option value="HIGH">High competition</option>
          </select>
        )}
        {viewMode === 'page_type' && (
          <select value={pageTypeFilter} onChange={(e) => setPageTypeFilter(e.target.value as 'service_page' | 'faq_service_page' | 'blog_content_only')} className="bg-navy-deep border border-white/20 rounded px-2 py-1 text-sm text-gray-300">
            <option value="service_page">Service Pages</option><option value="faq_service_page">FAQ / Service Pages</option><option value="blog_content_only">Blog Content</option>
          </select>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-white/10">
              {((() => {
                const displayLoc = selectedCity || data.meta?.google_ads_location_name;
                const isLocal = displayLoc && displayLoc !== 'United States';
                return [
                  { key: 'keyword' as const, label: 'Keyword' },
                  { key: 'search_volume' as const, label: isLocal ? (selectedCity || 'Local Vol.') : 'Volume' },
                  { key: 'keyword_difficulty' as const, label: 'Difficulty' },
                  { key: 'cpc' as const, label: 'CPC' },
                  { key: 'competition_level' as const, label: 'Competition' },
                  { key: 'high_top_of_page_bid' as const, label: 'Top Bid' },
                  { key: 'yearly_trend' as const, label: 'Trend (YoY)' },
                  { key: 'search_intent' as const, label: 'Intent' },
                  { key: 'content_flag' as const, label: 'Page Type' },
                  { key: 'priority_score' as const, label: 'Priority' },
                  { key: 'source' as const, label: 'Source' },
                ];
              })()).map(({ key, label }) => (
                <th key={key} className="py-2 pr-2 cursor-pointer hover:text-cyan-electric whitespace-nowrap" onClick={() => toggleSort(key)}>
                  {label}{sortKey === key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-gray-300">
            {keywords.map((k, i) => {
              const vol = getAllVolume(k);
              return (
              <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                <td className="py-1.5 pr-2 break-words">{k.keyword}</td>
                <td className="py-1.5 pr-2">{vol > 0 ? vol.toLocaleString() : '—'}</td>
                <td className="py-1.5 pr-2">{k.keyword_difficulty ?? '—'}</td>
                <td className="py-1.5 pr-2">{typeof k.cpc === 'number' ? `$${k.cpc.toFixed(2)}` : '—'}</td>
                <td className="py-1.5 pr-2"><CompetitionBadge level={k.competition_level} /></td>
                <td className="py-1.5 pr-2">{typeof k.high_top_of_page_bid === 'number' && k.high_top_of_page_bid > 0 ? `$${k.high_top_of_page_bid.toFixed(2)}` : '—'}</td>
                <td className="py-1.5 pr-2"><TrendIndicator trend={k.search_volume_trend} /></td>
                <td className="py-1.5 pr-2"><IntentBadge intent={k.search_intent} /></td>
                <td className="py-1.5 pr-2"><ContentFlagBadge flag={k.content_flag} /></td>
                <td className="py-1.5 pr-2">{k.priority_score != null ? k.priority_score.toFixed(1) : '—'}</td>
                <td className="py-1.5 pr-2">{k.source ?? '—'}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => setShowAll((v) => !v)} className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors bg-cyan-electric/10 border-cyan-electric/30 text-cyan-electric hover:bg-cyan-electric/20">
            {showAll ? `Show first ${PAGE_SIZE}` : `Show all ${sortedList.length.toLocaleString()} keywords`}
          </button>
          <span className="text-gray-500 text-sm">Showing {keywords.length.toLocaleString()} of {sortedList.length.toLocaleString()}</span>
        </div>
      )}
    </>
  );
}

// ─── Main Component ──────────────────────────────────────────

export function KeywordUniverseTable({ data }: { data: UnifiedAuditData }) {
  const hasOrganic = (data.organic_keyword_analysis?.keywords?.length || 0) > 0;
  const hasPaid = (data.paid_keyword_analysis?.keywords?.length || 0) > 0;
  const hasAll = (data.keyword_universe?.keywords?.length || 0) > 0;

  const defaultTab: TabMode = hasOrganic ? 'organic' : hasPaid ? 'paid' : 'all';
  const [activeTab, setActiveTab] = useState<TabMode>(defaultTab);
  const [filter, setFilter] = useState('');
  const [selectedCity, setSelectedCity] = useState('');

  const serviceAreaCities = data.meta?.service_area_locations?.map(l => l.city) ?? [];
  const hasMultipleCities = serviceAreaCities.length > 1;

  if (!hasOrganic && !hasPaid && !hasAll) return null;

  const tabs: Array<{ key: TabMode; label: string; icon: React.ReactNode; available: boolean }> = [
    { key: 'organic', label: 'Organic (SEO)', icon: <Search className="w-4 h-4" />, available: hasOrganic },
    { key: 'paid', label: 'Paid (SEM)', icon: <DollarSign className="w-4 h-4" />, available: hasPaid },
    { key: 'all', label: 'All Keywords', icon: <Key className="w-4 h-4" />, available: hasAll },
  ];

  const displayLocationName = selectedCity || data.meta?.google_ads_location_name;
  const isLocalData = displayLocationName && displayLocationName !== 'United States';

  return (
    <div className={cardClass}>
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <TrendingUp className={iconClass} />
        Keyword Analysis
      </h3>
      <p className="text-gray-400 text-sm mb-3">
        Keywords analyzed for organic ranking opportunities and paid advertising potential.
      </p>

      {/* Location context banner with city selector */}
      {isLocalData && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-cyan-electric/5 border border-cyan-electric/20 px-3 py-2">
          <MapPin className="w-4 h-4 text-cyan-electric shrink-0 mt-0.5" />
          <div className="text-sm text-gray-300 flex-1">
            <span className="text-cyan-electric font-medium">Local data</span>
            {' — '}
            {activeTab === 'paid'
              ? <>Volume, CPC, competition, ad traffic, and bid data are localized to <span className="text-white font-medium">{displayLocationName}</span>.</>
              : <>Search volume and CPC reflect local demand in <span className="text-white font-medium">{displayLocationName}</span>. Difficulty and intent are national (USA) metrics.</>
            }
          </div>
          {hasMultipleCities && (
            <select
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              className="bg-navy-deep border border-cyan-electric/30 rounded px-2 py-1 text-sm text-gray-300 focus:border-cyan-electric focus:outline-none shrink-0"
            >
              <option value="">Best across all cities</option>
              {serviceAreaCities.map(city => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* City selector when no local banner shown but multiple cities exist */}
      {!isLocalData && hasMultipleCities && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2">
          <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="text-sm text-gray-400">View by city:</span>
          <select
            value={selectedCity}
            onChange={(e) => setSelectedCity(e.target.value)}
            className="bg-navy-deep border border-white/20 rounded px-2 py-1 text-sm text-gray-300 focus:border-cyan-electric focus:outline-none"
          >
            <option value="">Best across all cities</option>
            {serviceAreaCities.map(city => (
              <option key={city} value={city}>{city}</option>
            ))}
          </select>
        </div>
      )}

      {/* Tab bar */}
      <div className="mb-4 flex flex-wrap gap-2 items-center">
        {tabs.filter(t => t.available).map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
              activeTab === t.key
                ? 'bg-cyan-electric/20 text-white border border-cyan-electric'
                : 'bg-white/5 text-gray-400 border border-white/10 hover:border-white/20'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <input
          type="text"
          placeholder="Filter keywords..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-navy-deep border border-white/20 rounded px-3 py-1.5 text-sm text-gray-300 placeholder-gray-500 focus:border-cyan-electric focus:outline-none ml-auto"
        />
      </div>

      {/* Tab content */}
      {activeTab === 'organic' && <OrganicTab data={data} filter={filter} selectedCity={selectedCity} />}
      {activeTab === 'paid' && <PaidTab data={data} filter={filter} selectedCity={selectedCity} />}
      {activeTab === 'all' && <AllTab data={data} filter={filter} selectedCity={selectedCity} />}
    </div>
  );
}
