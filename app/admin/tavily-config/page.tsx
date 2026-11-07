'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useRouter } from 'next/navigation';
import AdminNav from '@/components/AdminNav';
import { FullPageLoading } from '@/components/ui/loading-spinner';

interface TavilyConfig {
  search_depth: 'basic' | 'advanced';
  topic: 'general' | 'news' | 'finance';
  time_range?: string;
  max_results: number;
  include_raw_content: boolean | 'markdown' | 'text';
  include_images: boolean;
  include_answer: boolean | 'basic' | 'advanced';
  include_domains: string[];
  exclude_domains: string[];
  model?: 'auto' | 'pro' | 'mini';
}

interface PhaseConfig {
  key: string;
  label: string;
  description: string;
  defaultConfig: TavilyConfig;
}

const DEFAULT_CONFIGS: Record<string, TavilyConfig> = {
  phase1: {
    search_depth: 'advanced',
    topic: 'general',
    time_range: '',
    max_results: 15, // Tavily API allows max 20 sources
    include_raw_content: true,
    include_images: false,
    include_answer: true,
    include_domains: [],
    exclude_domains: [],
    model: 'auto'
  },
  phase2: {
    search_depth: 'advanced',
    topic: 'general',
    time_range: '',
    max_results: 15, // Tavily API allows max 20 sources
    include_raw_content: true,
    include_images: false,
    include_answer: true,
    include_domains: [],
    exclude_domains: [],
    model: 'auto'
  },
  phase3: {
    search_depth: 'advanced',
    topic: 'general',
    time_range: '',
    max_results: 15, // Tavily API allows max 20 sources
    include_raw_content: true,
    include_images: false,
    include_answer: true,
    include_domains: [],
    exclude_domains: [],
    model: 'auto'
  }
};

