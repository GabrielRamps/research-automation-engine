'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import ScriptedResearchProgress from '@/components/scripted-research-progress';
import ResearchProgress from '@/components/research-progress';
import { FullPageLoading } from '@/components/ui/loading-spinner';
import {
  BarChart3,
  Target,
  FileText,
  DollarSign,
  Map,
  Building2,
  Palette,
  ClipboardList,
  Search,
  PenLine,
  FileCode,
  FileStack,
  CheckCircle,
} from 'lucide-react';

const FALLBACK_POLL_MS = 60_000;

export default function ResearchProgressPage() {
  const params = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  const MAX_ERRORS_BEFORE_SHOWING = 3;

  const fetchStatus = useCallback(async (initial = false) => {
    try {
      const url = `/api/sessions/${params.sessionId}/status${initial ? '?initial=true' : ''}`;
      const response = await fetch(url);
      const data = (await response.json()) as { error?: string; session?: any };

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch status');
      }

      setSession((prev: any) => {
        if (!prev || initial) return data.session;
        return { ...prev, ...data.session };
      });
      setLoading(false);
      setConsecutiveErrors(0);
      setError('');
    } catch (err: any) {
      const newErrorCount = consecutiveErrors + 1;
      setConsecutiveErrors(newErrorCount);
      if (newErrorCount >= MAX_ERRORS_BEFORE_SHOWING) {
        setError(err.message);
        setLoading(false);
      }
    }
  }, [params.sessionId, consecutiveErrors]);

  // Initial load + Supabase Realtime subscription
  useEffect(() => {
    fetchStatus(true);

    const supabase = createClient();
    const channel = supabase
      .channel(`session-${params.sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'research_sessions',
          filter: `id=eq.${params.sessionId}`,
        },
        (payload) => {
          const next = payload.new as any;
          setSession((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              status: next.status,
              current_phase: next.current_phase,
              balance_errors: next.balance_errors,
              error_log: next.error_log,
            };
          });

          if (next.status === 'completed') {
            fetchStatus(false);
          }
        }
      )
      .subscribe();

    // Fallback poll every 60s in case Realtime drops
    fallbackRef.current = setInterval(() => {
      fetchStatus(false);
    }, FALLBACK_POLL_MS);

    return () => {
      supabase.removeChannel(channel);
      if (fallbackRef.current) clearInterval(fallbackRef.current);
    };
  }, [params.sessionId]);

  async function handleRetry() {
    setRetrying(true);
    try {
      const response = await fetch(`/api/sessions/${params.sessionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await response.json()) as { error?: string; detail?: string };
      if (!response.ok) {
        const msg = data.detail ? `${data.error}. ${data.detail}` : (data.error || 'Failed to resume research');
        throw new Error(msg);
      }
      await fetchStatus(false);
      setRetrying(false);
    } catch (err: any) {
      alert(`Failed to retry: ${err.message}`);
      setRetrying(false);
    }
  }

  function handleCancelClick() {
    setShowCancelConfirm(true);
  }

  async function confirmCancel() {
    setShowCancelConfirm(false);
    setCancelling(true);
    try {
      const response = await fetch(`/api/sessions/${params.sessionId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel research');
      }
      await fetchStatus(false);
      setTimeout(() => router.push('/dashboard'), 2000);
    } catch (err: any) {
      alert(`Failed to cancel: ${err.message}`);
      setCancelling(false);
    }
  }

  // ---------- Loading ----------
  if (loading && !session) {
    return (
      <FullPageLoading message="Loading your research…" />
    );
  }

  // ---------- Fatal error ----------
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full glass-panel-dark rounded-lg p-8 text-center bg-navy-dark/95">
          <div className="text-red-400 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Error Loading Research</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-6 py-2 bg-cyan-electric text-navy-deep rounded-lg hover:shadow-glow-cyan transition"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ---------- Completion ----------
  const isActuallyCompleted =
    session?.status === 'completed' ||
    (session?.phase4_synthesis?.seo_keyword_strategy &&
      session?.phase4_synthesis?.site_architecture &&
      session?.phase4_synthesis?.ui_design &&
      session?.phase4_synthesis?.project_overview) ||
    (session?.phase4_synthesis?.final_synthesis?.content &&
      session?.phase4_synthesis?.competitive_intelligence &&
      session?.phase4_synthesis?.seo_strategy &&
      session?.phase4_synthesis?.cro_optimization);

  if (isActuallyCompleted) {
    const totalTime = session.total_generation_time
      ? `${Math.floor(session.total_generation_time / 60000)}m ${Math.floor((session.total_generation_time % 60000) / 1000)}s`
      : 'N/A';

    return (
      <div className="min-h-screen py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="glass-panel-dark rounded-lg p-12 text-center bg-navy-dark/95">
            <div className="inline-flex items-center justify-center w-24 h-24 bg-cyan-electric/20 rounded-full mb-6 animate-bounce border border-cyan-electric/30 shadow-glow-cyan">
              <CheckCircle className="w-12 h-12 text-cyan-electric" />
            </div>

            <h1 className="text-4xl font-bold text-white mb-3">Research Complete!</h1>
            <p className="text-xl text-gray-300 mb-2">{session.business_name}</p>
            <p className="text-sm text-gray-400 mb-8">Total time: {totalTime}</p>

            <div className="glass-panel-dark rounded-lg p-6 mb-8 border border-white/10 bg-navy-dark/90">
              <h3 className="font-semibold text-white mb-4">Your research includes:</h3>
              <div className="grid grid-cols-1 gap-3 text-left">
                {([
                  { icon: BarChart3, label: 'Keyword Strategy & Prioritization', has: !!session?.phase4_synthesis?.seo_keyword_strategy?.content },
                  { icon: Target, label: 'Market Position + Competitive Analysis', has: !!session?.phase4_synthesis?.competitive_analysis?.content },
                  { icon: FileText, label: 'Content Strategy & Blog Calendar', has: !!(session?.phase4_synthesis?.content_strategy?.content || session?.phase4_synthesis?.content_strategy_and_cro?.content) },
                  { icon: DollarSign, label: 'CRO Optimization Guide', has: !!session?.phase4_synthesis?.cro_guide?.content },
                  { icon: Map, label: '90-Day Off-Page Roadmap & Benchmarks', has: !!session?.phase4_synthesis?.offpage_roadmap_benchmarks?.content },
                  { icon: Building2, label: 'Site Architecture + SEO Specs + Technical SEO', has: !!session?.phase4_synthesis?.site_architecture?.content },
                  { icon: Palette, label: 'UI Design & Styling Direction', has: !!session?.phase4_synthesis?.ui_design?.design_system },
                  { icon: ClipboardList, label: 'Project Overview for Cursor', has: !!session?.phase4_synthesis?.project_overview?.content },
                  { icon: Target, label: 'Competitive Intelligence Report', has: !!session?.phase4_synthesis?.competitive_intelligence?.report && !session?.phase4_synthesis?.competitive_analysis },
                  { icon: Search, label: 'SEO & Content Strategy Guide', has: !!session?.phase4_synthesis?.seo_strategy?.guide && !session?.phase4_synthesis?.seo_keyword_strategy },
                  { icon: DollarSign, label: 'Conversion Optimization Guide', has: !!session?.phase4_synthesis?.cro_optimization?.guide && !session?.phase4_synthesis?.cro_guide },
                  { icon: Building2, label: 'Website Wireframe & Outline', has: !!session?.phase4_synthesis?.wireframe?.outline },
                  { icon: PenLine, label: 'Website Copy', has: !!(session?.phase4_synthesis?.all_copy?.copy_content) },
                  { icon: FileCode, label: 'Cursor IDE Page Prompts', has: !!(session?.phase4_synthesis?.page_prompts && Object.keys(session.phase4_synthesis.page_prompts).length > 0) },
                  { icon: FileStack, label: 'Final Blueprint', has: !!(session?.phase4_synthesis?.final_synthesis?.content && !session?.phase4_synthesis?.wireframe?.outline) },
                ])
                  .filter((d) => d.has)
                  .map((d) => (
                    <div key={d.label} className="flex items-center space-x-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-cyan-electric/15 border border-cyan-electric/20 flex items-center justify-center">
                        <d.icon className="w-4 h-4 text-cyan-electric" />
                      </div>
                      <span className="text-gray-300">{d.label}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => router.push(`/results/${params.sessionId}/download`)}
                className="px-8 py-4 bg-cyan-electric text-navy-deep text-lg font-semibold rounded-lg hover:shadow-glow-cyan-lg transition-all"
              >
                View My Results →
              </button>
              <button
                onClick={() => router.push('/dashboard')}
                className="px-8 py-4 bg-transparent border border-cyan-electric/30 text-cyan-electric text-lg font-semibold rounded-lg hover:bg-cyan-electric/10 hover:border-cyan-electric transition-all"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- UI phases (5 for intermediate/advanced, 4 for basic) ----------
  const isEnhanced = session.tier === 'intermediate' || session.tier === 'advanced';

  const phases: Array<{
    number: number;
    name: string;
    shortName: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
  }> = isEnhanced
    ? [
        { number: 1, name: 'Competitive Intelligence', shortName: 'Competitive Intel', status: (session.current_phase > 1 ? 'completed' : session.current_phase === 1 ? 'in_progress' : 'pending') as any },
        { number: 2, name: 'SEO & Content Strategy', shortName: 'SEO & Content', status: (session.current_phase > 2 ? 'completed' : session.current_phase === 2 ? 'in_progress' : 'pending') as any },
        { number: 3, name: 'Conversion Optimization', shortName: 'Conversion', status: (session.current_phase > 3 ? 'completed' : session.current_phase === 3 ? 'in_progress' : 'pending') as any },
        { number: 4, name: 'DataForSEO Analysis', shortName: 'DataForSEO', status: (session.current_phase > 3 ? 'completed' : session.current_phase >= 1 ? 'in_progress' : 'pending') as any },
        { number: 5, name: 'AI Synthesis', shortName: 'AI Synthesis', status: (session.current_phase >= 4 ? 'in_progress' : 'pending') as any },
      ]
    : [
        { number: 1, name: 'Competitive Intelligence', shortName: 'Competitive Intel', status: (session.current_phase > 1 ? 'completed' : session.current_phase === 1 ? 'in_progress' : 'pending') as any },
        { number: 2, name: 'SEO & Content Strategy', shortName: 'SEO & Content', status: (session.current_phase > 2 ? 'completed' : session.current_phase === 2 ? 'in_progress' : 'pending') as any },
        { number: 3, name: 'Conversion Optimization', shortName: 'Conversion', status: (session.current_phase > 3 ? 'completed' : session.current_phase === 3 ? 'in_progress' : 'pending') as any },
        { number: 4, name: 'AI Synthesis', shortName: 'AI Synthesis', status: (session.current_phase >= 4 ? 'in_progress' : 'pending') as any },
      ];

  const tierLabel = session.tier === 'advanced' ? 'Advanced' : session.tier === 'intermediate' ? 'Intermediate' : 'Basic';
  const timeEstimate = session.tier === 'basic' ? '30 minutes' : '60-90 minutes';

  // ---------- In-progress / paused / failed ----------
  return (
    <div className="min-h-screen py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <img
              src="/rae-logo.svg"
              alt="RAE Logo"
              className="h-10 w-auto cursor-pointer"
              onClick={() => router.push('/dashboard')}
            />
            <div>
              <h1 className="text-2xl font-bold text-white">Research in Progress</h1>
              <p className="text-gray-400 text-sm">{session.business_name}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 px-3 py-1 bg-cyan-electric/20 border border-cyan-electric/30 rounded-full backdrop-blur-sm">
            <div className="w-2 h-2 bg-cyan-electric rounded-full animate-pulse shadow-glow-cyan" />
            <span className="text-xs font-semibold text-cyan-electric">{tierLabel}</span>
          </div>
        </div>

        {/* Research Info */}
        <div className="text-center mb-8">
          <p className="text-gray-400">
            {session.industry} • {session.location}
          </p>
          <p className="text-sm text-gray-400 mt-2">
            This process takes approximately {timeEstimate}
          </p>

          {/* Action Buttons */}
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="inline-flex items-center justify-center rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-electric border border-cyan-electric/30 bg-transparent hover:bg-cyan-electric/10 text-cyan-electric h-10 px-6 py-2"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Return to Dashboard
            </button>

            {session.status !== 'completed' && session.status !== 'cancelled' && (
              <button
                onClick={handleCancelClick}
                disabled={cancelling}
                className="inline-flex items-center justify-center rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:pointer-events-none disabled:opacity-50 border border-red-500/30 bg-transparent hover:bg-red-500/10 text-red-400 h-10 px-6 py-2"
              >
                {cancelling ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-red-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Cancelling...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Cancel Research
                  </>
                )}
              </button>
            )}
          </div>

          {/* Safe to leave message */}
          {session.status !== 'completed' && session.status !== 'cancelled' && !(
            session.error_log?.length &&
            session.error_log[session.error_log.length - 1].error_type === 'decryption_error'
          ) && (
            <div className="mt-6 glass-panel-dark rounded-lg border border-white/10 p-4 max-w-2xl mx-auto bg-navy-dark/95">
              <div className="flex items-start space-x-3">
                <svg className="w-5 h-5 text-cyan-electric mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">You can safely leave this page</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Your research will continue running in the background. We'll send you an email notification when it's complete with a direct link to your results.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Horizontal phase stepper */}
        <ResearchProgress
          phases={phases}
          currentPhase={session.current_phase}
          status={session.status}
          onRetry={handleRetry}
          retrying={retrying}
          balanceErrors={session.balance_errors || []}
          sessionId={params.sessionId}
          failureMessage={session.error_log?.length ? session.error_log[session.error_log.length - 1].error : undefined}
          failureType={session.error_log?.length ? session.error_log[session.error_log.length - 1].error_type : undefined}
        />

        {/* Scripted progress tiles (2-2-1 grid) */}
        <ScriptedResearchProgress
          session={{
            business_name: session.business_name,
            industry: session.industry,
            location: session.location,
            city: session.city,
            state: session.state,
            primary_service: session.primary_service,
            services: session.services,
            tier: session.tier,
          }}
          currentPhase={session.current_phase}
          status={session.status}
        />
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="glass-panel-dark rounded-xl border border-white/10 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200 bg-navy-dark">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white mb-2">Cancel Research?</h3>
                <p className="text-sm text-gray-400 mb-3">
                  Are you sure you want to cancel this research? All progress will be lost and this action cannot be undone.
                </p>
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 mb-4">
                  <div className="flex items-start space-x-2">
                    <svg className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-xs text-orange-200">
                      <strong className="text-orange-300">Note:</strong> You will still be charged for API usage from completed phases (charged directly to your API keys).
                    </p>
                  </div>
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => setShowCancelConfirm(false)}
                    className="px-4 py-2 border border-white/20 rounded-lg text-gray-300 hover:bg-white/10 font-medium transition-colors"
                  >
                    Keep Research
                  </button>
                  <button
                    onClick={confirmCancel}
                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium transition-colors"
                  >
                    Yes, Cancel Research
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
