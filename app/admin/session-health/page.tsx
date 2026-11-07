'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AdminNav from '@/components/AdminNav';

// ============================================================
// Types
// ============================================================

interface ErrorLogEntry {
  phase?: number;
  error?: string;
  error_type?: string;
  timestamp?: string;
}

interface BalanceErrorEntry {
  service?: 'claude' | 'tavily' | 'dataforseo';
  message?: string;
  instructions?: string;
  link?: string;
  phase?: number;
}

interface StuckSession {
  id: string;
  user_id: string;
  email: string | null;
  business_name: string;
  tier: string;
  current_phase: number;
  status: string;
  error_log: ErrorLogEntry[] | null;
  error_type: string | null;
  created_at: string;
  minutes_running: number;
}

interface FailedSession extends StuckSession {
  completed_at: string | null;
  balance_errors: BalanceErrorEntry[] | null;
}

interface PausedSession extends StuckSession {
  balance_errors: BalanceErrorEntry[] | null;
}

interface BrokenKeyRow {
  user_id: string;
  email: string | null;
  providers_broken: string[];
  updated_at: string;
}

interface HealthResponse {
  ok: boolean;
  generated_at?: string;
  stuck: StuckSession[];
  failed: FailedSession[];
  paused: PausedSession[];
  broken_keys: BrokenKeyRow[];
  summary: {
    stuck: number;
    failed_recent: number;
    paused: number;
    broken_keys: number;
  };
}

type Tab = 'stuck' | 'failed' | 'paused' | 'broken_keys';

// ============================================================
// Response templates — copy-paste messages for support
// ============================================================

const RESPONSE_TEMPLATES: Record<string, { title: string; body: (ctx: TemplateCtx) => string }> = {
  decryption_error: {
    title: 'Re-enter API keys',
    body: ({ name, businessName }) =>
      `Hey${name ? ' ' + name : ''},\n\nYour research run for "${businessName}" got stuck because we couldn't read your saved API keys. This usually happens after one of our security updates — your existing keys are still valid, but the encrypted copy on our end can't be decrypted with the new key.\n\nFix:\n1. Go to your dashboard\n2. Click "Manage Keys"\n3. Re-enter your Claude, Tavily, and DataForSEO keys\n4. Start a new research run\n\nNo charges were made for the failed run. Sorry for the friction!`,
  },
  balance_error: {
    title: 'Add API credits',
    body: ({ name, businessName, provider }) =>
      `Hey${name ? ' ' + name : ''},\n\nYour research run for "${businessName}" paused because your ${provider ?? 'API'} account ran out of credits.\n\nFix:\n1. Add credits to your ${provider ?? 'API'} account\n2. Return to your dashboard and click "Resume" on the paused session — your progress is saved, you don't have to start over\n\nLet me know if you need links to the right billing page.`,
  },
  worker_shutdown: {
    title: 'Worker restart — please retry',
    body: ({ name, businessName }) =>
      `Hey${name ? ' ' + name : ''},\n\nYour research run for "${businessName}" was interrupted by an infrastructure restart on our end. Your form data is saved.\n\nFix:\n1. Go to your dashboard\n2. Cancel the failed session\n3. Start a new research run — your previous form values will be pre-filled\n\nApologies for the friction.`,
  },
  stuck: {
    title: 'Stuck session — cancel and retry',
    body: ({ name, businessName }) =>
      `Hey${name ? ' ' + name : ''},\n\nYour research run for "${businessName}" looks like it got stuck mid-run. I've marked it as failed on our end.\n\nFix:\n1. Go to your dashboard\n2. Start a new research run — your previous form values will be pre-filled, so it's quick\n\nIf the same thing happens again, please let me know and I'll dig in.`,
  },
  unknown_error: {
    title: 'Generic retry',
    body: ({ name, businessName }) =>
      `Hey${name ? ' ' + name : ''},\n\nYour research run for "${businessName}" hit an unexpected error. Could you try again? Your form data is saved.\n\nIf it fails the second time too, please let me know and I'll investigate.`,
  },
};

interface TemplateCtx {
  name?: string;
  businessName: string;
  provider?: string;
}

// ============================================================
// Page
// ============================================================

