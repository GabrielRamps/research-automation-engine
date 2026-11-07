'use client';

import { useState } from 'react';
import { BarChart3, MapPin, Search, MessageSquare, Star, ChevronDown, ChevronRight, ExternalLink, Globe, Tag } from 'lucide-react';
import type { UnifiedAuditData, SerpOrganicEntry, SerpMapsEntry, SerpLocalFinderEntry, SerpAutocompleteEntry } from '@/types/seo-audit';
import { safeString } from './SEODataView';

const cardClass = 'bg-navy-deep/50 p-4 rounded-lg mb-4 border border-white/10 backdrop-blur-sm';
const iconClass = 'w-5 h-5 shrink-0 text-gray-300';
const subCardClass = 'bg-white/5 rounded p-3 mb-3 text-sm';

function StarRating({ rating, count }: { rating: number | null; count: number | null }) {
  if (rating == null) return <span className="text-gray-500">—</span>;
  return (
    <span className="flex items-center gap-1">
      <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
      <span className="text-yellow-400">{rating.toFixed(1)}</span>
      {count != null && <span className="text-gray-500">({count.toLocaleString()})</span>}
    </span>
  );
}

function SerpFeatureBadge({ feature }: { feature: string }) {
  const colors: Record<string, string> = {
    local_pack: 'bg-green-500/20 text-green-400 border-green-500/30',
    featured_snippet: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    people_also_ask: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    paid: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    video: 'bg-red-500/20 text-red-400 border-red-500/30',
    images: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
    shopping: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    knowledge_graph: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  };
  const label = feature.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${colors[feature] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
      {label}
    </span>
  );
}

function CollapsibleSection({ title, count, defaultOpen = false, children }: { title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-2">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-sm text-gray-300 hover:text-white w-full text-left py-1">
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <span className="font-medium">{title}</span>
        {count != null && <span className="text-gray-500 text-xs">({count})</span>}
      </button>
      {open && <div className="ml-6 mt-1">{children}</div>}
    </div>
  );
}

// ─── Local Pack Dominance ────────────────────────────────────

