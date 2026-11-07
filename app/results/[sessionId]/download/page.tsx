'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  PartyPopper,
  MapPin,
  Building2,
  Clock,
  Target,
  Search,
  DollarSign,
  Ruler,
  Palette,
  ClipboardList,
  FileText,
  PenLine,
  Lightbulb,
  LayoutDashboard,
  Map,
  Database,
  FileCode,
  FileStack,
  Download,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Globe,
  Brain,
  BarChart3,
  Hammer,
  type LucideIcon,
} from 'lucide-react';
import { FullPageLoading } from '@/components/ui/loading-spinner';
import { Button } from '@/components/ui/button';
import { SEODataView } from '@/components/seo-data/SEODataView';

const iconClass = 'w-5 h-5 shrink-0 text-current';

interface TabItem {
  id: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  downloadType?: string;
  getContent: (session: any) => string;
  isSpecial?: 'overview' | 'seo-data' | 'page-prompts' | 'blueprint';
}

export default function DownloadPage() {
  const params = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [showRawResearch, setShowRawResearch] = useState(false);
  const [buildPrompt, setBuildPrompt] = useState<string | null>(null);
  const [buildPromptCopied, setBuildPromptCopied] = useState(false);
  const [showBuildPrompt, setShowBuildPrompt] = useState(false);
  const navScrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const updateScrollArrows = useCallback(() => {
    const el = navScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  function scrollNav(direction: 'left' | 'right') {
    const el = navScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === 'left' ? -200 : 200, behavior: 'smooth' });
  }

  async function downloadAllReports() {
    setDownloadingAll(true);
    try {
      const response = await fetch('/api/generate-all-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: params.sessionId })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Failed to generate ZIP');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition');
      const match = disposition?.match(/filename="?([^";]+)"?/);
      const filename = match?.[1] || `research-all-reports-${session?.business_name?.replace(/\s+/g, '-').toLowerCase() || 'reports'}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Download all error:', err);
      alert(err.message || 'Failed to download. Please try again.');
    } finally {
      setDownloadingAll(false);
    }
  }

  useEffect(() => {
    fetchSession();
    fetchBuildPrompt();
  }, [params.sessionId]);

  async function fetchBuildPrompt() {
    try {
      const res = await fetch('/api/build-site-prompt');
      if (res.ok) {
        const data = (await res.json()) as { prompt?: string };
        if (data.prompt) setBuildPrompt(data.prompt);
      }
    } catch {
      // Non-critical — section will simply not show the prompt
    }
  }

  async function fetchSession(retryCount = 0) {
    const MAX_RETRIES = 3;
    try {
      const statusRes = await fetch(`/api/sessions/${params.sessionId}/status`);
      const statusData = (await statusRes.json()) as { error?: string; session?: { status?: string }; retry?: boolean };

      if (!statusRes.ok) {
        if ((statusRes.status === 503 || statusData.retry) && retryCount < MAX_RETRIES) {
          const delay = 2000 * Math.pow(2, retryCount);
          console.log(`[Results] Retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
          await new Promise((r) => setTimeout(r, delay));
          return fetchSession(retryCount + 1);
        }
        throw new Error(statusData.error || 'Failed to fetch status');
      }

      if (statusData.session?.status !== 'completed') {
        router.push(`/research/${params.sessionId}`);
        return;
      }

      const resultsRes = await fetch(`/api/sessions/${params.sessionId}/results`);
      const resultsData = (await resultsRes.json()) as { error?: string; session?: unknown; retry?: boolean };

      if (!resultsRes.ok) {
        if ((resultsRes.status === 503 || resultsData.retry) && retryCount < MAX_RETRIES) {
          const delay = 2000 * Math.pow(2, retryCount);
          console.log(`[Results] Retrying results in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
          await new Promise((r) => setTimeout(r, delay));
          return fetchSession(retryCount + 1);
        }
        throw new Error(resultsData.error || 'Failed to fetch results');
      }

      setSession(resultsData.session);
      setLoading(false);
    } catch (err: any) {
      console.error('Session fetch error:', err);
      setError(err.message);
      setLoading(false);
    }
  }

  const formatTime = (ms?: number) => {
    if (!ms) return 'N/A';
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  async function downloadReport(type: string) {
    setDownloading(type);
    try {
      const phase4 = session?.phase4_synthesis;
      let content = '';
      let filename = '';
      let title = '';

      switch(type) {
        case 'keyword_strategy':
          content = phase4?.seo_keyword_strategy?.content || '';
          filename = 'keyword-strategy-prioritization.txt';
          title = 'Keyword Strategy & Prioritization';
          break;
        case 'competitive_analysis':
          content = phase4?.competitive_analysis?.content || '';
          filename = 'market-position-competitive-analysis.txt';
          title = 'Market Position + Competitive Analysis';
          break;
        case 'content_strategy':
          content = phase4?.content_strategy?.content || '';
          filename = 'content-strategy-blog-calendar.txt';
          title = 'Content Strategy & Blog Calendar';
          break;
        case 'cro_guide':
          content = phase4?.cro_guide?.content || '';
          filename = 'cro-optimization-guide.txt';
          title = 'CRO Optimization Guide';
          break;
        case 'content_cro':
          content = phase4?.content_strategy_and_cro?.content || '';
          filename = 'content-strategy-cro-guide.txt';
          title = 'Content Strategy + CRO Guide + Blog Calendar';
          break;
        case 'offpage_roadmap':
          content = phase4?.offpage_roadmap_benchmarks?.content || '';
          filename = 'offpage-roadmap-benchmarks.txt';
          title = '90-Day Off-Page Roadmap & Success Benchmarks';
          break;
        case 'site_architecture':
          content = phase4?.site_architecture?.content || '';
          filename = 'site-architecture-seo-specs.txt';
          title = 'Site Architecture + SEO Specs + Technical SEO';
          break;
        case 'competitive':
          content = phase4?.competitive_intelligence?.report || '';
          filename = 'competitive-intelligence-report.txt';
          title = 'Competitive Intelligence Report';
          break;
        case 'seo':
          content = phase4?.seo_strategy?.guide || '';
          filename = 'seo-content-strategy-guide.txt';
          title = 'SEO & Content Strategy Guide';
          break;
        case 'cro':
          content = phase4?.cro_optimization?.guide || '';
          filename = 'conversion-optimization-guide.txt';
          title = 'Conversion Optimization Guide';
          break;
        case 'wireframe':
          content = phase4?.wireframe?.outline || '';
          filename = 'website-wireframe-outline.txt';
          title = 'Website Wireframe & Outline';
          break;
        case 'ui_design':
          content = phase4?.ui_design?.design_system || '';
          filename = 'ui-design-styling-direction.txt';
          title = 'UI Design & Styling Direction';
          break;
        case 'project_overview':
          content = phase4?.project_overview?.content || '';
          filename = 'project-overview-for-cursor.txt';
          title = 'Project Overview for Cursor';
          break;
        case 'page_prompts': {
          const pagePrompts = phase4?.page_prompts || {};
          const pageNames = Object.keys(pagePrompts);
          if (pageNames.length === 0) {
            alert('No page prompts available for this session.');
            return;
          }
          content = pageNames.map((pageName: string, index: number) => {
            const pageData = pagePrompts[pageName];
            return `\n================================================================================\nPAGE PROMPT ${index + 1}: ${pageName}\n================================================================================\n\n${pageData.prompt}\n`;
          }).join('\n');
          filename = 'cursor-ide-page-prompts.txt';
          title = 'Cursor IDE Page Prompts';
          break;
        }
        case 'blueprint':
          content = phase4?.final_synthesis?.content || phase4?.content || '';
          filename = 'strategic-blueprint.txt';
          title = 'Strategic Blueprint & Implementation Plan';
          break;
        case 'overview': {
          const parts = [
            session.phase1_summary?.content ? `PHASE 1: COMPETITIVE INTELLIGENCE\n${'='.repeat(60)}\n\n${session.phase1_summary.content}` : '',
            session.phase2_summary?.content ? `PHASE 2: SEO & CONTENT STRATEGY\n${'='.repeat(60)}\n\n${session.phase2_summary.content}` : '',
            session.phase3_summary?.content ? `PHASE 3: CONVERSION OPTIMIZATION\n${'='.repeat(60)}\n\n${session.phase3_summary.content}` : '',
          ].filter(Boolean);
          content = parts.join('\n\n\n');
          filename = 'raw-research-data.txt';
          title = 'Raw Research Data';
          break;
        }
      }

      if (!content) {
        alert('Content not available for this deliverable.');
        return;
      }

      const fullContent = `# ${title}\n# Business: ${session.business_name}\n# Industry: ${session.industry}\n# Location: ${session.location}\n# Generated: ${new Date().toLocaleDateString()}\n\n${'='.repeat(80)}\n${title.toUpperCase()}\n${'='.repeat(80)}\n\n${content}\n\n${'='.repeat(80)}\nGenerated by Research Automation Engine\n${'='.repeat(80)}\n`;

      const blob = new Blob([fullContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${session.business_name.replace(/\s+/g, '-').toLowerCase()}-${filename}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to download report. Please try again.');
    } finally {
      setDownloading(null);
    }
  }

  const tabs = useMemo<TabItem[]>(() => {
    if (!session) return [];
    const phase4 = session.phase4_synthesis;
    const items: TabItem[] = [];

    items.push({
      id: 'overview',
      label: 'Research Overview',
      shortLabel: 'Overview',
      icon: LayoutDashboard,
      downloadType: 'overview',
      isSpecial: 'overview',
      getContent: () => '',
    });

    if (phase4?.seo_keyword_strategy?.content)
      items.push({ id: 'keyword-strategy', label: 'Keyword Strategy & Prioritization', shortLabel: 'Keywords', icon: Search, downloadType: 'keyword_strategy', getContent: (s) => s.phase4_synthesis.seo_keyword_strategy.content });

    if (phase4?.competitive_analysis?.content)
      items.push({ id: 'competitive-analysis', label: 'Market Position + Competitive Analysis', shortLabel: 'Competitive', icon: Target, downloadType: 'competitive_analysis', getContent: (s) => s.phase4_synthesis.competitive_analysis.content });

    if (phase4?.content_strategy?.content)
      items.push({ id: 'content-strategy', label: 'Content Strategy & Blog Calendar', shortLabel: 'Content', icon: FileText, downloadType: 'content_strategy', getContent: (s) => s.phase4_synthesis.content_strategy.content });

    if (phase4?.cro_guide?.content)
      items.push({ id: 'cro-guide', label: 'CRO Optimization Guide', shortLabel: 'CRO', icon: DollarSign, downloadType: 'cro_guide', getContent: (s) => s.phase4_synthesis.cro_guide.content });

    if (!phase4?.content_strategy && phase4?.content_strategy_and_cro?.content)
      items.push({ id: 'content-cro', label: 'Content Strategy + CRO + Blog Calendar', shortLabel: 'Content + CRO', icon: DollarSign, downloadType: 'content_cro', getContent: (s) => s.phase4_synthesis.content_strategy_and_cro.content });

    if (phase4?.offpage_roadmap_benchmarks?.content)
      items.push({ id: 'offpage-roadmap', label: '90-Day Off-Page Roadmap & Benchmarks', shortLabel: 'Off-Page', icon: Map, downloadType: 'offpage_roadmap', getContent: (s) => s.phase4_synthesis.offpage_roadmap_benchmarks.content });

    if (phase4?.site_architecture?.content)
      items.push({ id: 'site-architecture', label: 'Site Architecture + SEO Specs', shortLabel: 'Architecture', icon: Ruler, downloadType: 'site_architecture', getContent: (s) => s.phase4_synthesis.site_architecture.content });

    if (phase4?.ui_design?.design_system)
      items.push({ id: 'ui-design', label: 'UI Design & Styling Direction', shortLabel: 'UI Design', icon: Palette, downloadType: 'ui_design', getContent: (s) => s.phase4_synthesis.ui_design.design_system });

    if (phase4?.project_overview?.content)
      items.push({ id: 'project-overview', label: 'Project Overview for Cursor', shortLabel: 'Project', icon: ClipboardList, downloadType: 'project_overview', getContent: (s) => s.phase4_synthesis.project_overview.content });

    // Legacy fallbacks
    if (!phase4?.competitive_analysis && phase4?.competitive_intelligence?.report)
      items.push({ id: 'competitive-intel', label: 'Competitive Intelligence Report', shortLabel: 'Competitive', icon: Target, downloadType: 'competitive', getContent: (s) => s.phase4_synthesis.competitive_intelligence.report });

    if (!phase4?.seo_keyword_strategy && phase4?.seo_strategy?.guide)
      items.push({ id: 'seo-strategy', label: 'SEO & Content Strategy Guide', shortLabel: 'SEO Strategy', icon: Search, downloadType: 'seo', getContent: (s) => s.phase4_synthesis.seo_strategy.guide });

    if (!phase4?.cro_guide && !phase4?.content_strategy_and_cro && phase4?.cro_optimization?.guide)
      items.push({ id: 'cro-optimization', label: 'Conversion Optimization Guide', shortLabel: 'CRO', icon: DollarSign, downloadType: 'cro', getContent: (s) => s.phase4_synthesis.cro_optimization.guide });

    if (phase4?.wireframe?.outline)
      items.push({ id: 'wireframe', label: 'Website Wireframe & Outline', shortLabel: 'Wireframe', icon: Ruler, downloadType: 'wireframe', getContent: (s) => s.phase4_synthesis.wireframe.outline });

    if (phase4?.all_copy?.copy_content)
      items.push({ id: 'website-copy', label: 'Website Copy', shortLabel: 'Copy', icon: PenLine, downloadType: undefined, getContent: (s) => s.phase4_synthesis.all_copy.copy_content });

    if (phase4?.page_prompts && Object.keys(phase4.page_prompts).length > 0)
      items.push({ id: 'page-prompts', label: 'Cursor IDE Page Prompts', shortLabel: 'Page Prompts', icon: FileCode, downloadType: 'page_prompts', isSpecial: 'page-prompts', getContent: (s) => {
        const pp = s.phase4_synthesis.page_prompts;
        return Object.entries(pp).map(([name, data]: [string, any]) => `--- ${name} ---\n${data.prompt}`).join('\n\n');
      }});

    if (!phase4?.wireframe && phase4?.final_synthesis?.content)
      items.push({ id: 'blueprint', label: 'Strategic Blueprint', shortLabel: 'Blueprint', icon: FileStack, downloadType: 'blueprint', isSpecial: 'blueprint', getContent: (s) => s.phase4_synthesis.final_synthesis.content });

    if (session.seo_audit_data)
      items.push({ id: 'seo-data', label: 'SEO Data', shortLabel: 'SEO Data', icon: Database, isSpecial: 'seo-data', getContent: () => '' });

    return items;
  }, [session]);

  useEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;
    updateScrollArrows();
    el.addEventListener('scroll', updateScrollArrows, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollArrows);
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollArrows);
      resizeObserver.disconnect();
    };
  }, [updateScrollArrows, tabs]);

  const currentTab = useMemo(() => tabs.find(t => t.id === activeTab) || tabs[0], [tabs, activeTab]);

  const deliverableTabs = useMemo(
    () => tabs.filter(t => t.id !== 'overview' && t.id !== 'seo-data'),
    [tabs]
  );

  const copyContent = useCallback(async () => {
    if (!currentTab || !session) return;
    const content = currentTab.getContent(session);
    if (!content) {
      alert('No content to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('Failed to copy to clipboard.');
    }
  }, [currentTab, session]);

  if (loading) {
    return (
      <FullPageLoading message="Loading your results…" />
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full glass-panel rounded-lg p-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Error</h2>
          <p className="text-gray-400 mb-6">{error || 'Session not found'}</p>
          <Button onClick={() => router.push('/dashboard')}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const showActionButtons = currentTab && currentTab.isSpecial !== 'seo-data';
  const hasContent = currentTab && currentTab.getContent(session);

  return (
    <div className="min-h-screen py-8 lg:py-12 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header with Logo */}
        <div className="flex items-center justify-between mb-6 lg:mb-8">
          <div className="flex items-center gap-3 lg:gap-4">
            <img
              src="/rae-logo.svg"
              alt="RAE Logo"
              className="h-8 lg:h-10 w-auto cursor-pointer"
              onClick={() => router.push('/dashboard')}
            />
            <div>
              <h1 className="text-xl lg:text-2xl font-bold text-white">Research Complete</h1>
              <p className="text-gray-400 text-xs lg:text-sm">{session.business_name}</p>
            </div>
          </div>
          <Button onClick={() => router.push('/dashboard')} variant="outline" size="sm">
            <span className="hidden sm:inline">← Dashboard</span>
            <span className="sm:hidden">←</span>
          </Button>
        </div>

        {/* Success Banner */}
        <div className="glass-panel rounded-lg p-6 lg:p-8 mb-6 lg:mb-8">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 lg:w-16 lg:h-16 bg-cyan-electric/20 rounded-full mb-4 border border-cyan-electric/30 shadow-glow-cyan">
              <svg className="w-7 h-7 lg:w-8 lg:h-8 text-cyan-electric" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl lg:text-3xl font-bold text-white mb-2 flex items-center justify-center gap-2">
              Research Complete! <PartyPopper className="w-6 h-6 lg:w-8 lg:h-8 text-cyan-electric" />
            </h2>
            <p className="text-lg lg:text-xl text-gray-300 mb-4">
              {session.business_name}
            </p>
            <div className="flex items-center justify-center flex-wrap gap-x-4 lg:gap-x-6 gap-y-1 text-xs lg:text-sm text-gray-400">
              <span className="flex items-center gap-1.5"><MapPin className={iconClass} />{session.location}</span>
              <span className="flex items-center gap-1.5"><Building2 className={iconClass} />{session.industry}</span>
              <span className="flex items-center gap-1.5"><Clock className={iconClass} />{formatTime(session.total_generation_time)}</span>
            </div>
            <div className="mt-5 lg:mt-6">
              <Button
                size="lg"
                onClick={downloadAllReports}
                disabled={downloadingAll}
                className="bg-cyan-electric hover:bg-cyan-electric/90 text-navy-deep font-semibold px-6 lg:px-8 py-3 shadow-glow-cyan"
              >
                {downloadingAll ? 'Preparing ZIP...' : 'Download All (ZIP)'}
              </Button>
              <p className="text-xs lg:text-sm text-gray-400 mt-2">
                All reports + Project Overview in one ZIP
              </p>
            </div>
          </div>
        </div>

        {/* Sidebar + Content Layout */}
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
          {/* Navigation — horizontal pills on mobile, vertical sidebar on desktop */}
          <div className="relative lg:w-72 lg:shrink-0 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)]">
            {/* Mobile scroll arrows */}
            {canScrollLeft && (
              <button
                onClick={() => scrollNav('left')}
                className="lg:hidden absolute left-0 top-0 bottom-0 z-10 flex items-center pl-1 pr-3 bg-gradient-to-r from-navy-dark/95 via-navy-dark/80 to-transparent"
                aria-label="Scroll left"
              >
                <ChevronLeft className="w-4 h-4 text-gray-300" />
              </button>
            )}
            {canScrollRight && (
              <button
                onClick={() => scrollNav('right')}
                className="lg:hidden absolute right-0 top-0 bottom-0 z-10 flex items-center pr-1 pl-3 bg-gradient-to-l from-navy-dark/95 via-navy-dark/80 to-transparent"
                aria-label="Scroll right"
              >
                <ChevronRight className="w-4 h-4 text-gray-300" />
              </button>
            )}
            <nav
              ref={navScrollRef}
              className="flex flex-row lg:flex-col gap-2 overflow-x-auto pb-2 lg:pb-0 lg:overflow-x-visible lg:overflow-y-auto glass-panel rounded-lg p-2 lg:p-3 scrollbar-hide"
              aria-label="Deliverables"
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => { setActiveTab(tab.id); setCopied(false); }}
                    className={`
                      flex items-center gap-2 transition-colors
                      px-3 py-2 rounded-full text-xs whitespace-nowrap shrink-0
                      lg:w-full lg:rounded-lg lg:text-sm lg:text-left lg:py-2.5 lg:whitespace-normal lg:shrink
                      ${isActive
                        ? 'bg-cyan-electric/15 text-cyan-electric border border-cyan-electric/30'
                        : 'text-gray-400 hover:bg-white/5 hover:text-white border border-transparent'
                      }
                    `}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="lg:hidden">{tab.shortLabel}</span>
                    <span className="hidden lg:inline">{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Content Area */}
          <div className="flex-1 min-w-0 glass-panel rounded-lg p-4 lg:p-6">
            {currentTab && (
              <>
                {/* Action Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 pb-4 border-b border-white/10">
                  <h2 className="text-lg lg:text-xl font-bold text-white flex items-center gap-2">
                    <currentTab.icon className="w-5 h-5 text-cyan-electric shrink-0" />
                    {currentTab.label}
                  </h2>
                  {showActionButtons && (
                    <div className="flex gap-2 shrink-0">
                      {hasContent && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={copyContent}
                          disabled={copied}
                          className="gap-1.5"
                        >
                          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy'}</span>
                        </Button>
                      )}
                      {currentTab.downloadType && (
                        <Button
                          size="sm"
                          onClick={() => downloadReport(currentTab.downloadType!)}
                          disabled={downloading === currentTab.downloadType}
                          className="gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">
                            {downloading === currentTab.downloadType ? 'Downloading...' : 'Download'}
                          </span>
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Tab Content */}
                {currentTab.isSpecial === 'overview' && (
                  <div className="space-y-8">
                    {/* Generation Time */}
                    <div className="bg-navy-deep/50 p-4 rounded-lg inline-block border border-white/10 backdrop-blur-sm">
                      <p className="text-sm text-gray-400">Total Generation Time</p>
                      <p className="text-2xl font-bold text-cyan-electric">{formatTime(session.total_generation_time)}</p>
                    </div>

                    {/* Pipeline Story Cards */}
                    <div className="space-y-4">
                      {/* Step 1: Tavily Web Research */}
                      <div className="bg-navy-deep/50 p-5 rounded-lg border border-cyan-electric/20 backdrop-blur-sm">
                        <div className="flex items-start gap-4">
                          <div className="flex flex-col items-center gap-1 shrink-0">
                            <span className="text-[10px] font-bold text-cyan-electric/60 uppercase tracking-wider">Step 1</span>
                            <div className="p-2.5 bg-cyan-electric/15 rounded-lg border border-cyan-electric/30">
                              <Globe className="w-5 h-5 text-cyan-electric" />
                            </div>
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-semibold text-white text-base">Deep Web Research</h3>
                            <p className="text-sm text-gray-400 mt-1 leading-relaxed">
                              We conducted extensive web research on competitors, market positioning, SEO opportunities, and conversion strategies for <span className="text-gray-300 font-medium">{session.business_name}</span> in <span className="text-gray-300 font-medium">{session.location}</span>.
                            </p>
                            {(session.phase1_summary?.content || session.phase2_summary?.content || session.phase3_summary?.content) && (
                              <div className="mt-3">
                                <button
                                  onClick={() => setShowRawResearch(!showRawResearch)}
                                  className="flex items-center gap-1.5 text-xs text-cyan-electric/70 hover:text-cyan-electric transition-colors"
                                >
                                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showRawResearch ? 'rotate-180' : ''}`} />
                                  {showRawResearch ? 'Hide' : 'View'} raw research data
                                </button>
                                {showRawResearch && (
                                  <div className="mt-3 space-y-3 pl-0.5 border-l-2 border-cyan-electric/20">
                                    {session.phase1_summary?.content && (
                                      <div className="pl-4">
                                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Competitive Intelligence</h4>
                                        <div className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">{session.phase1_summary.content}</div>
                                      </div>
                                    )}
                                    {session.phase2_summary?.content && (
                                      <div className="pl-4">
                                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">SEO & Content Strategy</h4>
                                        <div className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">{session.phase2_summary.content}</div>
                                      </div>
                                    )}
                                    {session.phase3_summary?.content && (
                                      <div className="pl-4">
                                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Conversion Optimization</h4>
                                        <div className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">{session.phase3_summary.content}</div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Step 2: DataForSEO (conditional) */}
                      {session.seo_audit_data && (
                        <div className="bg-navy-deep/50 p-5 rounded-lg border border-orange-500/20 backdrop-blur-sm">
                          <div className="flex items-start gap-4">
                            <div className="flex flex-col items-center gap-1 shrink-0">
                              <span className="text-[10px] font-bold text-orange-400/60 uppercase tracking-wider">Step 2</span>
                              <div className="p-2.5 bg-orange-500/15 rounded-lg border border-orange-500/30">
                                <BarChart3 className="w-5 h-5 text-orange-400" />
                              </div>
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-semibold text-white text-base">Real SEO Data Collection</h3>
                              <p className="text-sm text-gray-400 mt-1 leading-relaxed">
                                We pulled real keyword data, search volume, competitor rankings, on-page audit results, and local search data{session.api_costs?.dataforseo?.total_calls ? ` across ${session.api_costs.dataforseo.total_calls} API calls` : ''}.
                              </p>
                              <button
                                onClick={() => { setActiveTab('seo-data'); setCopied(false); }}
                                className="mt-2 text-xs text-orange-400/80 hover:text-orange-300 transition-colors underline underline-offset-2"
                              >
                                View SEO data →
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Step 3: Claude AI Synthesis */}
                      <div className="bg-navy-deep/50 p-5 rounded-lg border border-purple-500/20 backdrop-blur-sm">
                        <div className="flex items-start gap-4">
                          <div className="flex flex-col items-center gap-1 shrink-0">
                            <span className="text-[10px] font-bold text-purple-400/60 uppercase tracking-wider">Step {session.seo_audit_data ? '3' : '2'}</span>
                            <div className="p-2.5 bg-purple-500/15 rounded-lg border border-purple-500/30">
                              <Brain className="w-5 h-5 text-purple-400" />
                            </div>
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-semibold text-white text-base">AI-Powered Analysis</h3>
                            <p className="text-sm text-gray-400 mt-1 leading-relaxed">
                              Claude analyzed all research data and created {deliverableTabs.length} custom strategy documents and build-ready resources for your project.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Deliverable Tiles */}
                    {deliverableTabs.length > 0 && (
                      <div>
                        <h3 className="text-lg font-semibold text-white mb-4">Your Deliverables</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {deliverableTabs.map((tab) => {
                            const Icon = tab.icon;
                            return (
                              <button
                                key={tab.id}
                                onClick={() => { setActiveTab(tab.id); setCopied(false); }}
                                className="flex items-center gap-3 p-4 bg-navy-deep/50 rounded-lg border border-white/10 hover:border-cyan-electric/30 hover:bg-cyan-electric/5 transition-all text-left group backdrop-blur-sm"
                              >
                                <Icon className="w-5 h-5 text-cyan-electric shrink-0 group-hover:scale-110 transition-transform" />
                                <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
                                  {tab.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Build Your Site */}
                    <div className="bg-navy-deep/50 p-5 lg:p-6 rounded-lg border border-green-500/30 backdrop-blur-sm">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2.5 bg-green-500/15 rounded-lg border border-green-500/30">
                          <Hammer className="w-5 h-5 text-green-400" />
                        </div>
                        <h3 className="text-lg font-semibold text-white">Build Your Site</h3>
                      </div>
                      <p className="text-sm text-gray-400 mb-4">
                        Turn your research into a fully built website using AI. Follow these steps:
                      </p>
                      <ol className="space-y-2.5 mb-5">
                        {[
                          'Download all your research files using the "Download All (ZIP)" button above',
                          'Open Claude (claude.ai) and start a new conversation',
                          'Copy the master prompt below and paste it into Claude',
                          'Drag all downloaded research files into the same Claude conversation',
                          'Claude will generate sequenced build prompts for your entire site',
                          'Take those prompts + your research files into Cursor, Claude Code, or your preferred AI coding tool and build page by page',
                        ].map((step, i) => (
                          <li key={i} className="flex items-start gap-3 text-sm text-gray-300">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-green-500/20 text-green-400 text-xs font-bold shrink-0 mt-0.5 border border-green-500/30">
                              {i + 1}
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>

                      {buildPrompt && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-medium text-gray-400">Master Build Prompt</label>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setShowBuildPrompt(!showBuildPrompt)}
                                className="text-xs text-green-400/80 hover:text-green-300 transition-colors"
                              >
                                {showBuildPrompt ? 'Hide prompt' : 'Show prompt'}
                              </button>
                              <button
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(buildPrompt);
                                    setBuildPromptCopied(true);
                                    setTimeout(() => setBuildPromptCopied(false), 2000);
                                  } catch {
                                    alert('Failed to copy to clipboard.');
                                  }
                                }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                                  buildPromptCopied
                                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                    : 'bg-green-600 hover:bg-green-500 text-white'
                                }`}
                              >
                                {buildPromptCopied ? (
                                  <><Check className="w-3.5 h-3.5" /> Copied!</>
                                ) : (
                                  <><Copy className="w-3.5 h-3.5" /> Copy Prompt</>
                                )}
                              </button>
                            </div>
                          </div>
                          {showBuildPrompt && (
                            <div className="bg-black/40 border border-white/10 rounded-lg p-4 max-h-64 overflow-y-auto">
                              <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono leading-relaxed">{buildPrompt}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {currentTab.isSpecial === 'seo-data' && (
                  <div>
                    {session.seo_audit_data ? (
                      <SEODataView
                        data={session.seo_audit_data}
                        tier={session.tier || 'basic'}
                        dataforseoCost={session.api_costs?.dataforseo?.total_cost}
                        dataforseoApiCalls={session.api_costs?.dataforseo?.total_calls}
                      />
                    ) : (
                      <div className="bg-navy-deep/50 p-6 rounded-lg border border-white/10 backdrop-blur-sm text-center">
                        <p className="text-gray-400">
                          No SEO data for this run. SEO data is available on Intermediate and Advanced tiers.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {currentTab.isSpecial === 'page-prompts' && (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-400 mb-4">
                      {Object.keys(session.phase4_synthesis.page_prompts).length} page prompts (older format)
                    </p>
                    {Object.entries(session.phase4_synthesis.page_prompts).map(([pageName, pageData]: [string, any]) => (
                      <div key={pageName} className="p-4 bg-navy-deep/50 rounded-lg border border-white/10">
                        <h4 className="font-semibold text-white mb-2 flex items-center gap-2">
                          <FileCode className="w-4 h-4 text-gray-400" />
                          {pageName}
                        </h4>
                        <div className="text-sm text-gray-300 whitespace-pre-wrap">{pageData.prompt}</div>
                      </div>
                    ))}
                  </div>
                )}

                {currentTab.isSpecial === 'blueprint' && (
                  <div className="space-y-4">
                    <div className="text-sm text-gray-300 whitespace-pre-wrap">
                      {session.phase4_synthesis.final_synthesis?.content || session.phase4_synthesis.content}
                    </div>
                    <div className="mt-4 p-3 bg-cyan-electric/10 border border-cyan-electric/30 rounded backdrop-blur-sm">
                      <p className="text-sm text-gray-300 flex items-start gap-2">
                        <Lightbulb className="w-4 h-4 shrink-0 mt-0.5 text-cyan-electric" />
                        <span><strong>Note:</strong> This is from an older session format. New sessions have separate deliverables for each section.</span>
                      </p>
                    </div>
                  </div>
                )}

                {/* Standard content tabs (not special) */}
                {!currentTab.isSpecial && (
                  <div className="text-sm text-gray-300 whitespace-pre-wrap">
                    {currentTab.getContent(session) || (
                      <div className="text-center py-8 text-gray-500">Content not available</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
