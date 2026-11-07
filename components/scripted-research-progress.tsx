'use client';

import { useEffect, useState, useRef } from 'react';

type Tier = 'basic' | 'intermediate' | 'advanced';

interface SessionData {
  business_name?: string;
  industry?: string;
  location?: string;
  city?: string;
  state?: string;
  primary_service?: string;
  services?: string;
  tier?: Tier;
}

interface ScriptedStep {
  id: string;
  label: string;
  phase: number;
  group: string;
}

interface ScriptedResearchProgressProps {
  session: SessionData;
  currentPhase: number;
  status: string;
}

function buildSteps(session: SessionData): ScriptedStep[] {
  const {
    industry = 'your industry',
    location = 'your area',
    city,
    state,
    primary_service,
    services,
  } = session;

  const tier = session.tier || 'basic';
  const svc = primary_service || services?.split(',')[0]?.trim() || industry;
  const geo = city && state ? `${city}, ${state}` : location;

  const steps: ScriptedStep[] = [
    // Phase 1
    { id: 'p1-1', label: `Analyzing ${industry} competitors in ${geo}`, phase: 1, group: 'Competitive Intelligence' },
    { id: 'p1-2', label: `Evaluating market positioning for ${svc}`, phase: 1, group: 'Competitive Intelligence' },
    { id: 'p1-3', label: 'Gathering competitive intelligence data', phase: 1, group: 'Competitive Intelligence' },
    { id: 'p1-4', label: 'Reviewing competitor strategies and offerings', phase: 1, group: 'Competitive Intelligence' },
    // Phase 2
    { id: 'p2-1', label: `Researching keyword opportunities for ${industry}`, phase: 2, group: 'SEO & Content Strategy' },
    { id: 'p2-2', label: `Analyzing search patterns in ${geo}`, phase: 2, group: 'SEO & Content Strategy' },
    { id: 'p2-3', label: 'Identifying content gaps and opportunities', phase: 2, group: 'SEO & Content Strategy' },
    { id: 'p2-4', label: 'Evaluating local search demand', phase: 2, group: 'SEO & Content Strategy' },
    // Phase 3
    { id: 'p3-1', label: `Investigating ${industry} industry trends`, phase: 3, group: 'Conversion Optimization' },
    { id: 'p3-2', label: 'Analyzing conversion benchmarks', phase: 3, group: 'Conversion Optimization' },
    { id: 'p3-3', label: `Evaluating growth opportunities for ${svc}`, phase: 3, group: 'Conversion Optimization' },
  ];

  if (tier === 'intermediate' || tier === 'advanced') {
    steps.push(
      { id: 'df-1', label: 'Running technical SEO audit', phase: 3, group: 'DataForSEO Analysis' },
      { id: 'df-2', label: 'Analyzing keyword universe with DataForSEO', phase: 3, group: 'DataForSEO Analysis' },
      { id: 'df-3', label: 'Evaluating SERP competition', phase: 3, group: 'DataForSEO Analysis' },
      { id: 'df-4', label: 'Auditing on-page elements', phase: 3, group: 'DataForSEO Analysis' },
      { id: 'df-5', label: 'Gathering review intelligence', phase: 3, group: 'DataForSEO Analysis' },
    );
  }

  if (tier === 'intermediate' || tier === 'advanced') {
    steps.push(
      { id: 'p4-1', label: 'Building keyword strategy & prioritization', phase: 4, group: 'AI Synthesis' },
      { id: 'p4-2', label: 'Analyzing market position & competition', phase: 4, group: 'AI Synthesis' },
      { id: 'p4-3', label: 'Crafting content strategy & blog calendar', phase: 4, group: 'AI Synthesis' },
      { id: 'p4-4', label: 'Generating CRO optimization guide', phase: 4, group: 'AI Synthesis' },
      { id: 'p4-5', label: 'Planning off-page roadmap & benchmarks', phase: 4, group: 'AI Synthesis' },
      { id: 'p4-6', label: 'Designing site architecture & SEO specs', phase: 4, group: 'AI Synthesis' },
      { id: 'p4-7', label: 'Creating UI design direction', phase: 4, group: 'AI Synthesis' },
      { id: 'p4-8', label: 'Compiling project overview for Cursor AI', phase: 4, group: 'AI Synthesis' },
    );
  } else {
    steps.push(
      { id: 'p4-1', label: 'Building competitive intelligence report', phase: 4, group: 'AI Synthesis' },
      { id: 'p4-2', label: 'Crafting SEO strategy guide', phase: 4, group: 'AI Synthesis' },
      { id: 'p4-3', label: 'Generating CRO optimization guide', phase: 4, group: 'AI Synthesis' },
      { id: 'p4-4', label: 'Designing site architecture', phase: 4, group: 'AI Synthesis' },
      { id: 'p4-5', label: 'Creating UI design direction', phase: 4, group: 'AI Synthesis' },
    );
  }

  return steps;
}

function getStepIntervalMs(tier: Tier | undefined, phase: number): number {
  if (tier === 'intermediate' || tier === 'advanced') {
    return phase === 4 ? 15000 : 12000;
  }
  return phase === 4 ? 10000 : 8000;
}

