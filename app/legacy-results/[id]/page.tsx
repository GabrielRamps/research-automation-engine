'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { FullPageLoading } from '@/components/ui/loading-spinner';
import { Button } from '@/components/ui/button';

interface Citation {
  url: string;
  title?: string;
  snippet?: string;
}

interface Result {
  id: string;
  business_name: string;
  industry: string;
  location: string;
  services: string;
  target_audience: string;
  unique_selling_points: string;
  contact_email: string;
  project_type: string;
  research_data: string;
  prompts_data: string;
  generation_time: number;
  created_at: string;
  citations?: Citation[];
}

export default function ResultsPage() {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'research' | 'prompts'>('research');
  const [copied, setCopied] = useState(false);
  
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();
  
  useEffect(() => {
    loadResult();
  }, []);
  
  async function loadResult() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        router.push('/');
        return;
      }
      
      const { data, error: fetchError } = await supabase
        .from('research_results')
        .select('*')
        .eq('id', params.id)
        .eq('user_id', session.user.id)
        .single();
      
      if (fetchError || !data) {
        setError('Result not found');
        setLoading(false);
        return;
      }
      
      setResult(data);
      setLoading(false);
    } catch (err) {
      setError('Failed to load result');
      setLoading(false);
    }
  }
  
  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  
  function downloadAsMarkdown() {
    if (!result) return;
    
    const content = `# ${result.business_name} - Research Report\n\n## Business Details\n- **Industry:** ${result.industry}\n- **Location:** ${result.location}\n- **Project Type:** ${result.project_type}\n- **Generated:** ${new Date(result.created_at).toLocaleString()}\n\n---\n\n# INDUSTRY RESEARCH\n\n${result.research_data}\n\n---\n\n# CURSOR PROMPTS\n\n${result.prompts_data}`;
    
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.business_name.replace(/[^a-z0-9]/gi, '_')}_research.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  if (loading) {
    return (
      <FullPageLoading message="Loading…" variant="light" className="bg-gray-50" />
    );
  }
  
  if (error || !result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Result Not Found</h1>
          <p className="text-gray-600 mb-6">{error || 'This result does not exist or you do not have access to it.'}</p>
          <Button onClick={() => router.push('/dashboard')}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-4 transition"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Dashboard
          </button>
          
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">{result.business_name}</h1>
              <div className="flex items-center space-x-4 text-sm text-gray-600">
                <span>{result.industry}</span>
                <span>•</span>
                <span>{result.location}</span>
                <span>•</span>
                <span>{result.project_type}</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Generated on {new Date(result.created_at).toLocaleString()} 
                {result.generation_time && ` • Took ${Math.round(result.generation_time / 1000)}s`}
              </p>
            </div>
            
            <Button onClick={downloadAsMarkdown} variant="outline">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </Button>
          </div>
        </div>
        
        {/* Tabs */}
        <div className="bg-white rounded-t-xl border-b border-gray-200">
          <div className="flex">
            <button
              onClick={() => setActiveTab('research')}
              className={`flex-1 px-6 py-4 font-medium transition ${
                activeTab === 'research'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span className="flex items-center justify-center space-x-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Industry Research</span>
              </span>
            </button>
            <button
              onClick={() => setActiveTab('prompts')}
              className={`flex-1 px-6 py-4 font-medium transition ${
                activeTab === 'prompts'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span className="flex items-center justify-center space-x-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <span>Cursor Prompts</span>
              </span>
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="bg-white rounded-b-xl shadow-sm border border-gray-200 border-t-0">
          <div className="p-8">
            {activeTab === 'research' ? (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">Industry Research Report</h2>
                  <Button
                    onClick={() => copyToClipboard(result.research_data)}
                    variant="outline"
                    size="sm"
                  >
                    {copied ? 'Copied!' : 'Copy All'}
                  </Button>
                </div>
                <div className="prose prose-lg max-w-none">
                  <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                    {result.research_data}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">Custom Cursor Prompts</h2>
                  <Button
                    onClick={() => copyToClipboard(result.prompts_data)}
                    variant="outline"
                    size="sm"
                  >
                    {copied ? 'Copied!' : 'Copy All'}
                  </Button>
                </div>
                <div className="space-y-6">
                  {result.prompts_data.split('## PROMPT').filter(p => p.trim()).map((prompt, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-6 bg-gray-50">
                      <div className="flex justify-between items-start mb-3">
                        <h3 className="text-lg font-semibold text-gray-900">
                          PROMPT {index + 1}: {prompt.split('\n')[0].replace(/^\d+:\s*/, '')}
                        </h3>
                        <Button
                          onClick={() => copyToClipboard('## PROMPT' + prompt)}
                          variant="ghost"
                          size="sm"
                        >
                          Copy
                        </Button>
                      </div>
                      <div className="text-gray-700 whitespace-pre-wrap leading-relaxed">
                        {prompt.split('\n').slice(1).join('\n').trim()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Citations/Sources Card */}
        {result.citations && result.citations.length > 0 && (
          <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center mb-4">
              <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <h3 className="font-semibold text-gray-900">Sources & Citations</h3>
              <span className="ml-2 text-sm text-gray-500">({result.citations.length} sources)</span>
            </div>
            <div className="space-y-3">
              {result.citations.map((citation, index) => (
                <div key={index} className="border-l-4 border-blue-500 pl-4 py-2">
                  <a
                    href={citation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 font-medium hover:underline flex items-center"
                  >
                    {citation.title || new URL(citation.url).hostname}
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                  {citation.snippet && (
                    <p className="text-sm text-gray-600 mt-1">{citation.snippet}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">{citation.url}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Business Details Card */}
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Business Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            {result.services && (
              <div>
                <span className="font-medium text-gray-700">Services:</span>
                <p className="text-gray-600 mt-1">{result.services}</p>
              </div>
            )}
            {result.target_audience && (
              <div>
                <span className="font-medium text-gray-700">Target Audience:</span>
                <p className="text-gray-600 mt-1">{result.target_audience}</p>
              </div>
            )}
            {result.unique_selling_points && (
              <div>
                <span className="font-medium text-gray-700">Unique Selling Points:</span>
                <p className="text-gray-600 mt-1">{result.unique_selling_points}</p>
              </div>
            )}
            {result.contact_email && (
              <div>
                <span className="font-medium text-gray-700">Contact Email:</span>
                <p className="text-gray-600 mt-1">{result.contact_email}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