export default function TavilyConfigPage() {
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('phase1');
  
  const [configs, setConfigs] = useState<Record<string, TavilyConfig>>(DEFAULT_CONFIGS);
  const [domainInput, setDomainInput] = useState<Record<string, { include: string; exclude: string }>>({
    phase1: { include: '', exclude: '' },
    phase2: { include: '', exclude: '' },
    phase3: { include: '', exclude: '' }
  });

  const supabase = createClient();
  const router = useRouter();

  const phases: PhaseConfig[] = [
    {
      key: 'phase1',
      label: 'Phase 1: Competitive Intelligence',
      description: 'Local competitor intelligence and market positioning analysis',
      defaultConfig: DEFAULT_CONFIGS.phase1
    },
    {
      key: 'phase2',
      label: 'Phase 2: SEO & Content Strategy',
      description: 'SEO keyword analysis, content strategy, and search intent patterns',
      defaultConfig: DEFAULT_CONFIGS.phase2
    },
    {
      key: 'phase3',
      label: 'Phase 3: Conversion Optimization',
      description: 'Conversion optimization, user experience, and performance benchmarks',
      defaultConfig: DEFAULT_CONFIGS.phase3
    }
  ];

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

    const adminEmails = adminConfig?.config_value as string[];
    const userIsAdmin = adminEmails?.includes(session.user.email || '');

    if (!userIsAdmin) {
      router.push('/dashboard');
      return;
    }

    setIsAdmin(true);
    await loadConfigs();
    setLoading(false);
  }

  async function loadConfigs() {
    const configKeys = phases.map(p => `${p.key}_tavily_params`);
    
    const { data } = await supabase
      .from('admin_config')
      .select('config_key, config_value')
      .in('config_key', configKeys);

    if (data) {
      const loadedConfigs: Record<string, TavilyConfig> = { ...DEFAULT_CONFIGS };
      data.forEach((item: any) => {
        const phaseKey = item.config_key.replace('_tavily_params', '');
        loadedConfigs[phaseKey] = item.config_value as TavilyConfig;
      });
      setConfigs(loadedConfigs);
    }
  }

  async function saveConfig(phaseKey: string) {
    setSaving(phaseKey);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const configKey = `${phaseKey}_tavily_params`;
      
      // Check if record exists
      const { data: existing } = await supabase
        .from('admin_config')
        .select('id')
        .eq('config_key', configKey)
        .maybeSingle();

      let error;
      
      if (existing) {
        // Update existing record
        const { error: updateError } = await supabase
          .from('admin_config')
          .update({
            config_value: configs[phaseKey],
            updated_at: new Date().toISOString(),
            updated_by: user?.id || null
          })
          .eq('config_key', configKey);
        
        error = updateError;
      } else {
        // Insert new record
        const { error: insertError } = await supabase
          .from('admin_config')
          .insert({
            config_key: configKey,
            config_value: configs[phaseKey],
            description: `Tavily search parameters for ${phaseKey}`,
            updated_at: new Date().toISOString(),
            updated_by: user?.id || null
          });
        
        error = insertError;
      }

      if (error) throw error;

      alert('Configuration saved successfully!');
      await loadConfigs();
    } catch (error: any) {
      console.error('Save error:', error);
      alert(`Failed to save: ${error.message}`);
    } finally {
      setSaving(null);
    }
  }

  function updateConfig(phaseKey: string, field: keyof TavilyConfig, value: any) {
    setConfigs(prev => ({
      ...prev,
      [phaseKey]: {
        ...prev[phaseKey],
        [field]: value
      }
    }));
  }

  function addDomain(phaseKey: string, type: 'include' | 'exclude') {
    const domain = domainInput[phaseKey][type].trim();
    if (!domain) return;

    const field = type === 'include' ? 'include_domains' : 'exclude_domains';
    const currentDomains = configs[phaseKey][field] as string[];
    
    if (!currentDomains.includes(domain)) {
      updateConfig(phaseKey, field, [...currentDomains, domain]);
    }

    setDomainInput(prev => ({
      ...prev,
      [phaseKey]: {
        ...prev[phaseKey],
        [type]: ''
      }
    }));
  }

  function removeDomain(phaseKey: string, type: 'include' | 'exclude', domain: string) {
    const field = type === 'include' ? 'include_domains' : 'exclude_domains';
    const currentDomains = configs[phaseKey][field] as string[];
    updateConfig(phaseKey, field, currentDomains.filter(d => d !== domain));
  }

  function resetToDefaults(phaseKey: string) {
    if (confirm('Reset to default configuration? This cannot be undone.')) {
      setConfigs(prev => ({
        ...prev,
        [phaseKey]: DEFAULT_CONFIGS[phaseKey]
      }));
    }
  }

  if (loading) {
    return (
      <FullPageLoading message="Loading configuration…" variant="light" className="bg-gray-50" />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-4">
            <h1 className="text-3xl font-bold text-black">Tavily Search Configuration</h1>
            <p className="text-gray-600 mt-2">
              Configure Tavily API parameters for each research phase
            </p>
          </div>
          <AdminNav />
        </div>

        {/* Info Banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="text-sm text-blue-800">
              <p className="font-semibold mb-1">About Tavily Search Parameters</p>
              <p>These settings control how Tavily searches and retrieves information for each research phase. Adjust parameters based on your needs for depth, speed, cost, and relevance. Changes take effect immediately for new research sessions.</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="border-b border-gray-200">
            <div className="flex">
              {phases.map((phase) => (
                <button
                  key={phase.key}
                  onClick={() => setActiveTab(phase.key)}
                  className={`flex-1 px-4 py-3 text-sm font-medium ${
                    activeTab === phase.key
                      ? 'border-b-2 border-blue-600 text-blue-600 bg-blue-50'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  {phase.label}
                </button>
              ))}
            </div>
          </div>

          {/* Configuration Editor */}
          {phases.map((phase) => 
            activeTab === phase.key ? (
              <div key={phase.key} className="p-6">
                <div className="mb-6">
                  <h2 className="text-xl font-bold text-black mb-2">{phase.label}</h2>
                  <p className="text-gray-600">{phase.description}</p>
                </div>

                <div className="space-y-6">
                  {/* Search Depth */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-semibold text-black mb-2">
                      Search Depth
                      <span className="ml-2 text-xs font-normal text-gray-500">(How thorough the search is)</span>
                    </label>
                    <select
                      value={configs[phase.key].search_depth}
                      onChange={(e) => updateConfig(phase.key, 'search_depth', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    >
                      <option value="basic">Basic - Fast, lightweight searches with generic snippets</option>
                      <option value="advanced">Advanced - Deeper, more tailored results (higher latency)</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      💡 Use "basic" for quick lookups, "advanced" for research-intensive tasks
                    </p>
                  </div>

                  {/* Topic */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-semibold text-black mb-2">
                      Topic / Search Domain
                      <span className="ml-2 text-xs font-normal text-gray-500">(Influences search agent used)</span>
                    </label>
                    <select
                      value={configs[phase.key].topic}
                      onChange={(e) => updateConfig(phase.key, 'topic', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    >
                      <option value="general">General - Broad web search</option>
                      <option value="news">News - Time-sensitive current events</option>
                      <option value="finance">Finance - Financial and market data</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      💡 Use "news" for current events, "finance" for market data, "general" for everything else
                    </p>
                  </div>

                  {/* Model Selection */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-semibold text-black mb-2">
                      Research Model
                      <span className="ml-2 text-xs font-normal text-gray-500">(Quality vs Speed tradeoff)</span>
                    </label>
                    <select
                      value={configs[phase.key].model || 'auto'}
                      onChange={(e) => updateConfig(phase.key, 'model', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    >
                      <option value="auto">Auto - Tavily decides based on query complexity (Recommended)</option>
                      <option value="pro">Pro - Comprehensive multi-domain research (slower, higher quality)</option>
                      <option value="mini">Mini - Fast targeted research (faster, lower cost)</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      💡 Auto is recommended. Use Pro for complex industry analysis, Mini for simple fact-finding
                    </p>
                  </div>

                  {/* Time Range */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-semibold text-black mb-2">
                      Time Range
                      <span className="ml-2 text-xs font-normal text-gray-500">(Filter by content publish date)</span>
                    </label>
                    <select
                      value={configs[phase.key].time_range || ''}
                      onChange={(e) => updateConfig(phase.key, 'time_range', e.target.value || undefined)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    >
                      <option value="">No time filter (all results)</option>
                      <option value="d">Past Day</option>
                      <option value="w">Past Week</option>
                      <option value="m">Past Month</option>
                      <option value="y">Past Year</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      💡 Use time filters for news/current events to ensure freshness
                    </p>
                  </div>

                  {/* Max Results */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-semibold text-black mb-2">
                      Max Results
                      <span className="ml-2 text-xs font-normal text-gray-500">(Tavily API limit: 1-20 sources)</span>
                    </label>
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min="1"
                        max="20"
                        step="1"
                        value={configs[phase.key].max_results}
                        onChange={(e) => updateConfig(phase.key, 'max_results', parseInt(e.target.value))}
                        className="flex-1"
                      />
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={configs[phase.key].max_results}
                        onChange={(e) => updateConfig(phase.key, 'max_results', Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
                        className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      💡 Lower values (5-10) = faster + cheaper. Higher values (50-100) = more comprehensive research
                    </p>
                  </div>

                  {/* Include Raw Content */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-semibold text-black mb-2">
                      Include Raw Content
                      <span className="ml-2 text-xs font-normal text-gray-500">(Full article content vs snippets)</span>
                    </label>
                    <select
                      value={String(configs[phase.key].include_raw_content)}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateConfig(phase.key, 'include_raw_content', 
                          val === 'true' ? true : val === 'false' ? false : val
                        );
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    >
                      <option value="false">Snippets only (faster, less tokens)</option>
                      <option value="true">Full content as markdown (best for analysis)</option>
                      <option value="text">Full content as plain text</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      💡 Enable for deep research tasks requiring full context. Disable for quick lookups.
                    </p>
                  </div>

                  {/* Include Images */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={configs[phase.key].include_images}
                        onChange={(e) => updateConfig(phase.key, 'include_images', e.target.checked)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="ml-3 text-sm font-semibold text-black">
                        Include Images
                        <span className="ml-2 text-xs font-normal text-gray-500">(Visual context from search results)</span>
                      </span>
                    </label>
                    <p className="text-xs text-gray-500 mt-2 ml-7">
                      💡 Enable if you need visual context, product images, or UI examples
                    </p>
                  </div>

                  {/* Include Answer */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-semibold text-black mb-2">
                      Include AI Answer
                      <span className="ml-2 text-xs font-normal text-gray-500">(Tavily generates summary from results)</span>
                    </label>
                    <select
                      value={String(configs[phase.key].include_answer)}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateConfig(phase.key, 'include_answer', 
                          val === 'true' ? true : val === 'false' ? false : val
                        );
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    >
                      <option value="false">No AI answer (process results yourself)</option>
                      <option value="true">Basic answer (quick summary)</option>
                      <option value="advanced">Advanced answer (detailed analysis)</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      💡 AI answers provide pre-digested insights. Disable for custom processing.
                    </p>
                  </div>

                  {/* Include Domains (Whitelist) */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-semibold text-black mb-2">
                      Include Domains (Whitelist)
                      <span className="ml-2 text-xs font-normal text-gray-500">(Only search these trusted sources)</span>
                    </label>
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        value={domainInput[phase.key].include}
                        onChange={(e) => setDomainInput(prev => ({
                          ...prev,
                          [phase.key]: { ...prev[phase.key], include: e.target.value }
                        }))}
                        onKeyPress={(e) => e.key === 'Enter' && addDomain(phase.key, 'include')}
                        placeholder="example.com"
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                      />
                      <button
                        onClick={() => addDomain(phase.key, 'include')}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                      >
                        Add
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {configs[phase.key].include_domains.map((domain) => (
                        <span
                          key={domain}
                          className="inline-flex items-center px-3 py-1 bg-green-100 text-green-800 text-sm rounded-full"
                        >
                          {domain}
                          <button
                            onClick={() => removeDomain(phase.key, 'include', domain)}
                            className="ml-2 text-green-600 hover:text-green-800"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {configs[phase.key].include_domains.length === 0 && (
                        <span className="text-xs text-gray-500 italic">No domain restrictions</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      💡 Use for authoritative sources (e.g., official docs, trusted publications)
                    </p>
                  </div>

                  {/* Exclude Domains (Blacklist) */}
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <label className="block text-sm font-semibold text-black mb-2">
                      Exclude Domains (Blacklist)
                      <span className="ml-2 text-xs font-normal text-gray-500">(Block low-quality sources)</span>
                    </label>
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        value={domainInput[phase.key].exclude}
                        onChange={(e) => setDomainInput(prev => ({
                          ...prev,
                          [phase.key]: { ...prev[phase.key], exclude: e.target.value }
                        }))}
                        onKeyPress={(e) => e.key === 'Enter' && addDomain(phase.key, 'exclude')}
                        placeholder="spam-site.com"
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                      />
                      <button
                        onClick={() => addDomain(phase.key, 'exclude')}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                      >
                        Add
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {configs[phase.key].exclude_domains.map((domain) => (
                        <span
                          key={domain}
                          className="inline-flex items-center px-3 py-1 bg-red-100 text-red-800 text-sm rounded-full"
                        >
                          {domain}
                          <button
                            onClick={() => removeDomain(phase.key, 'exclude', domain)}
                            className="ml-2 text-red-600 hover:text-red-800"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {configs[phase.key].exclude_domains.length === 0 && (
                        <span className="text-xs text-gray-500 italic">No domains blocked</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      💡 Use to filter out spam, low-quality blogs, or irrelevant sources
                    </p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-between items-center mt-8 pt-6 border-t border-gray-200">
                  <button
                    onClick={() => resetToDefaults(phase.key)}
                    className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  >
                    Reset to Defaults
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={() => loadConfigs()}
                      className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                    >
                      Cancel Changes
                    </button>
                    <button
                      onClick={() => saveConfig(phase.key)}
                      disabled={saving === phase.key}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving === phase.key ? 'Saving...' : 'Save Configuration'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null
          )}
        </div>

        {/* Best Practices Guide */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <h3 className="font-semibold text-green-900 mb-2 flex items-center">
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Quick Lookups
            </h3>
            <ul className="text-sm text-green-800 space-y-1">
              <li>• <strong>search_depth:</strong> basic</li>
              <li>• <strong>max_results:</strong> 5-10</li>
              <li>• <strong>include_raw_content:</strong> false</li>
              <li>• <strong>include_answer:</strong> basic</li>
            </ul>
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <h3 className="font-semibold text-purple-900 mb-2 flex items-center">
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
              </svg>
              Deep Research
            </h3>
            <ul className="text-sm text-purple-800 space-y-1">
              <li>• <strong>search_depth:</strong> advanced</li>
              <li>• <strong>max_results:</strong> 15-20 (Tavily API max)</li>
              <li>• <strong>include_raw_content:</strong> markdown</li>
              <li>• <strong>include_answer:</strong> advanced</li>
            </ul>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h3 className="font-semibold text-yellow-900 mb-2 flex items-center">
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
              </svg>
              News & Current Events
            </h3>
            <ul className="text-sm text-yellow-800 space-y-1">
              <li>• <strong>topic:</strong> news</li>
              <li>• <strong>time_range:</strong> day or week</li>
              <li>• <strong>search_depth:</strong> advanced</li>
              <li>• Ensures fresh, timely content</li>
            </ul>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-2 flex items-center">
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Trusted Sources Only
            </h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Use <strong>include_domains</strong> whitelist</li>
              <li>• Add official docs, gov sites</li>
              <li>• Improves credibility & reliability</li>
              <li>• Great for regulated industries</li>
            </ul>
          </div>
        </div>

        {/* Parameter Reference */}
        <div className="mt-6 bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h3 className="font-semibold text-gray-900 mb-4">📖 Parameter Quick Reference</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Performance Impact</h4>
              <ul className="text-gray-700 space-y-1">
                <li><strong>search_depth:</strong> advanced = slower but better</li>
                <li><strong>max_results:</strong> Higher = more API cost</li>
                <li><strong>include_raw_content:</strong> Increases tokens</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Quality Controls</h4>
              <ul className="text-gray-700 space-y-1">
                <li><strong>include_domains:</strong> Whitelist trusted sources</li>
                <li><strong>exclude_domains:</strong> Block spam/low-quality</li>
                <li><strong>time_range:</strong> Ensure content freshness</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
