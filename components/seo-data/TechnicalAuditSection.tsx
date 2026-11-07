import { Wrench, Shield, FileWarning, Search, Zap, FileText, Code, CheckCircle2, XCircle, Info } from 'lucide-react';
import type { UnifiedAuditData } from '@/types/seo-audit';
import { safeString } from './SEODataView';

const cardClass = 'bg-navy-deep/50 p-4 rounded-lg mb-4 border border-white/10 backdrop-blur-sm';
const iconClass = 'w-5 h-5 shrink-0 text-gray-300';
const subCardClass = 'bg-white/5 p-3 rounded-md mb-2';
const hintClass = 'text-xs text-gray-500 mt-1 leading-relaxed';

function BoolIndicator({ value, label }: { value: boolean | undefined; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm mr-4 mb-1">
      {value ? (
        <CheckCircle2 className="w-4 h-4 text-green-400" />
      ) : (
        <XCircle className="w-4 h-4 text-red-400" />
      )}
      <span className="text-gray-300">{label}</span>
    </span>
  );
}

function ScopeLabel({ scope }: { scope: 'site' | 'homepage' }) {
  return (
    <span className="ml-1 text-[10px] font-normal uppercase tracking-wider text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">
      {scope === 'homepage' ? 'Homepage only' : 'Site-wide'}
    </span>
  );
}

