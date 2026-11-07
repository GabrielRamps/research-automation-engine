import { FlaskConical } from 'lucide-react';
import type { UnifiedAuditData } from '@/types/seo-audit';
import { safeString } from './SEODataView';

const cardClass = 'bg-navy-deep/50 p-4 rounded-lg mb-4 border border-white/10 backdrop-blur-sm';
const iconClass = 'w-5 h-5 shrink-0 text-gray-300';

export function TavilyResearchSummary({ data }: { data: UnifiedAuditData }) {
  const tr = data.tavily_research;
  if (!tr) return null;

  const hasSummary = tr.phase1_summary || tr.phase2_summary || tr.phase3_summary;
  const hasSources = (Array.isArray(tr.phase1_sources) && tr.phase1_sources.length > 0) ||
    (Array.isArray(tr.phase2_sources) && tr.phase2_sources.length > 0) ||
    (Array.isArray(tr.phase3_sources) && tr.phase3_sources.length > 0);
  if (!hasSummary && !hasSources) return null;

  return (
    <div className={cardClass}>
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <FlaskConical className={iconClass} />
        Tavily research (used in audit)
      </h3>
      {tr.phase1_summary && (
        <div className="mb-2 text-sm">
          <h4 className="text-gray-400 mb-1">Phase 1 summary</h4>
          <p className="text-gray-300 whitespace-pre-wrap">{safeString(tr.phase1_summary).slice(0, 500)}{safeString(tr.phase1_summary).length > 500 ? '…' : ''}</p>
        </div>
      )}
      {tr.phase2_summary && (
        <div className="mb-2 text-sm">
          <h4 className="text-gray-400 mb-1">Phase 2 summary</h4>
          <p className="text-gray-300 whitespace-pre-wrap">{safeString(tr.phase2_summary).slice(0, 500)}{safeString(tr.phase2_summary).length > 500 ? '…' : ''}</p>
        </div>
      )}
      {tr.phase3_summary && (
        <div className="mb-2 text-sm">
          <h4 className="text-gray-400 mb-1">Phase 3 summary</h4>
          <p className="text-gray-300 whitespace-pre-wrap">{safeString(tr.phase3_summary).slice(0, 500)}{safeString(tr.phase3_summary).length > 500 ? '…' : ''}</p>
        </div>
      )}
      {hasSources && (
        <p className="text-gray-400 text-sm">
          Sources: Phase 1 {tr.phase1_sources?.length ?? 0} · Phase 2 {tr.phase2_sources?.length ?? 0} · Phase 3 {tr.phase3_sources?.length ?? 0}
        </p>
      )}
    </div>
  );
}
