import { Trophy, TrendingUp } from 'lucide-react';
import type { UnifiedAuditData } from '@/types/seo-audit';
import { safeString } from './SEODataView';

const cardClass = 'bg-navy-deep/50 p-4 rounded-lg mb-4 border border-white/10 backdrop-blur-sm';
const iconClass = 'w-5 h-5 shrink-0 text-gray-300';

function renderList(label: string, items: unknown[], keys: string[]) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="mb-4 last:mb-0">
      <h4 className="text-gray-400 text-sm font-medium mb-2">{label}</h4>
      <ul className="space-y-1 text-sm text-gray-300">
        {items.slice(0, 30).map((val: unknown, i: number) => {
          const item = val as Record<string, unknown>;
          return (
            <li key={i}>
              {keys.map((k) => item[k] != null && safeString(item[k])).filter(Boolean).join(' · ') || JSON.stringify(item).slice(0, 80)}
            </li>
          );
        })}
      </ul>
      {items.length > 30 && <p className="text-gray-500 text-xs mt-1">+ {items.length - 30} more</p>}
    </div>
  );
}

function OrganicCompetitorsTable({ competitors }: { competitors: NonNullable<UnifiedAuditData['competitors']>['organic_competitors'] }) {
  if (!Array.isArray(competitors) || competitors.length === 0) return null;

  const hasTraffic = competitors.some(c => c.estimated_monthly_traffic != null && c.estimated_monthly_traffic > 0);

  return (
    <div className="mb-4 last:mb-0">
      <h4 className="text-gray-400 text-sm font-medium mb-2 flex items-center gap-2">
        Organic competitors
        {hasTraffic && <TrendingUp className="w-3 h-3 text-green-400" />}
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-white/10">
              <th className="py-1.5 pr-3">Domain</th>
              <th className="py-1.5 pr-3">Avg Position</th>
              <th className="py-1.5 pr-3">Intersections</th>
              {hasTraffic && <th className="py-1.5 pr-3">Est. Monthly Traffic</th>}
            </tr>
          </thead>
          <tbody className="text-gray-300">
            {competitors.slice(0, 15).map((c, i) => (
              <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                <td className="py-1.5 pr-3 font-medium text-white/90">{c.domain || '—'}</td>
                <td className="py-1.5 pr-3">{c.avg_position != null ? Number(c.avg_position).toFixed(1) : '—'}</td>
                <td className="py-1.5 pr-3">{c.intersections ?? '—'}</td>
                {hasTraffic && (
                  <td className="py-1.5 pr-3">
                    {c.estimated_monthly_traffic != null && c.estimated_monthly_traffic > 0 ? (
                      <span className="text-green-400">~{Math.round(c.estimated_monthly_traffic).toLocaleString()} visits/mo</span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function competitorGBPCompare(own: { hours?: unknown; attributes?: unknown[] }, biz: { hours?: unknown; attributes?: unknown; posts?: unknown[] }) {
  const parts: string[] = [];
  if (biz.hours != null) parts.push('Hours');
  const attrCount = Array.isArray(biz.attributes) ? biz.attributes.length : (typeof biz.attributes === 'object' && biz.attributes !== null ? 1 : 0);
  if (attrCount > 0) parts.push(`${attrCount} attributes`);
  const postCount = Array.isArray(biz.posts) ? biz.posts.length : 0;
  if (postCount > 0) parts.push(`${postCount} posts`);
  return parts.length ? parts.join(' · ') : '—';
}

function UserDomainCallout({ data }: { data: UnifiedAuditData }) {
  const di = data.domain_intelligence;
  if (!di) return null;
  const domain = data.meta?.domain;
  if (!domain) return null;

  const displayDomain = domain;

  const traffic = (di as any).organic_traffic;
  const rank = (di as any).domain_rank;

  return (
    <div className="bg-cyan-electric/5 border border-cyan-electric/20 rounded-lg p-3 mb-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm text-cyan-200 font-medium">{displayDomain}</p>
          <p className="text-xs text-gray-500">Your website</p>
        </div>
        <div className="flex gap-4">
          {typeof traffic === 'number' && traffic > 0 && (
            <div className="text-right">
              <p className="text-cyan-300 font-medium">~{Math.round(traffic).toLocaleString()}</p>
              <p className="text-[10px] text-gray-500">est. organic visits/mo</p>
            </div>
          )}
          {typeof rank === 'number' && rank > 0 && (
            <div className="text-right">
              <p className="text-cyan-300 font-medium">{rank}</p>
              <p className="text-[10px] text-gray-500">domain rank</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function CompetitorsSection({ data }: { data: UnifiedAuditData }) {
  const comp = data.competitors;
  if (!comp) return null;

  const hasAny =
    (Array.isArray(comp.organic_competitors) && comp.organic_competitors.length > 0) ||
    (Array.isArray(comp.serp_competitors) && comp.serp_competitors.length > 0) ||
    (Array.isArray(comp.local_competitors) && comp.local_competitors.length > 0) ||
    (Array.isArray(comp.backlink_competitors) && comp.backlink_competitors.length > 0) ||
    (Array.isArray(comp.competitor_profiles) && comp.competitor_profiles.length > 0);
  if (!hasAny) return null;

  const ownProfile = data.business_profile;

  return (
    <div className={cardClass}>
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <Trophy className={iconClass} />
        Competitors
      </h3>
      <UserDomainCallout data={data} />
      <OrganicCompetitorsTable competitors={comp.organic_competitors} />
      {renderList('SERP competitors', comp.serp_competitors ?? [], ['domain', 'avg_position', 'intersections'])}
      {renderList('Local competitors', comp.local_competitors ?? [], ['title', 'domain', 'address'])}

      {Array.isArray(comp.competitor_profiles) && comp.competitor_profiles.length > 0 && (
        <div className="mb-4 last:mb-0">
          <h4 className="text-gray-400 text-sm font-medium mb-2">Competitor GBP (hours, attributes, posts vs own)</h4>
          <p className="text-gray-500 text-xs mb-2">How competitor profiles compare to your business profile.</p>
          <ul className="space-y-2 text-sm text-gray-300">
            {comp.competitor_profiles.slice(0, 10).map((p, i) => {
              const profile = p as { key: string; business_info?: { title?: string; rating?: { value?: number; votes_count?: number }; hours?: unknown; attributes?: unknown; posts?: unknown[] }; reviews?: unknown[] };
              const name = profile.business_info?.title ?? profile.key;
              const rating = profile.business_info?.rating;
              const gbpSummary = competitorGBPCompare(
                { hours: ownProfile?.hours, attributes: ownProfile?.attributes },
                { hours: profile.business_info?.hours, attributes: profile.business_info?.attributes, posts: profile.business_info?.posts }
              );
              const reviewCount = Array.isArray(profile.reviews) ? profile.reviews.length : 0;
              return (
                <li key={i} className="border-l-2 border-white/10 pl-2">
                  <span className="text-white/90 font-medium">{name}</span>
                  {rating != null && (
                    <span className="text-amber-400 ml-1">
                      {rating.value != null ? `${rating.value}★` : ''}
                      {rating.votes_count != null ? ` (${rating.votes_count} reviews)` : ''}
                    </span>
                  )}
                  {reviewCount > 0 && rating == null && <span className="text-gray-400 ml-1">({reviewCount} reviews)</span>}
                  <div className="text-gray-400 text-xs mt-0.5">GBP: {gbpSummary}</div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {renderList('Backlink competitors', comp.backlink_competitors ?? [], ['domain', 'backlinks', 'referring_domains'])}
    </div>
  );
}
