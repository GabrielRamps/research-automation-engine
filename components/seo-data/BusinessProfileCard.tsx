import { Building2 } from 'lucide-react';
import type { UnifiedAuditData } from '@/types/seo-audit';
import { safeString } from './SEODataView';

const cardClass = 'bg-navy-deep/50 p-4 rounded-lg mb-4 border border-white/10 backdrop-blur-sm';
const iconClass = 'w-5 h-5 shrink-0 text-gray-300';

export function BusinessProfileCard({ data }: { data: UnifiedAuditData }) {
  const bp = data.business_profile;
  if (!bp) return null;

  return (
    <div className={cardClass}>
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <Building2 className={iconClass} />
        Google Business Profile
      </h3>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-gray-400">Name</dt>
          <dd className="text-gray-300 font-medium">{safeString(bp.name)}</dd>
        </div>
        <div>
          <dt className="text-gray-400">Category</dt>
          <dd className="text-gray-300">{safeString(bp.category)}</dd>
        </div>
        {bp.address && (
          <div className="sm:col-span-2">
            <dt className="text-gray-400">Address</dt>
            <dd className="text-gray-300">{safeString(bp.address)}</dd>
          </div>
        )}
        {bp.phone && (
          <div>
            <dt className="text-gray-400">Phone</dt>
            <dd className="text-gray-300">{safeString(bp.phone)}</dd>
          </div>
        )}
        {bp.website && (
          <div>
            <dt className="text-gray-400">Website</dt>
            <dd className="text-cyan-electric break-all">{safeString(bp.website)}</dd>
          </div>
        )}
        <div>
          <dt className="text-gray-400">Claimed</dt>
          <dd className="text-gray-300">{bp.is_claimed ? 'Yes' : 'No'}</dd>
        </div>
        {typeof bp.gbp_completeness_score === 'number' && (
          <div>
            <dt className="text-gray-400">GBP completeness</dt>
            <dd className="text-gray-300">{bp.gbp_completeness_score}%</dd>
          </div>
        )}
      </dl>
      {bp.gbp_completeness_gaps?.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <dt className="text-gray-400 text-sm mb-1">Gaps</dt>
          <ul className="text-sm text-gray-300 list-disc list-inside">
            {bp.gbp_completeness_gaps.map((g, i) => (
              <li key={i}>{safeString(g)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
