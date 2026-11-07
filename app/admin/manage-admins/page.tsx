'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useRouter } from 'next/navigation';
import AdminNav from '@/components/AdminNav';
import { FullPageLoading } from '@/components/ui/loading-spinner';

interface User {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  isAdmin: boolean;
}

export default function ManageAdminsPage() {
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

    setUser(session.user);

    // Check if user is admin
    const { data: adminConfig } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'admin_emails')
      .single();

    const admins = adminConfig?.config_value as string[];
    const userIsAdmin = admins?.includes(session.user.email || '');

    if (!userIsAdmin) {
      router.push('/dashboard');
      return;
    }

    setIsAdmin(true);
    await loadUsers();
    setLoading(false);
  }

  async function loadUsers() {
    try {
      const response = await fetch('/api/admin/users/list');
      const data = (await response.json()) as { success?: boolean; users?: User[]; adminEmails?: string[] };

      if (data.success) {
        setUsers(data.users ?? []);
        setAdminEmails(data.adminEmails ?? []);
      } else {
        setError('Failed to load users');
      }
    } catch (err) {
      setError('Error loading users');
      console.error(err);
    }
  }

  async function grantAdminAccess(email: string) {
    const confirmGrant = window.confirm(
      `Are you sure you want to grant admin access to ${email}?\n\n` +
      `This will give them full control over the platform, including:\n` +
      `- Access to all admin panels\n` +
      `- Ability to manage system prompts\n` +
      `- Ability to update terms & conditions\n` +
      `- Ability to grant/revoke admin access to others`
    );

    if (!confirmGrant) return;

    setActionLoading(email);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/admin/users/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = (await response.json()) as { success?: boolean; error?: string };

      if (response.ok) {
        setSuccess(`Admin access granted to ${email}`);
        await loadUsers();
      } else {
        setError(data.error || 'Failed to grant admin access');
      }
    } catch (err) {
      setError('Error granting admin access');
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  }

  async function revokeAdminAccess(email: string) {
    const confirmRevoke = window.confirm(
      `Are you sure you want to revoke admin access from ${email}?\n\n` +
      `They will lose access to:\n` +
      `- All admin panels\n` +
      `- System prompt management\n` +
      `- Terms & conditions management\n` +
      `- Admin user management\n\n` +
      `This action can be reversed by granting admin access again.`
    );

    if (!confirmRevoke) return;

    setActionLoading(email);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/admin/users/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = (await response.json()) as { success?: boolean; error?: string };

      if (response.ok) {
        setSuccess(`Admin access revoked from ${email}`);
        await loadUsers();
      } else {
        setError(data.error || 'Failed to revoke admin access');
      }
    } catch (err) {
      setError('Error revoking admin access');
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  }

  const filteredUsers = users.filter(u => 
    u.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const adminUsers = filteredUsers.filter(u => u.isAdmin);
  const regularUsers = filteredUsers.filter(u => !u.isAdmin);

  if (loading) {
    return (
      <FullPageLoading message="Loading admin panel…" variant="light" className="bg-gray-50" />
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-4">
            <h1 className="text-3xl font-bold text-gray-900">Manage Admins</h1>
          </div>
          
          <AdminNav />
          
          {/* Current User Info */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4">
            <p className="text-sm text-yellow-800">
              <strong>You are logged in as:</strong> {user?.email}
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

        {/* Current Administrators Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-8">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Current Administrators</h2>
            <p className="text-sm text-gray-600 mt-1">
              {adminUsers.length} {adminUsers.length === 1 ? 'administrator' : 'administrators'}
            </p>
          </div>
          
          <div className="p-6">
            {adminUsers.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No administrators found</p>
            ) : (
              <div className="space-y-3">
                {adminUsers.map(admin => (
                  <div 
                    key={admin.id}
                    className="flex items-center justify-between p-4 bg-blue-50 border border-blue-200 rounded-lg"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{admin.email}</p>
                      <p className="text-sm text-gray-600">
                        Last sign in: {admin.last_sign_in_at 
                          ? new Date(admin.last_sign_in_at).toLocaleDateString()
                          : 'Never'}
                      </p>
                    </div>
                    
                    <button
                      onClick={() => revokeAdminAccess(admin.email)}
                      disabled={
                        admin.email === user?.email || 
                        actionLoading === admin.email ||
                        adminUsers.length <= 1
                      }
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        admin.email === user?.email || adminUsers.length <= 1
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : actionLoading === admin.email
                          ? 'bg-red-400 text-white cursor-wait'
                          : 'bg-red-600 text-white hover:bg-red-700'
                      }`}
                      title={
                        admin.email === user?.email 
                          ? 'You cannot revoke your own admin access'
                          : adminUsers.length <= 1
                          ? 'Cannot remove the last administrator'
                          : 'Revoke admin access'
                      }
                    >
                      {actionLoading === admin.email ? 'Revoking...' : 'Revoke'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* All Platform Users Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">All Platform Users</h2>
            <p className="text-sm text-gray-600 mt-1">
              {users.length} total {users.length === 1 ? 'user' : 'users'}
            </p>
          </div>

          {/* Search Bar */}
          <div className="px-6 py-4 border-b border-gray-200">
            <input
              type="text"
              placeholder="Search users by email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Users Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Sign In
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(u => (
                    <tr key={u.id} className={u.isAdmin ? 'bg-blue-50' : ''}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{u.email}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {u.isAdmin ? (
                          <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                            Admin
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                            User
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {u.last_sign_in_at 
                          ? new Date(u.last_sign_in_at).toLocaleDateString()
                          : 'Never'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {u.isAdmin ? (
                          <span className="text-gray-400">Already admin</span>
                        ) : (
                          <button
                            onClick={() => grantAdminAccess(u.email)}
                            disabled={actionLoading === u.email}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                              actionLoading === u.email
                                ? 'bg-blue-400 text-white cursor-wait'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                            }`}
                          >
                            {actionLoading === u.email ? 'Granting...' : 'Grant Admin'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Security Notice */}
        <div className="mt-8 bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Security Notes</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• All admin actions are logged with full audit trails</li>
            <li>• You cannot revoke your own admin access (prevents lockout)</li>
            <li>• At least one administrator must remain at all times</li>
            <li>• Only existing platform users can be granted admin access</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
