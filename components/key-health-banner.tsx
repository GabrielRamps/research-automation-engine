'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyHealthSnapshot, Provider, ProviderHealthStatus } from '@/lib/key-health';

const PROVIDER_LABEL: Record<Provider, string> = {
  claude: 'Claude',
  tavily: 'Tavily',
  dataforseo: 'DataForSEO',
};

/**
 * Persistent banner shown on the dashboard. Decrypt-only check (no provider
 * pings, no cost). Only shows when at least one stored key can't be decrypted.
 *
 * For full live verification (bad key / low balance / provider down), the form
 * gate at /generate uses /api/keys/verify instead.
 */
export function KeyHealthBanner() {
  const router = useRouter();
  const [broken, setBroken] = useState<Provider[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/keys/health')
      .then((r) => r.json())
      .then((data: { ok?: boolean; health?: KeyHealthSnapshot }) => {
        if (cancelled || !data.ok || !data.health) return;
        const bad: Provider[] = [];
        (Object.keys(PROVIDER_LABEL) as Provider[]).forEach((p) => {
          const status: ProviderHealthStatus = data.health![p].status;
          // Only `needs_reentry` warrants a persistent banner. `missing` is
          // expected for fresh users and is handled by the regular setup flow.
          // `low_balance` and `provider_down` are caught by the form gate, not here.
          if (status === 'needs_reentry') bad.push(p);
        });
        setBroken(bad);
      })
      .catch(() => {
        // Banner is best-effort; if the health endpoint fails, just don't show it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!broken || broken.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
      <svg className="w-5 h-5 mt-0.5 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-red-200">
          Your saved API key{broken.length > 1 ? 's' : ''} for{' '}
          {broken.map((p, i) => (
            <span key={p}>
              {i > 0 && (i === broken.length - 1 ? ' and ' : ', ')}
              <span className="font-bold">{PROVIDER_LABEL[p]}</span>
            </span>
          ))}{' '}
          can&apos;t be read.
        </p>
        <p className="text-xs text-red-200/80 mt-1">
          This usually happens after a security update. Re-enter the affected key
          {broken.length > 1 ? 's' : ''} to start a new research run.
        </p>
      </div>
      <button
        onClick={() => router.push('/dashboard?manage=keys')}
        className="flex-shrink-0 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-100 text-sm font-medium rounded border border-red-500/40 transition"
      >
        Manage Keys →
      </button>
    </div>
  );
}
