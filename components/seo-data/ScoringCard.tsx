import { TrendingUp } from 'lucide-react';
import type { UnifiedAuditData } from '@/types/seo-audit';

const cardClass = 'bg-cyan-electric/10 p-4 rounded-lg mb-4 border border-cyan-electric/30 backdrop-blur-sm';
const iconClass = 'w-5 h-5 shrink-0 text-cyan-electric';

export function ScoringCard({ data }: { data: UnifiedAuditData }) {
  const scoring = data.scoring;
  if (!scoring) return null;

  return (
    <div className={cardClass}>
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <TrendingUp className={iconClass} />
        SEO readiness scores
      </h3>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        {typeof scoring.overall_seo_readiness === 'number' && (
          <div>
            <dt className="text-gray-400">Overall</dt>
            <dd className="text-2xl font-bold text-cyan-electric">{scoring.overall_seo_readiness}</dd>
          </div>
        )}
        {typeof scoring.gbp_completeness === 'number' && (
          <div>
            <dt className="text-gray-400">GBP completeness</dt>
            <dd className="text-gray-300">{scoring.gbp_completeness}</dd>
          </div>
        )}
        {typeof scoring.technical_health === 'number' && (
          <div>
            <dt className="text-gray-400">Technical health</dt>
            <dd className="text-gray-300">{scoring.technical_health}</dd>
          </div>
        )}
        {typeof scoring.competitive_position === 'number' && (
          <div>
            <dt className="text-gray-400">Competitive position</dt>
            <dd className="text-gray-300">{scoring.competitive_position}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