export default function ScriptedResearchProgress({
  session,
  currentPhase,
  status,
}: ScriptedResearchProgressProps) {
  const steps = useRef(buildSteps(session));
  const [activeStepIndex, setActiveStepIndex] = useState(() => {
    const allSteps = buildSteps(session);
    const firstIdx = allSteps.findIndex((s) => s.phase >= currentPhase);
    return firstIdx >= 0 ? firstIdx : 0;
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPhaseRef = useRef(currentPhase);

  // When real phase advances, jump the animation to the first step of that phase
  useEffect(() => {
    if (currentPhase > lastPhaseRef.current) {
      lastPhaseRef.current = currentPhase;
      const firstIdx = steps.current.findIndex((s) => s.phase >= currentPhase);
      if (firstIdx >= 0 && firstIdx > activeStepIndex) {
        setActiveStepIndex(firstIdx);
      }
    }
  }, [currentPhase, activeStepIndex]);

  // Auto-advance scripted steps on a timer
  useEffect(() => {
    if (status === 'completed' || status === 'failed' || status === 'paused' || status === 'cancelled') {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const currentStep = steps.current[activeStepIndex];
    if (!currentStep) return;

    const nextIndex = activeStepIndex + 1;
    const nextStep = steps.current[nextIndex];

    // Don't auto-advance past the current real phase boundary
    if (nextStep && nextStep.phase > currentPhase) return;

    // Don't advance past the last step
    if (nextIndex >= steps.current.length) return;

    const interval = getStepIntervalMs(session.tier, currentStep.phase);
    timerRef.current = setTimeout(() => {
      setActiveStepIndex(nextIndex);
    }, interval);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeStepIndex, currentPhase, status, session.tier]);

  const allSteps = steps.current;
  const isTerminal = status === 'completed' || status === 'failed' || status === 'paused' || status === 'cancelled';

  // Group steps by group label for rendering
  const groups: { group: string; steps: (ScriptedStep & { index: number })[] }[] = [];
  const seenGroups = new Set<string>();
  for (let i = 0; i < allSteps.length; i++) {
    const step = allSteps[i];
    if (!seenGroups.has(step.group)) {
      seenGroups.add(step.group);
      groups.push({ group: step.group, steps: [] });
    }
    groups.find((g) => g.group === step.group)!.steps.push({ ...step, index: i });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {groups.map((group, groupIndex) => {
        const groupDone = isTerminal
          ? status === 'completed'
          : group.steps.every((s) => s.index < activeStepIndex);
        const groupActive = !groupDone && group.steps.some(
          (s) => s.index <= activeStepIndex && s.index >= activeStepIndex - (group.steps.length - 1)
        );
        const isLastOdd = groupIndex === groups.length - 1 && groups.length % 2 !== 0;

        return (
          <div
            key={group.group}
            className={`rounded-xl border p-4 transition-all duration-500 ${
              isLastOdd ? 'md:col-span-2' : ''
            } ${
              groupDone
                ? 'border-green-500/30 bg-green-500/5'
                : groupActive
                ? 'border-cyan-electric/30 bg-cyan-electric/5'
                : 'border-white/10 bg-white/[0.02]'
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              {groupDone ? (
                <div className="w-7 h-7 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : groupActive ? (
                <div className="w-7 h-7 rounded-full bg-cyan-electric/20 border border-cyan-electric/30 flex items-center justify-center flex-shrink-0">
                  <div className="w-3.5 h-3.5 border-2 border-cyan-electric border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="w-7 h-7 rounded-full bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0">
                  <div className="w-2 h-2 rounded-full bg-gray-500" />
                </div>
              )}
              <h3 className={`text-sm font-semibold ${
                groupDone ? 'text-green-400' : groupActive ? 'text-cyan-electric' : 'text-gray-500'
              }`}>
                {group.group}
              </h3>
            </div>

            <div className="ml-10 space-y-2">
              {group.steps.map((step) => {
                const isDone = isTerminal ? status === 'completed' : step.index < activeStepIndex;
                const isActive = !isTerminal && step.index === activeStepIndex;

                return (
                  <div
                    key={step.id}
                    className={`flex items-center gap-2.5 transition-all duration-300 ${
                      isDone ? 'opacity-60' : isActive ? 'opacity-100' : 'opacity-30'
                    }`}
                  >
                    {isDone ? (
                      <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : isActive ? (
                      <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                        <div className="w-1.5 h-1.5 bg-cyan-electric rounded-full animate-pulse" />
                      </div>
                    ) : (
                      <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                        <div className="w-1.5 h-1.5 bg-gray-600 rounded-full" />
                      </div>
                    )}
                    <span className={`text-sm ${
                      isDone ? 'text-gray-400' : isActive ? 'text-white' : 'text-gray-600'
                    }`}>
                      {step.label}
                      {isActive && <span className="text-cyan-electric animate-pulse">...</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Holding message when all scripted steps consumed but not yet complete */}
      {!isTerminal && activeStepIndex >= allSteps.length - 1 && (
        <div className="md:col-span-2 rounded-xl border border-cyan-electric/20 bg-cyan-electric/5 p-4 flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-cyan-electric/20 border border-cyan-electric/30 flex items-center justify-center flex-shrink-0">
            <div className="w-3.5 h-3.5 border-2 border-cyan-electric border-t-transparent rounded-full animate-spin" />
          </div>
          <span className="text-sm text-cyan-electric">
            Finalizing your research package<span className="animate-pulse">...</span>
          </span>
        </div>
      )}
    </div>
  );
}
