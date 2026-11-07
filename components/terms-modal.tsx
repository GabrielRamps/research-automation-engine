'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useRouter, usePathname } from 'next/navigation';

interface TermsData {
  id: string;
  version: number;
  content: string;
  created_at: string;
  is_active: boolean;
}

export default function TermsModal() {
  const [showModal, setShowModal] = useState(false);
  const [terms, setTerms] = useState<TermsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    checkTermsAcceptance();
  }, [pathname]);

  async function checkTermsAcceptance() {
    // CRITICAL: Never show modal on these routes
    const publicRoutes = ['/', '/terms', '/no-access', '/setup'];
    
    if (publicRoutes.includes(pathname)) {
      setLoading(false);
      setShowModal(false); // Explicitly hide
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setLoading(false);
        return;
      }

      // Get active terms
      const { data: activeTerms } = await supabase
        .from('terms_and_conditions')
        .select('*')
        .eq('is_active', true)
        .single();

      if (!activeTerms) {
        setLoading(false);
        return;
      }

      // Check acceptance
      const { data: acceptance } = await supabase
        .from('user_terms_acceptance')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('terms_version', activeTerms.version)
        .single();

      if (!acceptance) {
        setTerms(activeTerms);
        setShowModal(true);
      } else {
        setShowModal(false); // Explicitly hide if accepted
      }
    } catch (error) {
      console.error('Terms check error:', error);
      setShowModal(false); // Hide on error
    } finally {
      setLoading(false);
    }
  }

  async function acceptTerms() {
    if (!terms) return;

    setAccepting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/terms/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: terms.version,
          ipAddress: null,
          userAgent: navigator.userAgent
        })
      });

      if (!response.ok) throw new Error('Failed to accept terms');

      setShowModal(false);
      router.refresh(); // Refresh to update middleware
    } catch (error: any) {
      alert('Failed to accept terms: ' + error.message);
      setAccepting(false);
    }
  }

  function declineTerms() {
    supabase.auth.signOut();
    router.push('/');
  }

  // Don't render anything if loading, not showing, or on public routes
  if (loading || !showModal || !terms) {
    return null;
  }

  // Blocking modal - can't be dismissed
  return (
    <div className="fixed inset-0 z-[9999] bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b">
          <h2 className="text-2xl font-bold">Terms and Conditions</h2>
          <p className="text-gray-600 mt-1">
            Version {terms.version} - Last Updated: {new Date(terms.created_at).toLocaleDateString()}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="prose max-w-none">
            {terms.content.split('\n').map((line: string, i: number) => {
              if (line.trim() === '') {
                return <div key={i} className="h-2" />;
              }
              
              // Headers (all caps lines)
              if (line === line.toUpperCase() && line.length > 0 && !line.match(/^\d/)) {
                return (
                  <h3 key={i} className="text-lg font-bold text-gray-900 mt-4 mb-2">
                    {line}
                  </h3>
                );
              }
              
              // Section headers (start with number)
              if (line.match(/^\d+\./)) {
                return (
                  <h4 key={i} className="text-base font-semibold text-gray-900 mt-3 mb-1">
                    {line}
                  </h4>
                );
              }
              
              // Sub-section headers (start with number.number)
              if (line.match(/^\d+\.\d+/)) {
                return (
                  <p key={i} className="text-sm font-medium text-gray-800 mt-2 mb-1 ml-4">
                    {line}
                  </p>
                );
              }
              
              // Regular paragraphs
              return (
                <p key={i} className="text-sm text-gray-700 mb-1 leading-relaxed">
                  {line}
                </p>
              );
            })}
          </div>
        </div>

        <div className="p-6 border-t bg-gray-50">
          <p className="text-sm text-gray-600 mb-4">
            You must accept these terms to continue using the application.
          </p>
          
          <div className="mb-4">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer"
              />
              <span className="text-sm text-gray-700 select-none">
                I have read the Terms & Conditions and agree to them
              </span>
            </label>
          </div>
          
          <div className="flex gap-4">
            <button
              onClick={declineTerms}
              disabled={accepting}
              className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-black font-medium"
            >
              Decline & Sign Out
            </button>
            <button
              onClick={acceptTerms}
              disabled={accepting || !agreedToTerms}
              className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {accepting ? 'Accepting...' : 'I Accept These Terms'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

