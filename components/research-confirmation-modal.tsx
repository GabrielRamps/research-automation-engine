'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InlineSpinner } from '@/components/ui/loading-spinner';

type Tier = 'basic' | 'intermediate' | 'advanced';

interface Props {
  tier: Tier;
  onConfirm: () => void;
  onCancel: () => void;
}

const MIN_BALANCE: Record<Tier, number> = {
  basic: 0,
  intermediate: 2,
  advanced: 100,
};

const ESTIMATED_COSTS: Record<Tier, { claude: string; tavily: string; dataforseo?: string }> = {
  basic: { claude: '~$2-5', tavily: '~50-100 searches' },
  intermediate: { claude: '~$2-5', tavily: '~50-100 searches', dataforseo: '~$0.78' },
  advanced: { claude: '~$2-5', tavily: '~50-100 searches', dataforseo: '~$0.94' },
};

const BILLING_LINKS = {
  claude: 'https://console.anthropic.com/settings/billing',
  tavily: 'https://app.tavily.com/billing',
  dataforseo: 'https://app.dataforseo.com/billing',
};

export function ResearchConfirmationModal({ tier, onConfirm, onCancel }: Props) {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState('');
  const [balanceErrorCode, setBalanceErrorCode] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminOverride, setAdminOverride] = useState(false);

  const isEnhanced = tier !== 'basic';
  const minBalance = MIN_BALANCE[tier];
  const costs = ESTIMATED_COSTS[tier];
  const balanceTooLow = isEnhanced && balance !== null && balance < minBalance;
  const canConfirm = !balanceLoading && (!balanceTooLow || adminOverride);

  useEffect(() => {
    if (!isEnhanced) return;

    setBalanceLoading(true);
    setBalanceError('');
    setBalanceErrorCode(null);

    const balancePromise = fetch('/api/keys/check-balance')
      .then((res) => res.json())
      .then((data: { balance: number | null; error?: string; code?: string }) => {
        if (data.error) {
          setBalanceError(data.error);
          if (data.code) setBalanceErrorCode(data.code);
        } else {
          setBalance(data.balance);
        }
      })
      .catch(() => {
        setBalanceError('Could not check balance');
      });

    const adminPromise = fetch('/api/admin/check-access')
      .then((res) => res.json())
      .then((data: { isAdmin?: boolean }) => {
        setIsAdmin(!!data.isAdmin);
      })
      .catch(() => {});

    Promise.all([balancePromise, adminPromise]).finally(() => {
      setBalanceLoading(false);
    });
  }, [isEnhanced]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 glass-panel rounded-xl border border-white/10 p-6 shadow-2xl">
        <h2 className="text-xl font-bold text-white mb-1">Before Starting Research</h2>
        <p className="text-sm text-gray-400 mb-5">
          Please confirm you have sufficient API credits for the{' '}
          <span className="text-cyan-electric font-medium capitalize">{tier}</span> tier.
        </p>

        {/* Service checklist */}
        <div className="space-y-3 mb-5">
          {/* Claude */}
          <ServiceRow
            name="Claude"
            estimate={costs.claude}
            link={BILLING_LINKS.claude}
          />

          {/* Tavily */}
          <ServiceRow
            name="Tavily"
            estimate={costs.tavily}
            link={BILLING_LINKS.tavily}
          />

          {/* DataForSEO (enhanced tiers only) */}
          {isEnhanced && (
            <div className="flex items-start justify-between rounded-lg border border-white/10 bg-navy-dark/60 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">DataForSEO</span>
                  {balanceLoading && <InlineSpinner className="h-4 w-4" />}
                  {!balanceLoading && balance !== null && !balanceTooLow && (
                    <span className="text-xs text-green-400">
                      ${balance.toFixed(2)}
                    </span>
                  )}
                  {!balanceLoading && balance !== null && balanceTooLow && (
                    <span className="text-xs text-red-400">
                      ${balance.toFixed(2)} — below minimum ${minBalance.toFixed(2)}
                    </span>
                  )}
                  {!balanceLoading && balance === null && !balanceError && (
                    <span className="text-xs text-gray-500">No credentials</span>
                  )}
                  {!balanceLoading && balanceError && balanceErrorCode === 'decryption_error' && (
                    <a href="/dashboard?manage=keys" className="text-xs text-red-400 underline hover:text-red-300">
                      Keys can&apos;t be decrypted — re-enter them →
                    </a>
                  )}
                  {!balanceLoading && balanceError && balanceErrorCode !== 'decryption_error' && (
                    <span className="text-xs text-yellow-400">{balanceError}</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Estimated cost: {costs.dataforseo}
                  {tier === 'advanced' && ' (backlinks require $100+ balance)'}
                </p>
              </div>
              <a
                href={BILLING_LINKS.dataforseo}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-cyan-electric hover:text-cyan-300 underline flex-shrink-0 ml-3 mt-0.5"
              >
                {balanceTooLow ? 'Top up' : 'Check'}
              </a>
            </div>
          )}
        </div>

        {/* Balance warning */}
        {balanceTooLow && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 mb-5">
            <p className="text-sm text-red-400">
              Your DataForSEO balance (${balance?.toFixed(2)}) is below the minimum
              recommended for the {tier} tier (${minBalance.toFixed(2)}).
              {!isAdmin && ' Please add funds before starting research.'}
            </p>
            {isAdmin && !adminOverride && (
              <button
                type="button"
                onClick={() => setAdminOverride(true)}
                className="mt-2 text-xs font-medium text-yellow-400 hover:text-yellow-300 underline transition-colors"
              >
                Admin: Override balance requirement
              </button>
            )}
            {isAdmin && adminOverride && (
              <p className="mt-2 text-xs text-yellow-400 font-medium">
                Balance check bypassed (admin override)
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {balanceLoading ? (
              <span className="flex items-center gap-2">
                <InlineSpinner className="h-4 w-4" />
                Checking balance...
              </span>
            ) : (
              'Start Research'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ServiceRow({
  name,
  estimate,
  link,
}: {
  name: string;
  estimate: string;
  link: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-navy-dark/60 px-4 py-3">
      <div>
        <span className="text-sm font-medium text-white">{name}</span>
        <p className="text-xs text-gray-400 mt-0.5">Estimated usage: {estimate}</p>
      </div>
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-cyan-electric hover:text-cyan-300 underline flex-shrink-0 ml-3"
      >
        Check balance
      </a>
    </div>
  );
}
