'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ResearchProgress from '@/components/research-progress';
import ScriptedResearchProgress from '@/components/scripted-research-progress';

const DEMO_BUSINESS = 'Demo Coffee Shop';
const DEMO_INDUSTRY = 'Coffee Shop';
const DEMO_LOCATION = 'Austin, TX';

/** Simulated step duration in ms (short so demo runs in ~30–45s) */
const STEP_MS = 2200;
const CITATION_STEPS_P1 = [0, 2, 5, 8, 12];
const CITATION_STEPS_P2 = [0, 3, 7, 11, 15];
const CITATION_STEPS_P3 = [0, 2, 6, 10, 14];

export default function ResearchDemoPage() {
  const router = useRouter();
  const [currentPhase, setCurrentPhase] = useState(1);
  const [status, setStatus] = useState<'in_progress' | 'completed'>('in_progress');
  const [citationCounts, setCitationCounts] = useState({ phase1: 0, phase2: 0, phase3: 0 });
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [phaseTimes, setPhaseTimes] = useState<Record<number, number>>({});
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopDemo = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const runDemo = useCallback(() => {
    stopDemo();
    setCurrentPhase(1);
    setStatus('in_progress');
    setCitationCounts({ phase1: 0, phase2: 0, phase3: 0 });
    setIsLiveConnected(true);
    setPhaseTimes({});
    setStartedAt(Date.now());

    let stepIndex = 0;
    const totalSteps =
      CITATION_STEPS_P1.length +
      CITATION_STEPS_P2.length +
      CITATION_STEPS_P3.length +
      2; // phase 4 "in progress" + done

    intervalRef.current = setInterval(() => {
      stepIndex += 1;

      if (stepIndex <= CITATION_STEPS_P1.length) {
        const i = stepIndex - 1;
        setCitationCounts((c) => ({ ...c, phase1: CITATION_STEPS_P1[i] ?? c.phase1 }));
        if (stepIndex === CITATION_STEPS_P1.length) {
          setPhaseTimes((t) => ({ ...t, 1: STEP_MS * CITATION_STEPS_P1.length }));
          setCurrentPhase(2);
        }
        return;
      }

      const p2Start = CITATION_STEPS_P1.length;
      if (stepIndex <= p2Start + CITATION_STEPS_P2.length) {
        const i = stepIndex - p2Start - 1;
        setCitationCounts((c) => ({ ...c, phase2: CITATION_STEPS_P2[i] ?? c.phase2 }));
        if (stepIndex === p2Start + CITATION_STEPS_P2.length) {
          setPhaseTimes((t) => ({ ...t, 2: STEP_MS * CITATION_STEPS_P2.length }));
          setCurrentPhase(3);
        }
        return;
      }

      const p3Start = p2Start + CITATION_STEPS_P2.length;
      if (stepIndex <= p3Start + CITATION_STEPS_P3.length) {
        const i = stepIndex - p3Start - 1;
        setCitationCounts((c) => ({ ...c, phase3: CITATION_STEPS_P3[i] ?? c.phase3 }));
        if (stepIndex === p3Start + CITATION_STEPS_P3.length) {
          setPhaseTimes((t) => ({ ...t, 3: STEP_MS * CITATION_STEPS_P3.length }));
          setCurrentPhase(4);
        }
        return;
      }

      const p4Start = p3Start + CITATION_STEPS_P3.length;
      if (stepIndex === p4Start + 1) {
        setPhaseTimes((t) => ({ ...t, 4: STEP_MS * 2 }));
        setStatus('completed');
        setIsLiveConnected(false);
        stopDemo();
      }
    }, STEP_MS);
  }, [stopDemo]);

  useEffect(() => {
    return () => stopDemo();
  }, [stopDemo]);

  const totalTimeMs =
    startedAt && status === 'completed'
      ? Date.now() - startedAt
      : startedAt
        ? Date.now() - startedAt
        : undefined;

  const phases = [
    {
      number: 1,
      name: 'Competitive Intelligence',
      shortName: 'Competitive Intel',
      status: (currentPhase > 1 ? 'completed' : currentPhase === 1 ? 'in_progress' : 'pending') as 'pending' | 'in_progress' | 'completed' | 'failed',
      timeMs: phaseTimes[1],
    },
    {
      number: 2,
      name: 'SEO & Content Strategy',
      shortName: 'SEO & Content',
      status: (currentPhase > 2 ? 'completed' : currentPhase === 2 ? 'in_progress' : 'pending') as 'pending' | 'in_progress' | 'completed' | 'failed',
      timeMs: phaseTimes[2],
    },
    {
      number: 3,
      name: 'Conversion Optimization',
      shortName: 'Conversion',
      status: (currentPhase > 3 ? 'completed' : currentPhase === 3 ? 'in_progress' : 'pending') as 'pending' | 'in_progress' | 'completed' | 'failed',
      timeMs: phaseTimes[3],
    },
    {
      number: 4,
      name: 'DataForSEO Analysis',
      shortName: 'DataForSEO',
      status: (currentPhase > 3 ? 'completed' : currentPhase >= 1 ? 'in_progress' : 'pending') as 'pending' | 'in_progress' | 'completed' | 'failed',
      timeMs: phaseTimes[3],
    },
    {
      number: 5,
      name: 'AI Synthesis',
      shortName: 'AI Synthesis',
      status: status === 'completed' ? 'completed' : (currentPhase === 4 ? 'in_progress' : 'pending') as 'pending' | 'in_progress' | 'completed' | 'failed',
      timeMs: phaseTimes[4],
    },
  ];

  const isCompleted = status === 'completed';

  if (isCompleted) {
    const totalTime = totalTimeMs
      ? `${Math.floor(totalTimeMs / 60000)}m ${Math.floor((totalTimeMs % 60000) / 1000)}s`
      : 'N/A';
    return (
      <div className="min-h-screen py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="glass-panel-dark rounded-lg p-12 text-center bg-navy-dark/95 border border-white/10">
            <h1 className="text-2xl font-bold text-white mb-2">Demo complete</h1>
            <p className="text-gray-400 mb-2">{DEMO_BUSINESS}</p>
            <p className="text-sm text-gray-500 mb-6">Total time: {totalTime}</p>
            <p className="text-sm text-gray-400 mb-8">
              This was simulated progress. Use a real research session for actual results.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={runDemo}
                className="px-6 py-3 bg-cyan-electric text-navy-deep font-semibold rounded-lg hover:shadow-glow-cyan transition"
              >
                Run demo again
              </button>
              <button
                onClick={() => router.push('/dashboard')}
                className="px-6 py-3 border border-cyan-electric/30 text-cyan-electric rounded-lg hover:bg-cyan-electric/10 transition"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Demo banner */}
        <div className="mb-6 glass-panel-dark rounded-lg border border-amber-500/30 p-3 flex items-center justify-between bg-amber-500/5">
          <span className="text-sm text-amber-200">
            <strong>Demo mode</strong> — Simulated progress. No real research is running.
          </span>
          <button
            onClick={() => router.push('/dashboard')}
            className="text-xs text-amber-300 hover:text-amber-200 underline"
          >
            Exit to dashboard
          </button>
        </div>

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
              <p className="text-gray-400 text-sm">{DEMO_BUSINESS}</p>
            </div>
          </div>
          {isLiveConnected && (
            <div className="flex items-center space-x-2 px-3 py-1 bg-cyan-electric/20 border border-cyan-electric/30 rounded-full backdrop-blur-sm">
              <div className="w-2 h-2 bg-cyan-electric rounded-full animate-pulse shadow-glow-cyan" />
              <span className="text-xs font-semibold text-cyan-electric">LIVE</span>
            </div>
          )}
        </div>

        {/* Research info */}
        <div className="text-center mb-8">
          <p className="text-gray-400">
            {DEMO_INDUSTRY} • {DEMO_LOCATION}
          </p>
          <p className="text-sm text-gray-400 mt-2">
            Demo runs in ~30–45 seconds
          </p>
          {!startedAt && (
            <div className="mt-6">
              <button
                onClick={runDemo}
                className="px-6 py-3 bg-cyan-electric text-navy-deep font-semibold rounded-lg hover:shadow-glow-cyan transition"
              >
                Start demo
              </button>
            </div>
          )}
        </div>

        {startedAt && (
          <>
            <ResearchProgress
              phases={phases}
              currentPhase={currentPhase}
              status={status}
              totalTimeMs={totalTimeMs}
              balanceErrors={[]}
              sessionId="demo"
            />
            <ScriptedResearchProgress
              session={{
                business_name: DEMO_BUSINESS,
                industry: DEMO_INDUSTRY,
                location: DEMO_LOCATION,
                tier: 'intermediate',
              }}
              currentPhase={currentPhase}
              status={status}
            />
          </>
        )}
      </div>
    </div>
  );
}
