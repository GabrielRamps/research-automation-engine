'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { FullPageLoading } from '@/components/ui/loading-spinner';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  
  const router = useRouter();
  const supabase = createClient();
  
  useEffect(() => {
    handleAuthCallback();
  }, [router]);

  async function handleAuthCallback() {
    try {
      // CRITICAL: Check for tokens in URL hash (magic link implicit flow)
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      const type = hashParams.get('type');

      // If we have tokens in the URL (from magic link), set the session
      if (accessToken && refreshToken && type === 'magiclink') {
        console.log('Magic link tokens detected, setting session...');
        
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });

        if (sessionError) {
          console.error('Failed to set session:', sessionError);
          setError('Failed to log in. Please try requesting a new magic link.');
          setLoading(false);
          // Clear the hash to prevent retry loops
          window.history.replaceState(null, '', window.location.pathname);
          return;
        }

        // Session set successfully! Clear hash and redirect
        console.log('✅ Session set successfully, redirecting to dashboard');
        window.history.replaceState(null, '', window.location.pathname);
        window.location.href = '/dashboard';
        return;
      }

      // Check for error in URL query (from callback redirect)
      const params = new URLSearchParams(window.location.search);
      const errorParam = params.get('error');
      if (errorParam) {
        setError(decodeURIComponent(errorParam));
        setLoading(false);
        return;
      }
      
      // Check if user already has active session
      // Use getUser() instead of getSession() for security
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Already logged in, redirect to dashboard
        window.location.href = '/dashboard';
      } else {
        // Not logged in, show login form
        setLoading(false);
      }
    } catch (err: any) {
      console.error('Auth callback error:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  }
  
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError('');
    
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback`
        }
      });
      
      if (error) throw error;
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }
  
  if (loading) {
    return (
      <FullPageLoading message="Checking sign-in…" />
    );
  }
  
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          {/* RAE Logo */}
          <div className="flex justify-center mb-6">
            <img 
              src="/rae-logo.svg" 
              alt="RAE Logo"
              className="h-20 w-auto"
            />
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">Research Automation Engine</h1>
          <p className="text-gray-400 text-lg">
            {sent ? 'Check your email' : 'Log in to access your dashboard'}
          </p>
        </div>
        
        <div className="glass-panel rounded-xl p-8">
          {sent ? (
            <div className="text-center">
              <div className="bg-cyan-electric/10 border border-cyan-electric/30 rounded-lg p-6 mb-4 backdrop-blur-sm">
                <svg className="w-12 h-12 text-cyan-electric mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <h3 className="text-lg font-semibold text-white mb-2">Check Your Email</h3>
                <p className="text-gray-300">
                  We sent a magic link to <strong className="text-cyan-electric">{email}</strong>
                </p>
                <p className="text-sm text-gray-400 mt-2">
                  Click the link to access your dashboard.
                </p>
              </div>
              <button
                onClick={() => setSent(false)}
                className="text-sm text-cyan-electric hover:text-cyan-electric/80 font-medium transition"
              >
                Use different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full px-4 py-3 border border-white/10 bg-navy-dark/70 backdrop-blur-sm rounded-lg focus:ring-2 focus:ring-cyan-electric focus:border-cyan-electric focus:shadow-glow-cyan outline-none transition text-white placeholder:text-gray-400"
                />
              </div>
              
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 backdrop-blur-sm">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}
              
              <button
                type="submit"
                disabled={sending}
                className="w-full bg-cyan-electric text-navy-deep py-3 rounded-lg font-semibold hover:shadow-glow-cyan disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md"
              >
                {sending ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-navy-deep" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Sending...
                  </span>
                ) : (
                  'Send Magic Link'
                )}
              </button>
              
              <div className="text-center pt-4 border-t border-white/10">
                <p className="text-sm text-gray-400">
                  Don&apos;t have access? Ask the admin of this installation to add your email.
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

