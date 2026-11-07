'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useRouter } from 'next/navigation';
import AdminNav from '@/components/AdminNav';
import { FullPageLoading } from '@/components/ui/loading-spinner';

interface PlatformUser {
  id: string;
  user_id: string | null;
  email: string;
  status: 'active' | 'suspended' | 'cancelled';
  highlevel_contact_id: string | null;
  created_at: string;
  activated_at: string | null;
  last_sign_in_at: string | null;
  isAdmin: boolean;
}

type StatusFilter = 'all' | 'active' | 'suspended' | 'cancelled';

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-yellow-100 text-yellow-800',
  cancelled: 'bg-red-100 text-red-800',
};

export default function UserManagementPage() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create user form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createName, setCreateName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    checkAdminAccess();
  }, []);

  async function checkAdminAccess() {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      router.push('/');
      return;
    }

    setCurrentUser(session.user);

    const { data: adminConfig } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'admin_emails')
      .single();

    const admins = adminConfig?.config_value as string[];
    if (!admins?.includes(session.user.email || '')) {
      router.push('/dashboard');
      return;
    }

    setIsAdmin(true);
    await loadUsers();
    setLoading(false);
  }

  async function loadUsers() {
    try {
      const response = await fetch('/api/admin/users/access/list');
      const data = (await response.json()) as { success?: boolean; users?: PlatformUser[]; error?: string };

      if (data.success) {
        setUsers(data.users ?? []);
      } else {
        setError(data.error || 'Failed to load users');
      }
    } catch {
      setError('Error loading users');
    }
  }

  function flash(type: 'success' | 'error', message: string) {
    if (type === 'success') {
      setSuccess(message);
      setError(null);
    } else {
      setError(message);
      setSuccess(null);
    }
    setTimeout(() => { setSuccess(null); setError(null); }, 5000);
  }

  async function post(path: string, body: Record<string, unknown>) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<{ success?: boolean; error?: string; message?: string }>;
  }

  async function handleRevoke(email: string) {
    if (!window.confirm(
      `Revoke access for ${email}?\n\nThey will immediately lose platform access. This can be undone with Restore.`
    )) return;

    setActionLoading(email);
    const data = await post('/api/admin/users/access/revoke', { email });
    if (data.success) {
      flash('success', data.message || `Access revoked for ${email}`);
      await loadUsers();
    } else {
      flash('error', data.error || 'Failed to revoke access');
    }
    setActionLoading(null);
  }

  async function handleRestore(email: string) {
    setActionLoading(email);
    const data = await post('/api/admin/users/access/restore', { email });
    if (data.success) {
      flash('success', data.message || `Access restored for ${email}`);
      await loadUsers();
    } else {
      flash('error', data.error || 'Failed to restore access');
    }
    setActionLoading(null);
  }

  async function handleResendLink(email: string) {
    setActionLoading(`link-${email}`);
    const data = await post('/api/admin/users/resend-link', { email });
    if (data.success) {
      flash('success', data.message || `Magic link sent to ${email}`);
    } else {
      flash('error', data.error || 'Failed to send magic link');
    }
    setActionLoading(null);
  }

  async function handleDelete(email: string) {
    if (!window.confirm(
      `PERMANENTLY DELETE ${email}?\n\nThis removes:\n` +
      `• Their platform access record\n` +
      `• Their auth account\n` +
      `• All session history will remain in the database\n\n` +
      `This CANNOT be undone. Type the email below to confirm.`
    )) return;

    const typed = window.prompt(`Type "${email}" to confirm permanent deletion:`);
    if (typed?.trim().toLowerCase() !== email.toLowerCase()) {
      flash('error', 'Email did not match. Deletion cancelled.');
      return;
    }

    setActionLoading(`delete-${email}`);
    const data = await post('/api/admin/users/access/delete', { email, confirm: true });
    if (data.success) {
      flash('success', data.message || `${email} permanently deleted`);
      await loadUsers();
    } else {
      flash('error', data.error || 'Failed to delete user');
    }
    setActionLoading(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const email = createEmail.trim().toLowerCase();
    if (!email) return;

    setCreateLoading(true);
    const data = await post('/api/admin/users/create', { email, name: createName.trim() || undefined });
    if (data.success) {
      flash('success', data.message || `User ${email} created`);
      setCreateEmail('');
      setCreateName('');
      setShowCreateForm(false);
      await loadUsers();
    } else {
      flash('error', data.error || 'Failed to create user');
    }
    setCreateLoading(false);
  }

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.email?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || u.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const counts = {
    all: users.length,
    active: users.filter(u => u.status === 'active').length,
    suspended: users.filter(u => u.status === 'suspended').length,
    cancelled: users.filter(u => u.status === 'cancelled').length,
  };

  if (loading) {
    return <FullPageLoading message="Loading user management…" variant="light" className="bg-gray-50" />;
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="mb-8">
          <div className="mb-4">
            <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
            <p className="text-gray-600 mt-1">Create users, revoke access, and manage platform membership.</p>
          </div>
          <AdminNav />
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4">
            <p className="text-sm text-yellow-800">
              <strong>Logged in as:</strong> {currentUser?.email}
            </p>
          </div>
        </div>

        {/* Status Messages */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}
        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-green-800">{success}</p>
          </div>
        )}

        {/* Create User */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-8">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Create New User</h2>
              <p className="text-sm text-gray-600 mt-1">
                Creates an account and sends a magic link immediately.
              </p>
            </div>
            <button
              onClick={() => setShowCreateForm(v => !v)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              {showCreateForm ? 'Cancel' : '+ New User'}
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={handleCreate} className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={createEmail}
                    onChange={e => setCreateEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={createName}
                    onChange={e => setCreateName(e.target.value)}
                    placeholder="Jane Smith"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={createLoading || !createEmail.trim()}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {createLoading ? 'Creating...' : 'Create & Send Magic Link'}
                </button>
                <p className="text-sm text-gray-500">
                  A login link will be emailed immediately.
                </p>
              </div>
            </form>
          )}
        </div>

        {/* User Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Platform Users</h2>
          </div>

          {/* Filters */}
          <div className="px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Search by email..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="flex gap-2">
              {(['all', 'active', 'suspended', 'cancelled'] as StatusFilter[]).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    statusFilter === s
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                  <span className="ml-1 text-xs opacity-70">({counts[s]})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Sign In</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(u => (
                    <tr key={u.id} className={u.status !== 'active' ? 'bg-gray-50 opacity-75' : ''}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{u.email}</div>
                        <div className="flex gap-1 mt-1">
                          {u.isAdmin && (
                            <span className="px-1.5 py-0.5 text-xs rounded bg-blue-100 text-blue-700 font-medium">Admin</span>
                          )}
                          {u.highlevel_contact_id && (
                            <span className="px-1.5 py-0.5 text-xs rounded bg-purple-100 text-purple-700">HL</span>
                          )}
                          {!u.activated_at && (
                            <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-500">Never logged in</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${STATUS_BADGE[u.status] || 'bg-gray-100 text-gray-800'}`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex gap-2 flex-wrap">

                          {/* Send Magic Link (active users only) */}
                          {u.status === 'active' && (
                            <button
                              onClick={() => handleResendLink(u.email)}
                              disabled={actionLoading === `link-${u.email}`}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-50 transition-colors"
                            >
                              {actionLoading === `link-${u.email}` ? 'Sending...' : 'Send Link'}
                            </button>
                          )}

                          {/* Revoke (active or suspended) */}
                          {(u.status === 'active' || u.status === 'suspended') && (
                            <button
                              onClick={() => handleRevoke(u.email)}
                              disabled={!!actionLoading || u.email === currentUser?.email}
                              title={u.email === currentUser?.email ? 'You cannot revoke your own access' : 'Revoke access'}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-orange-100 text-orange-700 hover:bg-orange-200 disabled:opacity-50 transition-colors"
                            >
                              {actionLoading === u.email ? 'Revoking...' : 'Revoke'}
                            </button>
                          )}

                          {/* Restore (cancelled or suspended) */}
                          {(u.status === 'cancelled' || u.status === 'suspended') && (
                            <button
                              onClick={() => handleRestore(u.email)}
                              disabled={!!actionLoading}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50 transition-colors"
                            >
                              {actionLoading === u.email ? 'Restoring...' : 'Restore'}
                            </button>
                          )}

                          {/* Delete (anyone except self and admins) */}
                          {u.email !== currentUser?.email && !u.isAdmin && (
                            <button
                              onClick={() => handleDelete(u.email)}
                              disabled={!!actionLoading}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors"
                            >
                              {actionLoading === `delete-${u.email}` ? 'Deleting...' : 'Delete'}
                            </button>
                          )}

                          {/* Self or admin — no destructive actions */}
                          {(u.email === currentUser?.email || u.isAdmin) && u.status === 'active' && (
                            <span className="text-xs text-gray-400 italic self-center">
                              {u.email === currentUser?.email ? 'You' : 'Admin — use Manage Admins first'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Security Notes */}
        <div className="mt-8 bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Notes</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• <strong>Revoke</strong> — blocks access immediately but keeps account data. Reversible with Restore.</li>
            <li>• <strong>Delete</strong> — permanently removes the access record and auth account. Cannot be undone.</li>
            <li>• To delete an admin, revoke their admin privileges in <strong>Manage Admins</strong> first.</li>
            <li>• <strong>HL</strong> badge indicates the account was provisioned via HighLevel.</li>
            <li>• All actions are logged with a full audit trail.</li>
          </ul>
        </div>

      </div>
    </div>
  );
}
