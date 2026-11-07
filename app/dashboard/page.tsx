'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useRouter, useSearchParams } from 'next/navigation';
import MultiApiKeySetup from '@/components/multi-api-key-setup';
import { FullPageLoading } from '@/components/ui/loading-spinner';
import { Button } from '@/components/ui/button';
import { KeyHealthBanner } from '@/components/key-health-banner';

interface ResearchResult {
  id: string;
  business_name: string;
  industry: string;
  location: string;
  created_at: string;
  project_type: string;
  status: string;
  current_phase: number;
  completed_at: string | null;
}

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [activeSessions, setActiveSessions] = useState<ResearchResult[]>([]);
  const [completedSessions, setCompletedSessions] = useState<ResearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [showApiKeyChange, setShowApiKeyChange] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    checkAuth();
  }, []);

  // Auto-open the API keys UI when arriving with ?manage=keys (e.g., from
  // the KeyHealthBanner, the gate, or the research-progress decryption panel).
  useEffect(() => {
    if (searchParams?.get('manage') === 'keys') {
      setShowApiKeyChange(true);
      // Strip the param so a refresh doesn't re-trigger after the user closes it.
      router.replace('/dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  
  // Polling effect for active sessions
  useEffect(() => {
    if (!user?.id || activeSessions.length === 0) return;
    
    const interval = setInterval(() => {
      loadActiveSessions(user.id);
      loadCompletedSessions(user.id);
    }, 30000); // Poll every 30 seconds (reduced from 5s to lower disk I/O)
    
    return () => clearInterval(interval);
  }, [activeSessions.length, user?.id]);
  
  async function checkAuth() {
    // 1. Check auth session - use getUser() for security
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      console.error('Dashboard: No user found, redirecting to login', {
        error: error?.message,
        hasUser: !!user
      });
      router.push('/');
      return;
    }
    
    console.log('Dashboard: User authenticated', {
      userId: user.id,
      email: user.email
    });
    
    setUser(user);
    
    // 2. Check access
    const { data: accessData } = await supabase
      .from('user_access')
      .select('id, user_id, status')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();
    
    if (!accessData) {
      router.push('/no-access');
      return;
    }
    
    setHasAccess(true);
    
    // 3. Check API keys (all 3 required)
    try {
      const response = await fetch(`/api/keys/save?userId=${user.id}`);
      
      if (!response.ok) {
        console.error('API keys check failed with status:', response.status);
        setHasApiKey(false);
      } else {
        const data = (await response.json()) as { data?: { claude_validated?: boolean; tavily_validated?: boolean } };
        
        const hasAllKeys = Boolean(data.data?.claude_validated && 
                           data.data?.tavily_validated);
        
        setHasApiKey(hasAllKeys);
      }
    } catch (error) {
      console.error('Error checking API keys:', error);
      // Assume no keys if check fails - user will be prompted to set them up
      setHasApiKey(false);
    }
    
    // 4. Load all sessions (active and completed)
    await loadActiveSessions(user.id);
    await loadCompletedSessions(user.id);
    
    setLoading(false);
  }
  
  async function loadActiveSessions(userId: string) {
    const { data } = await supabase
      .from('research_sessions')
      .select('id, business_name, industry, location, created_at, project_type, status, current_phase, completed_at')
      .eq('user_id', userId)
      .not('status', 'in', '("completed","failed","cancelled")')
      .order('created_at', { ascending: false });
    
    setActiveSessions(data || []);
  }
  
  async function loadCompletedSessions(userId: string) {
    const { data } = await supabase
      .from('research_sessions')
      .select('id, business_name, industry, location, created_at, project_type, status, current_phase, completed_at')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false });
    
    setCompletedSessions(data || []);
  }
  
  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/');
  }
  
  function calculateProgress(session: ResearchResult): number {
    if (session.status === 'completed') return 100;
    if (session.status === 'failed' || session.status === 'cancelled' || session.status === 'pending') return 0;
    
    // Each phase is 25% (4 phases total)
    return (session.current_phase - 1) * 25;
  }

  const runningCount = activeSessions.filter((s) => s.status === 'in_progress').length;
  const queuedCount = activeSessions.filter((s) => s.status === 'pending').length;
  
  const COMPLETED_VISIBLE_COUNT = 3;
  const visibleCompleted = completedExpanded
    ? completedSessions
    : completedSessions.slice(0, COMPLETED_VISIBLE_COUNT);
  const hasMoreCompleted = completedSessions.length > COMPLETED_VISIBLE_COUNT;
  
  function getTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  }
  
  if (loading) {
    return (
      <FullPageLoading message="Loading your dashboard…" />
    );
  }
  
  if (!hasApiKey || showApiKeyChange) {
    return (
      <MultiApiKeySetup 
        onComplete={() => {
          setHasApiKey(true);
          setShowApiKeyChange(false);
        }}
        isUpdating={showApiKeyChange} // true when user clicked "Manage Keys", false for first-time setup
      />
    );
  }
  
  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div className="flex items-center gap-4">
            {/* RAE Logo */}
            <img 
              src="/rae-logo.svg" 
              alt="RAE Logo"
              className="h-12 w-auto cursor-pointer"
              onClick={() => router.push('/dashboard')}
            />
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">Research Automation Engine</h1>
              <p className="text-gray-400">Welcome back, {user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={handleLogout}
              variant="outline"
            >
              Logout
            </Button>
          </div>
        </div>
        
        {/* Key health banner — only shows when at least one stored key is unreadable */}
        <KeyHealthBanner />

        {/* API Keys Status Card */}
        <div className="glass-panel rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-3 h-3 bg-cyan-electric rounded-full animate-pulse shadow-glow-cyan"></div>
              <div>
                <p className="font-medium text-white">API Keys Connected</p>
                <p className="text-sm text-gray-400">Claude and Tavily configured</p>
              </div>
            </div>
            <Button
              onClick={() => setShowApiKeyChange(true)}
              variant="outline"
              size="sm"
            >
              Manage Keys
            </Button>
          </div>
        </div>
        
        {/* Start New Research Button */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/generate')}
            disabled={activeSessions.length >= 3}
            className={`w-full py-6 rounded-xl font-semibold text-xl shadow-lg transition-all duration-200 flex items-center justify-center space-x-3 ${
              activeSessions.length >= 3
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-cyan-electric text-navy-deep hover:shadow-glow-cyan-lg'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <span>Start New Research</span>
          </button>
          {activeSessions.length >= 3 && (
            <p className="text-sm text-orange-400 mt-2 text-center">
              Maximum of 3 slots reached. One research runs at a time; others wait in queue.
            </p>
          )}
        </div>
        
        {/* Active Research Sessions */}
        {activeSessions.length > 0 && (
          <div className="glass-panel rounded-lg mb-8">
            <div className="p-6 border-b border-white/10">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">Active Research</h2>
                  <p className="text-sm text-gray-400 mt-1">
                    {runningCount} running, {queuedCount} queued (one at a time; up to 3 slots)
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-cyan-electric rounded-full animate-pulse shadow-glow-cyan"></div>
                  <span className="text-sm text-cyan-electric font-medium">Live</span>
                </div>
              </div>
            </div>
            
            <div className="divide-y divide-white/10">
              {activeSessions.map((session) => (
                <div
                  key={session.id}
                  className="p-6 hover:bg-white/5 transition-colors cursor-pointer"
                  onClick={() => router.push(`/research/${session.id}`)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="text-lg font-semibold text-white">
                          {session.business_name}
                        </h3>
                        <span className="px-2 py-1 bg-cyan-electric/20 text-cyan-electric text-xs font-medium rounded border border-cyan-electric/30">
                          {session.project_type}
                        </span>
                        {session.status === 'in_progress' && (
                          <span className="px-2 py-0.5 bg-cyan-electric/20 text-cyan-electric rounded font-medium border border-cyan-electric/30">
                            Running
                          </span>
                        )}
                        {session.status === 'pending' && (
                          <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded font-medium border border-amber-500/30">
                            Queued
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-400 mb-2">
                        {session.industry} • {session.location}
                      </p>
                      <div className="flex items-center space-x-3 text-xs text-gray-400">
                        <span>Started {getTimeAgo(session.created_at)}</span>
                        {session.status === 'in_progress' && (
                          <span className="px-2 py-0.5 bg-cyan-electric/20 text-cyan-electric rounded font-medium border border-cyan-electric/30">
                            Phase {session.current_phase} of 4
                          </span>
                        )}
                        {session.status === 'pending' && (
                          <span className="text-amber-400/90">Starts when current research completes</span>
                        )}
                      </div>
                    </div>
                    <Button variant="outline" size="sm">
                      View Progress
                    </Button>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                      <span>Progress</span>
                      <span>{calculateProgress(session)}%</span>
                    </div>
                    <div className="w-full bg-navy-deep rounded-full h-2 overflow-hidden border border-white/10">
                      <div
                        className="bg-cyan-electric h-2 rounded-full transition-all duration-500 shadow-glow-cyan"
                        style={{ width: `${calculateProgress(session)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Completed Research */}
        <div className="glass-panel rounded-lg">
          <div className="p-6 border-b border-white/10">
            <h2 className="text-xl font-semibold text-white">Completed Research</h2>
            <p className="text-sm text-gray-400 mt-1">
              {completedSessions.length} {completedSessions.length === 1 ? 'report' : 'reports'} generated
            </p>
          </div>
          
          <div className="divide-y divide-white/10">
            {completedSessions.length === 0 ? (
              <div className="p-12 text-center">
                <div className="inline-block p-4 bg-navy-deep/50 rounded-full mb-4 border border-white/10">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-white mb-2">No completed research yet</h3>
                <p className="text-gray-400 mb-6">
                  {activeSessions.length > 0 
                    ? 'Your research is currently in progress. Check back soon!'
                    : 'Click "Start New Research" to generate your first AI-powered industry report.'
                  }
                </p>
              </div>
            ) : (
              <>
                {visibleCompleted.map((result) => (
                  <div 
                    key={result.id} 
                    className="p-6 hover:bg-white/5 transition-colors cursor-pointer group"
                    onClick={() => router.push(`/results/${result.id}/download`)}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <h3 className="text-lg font-semibold text-white group-hover:text-cyan-electric transition">
                            {result.business_name}
                          </h3>
                          <span className="px-2 py-1 bg-cyan-electric/20 text-cyan-electric text-xs font-medium rounded border border-cyan-electric/30">
                            {result.project_type}
                          </span>
                        </div>
                        <p className="text-sm text-gray-400 mb-2">
                          {result.industry} • {result.location}
                        </p>
                        <div className="flex items-center space-x-3 text-xs text-gray-400">
                          <span>
                            Completed {new Date(result.completed_at || result.created_at).toLocaleString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                          <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded font-medium border border-green-500/30">
                            ✓ 4-Phase Complete
                          </span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm">
                        View Report
                      </Button>
                    </div>
                  </div>
                ))}
                {hasMoreCompleted && (
                  <div className="p-4 border-t border-white/10 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setCompletedExpanded((prev) => !prev)}
                      className="text-sm font-medium text-cyan-electric hover:text-cyan-300 transition-colors flex items-center gap-2"
                      aria-expanded={completedExpanded}
                    >
                      {completedExpanded ? (
                        <>
                          <span>Show less</span>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        </>
                      ) : (
                        <>
                          <span>View all {completedSessions.length} reports</span>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        
        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-400">
          <p>
            Need help? See the Troubleshooting section of the setup guide (README.md) in the project files.
          </p>
        </div>
      </div>

    </div>
  );
}

