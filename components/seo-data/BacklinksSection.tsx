import { Link, Info } from 'lucide-react';
import type { UnifiedAuditData } from '@/types/seo-audit';
import { safeString } from './SEODataView';

const cardClass = 'bg-navy-deep/50 p-4 rounded-lg mb-4 border border-white/10 backdrop-blur-sm';
const iconClass = 'w-5 h-5 shrink-0 text-gray-300';
const hintClass = 'text-xs text-gray-500 leading-relaxed';

export function BacklinksSection({ data }: { data: UnifiedAuditData }) {
  const bl = data.backlinks;
  if (!bl) return null;

  const summary = bl.summary;
  const gap = bl.link_gap;
  const top = bl.top_referring_domains;

  const allZeros = summary &&
    (summary.total_backlinks ?? 0) === 0 &&
    (summary.referring_domains ?? 0) === 0;

  return (
    <div className={cardClass}>
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <Link className={iconClass} />
        Backlinks (Advanced)
      </h3>

      {allZeros ? (
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3 mb-3">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-yellow-200 mb-1">No backlinks detected for this domain</p>
              <p className={hintClass}>
                Backlinks from other websites are one of Google&apos;s top ranking factors. Building quality backlinks through local directories, industry partnerships, guest posts, and content marketing can significantly improve search visibility. Start with Google Business Profile, local chambers of commerce, and industry-specific directories.
              </p>
            </div>
          </div>
        </div>
      ) : summary && (
        <>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm mb-3">
            <div className="bg-white/5 rounded px-3 py-2">
              <dt className="text-gray-500 text-xs">Total backlinks</dt>
              <dd className="text-gray-200 font-medium text-lg">{summary.total_backlinks?.toLocaleString() ?? '—'}</dd>
              <p className={hintClass}>Individual links pointing to your site</p>
            </div>
            <div className="bg-white/5 rounded px-3 py-2">
              <dt className="text-gray-500 text-xs">Referring domains</dt>
              <dd className="text-gray-200 font-medium text-lg">{summary.referring_domains?.toLocaleString() ?? '—'}</dd>
              <p className={hintClass}>Unique websites linking to you</p>
            </div>
            <div className="bg-white/5 rounded px-3 py-2">
              <dt className="text-gray-500 text-xs">Dofollow ratio</dt>
              <dd className="text-gray-200 font-medium text-lg">{summary.dofollow_ratio != null ? `${(summary.dofollow_ratio * 100).toFixed(0)}%` : '—'}</dd>
              <p className={hintClass}>Links that pass SEO authority</p>
            </div>
            <div className="bg-white/5 rounded px-3 py-2">
              <dt className="text-gray-500 text-xs">Avg domain rank</dt>
              <dd className="text-gray-200 font-medium text-lg">{summary.avg_domain_rank ?? '—'}</dd>
              <p className={hintClass}>Quality of sites linking to you (0-100)</p>
            </div>
          </dl>
          {typeof summary.spam_score === 'number' && summary.spam_score > 0 && (
            <p className={`text-xs mb-2 ${summary.spam_score > 30 ? 'text-red-400' : 'text-gray-500'}`}>
              Spam score: {summary.spam_score}% {summary.spam_score > 30 ? '— consider disavowing toxic backlinks' : ''}
            </p>
          )}
        </>
      )}

      {gap && !allZeros && (
        <div className="mb-3 text-sm">
          <h4 className="text-gray-400 mb-1">Link gap analysis</h4>
          <div className="grid grid-cols-3 gap-2 mb-1">
            <div className="bg-white/5 rounded px-2 py-1.5">
              <span className="text-gray-300 font-medium">{gap.competitor_only_domains?.length ?? 0}</span>
              <span className="text-gray-500 text-xs ml-1">Competitor-only</span>
            </div>
            <div className="bg-white/5 rounded px-2 py-1.5">
              <span className="text-gray-300 font-medium">{gap.shared_domains?.length ?? 0}</span>
              <span className="text-gray-500 text-xs ml-1">Shared</span>
            </div>
            <div className="bg-white/5 rounded px-2 py-1.5">
              <span className="text-cyan-300 font-medium">{gap.opportunity_score ?? 0}</span>
              <span className="text-gray-500 text-xs ml-1">Opportunity</span>
            </div>
          </div>
          <p className={hintClass}>
            &quot;Competitor-only&quot; domains link to your competitors but not you — these are outreach opportunities. Higher opportunity score means more untapped link-building potential.
          </p>
        </div>
      )}

      {Array.isArray(top) && top.length > 0 && (
        <div className="text-sm">
          <h4 className="text-gray-400 mb-1">Top referring domains</h4>
          <ul className="text-gray-300 space-y-0.5">
            {top.slice(0, 15).map((val: unknown, i: number) => {
              const d = val as { domain?: unknown; rank?: number; backlinks?: number };
              return (
                <li key={i}>{safeString(d.domain) || '—'} {typeof d.rank === 'number' ? `(rank ${d.rank})` : ''} {typeof d.backlinks === 'number' ? `· ${d.backlinks} links` : ''}</li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
