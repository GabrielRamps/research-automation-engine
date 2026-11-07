'use client';

import { useState, useEffect, Suspense } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useRouter, useSearchParams } from 'next/navigation';
import { FullPageLoading } from '@/components/ui/loading-spinner';

interface TermsData {
  id: string;
  version: number;
  content: string;
  created_at: string;
  is_active: boolean;
}

function TermsContent() {
  const [terms, setTerms] = useState<TermsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/dashboard';

  useEffect(() => {
    checkAuthAndLoadTerms();
  }, []);

  async function checkAuthAndLoadTerms() {
    try {
      // Check authentication - use getUser() for security
      const { data: { user } } = await supabase.auth.getUser();
      setIsAuthenticated(!!user);

      if (!user) {
        setError('You must be logged in to view terms.');
        return;
      }

      // Load active terms
      const { data, error } = await supabase
        .from('terms_and_conditions')
        .select('*')
        .eq('is_active', true)
        .single();

      if (error) {
        console.error('Error loading terms:', error);
        setError('Failed to load Terms and Conditions. Please refresh the page.');
        return;
      }

      if (!data) {
        setError('No active Terms and Conditions found.');
        return;
      }

      // CRITICAL FIX: Check if user has already accepted this version
      // This prevents redirect loops when middleware fails to see acceptance
      const { data: existingAcceptance } = await supabase
        .from('user_terms_acceptance')
        .select('id')
        .eq('user_id', user.id)
        .eq('terms_version', data.version)
        .maybeSingle();

      if (existingAcceptance) {
        // Already accepted! Redirect to destination
        console.log('✅ Terms already accepted, redirecting to:', redirectTo);
        router.push(redirectTo);
        return;
      }

      setTerms(data);
    } catch (err: any) {
      console.error('Error:', err);
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAccept() {
    if (!terms || !isAuthenticated) return;

    setAccepting(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be logged in to accept the terms.');
        setAccepting(false);
        return;
      }

      // Call API to record acceptance
      const response = await fetch('/api/terms/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: terms.version,
          ipAddress: null, // Will be captured server-side if needed
          userAgent: navigator.userAgent
        })
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error || 'Failed to accept terms');
      }

      // Success! Terms accepted
      console.log('✅ Terms accepted, redirecting to:', redirectTo);
      setAccepting(false);
      
      // Use hard redirect to ensure middleware runs and dashboard loads fresh
      window.location.href = redirectTo;
    } catch (err: any) {
      console.error('Error accepting terms:', err);
      setError(err.message || 'Failed to accept terms. Please try again.');
      setAccepting(false);
    }
  }

  async function handleDecline() {
    // Sign out the user if they decline
    await supabase.auth.signOut();
    router.push('/');
  }

  if (loading) {
    return (
      <FullPageLoading message="Loading…" variant="light" className="bg-gray-50" />
    );
  }

  if (error && !terms) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
          <div className="text-red-600 text-center mb-4">
            <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-2xl font-bold mb-2">Error</h2>
            <p className="text-gray-600">{error}</p>
          </div>
          <button
            onClick={() => router.push('/')}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (!terms) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-8 text-white">
            <h1 className="text-3xl font-bold mb-2">Terms and Conditions</h1>
            <div className="flex items-center gap-4 text-blue-100">
              <span className="text-sm">Version {terms.version}</span>
              <span className="text-sm">•</span>
              <span className="text-sm">
                Last Updated: {new Date(terms.created_at).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </span>
            </div>
          </div>

          {/* Content */}
          <div className="p-8 max-h-[60vh] overflow-y-auto">
            <div className="prose max-w-none">
              {terms.content.split('\n').map((line, i) => {
                if (line.trim() === '') {
                  return <div key={i} className="h-4" />;
                }
                
                // Headers (all caps lines)
                if (line === line.toUpperCase() && line.length > 0 && !line.match(/^\d/)) {
                  return (
                    <h2 key={i} className="text-xl font-bold text-gray-900 mt-6 mb-3">
                      {line}
                    </h2>
                  );
                }
                
                // Section headers (start with number)
                if (line.match(/^\d+\./)) {
                  return (
                    <h3 key={i} className="text-lg font-semibold text-gray-900 mt-4 mb-2">
                      {line}
                    </h3>
                  );
                }
                
                // Sub-section headers (start with number.number)
                if (line.match(/^\d+\.\d+/)) {
                  return (
                    <h4 key={i} className="text-base font-medium text-gray-800 mt-3 mb-2 ml-4">
                      {line}
                    </h4>
                  );
                }
                
                // Regular paragraphs
                return (
                  <p key={i} className="text-gray-700 mb-2 leading-relaxed">
                    {line}
                  </p>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          {isAuthenticated && (
            <div className="border-t bg-gray-50 p-6">
              {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-800 text-sm">{error}</p>
                </div>
              )}
              
              <div className="mb-4">
                <p className="text-sm text-gray-600">
                  By clicking "I Accept These Terms", you acknowledge that you have read, understood, 
                  and agree to be bound by these Terms and Conditions. You must accept these terms to use the Research Automation Engine.
                </p>
              </div>
              
              <div className="mb-4">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={agreedToTerms}
                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                    className="mt-1 w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer"
                  />
                  <span className="text-sm text-gray-700 select-none">
                    I have read the Terms & Conditions and agree to them
                  </span>
                </label>
              </div>
              
              <div className="flex gap-4">
                <button
                  onClick={handleDecline}
                  disabled={accepting}
                  className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-black font-medium"
                >
                  Decline & Sign Out
                </button>
                <button
                  onClick={handleAccept}
                  disabled={accepting || !agreedToTerms}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                >
                  {accepting ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Accepting...
                    </span>
                  ) : (
                    'I Accept These Terms'
                  )}
                </button>
              </div>
            </div>
          )}

          {/* View-only mode for non-authenticated users */}
          {!isAuthenticated && (
            <div className="border-t bg-gray-50 p-6">
              <div className="text-center">
                <p className="text-gray-600 mb-4">
                  You must be signed in to accept these terms.
                </p>
                <button
                  onClick={() => router.push('/')}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Go to Sign In
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TermsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    }>
      <TermsContent />
    </Suspense>
  );
}

