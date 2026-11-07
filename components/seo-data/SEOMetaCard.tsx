import { ClipboardList } from 'lucide-react';
import type { UnifiedAuditData } from '@/types/seo-audit';

const cardClass = 'bg-navy-deep/50 p-4 rounded-lg mb-4 border border-white/10 backdrop-blur-sm';
const iconClass = 'w-5 h-5 shrink-0 text-gray-300';

export interface SEOMetaCardProps {
  data: UnifiedAuditData;
  /** Override from session.api_costs.dataforseo (audit meta is often 0; real values live on the session) */
  dataforseoCost?: number;
  dataforseoApiCalls?: number;
}

export function SEOMetaCard({ data, dataforseoCost, dataforseoApiCalls }: SEOMetaCardProps) {
  const meta = data.meta;
  if (!meta) return null;

  const cost = dataforseoCost ?? (typeof meta.dataforseo_cost === 'number' ? meta.dataforseo_cost : undefined);
  const calls = dataforseoApiCalls ?? (typeof meta.api_calls_count === 'number' ? meta.api_calls_count : undefined);

  return (
    <div className={cardClass}>
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <ClipboardList className={iconClass} />
        Audit metadata
      </h3>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-gray-400">Tier</dt>
          <dd className="text-gray-300 font-medium capitalize">{meta.tier}</dd>
        </div>
        <div>
          <dt className="text-gray-400">Location (SERP)</dt>
          <dd className="text-gray-300">{meta.location_name} ({meta.location_code})</dd>
        </div>
        {meta.google_ads_location_name && meta.google_ads_location_name !== 'United States' && (
          <div>
            <dt className="text-gray-400">Location (Keywords)</dt>
            <dd className="text-gray-300">{meta.google_ads_location_name} ({meta.google_ads_location_code})</dd>
          </div>
        )}
        {meta.domain != null && (
          <div>
            <dt className="text-gray-400">Domain</dt>
            <dd className="text-cyan-electric break-all">{meta.domain || '—'}</dd>
          </div>
        )}
        <div>
          <dt className="text-gray-400">Generated</dt>
          <dd className="text-gray-300">
            {meta.generated_at ? new Date(meta.generated_at).toLocaleString() : '—'}
          </dd>
        </div>
        {typeof cost === 'number' && (
          <div>
            <dt className="text-gray-400">DataForSEO cost</dt>
            <dd className="text-gray-300">${cost.toFixed(2)}</dd>
          </div>
        )}
        {typeof calls === 'number' && (
          <div>
            <dt className="text-gray-400">API calls</dt>
            <dd className="text-gray-300">{calls.toLocaleString()}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
