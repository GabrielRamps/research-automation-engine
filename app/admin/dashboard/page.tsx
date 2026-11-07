'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import AdminNav from '@/components/AdminNav';
import { FullPageLoading } from '@/components/ui/loading-spinner';

interface ActiveUser {
  id: string;
  email: string;
  lastSignInAt: string;
  secondsSinceActivity: number;
}

interface UserAnalytics {
  totalUsers: number;
  newUsers: number;
  activeUsers: number;
}

interface ResearchAnalytics {
  totalResearch: number;
  completedResearch: number;
  failedResearch: number;
  inProgressResearch: number;
  cancelledResearch: number;
  averageCompletionTime: number;
}

interface DataForSEOAnalytics {
  totalEnhancedSessions: number;
  phase1Enhanced: number;
  phase2Enhanced: number;
  phase3Enhanced: number;
  usersWithDataForSEO: number;
}

interface SecurityEvent {
  id: string;
  event_type: string;
  severity: string;
  user_email: string | null;
  ip_address: string | null;
  route_path: string | null;
  created_at: string;
  event_details: Record<string, any>;
}

interface SecurityData {
  events: SecurityEvent[];
  summary: {
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    total: number;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

type TimePeriod = '24h' | '7d' | '30d' | 'all' | 'custom';

interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  queue: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    error?: string;
  };
  database: {
    status: 'connected' | 'error';
    activeSessionCount?: number;
    pendingSessionCount?: number;
    pausedSessionCount?: number;
    error?: string;
  };
  timestamp: string;
}

