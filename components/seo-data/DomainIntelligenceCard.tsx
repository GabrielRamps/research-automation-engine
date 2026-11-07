import { Globe } from 'lucide-react';
import type { UnifiedAuditData } from '@/types/seo-audit';

const cardClass = 'bg-navy-deep/50 p-4 rounded-lg mb-4 border border-white/10 backdrop-blur-sm';
const iconClass = 'w-5 h-5 shrink-0 text-gray-300';

export function DomainIntelligenceCard({ data }: { data: UnifiedAuditData }) {
  const di = data.domain_intelligence;
  if (!di) return null;

  const lh = di.lighthouse;
  return (
    <div className={cardClass}>
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <Globe className={iconClass} />
        Domain intelligence
      </h3>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-gray-400">Organic traffic</dt>
          <dd className="text-gray-300">{typeof di.organic_traffic === 'number' ? di.organic_traffic.toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt className="text-gray-400">Paid traffic</dt>
          <dd className="text-gray-300">{typeof di.paid_traffic === 'number' ? di.paid_traffic.toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt className="text-gray-400">Organic keywords</dt>
          <dd className="text-gray-300">{typeof di.organic_keywords_count === 'number' ? di.organic_keywords_count.toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt className="text-gray-400">Backlinks</dt>
          <dd className="text-gray-300">{typeof di.backlinks_count === 'number' ? di.backlinks_count.toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt className="text-gray-400">Referring domains</dt>
          <dd className="text-gray-300">{typeof di.referring_domains_count === 'number' ? di.referring_domains_count.toLocaleString() : '—'}</dd>
        </div>
        <div>
          <dt className="text-gray-400">Domain rank</dt>
          <dd className="text-gray-300">{typeof di.domain_rank === 'number' ? di.domain_rank : '—'}</dd>
        </div>
      </dl>
      {lh?.desktop != null || lh?.mobile != null ? (
        <div className="mt-3 pt-3 border-t border-white/10">
          <h4 className="text-gray-300 font-medium mb-2">Lighthouse</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {lh?.desktop != null && (
              <div>
                <span className="text-gray-400">Desktop: </span>
                <span className="text-gray-300">
                  Perf {lh.desktop.performance} · A11y {lh.desktop.accessibility} · BP {lh.desktop.best_practices} · SEO {lh.desktop.seo}
                </span>
              </div>
            )}
            {lh?.mobile != null && (
              <div>
                <span className="text-gray-400">Mobile: </span>
                <span className="text-gray-300">
                  Perf {lh.mobile.performance} · A11y {lh.mobile.accessibility} · BP {lh.mobile.best_practices} · SEO {lh.mobile.seo}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
