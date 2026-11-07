'use client';

import React from 'react';

interface Phase {
  number: number;
  name: string;
  shortName?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  timeMs?: number;
}

interface BalanceError {
  service: 'claude' | 'tavily' | 'dataforseo';
  message: string;
  instructions: string;
  link: string;
  phase: number;
  timestamp?: string;
}

interface ResearchProgressProps {
  phases: Phase[];
  currentPhase: number;
  status: string;
  totalTimeMs?: number;
  onRetry?: () => void;
  retrying?: boolean;
  balanceErrors?: BalanceError[];
  sessionId: string;
  failureMessage?: string;
  failureType?: string;
}

export default function ResearchProgress({ phases, currentPhase, status, totalTimeMs, onRetry, retrying, balanceErrors = [], sessionId, failureMessage, failureType }: ResearchProgressProps) {
  const isDecryptionError =
    failureType === 'decryption_error' ||
    (typeof failureMessage === 'string' && /Failed to decrypt data/i.test(failureMessage));
  const completedPhases = phases.filter(p => p.status === 'completed').length;
  const progress = (completedPhases / phases.length) * 100;

  return (
    <div className="w-full">
      {/* Balance Error Alert */}
      {balanceErrors && balanceErrors.length > 0 && (
        <div className="mb-6 glass-panel-dark rounded-lg p-6 border border-orange-500/30 bg-navy-dark/95">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <svg className="w-6 h-6 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-orange-300 mb-2">
                API Balance Issue Detected
              </h3>
              <p className="text-orange-200/90 mb-4">
                The research process stopped because one or more of your API keys has insufficient balance.
              </p>
              <div className="space-y-3">
                {balanceErrors.map((be, idx) => (
                  <div key={idx} className="glass-panel-dark rounded-lg p-4 border border-white/10 bg-navy-dark/90">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-semibold text-white mb-1">
                          {be.service === 'claude' && '🔵 Claude (Anthropic)'}
                          {be.service === 'tavily' && '🟢 Tavily'}
                          {be.service === 'dataforseo' && '🟠 DataForSEO'}
                        </h4>
                        <p className="text-sm text-gray-300 mb-2">
                          {be.message}
                        </p>
                        <p className="text-sm text-gray-400 mb-3">
                          {be.instructions}
                        </p>
                        <a
                          href={be.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center text-sm font-medium text-cyan-electric hover:text-cyan-300 underline"
                        >
                          Add Balance →
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-white/10">
                <p className="text-sm text-gray-300 mb-3">
                  <strong>Next Steps:</strong>
                </p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-400">
                  <li>Add balance to the affected API key(s) using the links above</li>
                  <li>Update your API keys in the dashboard if needed</li>
                  <li>Click &quot;Retry from Failed Phase&quot; below to continue your research</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Horizontal Phase Stepper */}
      <div className="glass-panel-dark rounded-xl border border-white/10 bg-navy-dark/95 p-6 mb-6">
        {/* Progress summary */}
        <div className="flex justify-between items-center mb-5">
          <span className="text-sm font-medium text-white">
            Phase {Math.min(currentPhase, phases.length)} of {phases.length}
          </span>
          <span className="text-sm text-gray-400">
            {Math.round(progress)}% Complete
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-navy-deep rounded-full h-2 overflow-hidden border border-white/10 mb-6">
          <div
            className="bg-cyan-electric h-2 rounded-full transition-all duration-500 ease-out shadow-glow-cyan"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Stepper circles + connectors */}
        <div className="flex items-start w-full">
          {phases.map((phase, index) => (
            <React.Fragment key={phase.number}>
              {/* Connector line between circles */}
              {index > 0 && (
                <div className={`h-0.5 flex-1 mt-5 mx-1 ${
                  phases[index - 1].status === 'completed' ? 'bg-green-500/50' : 'bg-white/10'
                }`} />
              )}
              <div className="flex flex-col items-center flex-none">
                {/* Circle */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                  phase.status === 'completed'
                    ? 'bg-green-500/20 border-green-500 text-green-400'
                    : phase.status === 'in_progress'
                    ? 'bg-cyan-electric/20 border-cyan-electric text-cyan-electric shadow-glow-cyan'
                    : phase.status === 'failed'
                    ? 'bg-red-500/20 border-red-500 text-red-400'
                    : 'bg-white/5 border-white/20 text-gray-500'
                }`}>
                  {phase.status === 'completed' ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : phase.status === 'in_progress' ? (
                    <div className="w-4 h-4 border-2 border-cyan-electric border-t-transparent rounded-full animate-spin" />
                  ) : phase.status === 'failed' ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <span className="text-xs font-bold">{phase.number}</span>
                  )}
                </div>
                {/* Label */}
                <span className={`text-[11px] mt-2 text-center font-medium leading-tight max-w-[72px] ${
                  phase.status === 'completed'
                    ? 'text-green-400'
                    : phase.status === 'in_progress'
                    ? 'text-cyan-electric'
                    : phase.status === 'failed'
                    ? 'text-red-400'
                    : 'text-gray-500'
                }`}>
                  {phase.shortName || phase.name}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Total Time */}
      {status === 'completed' && totalTimeMs && (
        <div className="mt-6 glass-panel-dark rounded-lg p-6 border border-green-500/30 text-center bg-navy-dark/95">
          <h3 className="text-xl font-bold text-green-400 mb-2">
            Research Complete!
          </h3>
          <p className="text-gray-300">
            Total time: {(() => { const s = Math.floor(totalTimeMs / 1000); return `${Math.floor(s / 60)}m ${s % 60}s`; })()}
          </p>
        </div>
      )}

      {/* Paused Status (Balance Error - Recoverable) */}
      {status === 'paused' && (
        <div className="mt-8 glass-panel-dark rounded-lg p-6 border border-orange-500/30 text-center bg-navy-dark/95">
          <div className="flex items-center justify-center mb-2">
            <svg className="w-8 h-8 text-orange-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-xl font-bold text-orange-300">
              Research Paused - Action Required
            </h3>
          </div>
          <p className="text-gray-300 mb-4">
            Your research has been paused due to an API balance issue. <strong className="text-white">Your progress has been saved!</strong> 
            Add balance to your API key and click Resume to continue from where you left off.
          </p>
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 mb-4 text-sm text-gray-300">
            <p className="font-medium">✓ All completed work is saved</p>
            <p className="font-medium">✓ No need to start over</p>
            <p className="font-medium">✓ Resume will continue from Phase {currentPhase}</p>
          </div>
          {onRetry && (
            <button 
              onClick={onRetry}
              disabled={retrying}
              className="px-6 py-3 bg-cyan-electric text-navy-deep font-semibold rounded-lg hover:shadow-glow-cyan disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {retrying ? 'Resuming Research...' : 'Resume Research'}
            </button>
          )}
        </div>
      )}

      {/* Failed Status (Critical Error) — also surfaces decryption errors even if status is still
          'in_progress' (e.g., older stuck sessions before the worker started tagging them). */}
      {(status === 'failed' || (status === 'in_progress' && isDecryptionError)) && (
        <div className="mt-8 glass-panel-dark rounded-lg p-6 border border-red-500/30 text-center bg-navy-dark/95">
          <div className="flex items-center justify-center mb-2">
            <svg className="w-8 h-8 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-xl font-bold text-red-300">
              Research Failed
            </h3>
          </div>
          {isDecryptionError ? (
            <>
              <p className="text-gray-300 mb-4">
                We couldn&apos;t decrypt your saved API keys. This usually happens after a security
                update — your existing keys are no longer readable and need to be re-entered.
                <strong className="text-white"> No charges were made.</strong>
              </p>
              <div className="bg-cyan-electric/10 border border-cyan-electric/30 rounded-lg p-4 mb-4 text-sm text-gray-200 text-left">
                <p className="font-semibold text-white mb-2">To fix this:</p>
                <ol className="list-decimal list-inside space-y-1 text-gray-300">
                  <li>Open <strong>Manage API Keys</strong> below</li>
                  <li>Re-enter your Claude, Tavily, and (if applicable) DataForSEO keys</li>
                  <li>Return to your dashboard and start a new research session</li>
                </ol>
              </div>
              <a
                href="/dashboard?manage=keys"
                className="inline-block px-6 py-3 bg-cyan-electric text-navy-deep font-semibold rounded-lg hover:shadow-glow-cyan transition-colors"
              >
                Manage API Keys →
              </a>
            </>
          ) : failureMessage && /overload|Overloaded|rate_limit|capacity/i.test(failureMessage) ? (
            <>
              <p className="text-gray-300 mb-4">
                Our AI provider was temporarily overloaded. <strong className="text-white">Your progress is saved.</strong> Click Resume to continue from where you left off — no need to start over.
              </p>
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 text-sm text-gray-300">
                <p className="font-medium">✓ Completed phases are saved</p>
                <p className="font-medium">✓ Resume will continue from Phase {currentPhase}</p>
                <p className="font-medium">✓ This often clears in a few minutes</p>
              </div>
              {onRetry && (
                <button
                  onClick={onRetry}
                  disabled={retrying}
                  className="px-6 py-3 bg-cyan-electric text-navy-deep font-semibold rounded-lg hover:shadow-glow-cyan disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {retrying ? 'Resuming...' : 'Resume Research'}
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-gray-300 mb-4">
                An error occurred during Phase {currentPhase}. Your completed phases are saved.
                Click Retry to attempt recovery from the last checkpoint.
              </p>
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-sm text-gray-300">
                <p className="font-medium">• Phases 1-{currentPhase - 1} are saved</p>
                <p className="font-medium">• Phase {currentPhase} will be retried</p>
                <p className="font-medium">• Check your internet connection and API keys</p>
              </div>
              {onRetry && (
                <button
                  onClick={onRetry}
                  disabled={retrying}
                  className="px-6 py-3 bg-cyan-electric text-navy-deep font-semibold rounded-lg hover:shadow-glow-cyan disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {retrying ? 'Resuming...' : 'Resume Research'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Cancelled Status */}
      {status === 'cancelled' && (
        <div className="mt-8 glass-panel-dark rounded-lg p-6 border border-white/10 text-center bg-navy-dark/95">
          <h3 className="text-xl font-bold text-white mb-2">
            Research Cancelled
          </h3>
          <p className="text-gray-400">
            This research was cancelled during Phase {currentPhase}. Redirecting to dashboard...
          </p>
        </div>
      )}
    </div>
  );
}