function LocalPackDominance({ serp }: { serp: NonNullable<UnifiedAuditData['serp_analysis']> }) {
  const dominance = serp.local_pack_dominance;
  if (!dominance?.length) return null;

  const totalPacks = dominance.length;
  const inPackCount = dominance.filter(d => d.your_position != null).length;
  const percentage = totalPacks > 0 ? Math.round((inPackCount / totalPacks) * 100) : 0;

  return (
    <div className={subCardClass}>
      <h4 className="text-gray-300 font-medium mb-2 flex items-center gap-2">
        <MapPin className="w-4 h-4" /> Local Pack Dominance
      </h4>

      {/* Summary card */}
      <div className="bg-white/5 rounded-lg p-3 mb-3 flex items-center gap-4">
        <div className={`text-2xl font-bold ${percentage >= 50 ? 'text-green-400' : percentage >= 25 ? 'text-yellow-400' : 'text-red-400'}`}>
          {percentage}%
        </div>
        <div className="text-sm">
          <div className="text-gray-300">You appear in <span className="text-white font-medium">{inPackCount}</span> of <span className="text-white font-medium">{totalPacks}</span> local packs</div>
          <div className="text-gray-500">For transactional and commercial keywords</div>
        </div>
      </div>

      <div className="space-y-3">
        {dominance.slice(0, 15).map((ld, i) => (
          <div key={i} className="border-b border-white/5 pb-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-white text-sm">{ld.keyword}</span>
              {ld.your_position != null ? (
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${ld.your_position <= 3 ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                  #{ld.your_position}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">Not in pack</span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 text-xs">
              {ld.pack.slice(0, 5).map((p, j) => {
                const isYou = ld.your_position != null && p.rank === ld.your_position;
                const posColor = p.rank <= 3 ? 'text-green-400' : p.rank <= 7 ? 'text-yellow-400' : 'text-red-400';
                return (
                  <div key={j} className={`flex items-center gap-1.5 py-0.5 ${isYou ? 'bg-cyan-electric/10 rounded px-1' : ''}`}>
                    <span className={`font-mono font-bold ${posColor}`}>{p.rank}.</span>
                    <span className={isYou ? 'text-cyan-electric font-medium' : 'text-gray-300'}>{safeString(p.title || p.domain) || '—'}</span>
                    {p.rating?.value != null && (
                      <span className="text-yellow-400 flex items-center gap-0.5">
                        <Star className="w-2.5 h-2.5 fill-yellow-400" />{p.rating.value}
                        {p.rating.votes_count != null && <span className="text-gray-500">({p.rating.votes_count})</span>}
                      </span>
                    )}
                    {p.category && <span className="text-gray-500">{p.category}</span>}
                    {isYou && <span className="text-cyan-electric">(You)</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Paid Ads & LSA ──────────────────────────────────────────

function PaidAdsSection({ serp }: { serp: NonNullable<UnifiedAuditData['serp_analysis']> }) {
  const hasPaid = Array.isArray(serp.paid_results) && serp.paid_results.length > 0;
  const hasLSA = Array.isArray(serp.local_services_ads) && serp.local_services_ads.length > 0;
  if (!hasPaid && !hasLSA) return null;

  // Group paid results by keyword
  const paidByKeyword = new Map<string, Array<{ title?: string; domain?: string; description?: string; url?: string; rank?: number }>>();
  for (const p of (serp.paid_results || [])) {
    const kw = p.keyword || 'unknown';
    if (!paidByKeyword.has(kw)) paidByKeyword.set(kw, []);
    paidByKeyword.get(kw)!.push(p);
  }

  return (
    <div className={subCardClass}>
      <h4 className="text-gray-300 font-medium mb-2">Paid Ads & Local Service Ads</h4>
      <p className="text-gray-400 text-xs mb-2">Advertisers competing for paid positions per keyword.</p>

      {hasPaid && (
        <div className="mb-3">
          <div className="text-xs text-gray-400 mb-1 font-medium">PPC Ads ({serp.paid_results!.length} total across {paidByKeyword.size} keywords)</div>
          {Array.from(paidByKeyword.entries()).slice(0, 10).map(([kw, ads]) => (
            <CollapsibleSection key={kw} title={kw} count={ads.length}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500"><th className="text-left py-0.5">Pos</th><th className="text-left py-0.5">Domain</th><th className="text-left py-0.5">Title</th></tr>
                </thead>
                <tbody className="text-gray-300">
                  {ads.slice(0, 5).map((ad, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="py-0.5 pr-2">{ad.rank || i + 1}</td>
                      <td className="py-0.5 pr-2 text-cyan-electric/80">{ad.domain || '—'}</td>
                      <td className="py-0.5">{ad.title || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CollapsibleSection>
          ))}
        </div>
      )}

      {hasLSA && (
        <div>
          <div className="text-xs text-gray-400 mb-1 font-medium">Local Service Ads ({serp.local_services_ads!.length} entries)</div>
          <ul className="space-y-0.5 text-gray-300 text-xs">
            {serp.local_services_ads!.slice(0, 15).map((lsa: Record<string, unknown>, i: number) => (
              <li key={i} className="flex items-center gap-2">
                <span className="text-white/90">{safeString(lsa.keyword)}</span>
                <span className="text-gray-500">→</span>
                <span>{safeString(lsa.title ?? lsa.domain) || '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Related Searches & People Also Search ───────────────────

function RelatedSearchesSection({ serp }: { serp: NonNullable<UnifiedAuditData['serp_analysis']> }) {
  const hasRelated = Array.isArray(serp.related_searches) && serp.related_searches.length > 0;
  const hasPeopleAlsoSearch = Array.isArray(serp.people_also_search) && serp.people_also_search.length > 0;
  if (!hasRelated && !hasPeopleAlsoSearch) return null;

  return (
    <div className={subCardClass}>
      <h4 className="text-gray-300 font-medium mb-2">Related Searches & People Also Search</h4>
      <p className="text-gray-400 text-xs mb-2">Content ideas and long-tail keyword opportunities from Google.</p>

      {hasRelated && (
        <div className="mb-3">
          {serp.related_searches!.map((rs, i) => (
            <div key={i} className="mb-2">
              <span className="text-white/90 text-xs font-medium">{rs.keyword}:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {(rs.items || []).slice(0, 8).map((item: unknown, j: number) => {
                  const text = typeof item === 'string' ? item : (item as { title?: string })?.title || '';
                  if (!text) return null;
                  return (
                    <span key={j} className="px-2 py-0.5 bg-white/5 rounded text-xs text-gray-300 border border-white/10">
                      {text}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasPeopleAlsoSearch && (
        <div>
          <div className="text-xs text-gray-400 mb-1 font-medium">People Also Search</div>
          {serp.people_also_search!.slice(0, 10).map((pas, i) => (
            <div key={i} className="mb-2">
              <span className="text-white/90 text-xs font-medium">{pas.keyword}:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {(pas.items || []).slice(0, 8).map((item: unknown, j: number) => {
                  const text = typeof item === 'string' ? item : (item as { title?: string })?.title || '';
                  if (!text) return null;
                  return (
                    <span key={j} className="px-2 py-0.5 bg-white/5 rounded text-xs text-gray-300 border border-white/10">{text}</span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Discussions & Forums ────────────────────────────────────

function DiscussionsSection({ serp }: { serp: NonNullable<UnifiedAuditData['serp_analysis']> }) {
  const discussions = serp.discussions_and_forums;
  if (!discussions?.length) return null;

  // Group by platform/domain
  const byDomain = new Map<string, Array<{ keyword: string; title?: string; url?: string; domain?: string }>>();
  for (const d of discussions) {
    const domain = d.domain || 'Other';
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(d);
  }

  return (
    <div className={subCardClass}>
      <h4 className="text-gray-300 font-medium mb-2 flex items-center gap-2">
        <MessageSquare className="w-4 h-4" /> Discussions & Forums
      </h4>
      <p className="text-gray-400 text-xs mb-2">Community threads for content ideas and sentiment analysis ({discussions.length} results).</p>

      {Array.from(byDomain.entries()).slice(0, 10).map(([domain, items]) => (
        <CollapsibleSection key={domain} title={domain} count={items.length} defaultOpen={items.length <= 5}>
          <ul className="space-y-1">
            {items.slice(0, 10).map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <Tag className="w-3 h-3 text-gray-500 mt-0.5 shrink-0" />
                <div>
                  <span className="text-gray-500">[{safeString(d.keyword)}]</span>{' '}
                  {d.url ? (
                    <a href={String(d.url)} target="_blank" rel="noopener noreferrer" className="text-cyan-electric/80 hover:underline">{safeString(d.title || d.url)}</a>
                  ) : (
                    <span className="text-gray-300">{safeString(d.title) || '—'}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      ))}
    </div>
  );
}

// ─── Organic Results ─────────────────────────────────────────

function OrganicResultsSection({ serp }: { serp: NonNullable<UnifiedAuditData['serp_analysis']> }) {
  const organic = serp.organic_results;
  if (!Array.isArray(organic) || organic.length === 0) return null;

  return (
    <div className={subCardClass}>
      <h4 className="text-gray-300 font-medium mb-2 flex items-center gap-2">
        <Search className="w-4 h-4" /> Organic Rankings by Keyword
      </h4>
      <p className="text-gray-400 text-xs mb-2">Top organic results for each keyword with SERP feature badges.</p>

      {(organic as SerpOrganicEntry[]).slice(0, 10).map((entry, i) => (
        <CollapsibleSection
          key={i}
          title={entry.keyword}
          count={entry.rankings?.length}
          defaultOpen={i < 3}
        >
          {/* SERP features */}
          {entry.features_present?.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {entry.features_present.map((f, j) => <SerpFeatureBadge key={j} feature={f} />)}
            </div>
          )}
          {entry.user_position != null && (
            <div className="text-xs text-cyan-electric mb-1">Your position: #{entry.user_position}</div>
          )}
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500"><th className="text-left py-0.5">#</th><th className="text-left py-0.5">Domain</th><th className="text-left py-0.5">Title</th><th></th></tr></thead>
            <tbody className="text-gray-300">
              {(entry.rankings || []).slice(0, 10).map((r, j) => (
                <tr key={j} className={`border-t border-white/5 ${r.is_user_domain ? 'bg-cyan-electric/10' : ''}`}>
                  <td className="py-0.5 pr-2 font-mono">{r.position}</td>
                  <td className="py-0.5 pr-2">{safeString(r.domain)}{r.is_user_domain && <span className="text-cyan-electric ml-1">(You)</span>}</td>
                  <td className="py-0.5 pr-2 truncate max-w-xs" title={safeString(r.title)}>{safeString(r.title) || '—'}</td>
                  <td className="py-0.5">
                    {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-cyan-electric/60 hover:text-cyan-electric"><ExternalLink className="w-3 h-3" /></a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleSection>
      ))}
    </div>
  );
}

// ─── Maps Results ────────────────────────────────────────────

function MapsResultsSection({ serp }: { serp: NonNullable<UnifiedAuditData['serp_analysis']> }) {
  const maps = serp.maps_results;
  if (!Array.isArray(maps) || maps.length === 0) return null;

  return (
    <div className={subCardClass}>
      <h4 className="text-gray-300 font-medium mb-2 flex items-center gap-2">
        <MapPin className="w-4 h-4" /> Maps Results
      </h4>
      <p className="text-gray-400 text-xs mb-2">Google Maps listings by keyword ({maps.length} keywords searched).</p>

      {(maps as SerpMapsEntry[]).slice(0, 8).map((entry, i) => (
        <CollapsibleSection key={i} title={entry.keyword} count={entry.businesses?.length} defaultOpen={i < 3}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500">
                <th className="text-left py-0.5">#</th>
                <th className="text-left py-0.5">Business</th>
                <th className="text-left py-0.5">Rating</th>
                <th className="text-left py-0.5">Category</th>
                <th className="text-left py-0.5">Address</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {(entry.businesses || []).slice(0, 10).map((biz, j) => (
                <tr key={j} className={`border-t border-white/5 ${biz.is_user_business ? 'bg-cyan-electric/10' : ''}`}>
                  <td className="py-0.5 pr-2 font-mono">{biz.position}</td>
                  <td className="py-0.5 pr-2">
                    {safeString(biz.title)}
                    {biz.is_user_business && <span className="text-cyan-electric ml-1">(You)</span>}
                    {biz.domain && <span className="text-gray-500 ml-1 text-[10px]">{safeString(biz.domain)}</span>}
                  </td>
                  <td className="py-0.5 pr-2"><StarRating rating={biz.rating} count={biz.reviews_count} /></td>
                  <td className="py-0.5 pr-2 text-gray-500">{safeString(biz.category) || '—'}</td>
                  <td className="py-0.5 text-gray-500 truncate max-w-[200px]" title={safeString(biz.address)}>{safeString(biz.address) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleSection>
      ))}
    </div>
  );
}

// ─── Local Finder Results ────────────────────────────────────

function LocalFinderSection({ serp }: { serp: NonNullable<UnifiedAuditData['serp_analysis']> }) {
  const localFinder = serp.local_finder_results;
  if (!Array.isArray(localFinder) || localFinder.length === 0) return null;

  return (
    <div className={subCardClass}>
      <h4 className="text-gray-300 font-medium mb-2 flex items-center gap-2">
        <Globe className="w-4 h-4" /> Local Finder Results
      </h4>
      <p className="text-gray-400 text-xs mb-2">Extended local results (depth 40) — businesses found per keyword.</p>

      {(localFinder as SerpLocalFinderEntry[]).slice(0, 8).map((entry, i) => (
        <CollapsibleSection key={i} title={`${entry.keyword} (${entry.total_results} total)`} count={entry.businesses?.length} defaultOpen={i < 2}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500">
                <th className="text-left py-0.5">#</th>
                <th className="text-left py-0.5">Business</th>
                <th className="text-left py-0.5">Rating</th>
                <th className="text-left py-0.5">Category</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {(entry.businesses || []).slice(0, 10).map((biz, j) => (
                <tr key={j} className={`border-t border-white/5 ${biz.is_user_business ? 'bg-cyan-electric/10' : ''}`}>
                  <td className="py-0.5 pr-2 font-mono">{biz.position}</td>
                  <td className="py-0.5 pr-2">
                    {safeString(biz.title)}
                    {biz.is_user_business && <span className="text-cyan-electric ml-1">(You)</span>}
                  </td>
                  <td className="py-0.5 pr-2"><StarRating rating={biz.rating} count={biz.reviews_count} /></td>
                  <td className="py-0.5 text-gray-500">{safeString(biz.category) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {entry.businesses && entry.businesses.length > 10 && (
            <div className="text-xs text-gray-500 mt-1">+{entry.businesses.length - 10} more businesses</div>
          )}
        </CollapsibleSection>
      ))}
    </div>
  );
}

// ─── Autocomplete Suggestions ────────────────────────────────

function AutocompleteSection({ serp }: { serp: NonNullable<UnifiedAuditData['serp_analysis']> }) {
  const autocomplete = serp.autocomplete_suggestions;
  if (!Array.isArray(autocomplete) || autocomplete.length === 0) return null;

  // Check if structured or flat
  const isStructured = autocomplete.length > 0 && typeof autocomplete[0] === 'object' && autocomplete[0] !== null && 'keyword' in autocomplete[0];

  if (!isStructured) {
    // Legacy: flat list of strings or unknown items
    const items = autocomplete
      .map(s => typeof s === 'string' ? s : (typeof s === 'object' && s !== null && 'keyword' in s ? '' : String(s)))
      .filter(Boolean);
    if (items.length === 0) return null;
    return (
      <div className={subCardClass}>
        <h4 className="text-gray-300 font-medium mb-2">Autocomplete Suggestions</h4>
        <div className="flex flex-wrap gap-1">
          {items.slice(0, 50).map((s, i) => (
            <span key={i} className="px-2 py-1 bg-white/5 rounded text-xs text-gray-300 border border-white/10">{s}</span>
          ))}
        </div>
      </div>
    );
  }

  const entries = autocomplete as SerpAutocompleteEntry[];
  const totalSuggestions = entries.reduce((sum, e) => sum + (e.suggestions?.length || 0), 0);

  return (
    <div className={subCardClass}>
      <h4 className="text-gray-300 font-medium mb-2 flex items-center gap-2">
        <Search className="w-4 h-4" /> Autocomplete Suggestions
      </h4>
      <p className="text-gray-400 text-xs mb-2">Content and long-tail keyword ideas from Google Autocomplete ({totalSuggestions} suggestions across {entries.length} keywords).</p>

      {entries.slice(0, 15).map((entry, i) => (
        <div key={i} className="mb-2">
          <span className="text-white/90 text-xs font-medium">{entry.keyword}:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {(entry.suggestions || []).map((s, j) => (
              <span key={j} className="px-2 py-0.5 bg-white/5 rounded text-xs text-gray-300 border border-white/10">{s}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── People Also Ask ─────────────────────────────────────────

function PeopleAlsoAskSection({ features }: { features: NonNullable<UnifiedAuditData['serp_analysis']>['serp_features'] }) {
  if (!features?.people_also_ask?.length) return null;

  return (
    <div className={subCardClass}>
      <h4 className="text-gray-300 font-medium mb-2">People Also Ask</h4>
      <p className="text-gray-400 text-xs mb-2">Questions to answer in your content and FAQs ({features.people_also_ask.length} questions).</p>
      <ul className="space-y-1 text-gray-300 text-sm">
        {features.people_also_ask.slice(0, 20).map((paa: unknown, i: number) => {
          const q = typeof paa === 'object' && paa != null && 'question' in paa ? String((paa as { question?: string }).question) : typeof paa === 'string' ? paa : '';
          const url = typeof paa === 'object' && paa != null && 'url' in paa ? String((paa as { url?: string }).url) : '';
          if (!q) return null;
          return (
            <li key={i} className="flex items-start gap-2">
              <span className="text-cyan-electric/60 mt-0.5">Q:</span>
              <span>{q}{url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-cyan-electric/60 ml-1 hover:text-cyan-electric"><ExternalLink className="w-3 h-3 inline" /></a>}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── SERP Features Summary ───────────────────────────────────

function SerpFeaturesSummary({ features }: { features: NonNullable<UnifiedAuditData['serp_analysis']>['serp_features'] }) {
  if (!features) return null;
  const hasAny = features.local_pack_present || (features.featured_snippets?.length ?? 0) > 0 || (features.people_also_ask?.length ?? 0) > 0 || features.knowledge_panel;
  if (!hasAny) return null;

  return (
    <div className="mb-3 text-sm bg-white/5 rounded p-3 border border-white/10">
      <h4 className="text-gray-300 font-medium mb-2">SERP Features Detected</h4>
      <div className="flex flex-wrap gap-2">
        {features.local_pack_present && (
          <span className="px-2 py-1 bg-green-500/10 rounded text-xs text-green-400 border border-green-500/20">Local Pack</span>
        )}
        {(features.featured_snippets?.length ?? 0) > 0 && (
          <span className="px-2 py-1 bg-purple-500/10 rounded text-xs text-purple-400 border border-purple-500/20">Featured Snippets ({features.featured_snippets!.length})</span>
        )}
        {(features.people_also_ask?.length ?? 0) > 0 && (
          <span className="px-2 py-1 bg-blue-500/10 rounded text-xs text-blue-400 border border-blue-500/20">People Also Ask ({features.people_also_ask!.length})</span>
        )}
        {features.knowledge_panel != null && (
          <span className="px-2 py-1 bg-cyan-500/10 rounded text-xs text-cyan-400 border border-cyan-500/20">Knowledge Panel</span>
        )}
      </div>
    </div>
  );
}

// ─── City SERP Content ───────────────────────────────────────

function CitySerpContent({ serp }: { serp: NonNullable<UnifiedAuditData['serp_analysis']> }) {
  return (
    <>
      <SerpFeaturesSummary features={serp.serp_features} />
      <LocalPackDominance serp={serp} />
      <PaidAdsSection serp={serp} />
      <OrganicResultsSection serp={serp} />
      <MapsResultsSection serp={serp} />
      <LocalFinderSection serp={serp} />
      <RelatedSearchesSection serp={serp} />
      <PeopleAlsoAskSection features={serp.serp_features} />
      <DiscussionsSection serp={serp} />
      <AutocompleteSection serp={serp} />
    </>
  );
}

// ─── Main Export ─────────────────────────────────────────────

export function SerpAnalysisSection({ data }: { data: UnifiedAuditData }) {
  const serp = data.serp_analysis;
  if (!serp) return null;

  const hasAnyContent = (
    (Array.isArray(serp.organic_results) && serp.organic_results.length > 0) ||
    (Array.isArray(serp.maps_results) && serp.maps_results.length > 0) ||
    (Array.isArray(serp.local_finder_results) && serp.local_finder_results.length > 0) ||
    (Array.isArray(serp.autocomplete_suggestions) && serp.autocomplete_suggestions.length > 0) ||
    (Array.isArray(serp.local_pack_dominance) && serp.local_pack_dominance.length > 0) ||
    (Array.isArray(serp.paid_results) && serp.paid_results.length > 0) ||
    (Array.isArray(serp.related_searches) && serp.related_searches.length > 0) ||
    (Array.isArray(serp.discussions_and_forums) && serp.discussions_and_forums.length > 0) ||
    serp.serp_features?.local_pack_present ||
    (serp.serp_features?.featured_snippets?.length ?? 0) > 0 ||
    (serp.serp_features?.people_also_ask?.length ?? 0) > 0
  );

  if (!hasAnyContent) return null;

  const serviceAreaCities = data.meta?.service_area_locations?.map(l => l.city) ?? [];
  const serpByCityData = data.serp_by_service_area_city ?? {};
  const citiesWithData = serviceAreaCities.filter(c => serpByCityData[c]);
  const hasMultipleCities = citiesWithData.length > 1;
  const primaryCity = serviceAreaCities[0] || data.meta?.location_name || '';

  const [selectedCity, setSelectedCity] = useState(primaryCity);

  const activeSerpData = (() => {
    if (selectedCity === primaryCity || !serpByCityData[selectedCity]) {
      return serp;
    }
    const cityData = serpByCityData[selectedCity];
    return {
      organic_results: Array.isArray(cityData.organic_results) ? cityData.organic_results : [],
      maps_results: Array.isArray(cityData.maps_results) ? cityData.maps_results : [],
      local_finder_results: Array.isArray(cityData.local_finder_results) ? cityData.local_finder_results : [],
      autocomplete_suggestions: cityData.autocomplete_suggestions ?? [],
      local_pack_dominance: (cityData.serp_features?.local_pack_dominance ?? []) as NonNullable<UnifiedAuditData['serp_analysis']>['local_pack_dominance'],
      paid_results: ((cityData as any).paid_results ?? cityData.serp_features?.paid_results ?? []) as NonNullable<UnifiedAuditData['serp_analysis']>['paid_results'],
      local_services_ads: ((cityData as any).local_services_ads ?? []) as NonNullable<UnifiedAuditData['serp_analysis']>['local_services_ads'],
      related_searches: (cityData.serp_features?.related_searches ?? []) as NonNullable<UnifiedAuditData['serp_analysis']>['related_searches'],
      people_also_search: (cityData.serp_features?.people_also_search ?? []) as NonNullable<UnifiedAuditData['serp_analysis']>['people_also_search'],
      serp_features: cityData.serp_features ?? serp.serp_features,
    } as NonNullable<UnifiedAuditData['serp_analysis']>;
  })();

  const displayLocationName = selectedCity || data.meta?.location_name;
  const isLocal = displayLocationName && displayLocationName !== 'United States';

  return (
    <div className={cardClass}>
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <BarChart3 className={iconClass} />
        SERP & Local Search Analysis
      </h3>

      {isLocal && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-cyan-electric/5 border border-cyan-electric/20 px-3 py-2">
          <MapPin className="w-4 h-4 text-cyan-electric shrink-0" />
          <span className="text-sm text-gray-300">
            Rankings and map results based on <span className="text-white font-medium">{displayLocationName}</span> location.
          </span>
        </div>
      )}

      {/* City tabs */}
      {hasMultipleCities && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {citiesWithData.map(city => (
            <button
              key={city}
              type="button"
              onClick={() => setSelectedCity(city)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                selectedCity === city
                  ? 'bg-cyan-electric/20 text-white border border-cyan-electric'
                  : 'bg-white/5 text-gray-400 border border-white/10 hover:border-white/20'
              }`}
            >
              {city.split(',')[0].trim()}
            </button>
          ))}
        </div>
      )}

      <CitySerpContent serp={activeSerpData} />
    </div>
  );
}