export default function AdminDashboard() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // System health (queue + DB)
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  
  // Active users (real-time)
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [activeUsersCount, setActiveUsersCount] = useState(0);
  
  // User analytics
  const [userAnalytics, setUserAnalytics] = useState<UserAnalytics | null>(null);
  const [userPeriod, setUserPeriod] = useState<TimePeriod>('24h');
  const [userStartDate, setUserStartDate] = useState('');
  const [userEndDate, setUserEndDate] = useState('');
  
  // Research analytics
  const [researchAnalytics, setResearchAnalytics] = useState<ResearchAnalytics | null>(null);
  const [researchPeriod, setResearchPeriod] = useState<TimePeriod>('24h');
  const [researchStartDate, setResearchStartDate] = useState('');
  const [researchEndDate, setResearchEndDate] = useState('');
  
  // DataForSEO analytics
  const [dataforseoAnalytics, setDataforseoAnalytics] = useState<DataForSEOAnalytics | null>(null);
  
  // Security events
  const [securityData, setSecurityData] = useState<SecurityData | null>(null);
  const [securityPeriod, setSecurityPeriod] = useState<TimePeriod>('7d');
  const [securityStartDate, setSecurityStartDate] = useState('');
  const [securityEndDate, setSecurityEndDate] = useState('');
  const [securitySeverity, setSecuritySeverity] = useState<string>('');
  const [securityEventType, setSecurityEventType] = useState<string>('');
  const [securityPage, setSecurityPage] = useState(1);

  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    checkAdminAccess();
  }, []);

  useEffect(() => {
    if (user) {
      // Load initial data
      loadAllAnalytics();
      
      // Set up real-time active users polling (every 30 seconds)
      const interval = setInterval(() => {
        loadActiveUsers();
      }, 30000);
      
      return () => clearInterval(interval);
    }
  }, [user]);

  async function checkAdminAccess() {
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      router.push('/');
      return;
    }

    setUser(user);

    // Check if user is admin
    const { data: adminConfig } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'admin_emails')
      .single();

    const adminEmails = adminConfig?.config_value as string[];
    const userIsAdmin = adminEmails?.includes(user.email || '');

    if (!userIsAdmin) {
      router.push('/dashboard');
      return;
    }

    setLoading(false);
  }

  async function loadAllAnalytics() {
    await Promise.all([
      loadSystemHealth(),
      loadActiveUsers(),
      loadUserAnalytics(),
      loadResearchAnalytics(),
      loadDataForSEOAnalytics(),
      loadSecurityEvents()
    ]);
  }

  async function loadSystemHealth() {
    try {
      const response = await fetch('/api/admin/health');
      if (!response.ok) return;
      const data = (await response.json()) as SystemHealth;
      setSystemHealth(data);
    } catch {
      setSystemHealth(null);
    }
  }

  async function loadActiveUsers() {
    try {
      const response = await fetch('/api/admin/analytics/active-users');
      
      if (!response.ok) {
        throw new Error('Failed to fetch active users');
      }
      
      const data = (await response.json()) as { users?: ActiveUser[]; count?: number };
      setActiveUsers(data.users || []);
      setActiveUsersCount(data.count || 0);
    } catch (error) {
      console.error('Error loading active users:', error);
    }
  }

  async function loadUserAnalytics() {
    try {
      let url = `/api/admin/analytics/users?period=${userPeriod}`;
      if (userPeriod === 'custom' && userStartDate && userEndDate) {
        url += `&start_date=${userStartDate}&end_date=${userEndDate}`;
      }
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to fetch user analytics');
      }
      
      const data = (await response.json()) as { data?: UserAnalytics };
      setUserAnalytics(data.data ?? null);
    } catch (error) {
      console.error('Error loading user analytics:', error);
    }
  }

  async function loadResearchAnalytics() {
    try {
      let url = `/api/admin/analytics/research?period=${researchPeriod}`;
      if (researchPeriod === 'custom' && researchStartDate && researchEndDate) {
        url += `&start_date=${researchStartDate}&end_date=${researchEndDate}`;
      }
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to fetch research analytics');
      }
      
      const data = (await response.json()) as { data?: ResearchAnalytics };
      setResearchAnalytics(data.data ?? null);
    } catch (error) {
      console.error('Error loading research analytics:', error);
    }
  }

  async function loadDataForSEOAnalytics() {
    try {
      // Query research sessions that have DataForSEO data
      const { data: sessions, error: sessionsError } = await supabase
        .from('research_sessions')
        .select('id, phase1_dataforseo_raw, phase2_dataforseo_raw, phase3_dataforseo_raw');
      
      if (sessionsError) throw sessionsError;
      
      const totalEnhanced = sessions?.filter(s => 
        s.phase1_dataforseo_raw || s.phase2_dataforseo_raw || s.phase3_dataforseo_raw
      ).length || 0;
      
      const phase1Enhanced = sessions?.filter(s => s.phase1_dataforseo_raw).length || 0;
      const phase2Enhanced = sessions?.filter(s => s.phase2_dataforseo_raw).length || 0;
      const phase3Enhanced = sessions?.filter(s => s.phase3_dataforseo_raw).length || 0;
      
      // Count users with DataForSEO credentials
      const { data: keys, error: keysError } = await supabase
        .from('user_api_keys')
        .select('id')
        .eq('dataforseo_validated', true);
      
      if (keysError) throw keysError;
      
      setDataforseoAnalytics({
        totalEnhancedSessions: totalEnhanced,
        phase1Enhanced,
        phase2Enhanced,
        phase3Enhanced,
        usersWithDataForSEO: keys?.length || 0,
      });
    } catch (error) {
      console.error('Error loading DataForSEO analytics:', error);
    }
  }

  async function loadSecurityEvents() {
    try {
      console.log('Loading security events...', { securityPeriod, securityPage });
      
      let url = `/api/admin/security/events?period=${securityPeriod}&page=${securityPage}`;
      if (securityPeriod === 'custom' && securityStartDate && securityEndDate) {
        url += `&start_date=${securityStartDate}&end_date=${securityEndDate}`;
      }
      if (securitySeverity) {
        url += `&severity=${securitySeverity}`;
      }
      if (securityEventType) {
        url += `&event_type=${securityEventType}`;
      }
      
      console.log('Fetching security events from:', url);
      const response = await fetch(url);
      
      console.log('Security events response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Security events error response:', errorText);
        throw new Error('Failed to fetch security events');
      }
      
      const data = (await response.json()) as SecurityData;
      console.log('Security events data received:', data);
      setSecurityData(data);
    } catch (error) {
      console.error('Error loading security events:', error);
      alert('Failed to load security events. Check console for details.');
    }
  }

  async function handleRefreshAll() {
    setRefreshing(true);
    await loadAllAnalytics();
    setRefreshing(false);
  }

  function formatTime(seconds: number): string {
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  function getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-50 border-red-200';
      case 'high': return 'text-orange-600 bg-orange-50 border-orange-200';
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'low': return 'text-blue-600 bg-blue-50 border-blue-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  }

  if (loading) {
    return (
      <FullPageLoading message="Loading dashboard…" variant="light" className="bg-gray-50" />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold text-black">Admin Dashboard</h1>
              <p className="text-gray-600 mt-1">Real-time analytics and security monitoring</p>
            </div>
            <button
              onClick={handleRefreshAll}
              disabled={refreshing}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {refreshing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Refreshing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh All
                </>
              )}
            </button>
          </div>
          <AdminNav />
        </div>

        {/* System Health */}
        <div className="bg-white rounded-lg shadow mb-8 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-black">System Health</h2>
            <div className="flex items-center gap-2">
              {systemHealth ? (
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium ${
                    systemHealth.status === 'healthy'
                      ? 'bg-green-100 text-green-800'
                      : systemHealth.status === 'degraded'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      systemHealth.status === 'healthy'
                        ? 'bg-green-500'
                        : systemHealth.status === 'degraded'
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                    }`}
                  />
                  {systemHealth.status.charAt(0).toUpperCase() + systemHealth.status.slice(1)}
                </span>
              ) : (
                <span className="text-sm text-gray-500">Unavailable</span>
              )}
              <button
                onClick={loadSystemHealth}
                className="text-sm text-blue-600 hover:underline"
              >
                Refresh
              </button>
            </div>
          </div>
          {systemHealth && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <p className="text-sm font-medium text-gray-700 mb-1">Queue (waiting)</p>
                <p className="text-2xl font-bold text-black">
                  {systemHealth.queue.error != null ? '—' : systemHealth.queue.waiting}
                </p>
                {systemHealth.queue.error != null && (
                  <p className="text-xs text-red-600 mt-1">{systemHealth.queue.error}</p>
                )}
              </div>
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <p className="text-sm font-medium text-gray-700 mb-1">Queue (active)</p>
                <p className="text-2xl font-bold text-black">
                  {systemHealth.queue.error != null ? '—' : systemHealth.queue.active}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <p className="text-sm font-medium text-gray-700 mb-1">Active sessions</p>
                <p className="text-2xl font-bold text-black">
                  {systemHealth.database.activeSessionCount ?? '—'}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <p className="text-sm font-medium text-gray-700 mb-1">Pending sessions</p>
                <p className="text-2xl font-bold text-black">
                  {systemHealth.database.pendingSessionCount ?? '—'}
                </p>
              </div>
            </div>
          )}
          {systemHealth && (
            <div className="mt-3 text-xs text-gray-500">
              Completed: {systemHealth.queue.error != null ? '—' : systemHealth.queue.completed} · Failed:{' '}
              {systemHealth.queue.error != null ? '—' : systemHealth.queue.failed}
              {systemHealth.database.pausedSessionCount != null && systemHealth.database.pausedSessionCount > 0 && (
                <> · Paused: {systemHealth.database.pausedSessionCount}</>
              )}
              {' · '}
              Updated {systemHealth.timestamp ? new Date(systemHealth.timestamp).toLocaleString() : '—'}
            </div>
          )}
        </div>

        {/* Active Users - Real-time */}
        <div className="bg-white rounded-lg shadow mb-8 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-black flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              Active Users Now
            </h2>
            <span className="text-sm text-gray-500">Updates every 30 seconds</span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
              <p className="text-sm font-medium text-green-800 mb-1">Currently Active</p>
              <p className="text-3xl font-bold text-green-600">{activeUsersCount}</p>
              <p className="text-xs text-green-700 mt-1">Active in last 15 minutes</p>
            </div>
            
            {activeUsers.length > 0 && (
              <div className="md:col-span-2 bg-gray-50 rounded-lg p-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Recent Activity</p>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {activeUsers.slice(0, 5).map((user) => (
                    <div key={user.id} className="flex justify-between items-center text-sm">
                      <span className="text-gray-900 font-medium">{user.email}</span>
                      <span className="text-gray-500">{formatTime(user.secondsSinceActivity)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* User Analytics */}
        <div className="bg-white rounded-lg shadow mb-8 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-black">User Analytics</h2>
            <div className="flex items-center gap-3">
              <select
                value={userPeriod}
                onChange={(e) => {
                  setUserPeriod(e.target.value as TimePeriod);
                  if (e.target.value !== 'custom') {
                    setUserStartDate('');
                    setUserEndDate('');
                  }
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-black font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="24h">Last 24 Hours</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="all">All Time</option>
                <option value="custom">Custom Range</option>
              </select>
              
              {userPeriod === 'custom' && (
                <>
                  <input
                    type="date"
                    value={userStartDate}
                    onChange={(e) => setUserStartDate(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    type="date"
                    value={userEndDate}
                    onChange={(e) => setUserEndDate(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </>
              )}
              
              <button
                onClick={loadUserAnalytics}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                Refresh
              </button>
            </div>
          </div>
          
          {userAnalytics && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
                <p className="text-sm font-medium text-blue-800 mb-1">Total Users</p>
                <p className="text-3xl font-bold text-blue-600">{userAnalytics.totalUsers.toLocaleString()}</p>
                <p className="text-xs text-blue-700 mt-1">All registered users</p>
              </div>
              
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
                <p className="text-sm font-medium text-purple-800 mb-1">New Users</p>
                <p className="text-3xl font-bold text-purple-600">{userAnalytics.newUsers.toLocaleString()}</p>
                <p className="text-xs text-purple-700 mt-1">Registered in period</p>
              </div>
              
              <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-4 border border-indigo-200">
                <p className="text-sm font-medium text-indigo-800 mb-1">Active Users</p>
                <p className="text-3xl font-bold text-indigo-600">{userAnalytics.activeUsers.toLocaleString()}</p>
                <p className="text-xs text-indigo-700 mt-1">Signed in during period</p>
              </div>
            </div>
          )}
        </div>

        {/* Research Analytics */}
        <div className="bg-white rounded-lg shadow mb-8 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-black">Research Analytics</h2>
            <div className="flex items-center gap-3">
              <select
                value={researchPeriod}
                onChange={(e) => {
                  setResearchPeriod(e.target.value as TimePeriod);
                  if (e.target.value !== 'custom') {
                    setResearchStartDate('');
                    setResearchEndDate('');
                  }
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-black font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="24h">Last 24 Hours</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="all">All Time</option>
                <option value="custom">Custom Range</option>
              </select>
              
              {researchPeriod === 'custom' && (
                <>
                  <input
                    type="date"
                    value={researchStartDate}
                    onChange={(e) => setResearchStartDate(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    type="date"
                    value={researchEndDate}
                    onChange={(e) => setResearchEndDate(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </>
              )}
              
              <button
                onClick={loadResearchAnalytics}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                Refresh
              </button>
            </div>
          </div>
          
          {researchAnalytics && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg p-4 border border-gray-200">
                <p className="text-sm font-medium text-gray-800 mb-1">Total Research</p>
                <p className="text-3xl font-bold text-gray-600">{researchAnalytics.totalResearch.toLocaleString()}</p>
              </div>
              
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
                <p className="text-sm font-medium text-green-800 mb-1">Completed</p>
                <p className="text-3xl font-bold text-green-600">{researchAnalytics.completedResearch.toLocaleString()}</p>
              </div>
              
              <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-lg p-4 border border-red-200">
                <p className="text-sm font-medium text-red-800 mb-1">Failed</p>
                <p className="text-3xl font-bold text-red-600">{researchAnalytics.failedResearch.toLocaleString()}</p>
              </div>
              
              <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-4 border border-yellow-200">
                <p className="text-sm font-medium text-yellow-800 mb-1">In Progress</p>
                <p className="text-3xl font-bold text-yellow-600">{researchAnalytics.inProgressResearch.toLocaleString()}</p>
              </div>
              
              <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4 border border-orange-200">
                <p className="text-sm font-medium text-orange-800 mb-1">Cancelled</p>
                <p className="text-3xl font-bold text-orange-600">{researchAnalytics.cancelledResearch.toLocaleString()}</p>
              </div>
              
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
                <p className="text-sm font-medium text-blue-800 mb-1">Avg Time</p>
                <p className="text-2xl font-bold text-blue-600">{formatDuration(researchAnalytics.averageCompletionTime)}</p>
                <p className="text-xs text-blue-700 mt-1">Per research</p>
              </div>
            </div>
          )}
        </div>

        {/* DataForSEO Analytics */}
        <div className="bg-white rounded-lg shadow mb-8 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-black">📊 DataForSEO Integration</h2>
            <button
              onClick={loadDataForSEOAnalytics}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm"
            >
              Refresh
            </button>
          </div>
          
          {dataforseoAnalytics ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4 border border-orange-200">
                <p className="text-sm font-medium text-orange-800 mb-1">Users w/ DataForSEO</p>
                <p className="text-3xl font-bold text-orange-600">{dataforseoAnalytics.usersWithDataForSEO}</p>
                <p className="text-xs text-orange-700 mt-1">Validated credentials</p>
              </div>
              
              <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-lg p-4 border border-amber-200">
                <p className="text-sm font-medium text-amber-800 mb-1">Enhanced Sessions</p>
                <p className="text-3xl font-bold text-amber-600">{dataforseoAnalytics.totalEnhancedSessions}</p>
                <p className="text-xs text-amber-700 mt-1">With any DataForSEO data</p>
              </div>
              
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
                <p className="text-sm font-medium text-blue-800 mb-1">Phase 1 Enhanced</p>
                <p className="text-3xl font-bold text-blue-600">{dataforseoAnalytics.phase1Enhanced}</p>
                <p className="text-xs text-blue-700 mt-1">Local Competition</p>
              </div>
              
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
                <p className="text-sm font-medium text-purple-800 mb-1">Phase 2 Enhanced</p>
                <p className="text-3xl font-bold text-purple-600">{dataforseoAnalytics.phase2Enhanced}</p>
                <p className="text-xs text-purple-700 mt-1">Keyword Research</p>
              </div>
              
              <div className="bg-gradient-to-br from-teal-50 to-teal-100 rounded-lg p-4 border border-teal-200">
                <p className="text-sm font-medium text-teal-800 mb-1">Phase 3 Enhanced</p>
                <p className="text-3xl font-bold text-teal-600">{dataforseoAnalytics.phase3Enhanced}</p>
                <p className="text-xs text-teal-700 mt-1">On-Page Audit</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <p>Loading DataForSEO analytics...</p>
            </div>
          )}
        </div>

        {/* Security Report */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-black">Security Events</h2>
            <div className="flex items-center gap-3">
              <select
                value={securityPeriod}
                onChange={(e) => {
                  setSecurityPeriod(e.target.value as TimePeriod);
                  if (e.target.value !== 'custom') {
                    setSecurityStartDate('');
                    setSecurityEndDate('');
                  }
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-black font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="24h">Last 24 Hours</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="all">All Time</option>
                <option value="custom">Custom Range</option>
              </select>
              
              {securityPeriod === 'custom' && (
                <>
                  <input
                    type="date"
                    value={securityStartDate}
                    onChange={(e) => setSecurityStartDate(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    type="date"
                    value={securityEndDate}
                    onChange={(e) => setSecurityEndDate(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </>
              )}
              
              <select
                value={securitySeverity}
                onChange={(e) => setSecuritySeverity(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-black font-medium"
              >
                <option value="">All Severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              
              <select
                value={securityEventType}
                onChange={(e) => setSecurityEventType(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-black font-medium"
              >
                <option value="">All Event Types</option>
                <option value="unauthorized_admin_access">Unauthorized Admin Access</option>
                <option value="api_rate_limit">API Rate Limit</option>
                <option value="auth_failure">Auth Failure</option>
                <option value="privilege_escalation">Privilege Escalation</option>
              </select>
              
              <button
                onClick={loadSecurityEvents}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                Refresh
              </button>
            </div>
          </div>
          
          {securityData && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <p className="text-sm font-medium text-gray-700 mb-1">Total Events</p>
                  <p className="text-2xl font-bold text-gray-900">{securityData.summary.total.toLocaleString()}</p>
                </div>
                
                {Object.entries(securityData.summary.bySeverity).map(([severity, count]) => (
                  <div key={severity} className={`rounded-lg p-4 border ${getSeverityColor(severity)}`}>
                    <p className="text-sm font-medium mb-1 capitalize">{severity}</p>
                    <p className="text-2xl font-bold">{count.toLocaleString()}</p>
                  </div>
                ))}
              </div>
              
              {/* Events Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Severity</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Event Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP Address</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Route</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {securityData.events.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                          No security events found for the selected period
                        </td>
                      </tr>
                    ) : (
                      securityData.events.map((event) => (
                        <tr key={event.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {new Date(event.created_at).toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getSeverityColor(event.severity)}`}>
                              {event.severity}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {event.event_type.replace(/_/g, ' ')}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {event.user_email || 'N/A'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                            {event.ip_address || 'N/A'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                            {event.route_path || 'N/A'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination */}
              {securityData.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                  <div className="text-sm text-gray-600">
                    Page {securityData.pagination.page} of {securityData.pagination.totalPages}
                    {' '}({securityData.pagination.total} total events)
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setSecurityPage(Math.max(1, securityPage - 1));
                        setTimeout(loadSecurityEvents, 0);
                      }}
                      disabled={securityPage === 1}
                      className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => {
                        setSecurityPage(Math.min(securityData.pagination.totalPages, securityPage + 1));
                        setTimeout(loadSecurityEvents, 0);
                      }}
                      disabled={securityPage === securityData.pagination.totalPages}
                      className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