export default function SessionHealthPage() {
  const router = useRouter();
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('stuck');
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/admin/sessions/health');
      const body = (await res.json()) as HealthResponse | { error?: string };
      if (!res.ok || !('ok' in body) || !body.ok) {
        setError(('error' in body && body.error) || 'Could not load session health.');
        return;
      }
      setData(body);
    } catch (err: any) {
      setError(err?.message ?? 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000); // auto-refresh every 30s
    return () => clearInterval(id);
  }, [refresh]);

  async function runAction(action: string, payload: Record<string, unknown>, key: string) {
    setActingOn(key);
    try {
      const res = await fetch('/api/admin/sessions/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        alert(body.error ?? `Action "${action}" failed`);
      } else {
        await refresh();
      }
    } finally {
      setActingOn(null);
    }
  }

  function copyTemplate(templateKey: string, ctx: TemplateCtx, rowKey: string) {
    const tpl = RESPONSE_TEMPLATES[templateKey] ?? RESPONSE_TEMPLATES.unknown_error;
    const text = tpl.body(ctx);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(rowKey);
      setTimeout(() => setCopied((c) => (c === rowKey ? null : c)), 2000);
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <p className="text-gray-600">Loading session health…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <AdminNav />
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Session Health</h1>
              <p className="text-gray-500 text-sm mt-1">
                Live view of research sessions that need attention. Auto-refreshes every 30 seconds.
              </p>
            </div>
            <button
              onClick={refresh}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Refresh now
            </button>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
              {error}
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              label="Stuck"
              count={data?.summary.stuck ?? 0}
              hint="In progress > 30 min"
              color="red"
              active={tab === 'stuck'}
              onClick={() => setTab('stuck')}
            />
            <SummaryCard
              label="Failed (24h)"
              count={data?.summary.failed_recent ?? 0}
              hint="Recent failures"
              color="orange"
              active={tab === 'failed'}
              onClick={() => setTab('failed')}
            />
            <SummaryCard
              label="Paused"
              count={data?.summary.paused ?? 0}
              hint="Awaiting balance"
              color="yellow"
              active={tab === 'paused'}
              onClick={() => setTab('paused')}
            />
            <SummaryCard
              label="Broken keys"
              count={data?.summary.broken_keys ?? 0}
              hint="Users flagged"
              color="purple"
              active={tab === 'broken_keys'}
              onClick={() => setTab('broken_keys')}
            />
          </div>
        </div>

        {/* Active tab */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          {tab === 'stuck' && (
            <SessionTable
              title="Stuck sessions"
              empty="No stuck sessions. 🎉"
              rows={data?.stuck ?? []}
              renderActions={(row) => (
                <>
                  <ActionButton
                    label="Mark failed"
                    busy={actingOn === `stuck:${row.id}`}
                    onClick={() => runAction('mark_failed', { sessionId: row.id, reason: 'Stuck — marked failed by admin' }, `stuck:${row.id}`)}
                  />
                  <CopyButton
                    label={copied === `tpl:${row.id}` ? 'Copied!' : 'Copy email'}
                    onClick={() =>
                      copyTemplate(
                        row.error_type ?? 'stuck',
                        { businessName: row.business_name, name: row.email?.split('@')[0] },
                        `tpl:${row.id}`
                      )
                    }
                  />
                </>
              )}
              extraColumn={(row) => `${row.minutes_running}m running`}
            />
          )}

          {tab === 'failed' && (
            <SessionTable
              title="Recent failures (24h)"
              empty="No failures in the last 24 hours."
              rows={data?.failed ?? []}
              renderActions={(row) => (
                <CopyButton
                  label={copied === `tpl:${row.id}` ? 'Copied!' : 'Copy email'}
                  onClick={() =>
                    copyTemplate(
                      row.error_type ?? 'unknown_error',
                      {
                        businessName: row.business_name,
                        name: row.email?.split('@')[0],
                      },
                      `tpl:${row.id}`
                    )
                  }
                />
              )}
              extraColumn={(row) => row.error_type ?? 'unknown'}
            />
          )}

          {tab === 'paused' && (
            <SessionTable
              title="Paused sessions (balance)"
              empty="No paused sessions."
              rows={data?.paused ?? []}
              renderActions={(row) => (
                <CopyButton
                  label={copied === `tpl:${row.id}` ? 'Copied!' : 'Copy email'}
                  onClick={() =>
                    copyTemplate(
                      'balance_error',
                      {
                        businessName: row.business_name,
                        name: row.email?.split('@')[0],
                        provider: row.balance_errors?.[0]?.service,
                      },
                      `tpl:${row.id}`
                    )
                  }
                />
              )}
              extraColumn={(row) => row.balance_errors?.[0]?.service ?? '—'}
            />
          )}

          {tab === 'broken_keys' && (
            <BrokenKeysTable
              rows={data?.broken_keys ?? []}
              onClear={(userId) => runAction('clear_health_status', { userId }, `bk:${userId}`)}
              actingOn={actingOn}
              onCopy={(row) =>
                copyTemplate(
                  'decryption_error',
                  {
                    businessName: 'your recent run',
                    name: row.email?.split('@')[0],
                  },
                  `bk:${row.user_id}`
                )
              }
              copied={copied}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function SummaryCard({
  label,
  count,
  hint,
  color,
  active,
  onClick,
}: {
  label: string;
  count: number;
  hint: string;
  color: 'red' | 'orange' | 'yellow' | 'purple';
  active: boolean;
  onClick: () => void;
}) {
  const colorMap: Record<string, string> = {
    red: active ? 'border-red-500 bg-red-50' : 'border-red-200 hover:bg-red-50',
    orange: active ? 'border-orange-500 bg-orange-50' : 'border-orange-200 hover:bg-orange-50',
    yellow: active ? 'border-yellow-500 bg-yellow-50' : 'border-yellow-200 hover:bg-yellow-50',
    purple: active ? 'border-purple-500 bg-purple-50' : 'border-purple-200 hover:bg-purple-50',
  };
  const textMap: Record<string, string> = {
    red: 'text-red-700',
    orange: 'text-orange-700',
    yellow: 'text-yellow-700',
    purple: 'text-purple-700',
  };
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border-2 p-4 transition ${colorMap[color]}`}
    >
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${textMap[color]}`}>{count}</div>
      <div className="text-xs text-gray-500 mt-1">{hint}</div>
    </button>
  );
}

function SessionTable<T extends StuckSession>({
  title,
  empty,
  rows,
  renderActions,
  extraColumn,
}: {
  title: string;
  empty: string;
  rows: T[];
  renderActions: (row: T) => React.ReactNode;
  extraColumn: (row: T) => string;
}) {
  return (
    <>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 italic">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500 border-b">
              <tr>
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">Business</th>
                <th className="py-2 pr-4">Tier / Phase</th>
                <th className="py-2 pr-4">Detail</th>
                <th className="py-2 pr-4">Last error</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const lastError = row.error_log?.[row.error_log.length - 1];
                return (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-3 pr-4">
                      <div className="font-mono text-xs text-gray-700">{row.email ?? row.user_id}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-gray-900">{row.business_name}</div>
                      <div className="text-xs text-gray-500">{row.id.slice(0, 8)}…</div>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="inline-block text-xs bg-gray-100 px-2 py-0.5 rounded">{row.tier}</span>
                      <div className="text-xs text-gray-500 mt-0.5">phase {row.current_phase}</div>
                    </td>
                    <td className="py-3 pr-4 text-xs text-gray-600">{extraColumn(row)}</td>
                    <td className="py-3 pr-4">
                      {lastError ? (
                        <div className="text-xs text-gray-700 max-w-xs truncate" title={lastError.error}>
                          {lastError.error_type && (
                            <span className="inline-block bg-red-100 text-red-700 px-1.5 py-0.5 rounded mr-1">
                              {lastError.error_type}
                            </span>
                          )}
                          {lastError.error}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex gap-2">{renderActions(row)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function BrokenKeysTable({
  rows,
  onClear,
  actingOn,
  onCopy,
  copied,
}: {
  rows: BrokenKeyRow[];
  onClear: (userId: string) => void;
  actingOn: string | null;
  onCopy: (row: BrokenKeyRow) => void;
  copied: string | null;
}) {
  return (
    <>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Users with broken keys</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No users currently flagged.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500 border-b">
              <tr>
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">Broken providers</th>
                <th className="py-2 pr-4">Flagged at</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user_id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-3 pr-4">
                    <div className="font-mono text-xs text-gray-700">{row.email ?? row.user_id}</div>
                  </td>
                  <td className="py-3 pr-4">
                    {row.providers_broken.map((p) => (
                      <span key={p} className="inline-block bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs mr-1">
                        {p}
                      </span>
                    ))}
                  </td>
                  <td className="py-3 pr-4 text-xs text-gray-600">
                    {new Date(row.updated_at).toLocaleString()}
                  </td>
                  <td className="py-3">
                    <div className="flex gap-2">
                      <CopyButton
                        label={copied === `bk:${row.user_id}` ? 'Copied!' : 'Copy email'}
                        onClick={() => onCopy(row)}
                      />
                      <ActionButton
                        label="Clear flag"
                        busy={actingOn === `bk:${row.user_id}`}
                        onClick={() => onClear(row.user_id)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ActionButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-100 disabled:opacity-50"
    >
      {busy ? '…' : label}
    </button>
  );
}

function CopyButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs px-3 py-1.5 rounded border border-blue-300 text-blue-700 bg-white hover:bg-blue-50"
    >
      {label}
    </button>
  );
}
