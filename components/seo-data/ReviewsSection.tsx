import { Star } from 'lucide-react';
import type { UnifiedAuditData } from '@/types/seo-audit';
import { safeString } from './SEODataView';

const cardClass = 'bg-navy-deep/50 p-4 rounded-lg mb-4 border border-white/10 backdrop-blur-sm';
const iconClass = 'w-5 h-5 shrink-0 text-gray-300';

export function ReviewsSection({ data }: { data: UnifiedAuditData }) {
  const reviews = data.reviews;
  if (!reviews) return null;

  const dist = reviews.rating_distribution || {};
  const comp = reviews.competitor_comparison;
  const sentiment = reviews.sentiment_summary;

  return (
    <div className={cardClass}>
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <Star className={iconClass} />
        Reviews
      </h3>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-gray-400">Total count</dt>
          <dd className="text-gray-300">{reviews.total_count?.toLocaleString() ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-gray-400">Average rating</dt>
          <dd className="text-gray-300">{reviews.average_rating != null ? `${reviews.average_rating.toFixed(1)}` : '—'}</dd>
        </div>
        {reviews.review_velocity && (
          <>
            <div>
              <dt className="text-gray-400">Reviews (30 days)</dt>
              <dd className="text-gray-300">{reviews.review_velocity.last_30_days ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-400">Reviews (90 days)</dt>
              <dd className="text-gray-300">{reviews.review_velocity.last_90_days ?? '—'}</dd>
            </div>
          </>
        )}
      </dl>
      {comp && (
        <div className="mt-3 pt-3 border-t border-white/10 text-sm">
          <h4 className="text-gray-400 mb-1">vs competitors</h4>
          <p className="text-gray-300">
            Competitor avg rating: {comp.avg_competitor_rating?.toFixed(1) ?? '—'} · 
            Avg reviews: {comp.avg_competitor_review_count != null ? comp.avg_competitor_review_count.toLocaleString() : '—'} · 
            Rating gap: {comp.rating_gap != null ? comp.rating_gap.toFixed(1) : '—'} · 
            Review gap: {comp.review_count_gap != null ? comp.review_count_gap : '—'}
          </p>
        </div>
      )}
      {Object.keys(dist).length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/10 text-sm">
          <h4 className="text-gray-400 mb-1">Rating distribution</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(dist).map(([star, count]) => (
              <span key={star} className="text-gray-300">{star}★: {Number(count).toLocaleString()}</span>
            ))}
          </div>
        </div>
      )}
      {sentiment && (sentiment.positive_themes?.length > 0 || sentiment.negative_themes?.length > 0) && (
        <div className="mt-3 pt-3 border-t border-white/10 text-sm">
          <h4 className="text-gray-400 mb-1">Sentiment</h4>
          {sentiment.positive_themes?.length > 0 && (
            <p className="text-gray-300"><span className="text-green-400">Positive:</span> {sentiment.positive_themes.join(', ')}</p>
          )}
          {sentiment.negative_themes?.length > 0 && (
            <p className="text-gray-300 mt-1"><span className="text-amber-400">Negative:</span> {sentiment.negative_themes.join(', ')}</p>
          )}
        </div>
      )}
      {Array.isArray(reviews.recent_reviews) && reviews.recent_reviews.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <h4 className="text-gray-400 text-sm mb-2">Recent reviews (own)</h4>
          <ul className="space-y-2 text-sm text-gray-300 max-h-48 overflow-y-auto">
            {reviews.recent_reviews.slice(0, 5).map((val: unknown, i: number) => {
              const r = val as { rating?: number; text?: unknown };
              const text = safeString(r.text) || JSON.stringify(r).slice(0, 200);
              return (
                <li key={i} className="border-l-2 border-white/20 pl-2">
                  {typeof r.rating === 'number' && <span className="text-amber-400">{r.rating}★ </span>}
                  {text.slice(0, 200)}{text.length > 200 ? '…' : ''}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {data.competitors?.competitor_profiles && data.competitors.competitor_profiles.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <h4 className="text-gray-400 text-sm mb-2">Competitor reviews (counts, rating)</h4>
          <ul className="space-y-1.5 text-sm text-gray-300">
            {data.competitors.competitor_profiles.slice(0, 10).map((p, i) => {
              const profile = p as { key: string; business_info?: { title?: string; rating?: { value?: number; votes_count?: number } }; reviews?: unknown[] };
              const name = profile.business_info?.title ?? profile.key;
              const rating = profile.business_info?.rating?.value;
              const count = Array.isArray(profile.reviews) ? profile.reviews.length : 0;
              return (
                <li key={i}>
                  <span className="text-white/90">{name}</span>
                  {rating != null && <span className="text-amber-400"> {rating}★</span>}
                  {count > 0 && <span className="text-gray-400"> ({count} reviews)</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
