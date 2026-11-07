'use client';

import { useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  KeyHealthSnapshot,
  ProviderHealth,
  ProviderHealthStatus,
  Provider,
  Tier,
  TIER_PROVIDERS,
} from '@/lib/key-health';

interface VerifyResponse {
  ok: boolean;
  blocking: boolean;
  health: KeyHealthSnapshot;
  cached: boolean;
}

interface KeyHealthGateProps {
  /** The tier of research the user is trying to start. Determines which providers must be healthy. */
  tier: Tier;
  /** Children render only when the user's keys pass verification for this tier. */
  children: ReactNode;
}

const PROVIDER_LABEL: Record<Provider, string> = {
  claude: 'Claude (Anthropic)',
  tavily: 'Tavily',
  dataforseo: 'DataForSEO',
};

/**
 * Calls /api/keys/verify on mount. Renders:
 *  - a loading screen while verification is in progress
 *  - a block screen if any required provider is not healthy
 *  - children if all required providers are healthy
 *
 * The block screen distinguishes three causes (bad key / low balance / provider down)
 * and offers the right call-to-action for each.
 */
export function KeyHealthGate({ tier, children }: KeyHealthGateProps) {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ok' | 'blocked' | 'error'>('loading');
  const [snapshot, setSnapshot] = useState<KeyHealthSnapshot | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function runVerify(refresh = false) {
    setState('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/keys/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, refresh }),
      });
      const data = (await res.json()) as VerifyResponse | { ok: false; error?: string };
      if (!res.ok || !('health' in data)) {
        setState('error');
        setErrorMsg(('error' in data && data.error) || 'Could not verify your API keys.');
        return;
      }
      setSnapshot(data.health);
      setState(data.blocking ? 'blocked' : 'ok');
    } catch (err: any) {
      setState('error');
      setErrorMsg(err?.message || 'Network error while verifying keys.');
    }
  }

  useEffect(() => {
    runVerify(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier]);

  if (state === 'loading') return <LoadingScreen />;
  if (state === 'error')
    return <ErrorScreen message={errorMsg} onRetry={() => runVerify(true)} />;
  if (state === 'blocked' && snapshot)
    return (
      <BlockScreen
        snapshot={snapshot}
        tier={tier}
        onRetry={() => runVerify(true)}
        onManageKeys={() => router.push('/dashboard?manage=keys')}
        onBackToDashboard={() => router.push('/dashboard')}
      />
    );

  return <>{children}</>;
}

// ============================================================
// Loading
// ============================================================

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="glass-panel-dark rounded-xl border border-white/10 bg-navy-dark/95 p-8 max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-cyan-electric/20 rounded-full mb-4 border border-cyan-electric/30">
          <svg className="animate-spin w-7 h-7 text-cyan-electric" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-white mb-1">Verifying your API keys…</h2>
        <p className="text-sm text-gray-400">
          We&apos;re making a quick test call to each provider so we don&apos;t waste your time on
          a research run that would fail.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// Error (couldn't even reach our own verify endpoint)
// ============================================================

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="glass-panel-dark rounded-xl border border-red-500/30 bg-navy-dark/95 p-8 max-w-md w-full text-center">
        <h2 className="text-lg font-semibold text-red-300 mb-2">We couldn&apos;t verify your API keys</h2>
        <p className="text-sm text-gray-400 mb-5">{message}</p>
        <button
          onClick={onRetry}
          className="px-5 py-2.5 bg-cyan-electric text-navy-deep font-semibold rounded-lg hover:shadow-glow-cyan transition"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Block screen — the main thing
// ============================================================

interface BlockScreenProps {
  snapshot: KeyHealthSnapshot;
  tier: Tier;
  onRetry: () => void;
  onManageKeys: () => void;
  onBackToDashboard: () => void;
}

function BlockScreen({ snapshot, tier, onRetry, onManageKeys, onBackToDashboard }: BlockScreenProps) {
  const required = TIER_PROVIDERS[tier];
  const problems = required
    .map((provider) => ({ provider, health: snapshot[provider] }))
    .filter((p) => p.health.status !== 'healthy');

  // The dominant problem dictates the headline. Order: needs_reentry > low_balance > provider_down > missing.
  const dominant = pickDominant(problems.map((p) => p.health));

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="glass-panel-dark rounded-xl border border-white/10 bg-navy-dark/95 p-8 max-w-xl w-full">
        <Headline status={dominant} />

        <div className="mt-6 space-y-3">
          {required.map((provider) => (
            <ProviderRow key={provider} provider={provider} health={snapshot[provider]} />
          ))}
        </div>

        <div className="mt-7 pt-6 border-t border-white/10 flex flex-col sm:flex-row gap-3">
          <button
            onClick={onManageKeys}
            className="flex-1 px-4 py-2.5 bg-cyan-electric text-navy-deep font-semibold rounded-lg hover:shadow-glow-cyan transition"
          >
            Manage API Keys
          </button>
          <button
            onClick={onRetry}
            className="flex-1 px-4 py-2.5 border border-cyan-electric/40 text-cyan-electric rounded-lg hover:bg-cyan-electric/10 transition"
          >
            Retry verification
          </button>
          <button
            onClick={onBackToDashboard}
            className="flex-1 px-4 py-2.5 text-gray-400 hover:text-white transition"
          >
            Back to dashboard
          </button>
        </div>

        <p className="mt-5 text-xs text-gray-500 text-center">
          Your form data is saved automatically — when you come back, it&apos;ll be where you left it.
        </p>
      </div>
    </div>
  );
}

