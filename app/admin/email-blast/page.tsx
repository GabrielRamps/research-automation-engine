'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useRouter } from 'next/navigation';
import AdminNav from '@/components/AdminNav';
import { FullPageLoading } from '@/components/ui/loading-spinner';

interface User {
  email: string;
  status: 'active' | 'suspended' | 'cancelled';
}

type RecipientMode = 'all_active' | 'all' | 'selected';

interface SendResult {
  total: number;
  sent: number;
  failed: number;
  errors?: string[];
}

export default function EmailBlastPage() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('all_active');
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [userFilter, setUserFilter] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    checkAdminAndLoad();
  }, []);

  async function checkAdminAndLoad() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) { router.push('/'); return; }

    const { data: adminConfig } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'admin_emails')
      .single();

    const adminEmails = adminConfig?.config_value as string[];
    if (!adminEmails?.includes(user.email || '')) {
      router.push('/dashboard');
      return;
    }

    const res = await fetch('/api/admin/users/access/list');
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users ?? []);
    }
    setLoading(false);
  }

  function getRecipientsForMode(): string[] {
    if (recipientMode === 'all_active') return users.filter(u => u.status === 'active').map(u => u.email);
    if (recipientMode === 'all') return users.map(u => u.email);
    return Array.from(selectedEmails);
  }

  function getRecipientCount(): number {
    return getRecipientsForMode().length;
  }

  function toggleEmail(email: string) {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function selectAllFiltered() {
    const filtered = filteredUsers.map(u => u.email);
    setSelectedEmails(prev => {
      const next = new Set(prev);
      filtered.forEach(e => next.add(e));
      return next;
    });
  }

  function deselectAllFiltered() {
    const filtered = filteredUsers.map(u => u.email);
    setSelectedEmails(prev => {
      const next = new Set(prev);
      filtered.forEach(e => next.delete(e));
      return next;
    });
  }

  const filteredUsers = users.filter(u =>
    u.email.toLowerCase().includes(userFilter.toLowerCase())
  );

  async function handleSend() {
    setConfirmOpen(false);
    setSending(true);
    setResult(null);
    setError(null);

    const recipients = recipientMode === 'selected'
      ? Array.from(selectedEmails)
      : recipientMode;

    try {
      const res = await fetch('/api/admin/email-blast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body, recipients }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to send emails.');
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err.message || 'Network error.');
    } finally {
      setSending(false);
    }
  }

  const canSend = subject.trim() && body.trim() && getRecipientCount() > 0 && !sending;

  if (loading) return <FullPageLoading />;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <AdminNav />

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Email Blast</h1>
            <p className="text-sm text-gray-500 mt-1">
              Send a custom email to your users via Resend. Basic HTML is supported in the body.
            </p>
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-800">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Action Required: Please rotate your API keys"
              className="w-full text-sm text-gray-900 placeholder-gray-400 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Body */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-800">Message</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={10}
              placeholder={"Hi,\n\nWe're reaching out because Vercel was recently compromised. As a precaution, please rotate your API keys immediately.\n\nSteps:\n1. Log in to your account\n2. Go to Setup → re-enter your API keys\n\nIf you have any questions, reply to this email.\n\n— Research Automation Engine"}
              className="w-full text-sm text-gray-900 placeholder-gray-400 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
            />
            <p className="text-xs text-gray-400">{body.length} characters</p>
          </div>

          {/* Recipients */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-gray-800">Recipients</label>

            <div className="flex flex-col gap-2">
              {[
                { value: 'all_active' as RecipientMode, label: 'All active users', count: users.filter(u => u.status === 'active').length },
                { value: 'all' as RecipientMode, label: 'All users (including inactive/cancelled)', count: users.length },
                { value: 'selected' as RecipientMode, label: 'Select specific users', count: selectedEmails.size },
              ].map(opt => (
                <label key={opt.value} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="recipientMode"
                    value={opt.value}
                    checked={recipientMode === opt.value}
                    onChange={() => setRecipientMode(opt.value)}
                    className="accent-blue-600"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                  <span className="ml-auto text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    {opt.count} user{opt.count !== 1 ? 's' : ''}
                  </span>
                </label>
              ))}
            </div>

            {/* User selector for 'selected' mode */}
            {recipientMode === 'selected' && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="p-3 bg-gray-50 border-b border-gray-200 flex gap-2 items-center">
                  <input
                    type="text"
                    value={userFilter}
                    onChange={e => setUserFilter(e.target.value)}
                    placeholder="Filter users..."
                    className="flex-1 text-sm text-gray-900 placeholder-gray-400 border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button onClick={selectAllFiltered} className="text-xs text-blue-600 hover:underline px-2">Select all</button>
                  <button onClick={deselectAllFiltered} className="text-xs text-gray-500 hover:underline px-2">Deselect all</button>
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-gray-100">
                  {filteredUsers.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">No users found.</p>
                  )}
                  {filteredUsers.map(u => (
                    <label key={u.email} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedEmails.has(u.email)}
                        onChange={() => toggleEmail(u.email)}
                        className="accent-blue-600"
                      />
                      <span className="text-sm text-gray-700 flex-1">{u.email}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        u.status === 'active' ? 'bg-green-100 text-green-700' :
                        u.status === 'suspended' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {u.status}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Send summary */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            Ready to send to <strong>{getRecipientCount()}</strong> recipient{getRecipientCount() !== 1 ? 's' : ''}.
            {getRecipientCount() === 0 && recipientMode === 'selected' && (
              <span className="text-red-600"> Select at least one user.</span>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg text-sm font-medium bg-red-50 text-red-800 border border-red-200">
              {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className={`p-4 rounded-lg border text-sm space-y-1 ${
              result.failed === 0
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-yellow-50 border-yellow-200 text-yellow-800'
            }`}>
              <p className="font-semibold">
                {result.failed === 0
                  ? `All ${result.sent} email${result.sent !== 1 ? 's' : ''} sent successfully.`
                  : `Sent ${result.sent} of ${result.total} — ${result.failed} failed.`
                }
              </p>
              {result.errors?.map((e, i) => (
                <p key={i} className="text-xs opacity-75">{e}</p>
              ))}
            </div>
          )}

          {/* Send button */}
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={!canSend}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {sending ? 'Sending...' : `Send to ${getRecipientCount()} User${getRecipientCount() !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      {/* Confirmation dialog */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Confirm Email Blast</h2>
            <p className="text-sm text-gray-600">
              You are about to send <strong>&quot;{subject}&quot;</strong> to{' '}
              <strong>{getRecipientCount()} user{getRecipientCount() !== 1 ? 's' : ''}</strong>.
              This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg"
              >
                Yes, Send Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
