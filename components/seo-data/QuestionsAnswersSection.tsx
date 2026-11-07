import { HelpCircle } from 'lucide-react';
import type { UnifiedAuditData } from '@/types/seo-audit';
import { safeString } from './SEODataView';

const cardClass = 'bg-navy-deep/50 p-4 rounded-lg mb-4 border border-white/10 backdrop-blur-sm';
const iconClass = 'w-5 h-5 shrink-0 text-gray-300';

export function QuestionsAnswersSection({ data }: { data: UnifiedAuditData }) {
  const qa = data.questions_and_answers;
  if (!Array.isArray(qa) || qa.length === 0) return null;

  return (
    <div className={cardClass}>
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <HelpCircle className={iconClass} />
        Questions & answers
      </h3>
      <ul className="space-y-3 text-sm">
        {qa.slice(0, 20).map((val: unknown, i: number) => {
          const item = val as { question_text?: unknown; answer_text?: unknown; question?: unknown; answer?: unknown };
          const q = safeString(item.question_text ?? item.question) || '—';
          const a = safeString(item.answer_text ?? item.answer) || '—';
          return (
            <li key={i} className="border-l-2 border-cyan-electric/30 pl-3">
              <p className="text-gray-300 font-medium">{q}</p>
              <p className="text-gray-400 mt-1">{a}</p>
            </li>
          );
        })}
      </ul>
      {qa.length > 20 && (
        <p className="text-gray-400 text-sm mt-2">+ {qa.length - 20} more</p>
      )}
    </div>
  );
}