export function TechnicalAuditSection({ data }: { data: UnifiedAuditData }) {
  const ta = data.technical_audit;
  if (!ta) return null;

  const cs = ta.crawl_summary;
  const issues = ta.issues;
  const link = ta.link_analysis;
  const schema = ta.schema_markup;
  const img = ta.image_audit;
  const di = ta.domain_info;
  const ni = ta.non_indexable;
  const dc = ta.duplicate_content;
  const kd = ta.keyword_density;
  const wf = ta.waterfall;
  const content = ta.content_structure;
  const ra = ta.resource_audit;
  const lighthouseDesktop = data.domain_intelligence?.lighthouse?.desktop;
  const lcp = (lighthouseDesktop?.core_web_vitals as any)?.lcp;

  const pagesCrawled = cs?.pages_crawled ?? 0;
  const scopeNote = pagesCrawled > 0 ? `across ${pagesCrawled} pages crawled` : '';

  return (
    <div className={cardClass}>
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <Wrench className={iconClass} />
        Technical audit
      </h3>

      {/* Crawl summary */}
      {cs && (
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm mb-3">
          <div>
            <dt className="text-gray-400">Pages crawled</dt>
            <dd className="text-gray-300">{cs.pages_crawled ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Pages with issues</dt>
            <dd className="text-gray-300">{cs.pages_with_issues ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Avg on-page score</dt>
            <dd className="text-gray-300">{cs.avg_onpage_score != null ? cs.avg_onpage_score : '—'}</dd>
          </div>
        </dl>
      )}

      {/* Domain configuration */}
      {di && (
        <div className={subCardClass}>
          <h4 className="text-gray-400 mb-2 flex items-center gap-1 text-sm">
            <Shield className="w-4 h-4" /> Domain configuration
          </h4>
          <div className="flex flex-wrap">
            <BoolIndicator value={di.ssl} label="SSL" />
            <BoolIndicator value={di.has_sitemap} label="Sitemap" />
            <BoolIndicator value={di.has_robots_txt} label="Robots.txt" />
            <BoolIndicator value={di.is_https_redirect} label="HTTPS redirect" />
            <BoolIndicator value={di.canonicalization} label="Canonical" />
            <BoolIndicator value={di.test_404} label="404 test" />
          </div>
          {di.cms && <p className="text-xs text-gray-500 mt-1">CMS: {safeString(di.cms)}</p>}
          <p className={hintClass}>
            These are essential technical SEO foundations. Missing items (red) should be addressed — SSL, sitemaps, and proper redirects help Google crawl and index your site correctly.
          </p>
        </div>
      )}

      {/* Issues */}
      {issues && (
        <div className="mb-3 text-sm">
          <h4 className="text-gray-400 mb-1 flex items-center gap-1">
            Issues
            {scopeNote && <ScopeLabel scope="site" />}
          </h4>
          <div className="grid grid-cols-3 gap-2 mb-1">
            <div className="bg-red-500/10 rounded px-2 py-1.5">
              <span className="text-red-300 font-medium">{Array.isArray(issues.critical) ? issues.critical.length : 0}</span>
              <span className="text-red-400/70 text-xs ml-1">Critical</span>
            </div>
            <div className="bg-yellow-500/10 rounded px-2 py-1.5">
              <span className="text-yellow-300 font-medium">{Array.isArray(issues.warnings) ? issues.warnings.length : 0}</span>
              <span className="text-yellow-400/70 text-xs ml-1">Warnings</span>
            </div>
            <div className="bg-blue-500/10 rounded px-2 py-1.5">
              <span className="text-blue-300 font-medium">{Array.isArray(issues.notices) ? issues.notices.length : 0}</span>
              <span className="text-blue-400/70 text-xs ml-1">Notices</span>
            </div>
          </div>
          <p className={hintClass}>
            Critical issues can prevent Google from indexing pages. Warnings may impact rankings. Notices are optimization opportunities.
          </p>
          {Array.isArray(issues.critical) && issues.critical.length > 0 && (
            <div className="mt-2 space-y-1">
              {issues.critical.slice(0, 5).map((issue: any, i: number) => (
                <p key={i} className="text-xs text-red-300 truncate">
                  {issue.name || issue.line || safeString(issue)}
                </p>
              ))}
              {issues.critical.length > 5 && (
                <p className="text-xs text-gray-500">+{issues.critical.length - 5} more critical issues</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Non-indexable pages */}
      {ni && ni.total > 0 && (
        <div className={subCardClass}>
          <h4 className="text-gray-400 mb-1 flex items-center gap-1 text-sm">
            <FileWarning className="w-4 h-4" /> Non-indexable pages ({ni.total})
          </h4>
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(ni.by_reason).map(([reason, count]) => (
              <span key={reason} className="bg-red-500/10 text-red-300 px-2 py-0.5 rounded">
                {reason}: {count as number}
              </span>
            ))}
          </div>
          <p className={hintClass}>
            These pages cannot appear in Google search results. Common reasons include noindex tags, canonical redirects, or robots.txt blocking.
          </p>
        </div>
      )}

      {/* Duplicate content */}
      {dc && dc.total_duplicate_pages > 0 && (
        <div className={subCardClass}>
          <h4 className="text-gray-400 mb-1 text-sm">Duplicate content ({dc.total_duplicate_pages} pages)</h4>
          <div className="space-y-1 text-xs text-gray-400">
            {dc.pages.slice(0, 5).map((p, i) => (
              <p key={i} className="truncate">
                <span className="text-yellow-300">{p.similarity}/10</span> — {p.url}
              </p>
            ))}
          </div>
          <p className={hintClass}>
            Duplicate content confuses search engines about which page to rank. Use canonical tags or consolidate similar pages.
          </p>
        </div>
      )}

      {/* Links */}
      {link && (
        <div className="mb-3 text-sm">
          <h4 className="text-gray-400 mb-1 flex items-center gap-1">
            Links
            {scopeNote && <ScopeLabel scope="site" />}
          </h4>
          <div className="grid grid-cols-3 gap-2 mb-1">
            <div className="bg-white/5 rounded px-2 py-1.5">
              <span className="text-gray-300 font-medium">{link.internal_links ?? '—'}</span>
              <span className="text-gray-500 text-xs ml-1">Internal</span>
            </div>
            <div className="bg-white/5 rounded px-2 py-1.5">
              <span className="text-gray-300 font-medium">{link.external_links ?? '—'}</span>
              <span className="text-gray-500 text-xs ml-1">External</span>
            </div>
            <div className={`${(Array.isArray(link.broken_links) && link.broken_links.length > 0) ? 'bg-red-500/10' : 'bg-white/5'} rounded px-2 py-1.5`}>
              <span className={`font-medium ${(Array.isArray(link.broken_links) && link.broken_links.length > 0) ? 'text-red-300' : 'text-gray-300'}`}>
                {Array.isArray(link.broken_links) ? link.broken_links.length : 0}
              </span>
              <span className="text-gray-500 text-xs ml-1">Broken</span>
            </div>
          </div>
          <p className={hintClass}>
            Internal links help Google discover and understand your pages. External links to authoritative sources build trust. Broken links hurt user experience and waste crawl budget.
          </p>
        </div>
      )}

      {/* Schema */}
      {schema && (
        <div className="mb-3 text-sm">
          <h4 className="text-gray-400 mb-1 flex items-center gap-1">
            Schema markup
            {scopeNote && <ScopeLabel scope="site" />}
          </h4>
          {schema.existing_schemas?.length > 0 ? (
            <div className="flex flex-wrap gap-1 mb-1">
              {schema.existing_schemas.map((s) => (
                <span key={s} className="bg-green-500/10 text-green-300 px-2 py-0.5 rounded text-xs">{s}</span>
              ))}
            </div>
          ) : (
            <p className="text-yellow-300 text-xs mb-1">No schema markup detected</p>
          )}
          {schema.recommended_schemas && schema.recommended_schemas.length > 0 && (
            <>
              <p className="text-xs text-gray-500 mt-1.5 mb-1">Recommended for local businesses:</p>
              <div className="flex flex-wrap gap-1">
                {schema.recommended_schemas.map((s) => {
                  const hasIt = schema.existing_schemas?.includes(s);
                  return (
                    <span key={s} className={`px-2 py-0.5 rounded text-xs flex items-center gap-1 ${hasIt ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-300'}`}>
                      {hasIt ? <CheckCircle2 className="w-3 h-3" /> : <Info className="w-3 h-3" />}
                      {s}
                    </span>
                  );
                })}
              </div>
            </>
          )}
          <p className={hintClass}>
            Schema markup helps Google display rich results (star ratings, business hours, FAQs) in search. LocalBusiness and Service schemas are essential for local SEO.
          </p>
        </div>
      )}

      {/* Resource audit */}
      {ra ? (
        <div className={subCardClass}>
          <h4 className="text-gray-400 mb-2 flex items-center gap-1 text-sm">
            <Code className="w-4 h-4" /> Resource breakdown
            {scopeNote && <ScopeLabel scope="site" />}
          </h4>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <div>
              <dt className="text-gray-500 text-xs">Images</dt>
              <dd className="text-gray-300">{ra.images.total} <span className="text-xs text-gray-500">({ra.images.missing_alt} no alt, {ra.images.oversized} oversized)</span></dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Scripts</dt>
              <dd className="text-gray-300">{ra.scripts.total} <span className="text-xs text-gray-500">({(ra.scripts.total_size / 1024).toFixed(0)}KB)</span></dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Stylesheets</dt>
              <dd className="text-gray-300">{ra.stylesheets.total} <span className="text-xs text-gray-500">({(ra.stylesheets.total_size / 1024).toFixed(0)}KB)</span></dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Broken</dt>
              <dd className={`${ra.broken.total > 0 ? 'text-red-300' : 'text-gray-300'}`}>{ra.broken.total}</dd>
            </div>
          </dl>
          {ra.images.oversized > 0 && (
            <p className={hintClass}>
              {ra.images.oversized} oversized image{ra.images.oversized > 1 ? 's' : ''} found — compressing images improves page load speed, which is a Google ranking factor.
            </p>
          )}
          {ra.images.missing_alt > 0 && (
            <p className={hintClass}>
              {ra.images.missing_alt} image{ra.images.missing_alt > 1 ? 's' : ''} missing alt text — alt text helps Google understand images and improves accessibility.
            </p>
          )}
        </div>
      ) : img && (
        <div className="text-sm">
          <h4 className="text-gray-400 mb-1">Images</h4>
          <p className="text-gray-300">
            Total: {img.total_images ?? '—'} · Missing alt: {img.missing_alt ?? '—'} · Oversized: {img.oversized ?? '—'}
          </p>
        </div>
      )}

      {/* Page speed waterfall */}
      {wf && (
        <div className={subCardClass}>
          <h4 className="text-gray-400 mb-2 flex items-center gap-1 text-sm">
            <Zap className="w-4 h-4" /> Page speed
            <ScopeLabel scope="homepage" />
          </h4>
          <dl className="grid grid-cols-2 gap-2 text-sm mb-2">
            <div>
              <dt className="text-gray-500 text-xs">Homepage load time</dt>
              <dd className="text-gray-300">
                {wf.homepage_load_time > 0
                  ? `${(wf.homepage_load_time / 1000).toFixed(2)}s`
                  : lcp
                    ? `~${(Number(lcp) / 1000).toFixed(2)}s (LCP)`
                    : 'Data unavailable'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Render-blocking resources</dt>
              <dd className={`${wf.render_blocking_count > 3 ? 'text-yellow-300' : 'text-gray-300'}`}>{wf.render_blocking_count}</dd>
            </div>
          </dl>
          {Object.keys(wf.transfer_size_by_type).length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(wf.transfer_size_by_type).map(([type, size]) => (
                <span key={type} className="bg-white/5 text-gray-400 px-2 py-0.5 rounded">
                  {type}: {((size as number) / 1024).toFixed(0)}KB
                </span>
              ))}
            </div>
          )}
          <p className={hintClass}>
            Google recommends pages load in under 2.5 seconds (Largest Contentful Paint). Reduce render-blocking resources and optimize large assets to improve speed.
          </p>
        </div>
      )}

      {/* Keyword density */}
      {kd && (kd.two_word.length > 0 || kd.three_word.length > 0) && (
        <div className={subCardClass}>
          <h4 className="text-gray-400 mb-2 flex items-center gap-1 text-sm">
            <Search className="w-4 h-4" /> Keyword density
            {scopeNote && <ScopeLabel scope="site" />}
          </h4>
          <p className={hintClass + ' mb-2'}>
            These are the most frequently repeated phrases on your site. Check if your target service keywords appear here — if not, your content may need optimization.
          </p>
          {kd.two_word.length > 0 && (
            <div className="mb-2">
              <p className="text-xs text-gray-500 mb-1">Top 2-word phrases</p>
              <div className="flex flex-wrap gap-1">
                {kd.two_word.slice(0, 15).map((k, i) => (
                  <span key={i} className="bg-blue-500/10 text-blue-300 px-2 py-0.5 rounded text-xs">
                    &quot;{k.keyword}&quot; ({k.frequency}x)
                  </span>
                ))}
              </div>
            </div>
          )}
          {kd.three_word.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Top 3-word phrases</p>
              <div className="flex flex-wrap gap-1">
                {kd.three_word.slice(0, 15).map((k, i) => (
                  <span key={i} className="bg-purple-500/10 text-purple-300 px-2 py-0.5 rounded text-xs">
                    &quot;{k.keyword}&quot; ({k.frequency}x)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Content structure */}
      {content && (
        <div className={subCardClass}>
          <h4 className="text-gray-400 mb-2 flex items-center gap-1 text-sm">
            <FileText className="w-4 h-4" /> Content structure
            <ScopeLabel scope="homepage" />
          </h4>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-gray-500 text-xs">Main topic</dt>
              <dd className="text-gray-300 truncate">
                {typeof content.main_topic === 'string'
                  ? content.main_topic || '—'
                  : content.main_topic && typeof content.main_topic === 'object' && 'topic' in (content.main_topic as any)
                    ? String((content.main_topic as any).topic)
                    : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Contact info</dt>
              <dd className={content.has_contact_info ? 'text-green-300' : 'text-red-300'}>
                {content.has_contact_info ? 'Present' : 'Not found'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Ratings/reviews</dt>
              <dd className={content.has_ratings ? 'text-green-300' : 'text-gray-400'}>
                {content.has_ratings ? 'Present' : 'Not found'}
              </dd>
            </div>
          </dl>
          {!content.has_contact_info && (
            <p className={hintClass}>
              Contact information (phone, address) on the homepage helps Google verify your business for local search.
            </p>
          )}
          {content.heading_hierarchy?.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-500 mb-1">Heading hierarchy</p>
              <div className="text-xs text-gray-500 space-y-0.5">
                {content.heading_hierarchy.slice(0, 8).map((h, i) => (
                  <p key={i} className="truncate">
                    <span className="text-gray-400 font-mono">&lt;{safeString(h.tag)}&gt;</span> {safeString(h.text)}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