function pickDominant(healths: ProviderHealth[]): ProviderHealthStatus {
  const order: ProviderHealthStatus[] = ['needs_reentry', 'low_balance', 'provider_down', 'missing', 'healthy'];
  for (const status of order) if (healths.some((h) => h.status === status)) return status;
  return 'healthy';
}

function Headline({ status }: { status: ProviderHealthStatus }) {
  if (status === 'provider_down') {
    return (
      <>
        <h2 className="text-2xl font-bold text-orange-300">A provider is having issues right now</h2>
        <p className="mt-2 text-sm text-gray-300">
          This isn&apos;t a problem with your account or your API keys — one of the services
          we use is down or degraded. Try again in a few minutes.
        </p>
      </>
    );
  }
  if (status === 'low_balance') {
    return (
      <>
        <h2 className="text-2xl font-bold text-yellow-300">One of your API accounts needs more credits</h2>
        <p className="mt-2 text-sm text-gray-300">
          We won&apos;t start research that&apos;s guaranteed to fail mid-run. Add credits to the
          account below, then click &quot;Retry verification&quot;.
        </p>
      </>
    );
  }
  if (status === 'needs_reentry') {
    return (
      <>
        <h2 className="text-2xl font-bold text-red-300">Your API keys need attention</h2>
        <p className="mt-2 text-sm text-gray-300">
          One or more of your saved API keys can&apos;t be used. Re-enter the affected keys
          and you&apos;re good to go.
        </p>
      </>
    );
  }
  if (status === 'missing') {
    return (
      <>
        <h2 className="text-2xl font-bold text-white">Add your API keys to start</h2>
        <p className="mt-2 text-sm text-gray-300">
          You haven&apos;t saved keys for one or more required providers yet.
        </p>
      </>
    );
  }
  return null;
}

function ProviderRow({ provider, health }: { provider: Provider; health: ProviderHealth }) {
  const label = PROVIDER_LABEL[provider];

  if (health.status === 'healthy') {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-green-500/20 bg-green-500/5 p-3">
        <span className="mt-0.5 text-green-400 text-sm">✓</span>
        <div>
          <p className="text-sm font-medium text-white">{label}</p>
          <p className="text-xs text-green-300/80">Verified</p>
        </div>
      </div>
    );
  }

  const palette = paletteFor(health.status);
  return (
    <div className={`rounded-lg border ${palette.border} ${palette.bg} p-4`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 text-sm ${palette.icon}`}>{palette.symbol}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">{label}</p>
          {health.reason && <p className="text-xs text-gray-300 mt-0.5">{health.reason}</p>}
          {health.link && (
            <a
              href={health.link}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-block mt-2 text-xs font-medium underline ${palette.link}`}
            >
              {linkLabelFor(health.status)} →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function paletteFor(status: ProviderHealthStatus) {
  switch (status) {
    case 'needs_reentry':
      return {
        border: 'border-red-500/30',
        bg: 'bg-red-500/5',
        icon: 'text-red-400',
        symbol: '✕',
        link: 'text-red-300 hover:text-red-200',
      };
    case 'low_balance':
      return {
        border: 'border-yellow-500/30',
        bg: 'bg-yellow-500/5',
        icon: 'text-yellow-400',
        symbol: '!',
        link: 'text-yellow-300 hover:text-yellow-200',
      };
    case 'provider_down':
      return {
        border: 'border-orange-500/30',
        bg: 'bg-orange-500/5',
        icon: 'text-orange-400',
        symbol: '◐',
        link: 'text-orange-300 hover:text-orange-200',
      };
    case 'missing':
    default:
      return {
        border: 'border-white/15',
        bg: 'bg-white/5',
        icon: 'text-gray-400',
        symbol: '–',
        link: 'text-cyan-electric hover:text-cyan-300',
      };
  }
}

function linkLabelFor(status: ProviderHealthStatus): string {
  if (status === 'low_balance') return 'Add credits';
  if (status === 'provider_down') return 'Check provider status';
  return 'Open provider';
}
