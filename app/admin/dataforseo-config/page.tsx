'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useRouter } from 'next/navigation';
import AdminNav from '@/components/AdminNav';
import { FullPageLoading } from '@/components/ui/loading-spinner';

interface DataForSEOConfig {
  enabled: boolean;
  location_code: number;
  language_code: string;
  // Phase 1
  gmb_search_depth: number;
  local_pack_keywords: number;
  // Phase 2
  max_serp_competitors: number;
  max_ranked_keywords_per_competitor: number;
  keyword_suggestion_limit: number;
  keyword_enrichment_batch_size: number;
  // Phase 3
  max_urls_to_audit: number;
  enable_javascript_rendering: boolean;
  max_crawl_pages: number;
  load_resources: boolean;
}

interface PhaseConfig {
  key: string;
  label: string;
  description: string;
  configKey: string;
}

const DEFAULT_CONFIGS: Record<string, DataForSEOConfig> = {
  phase1: {
    enabled: true,
    location_code: 2840,
    language_code: 'en',
    gmb_search_depth: 20,
    local_pack_keywords: 3,
    max_serp_competitors: 5,
    max_ranked_keywords_per_competitor: 100,
    keyword_suggestion_limit: 50,
    keyword_enrichment_batch_size: 100,
    max_urls_to_audit: 3,
    enable_javascript_rendering: false,
    max_crawl_pages: 10,
    load_resources: false,
  },
  phase2: {
    enabled: true,
    location_code: 2840,
    language_code: 'en',
    gmb_search_depth: 20,
    local_pack_keywords: 3,
    max_serp_competitors: 5,
    max_ranked_keywords_per_competitor: 100,
    keyword_suggestion_limit: 50,
    keyword_enrichment_batch_size: 100,
    max_urls_to_audit: 3,
    enable_javascript_rendering: false,
    max_crawl_pages: 10,
    load_resources: false,
  },
  phase3: {
    enabled: true,
    location_code: 2840,
    language_code: 'en',
    gmb_search_depth: 20,
    local_pack_keywords: 3,
    max_serp_competitors: 5,
    max_ranked_keywords_per_competitor: 100,
    keyword_suggestion_limit: 50,
    keyword_enrichment_batch_size: 100,
    max_urls_to_audit: 3,
    enable_javascript_rendering: false,
    max_crawl_pages: 10,
    load_resources: false,
  },
};

const COMMON_LOCATIONS: Record<number, string> = {
  2840: 'United States',
  2826: 'United Kingdom',
  2124: 'Canada',
  2036: 'Australia',
  2276: 'Germany',
  2250: 'France',
  2724: 'Spain',
  2380: 'Italy',
  2528: 'Netherlands',
  2076: 'Brazil',
  2356: 'India',
  2392: 'Japan',
};

export default function DataForSEOConfigPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('phase1');
  const [configs, setConfigs] = useState<Record<string, DataForSEOConfig>>({ ...DEFAULT_CONFIGS });

  const supabase = createClient();
  const router = useRouter();

  const phases: PhaseConfig[] = [
    {
      key: 'phase1',
      label: 'Phase 1: Local Competitive Intelligence',
      description: 'Google My Business search and SERP local pack analysis',
      configKey: 'phase1_dataforseo_params',
    },
    {
      key: 'phase2',
      label: 'Phase 2: SEO & Keyword Research',
      description: 'SERP competitors, ranked keywords, keyword suggestions, and enrichment',
      configKey: 'phase2_dataforseo_params',
    },
    {
      key: 'phase3',
      label: 'Phase 3: On-Page Technical Audit',
      description: 'On-page SEO audit and technical benchmarking of top competitors',
      configKey: 'phase3_dataforseo_params',
    },
  ];

  useEffect(() => {
    checkAdminAccess();
  }, []);

  async function checkAdminAccess() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }
    setUser(session.user);

    const { data: adminConfig } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'admin_emails')
      .single();

    const adminEmails = adminConfig?.config_value as string[];
    if (!adminEmails?.includes(session.user.email || '')) { router.push('/dashboard'); return; }

    await loadConfigs();
    setLoading(false);
  }

  async function loadConfigs() {
    const configKeys = phases.map(p => p.configKey);
    const { data } = await supabase
      .from('admin_config')
      .select('config_key, config_value')
      .in('config_key', configKeys);

    if (data) {
      const loaded: Record<string, DataForSEOConfig> = { ...DEFAULT_CONFIGS };
      data.forEach((item: any) => {
        const phaseKey = item.config_key.replace('_dataforseo_params', '');
        loaded[phaseKey] = { ...DEFAULT_CONFIGS[phaseKey], ...item.config_value };
      });
      setConfigs(loaded);
    }
  }

  async function saveConfig(phaseKey: string) {
    setSaving(phaseKey);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const configKey = `${phaseKey}_dataforseo_params`;

      const { data: existing } = await supabase
        .from('admin_config')
        .select('id')
        .eq('config_key', configKey)
        .maybeSingle();

      let error;
      if (existing) {
        const { error: e } = await supabase
          .from('admin_config')
          .update({
            config_value: configs[phaseKey],
            updated_at: new Date().toISOString(),
            updated_by: user?.id || null,
          })
          .eq('config_key', configKey);
        error = e;
      } else {
        const { error: e } = await supabase
          .from('admin_config')
          .insert({
            config_key: configKey,
            config_value: configs[phaseKey],
            description: `DataForSEO parameters for ${phaseKey}`,
            updated_at: new Date().toISOString(),
            updated_by: user?.id || null,
          });
        error = e;
      }

      if (error) throw error;
      alert('Configuration saved successfully!');
      await loadConfigs();
    } catch (err: any) {
      console.error('Save error:', err);
      alert(`Failed to save: ${err.message}`);
    } finally {
      setSaving(null);
    }
  }

  function updateConfig(phaseKey: string, field: keyof DataForSEOConfig, value: any) {
    setConfigs(prev => ({
      ...prev,
      [phaseKey]: { ...prev[phaseKey], [field]: value },
    }));
  }

  function resetToDefaults(phaseKey: string) {
    if (confirm('Reset to default configuration? This cannot be undone.')) {
      setConfigs(prev => ({ ...prev, [phaseKey]: DEFAULT_CONFIGS[phaseKey] }));
    }
  }

  if (loading) {
    return (
      <FullPageLoading message="Loading…" variant="light" className="bg-gray-50" />
    );
  }

  const currentPhase = phases.find(p => p.key === activeTab)!;
  const config = configs[activeTab];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold text-black">DataForSEO Configuration</h1>
              <p className="text-gray-600 mt-1">Configure DataForSEO API parameters for each research phase</p>
            </div>
          </div>
          <AdminNav />
        </div>

        {/* Overview Banner */}
        <div className="bg-gradient-to-r from-orange-600 to-amber-600 rounded-lg shadow-lg p-8 mb-8 text-white">
          <h2 className="text-2xl font-bold mb-2">📊 DataForSEO API Integration</h2>
          <p className="text-orange-100 mb-4">
            DataForSEO provides real SEO intelligence data including Google Maps business data, SERP competitor analysis, keyword metrics, and on-page technical audits. Users with DataForSEO credentials will get enhanced research.
          </p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="bg-white/20 rounded-lg p-3">
              <div className="font-semibold">Phase 1</div>
              <div className="text-orange-100">Google Maps + Local Pack</div>
            </div>
            <div className="bg-white/20 rounded-lg p-3">
              <div className="font-semibold">Phase 2</div>
              <div className="text-orange-100">Keywords + Competitors</div>
            </div>
            <div className="bg-white/20 rounded-lg p-3">
              <div className="font-semibold">Phase 3</div>
              <div className="text-orange-100">On-Page Technical Audit</div>
            </div>
          </div>
        </div>

        {/* Cost Estimate */}
        <div className="bg-white rounded-lg shadow mb-8 p-6">
          <h3 className="text-lg font-semibold text-black mb-3">💰 Estimated Cost Per Research Session</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-2 text-left text-gray-700 font-medium">API Endpoint</th>
                  <th className="px-4 py-2 text-left text-gray-700 font-medium">~Cost/Call</th>
                  <th className="px-4 py-2 text-left text-gray-700 font-medium">Calls/Session</th>
                  <th className="px-4 py-2 text-left text-gray-700 font-medium">~Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr><td className="px-4 py-2 text-gray-900">Business Data (GMB)</td><td className="px-4 py-2 text-gray-600">$0.005</td><td className="px-4 py-2 text-gray-600">1</td><td className="px-4 py-2 font-medium text-gray-900">$0.005</td></tr>
                <tr><td className="px-4 py-2 text-gray-900">SERP (Local Pack)</td><td className="px-4 py-2 text-gray-600">$0.004</td><td className="px-4 py-2 text-gray-600">1-3</td><td className="px-4 py-2 font-medium text-gray-900">$0.004-$0.012</td></tr>
                <tr><td className="px-4 py-2 text-gray-900">Labs (SERP Competitors)</td><td className="px-4 py-2 text-gray-600">$0.01</td><td className="px-4 py-2 text-gray-600">1</td><td className="px-4 py-2 font-medium text-gray-900">$0.01</td></tr>
                <tr><td className="px-4 py-2 text-gray-900">Labs (Ranked Keywords)</td><td className="px-4 py-2 text-gray-600">$0.05</td><td className="px-4 py-2 text-gray-600">3-5</td><td className="px-4 py-2 font-medium text-gray-900">$0.15-$0.25</td></tr>
                <tr><td className="px-4 py-2 text-gray-900">Labs (Keyword Suggestions)</td><td className="px-4 py-2 text-gray-600">$0.01</td><td className="px-4 py-2 text-gray-600">1</td><td className="px-4 py-2 font-medium text-gray-900">$0.01</td></tr>
                <tr><td className="px-4 py-2 text-gray-900">Labs (Keyword Overview)</td><td className="px-4 py-2 text-gray-600">$0.02/100kw</td><td className="px-4 py-2 text-gray-600">1</td><td className="px-4 py-2 font-medium text-gray-900">$0.10</td></tr>
                <tr><td className="px-4 py-2 text-gray-900">On-Page (Task + Results)</td><td className="px-4 py-2 text-gray-600">$0.01/page</td><td className="px-4 py-2 text-gray-600">3-5</td><td className="px-4 py-2 font-medium text-gray-900">$0.03-$0.05</td></tr>
                <tr className="bg-orange-50 font-semibold"><td className="px-4 py-2 text-orange-900">Total Estimated</td><td className="px-4 py-2"></td><td className="px-4 py-2"></td><td className="px-4 py-2 text-orange-900">$0.31 - $0.43</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Phase Tabs */}
        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              {phases.map(phase => (
                <button
                  key={phase.key}
                  onClick={() => setActiveTab(phase.key)}
                  className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === phase.key
                      ? 'border-orange-500 text-orange-600 bg-orange-50'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {phase.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {/* Phase Info */}
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-black">{currentPhase.label}</h2>
              <p className="text-gray-600 mt-1">{currentPhase.description}</p>
            </div>

            {/* Enabled Toggle */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={e => updateConfig(activeTab, 'enabled', e.target.checked)}
                  className="w-5 h-5 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                />
                <span className="text-sm font-semibold text-black">
                  Enable DataForSEO for {currentPhase.label}
                </span>
              </label>
              <p className="text-xs text-gray-500 mt-1 ml-8">
                When disabled, this phase will only use Tavily data (original behavior)
              </p>
            </div>

            {/* Common Settings */}
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-black border-b pb-2">General Settings</h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-black mb-2">Location</label>
                  <select
                    value={config.location_code}
                    onChange={e => updateConfig(activeTab, 'location_code', parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-black"
                  >
                    {Object.entries(COMMON_LOCATIONS).map(([code, name]) => (
                      <option key={code} value={code}>{name} ({code})</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">DataForSEO location code for search targeting</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-black mb-2">Language Code</label>
                  <input
                    type="text"
                    value={config.language_code}
                    onChange={e => updateConfig(activeTab, 'language_code', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-black"
                    placeholder="en"
                  />
                </div>
              </div>

              {/* Phase-specific Settings */}
              {activeTab === 'phase1' && (
                <>
                  <h3 className="text-lg font-semibold text-black border-b pb-2 mt-8">Phase 1: Local Competition Settings</h3>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-black mb-2">GMB Search Depth</label>
                      <input
                        type="number"
                        value={config.gmb_search_depth}
                        onChange={e => updateConfig(activeTab, 'gmb_search_depth', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-black"
                        min={5} max={100}
                      />
                      <p className="text-xs text-gray-500 mt-1">Max Google Maps results to fetch (5-100)</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-black mb-2">Local Pack Keywords</label>
                      <input
                        type="number"
                        value={config.local_pack_keywords}
                        onChange={e => updateConfig(activeTab, 'local_pack_keywords', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-black"
                        min={1} max={10}
                      />
                      <p className="text-xs text-gray-500 mt-1">Number of SERP local pack queries (1-10)</p>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'phase2' && (
                <>
                  <h3 className="text-lg font-semibold text-black border-b pb-2 mt-8">Phase 2: Keyword Research Settings</h3>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-black mb-2">Max SERP Competitors</label>
                      <input
                        type="number"
                        value={config.max_serp_competitors}
                        onChange={e => updateConfig(activeTab, 'max_serp_competitors', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-black"
                        min={1} max={20}
                      />
                      <p className="text-xs text-gray-500 mt-1">Top SERP competitors to analyze (1-20)</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-black mb-2">Ranked Keywords Per Competitor</label>
                      <input
                        type="number"
                        value={config.max_ranked_keywords_per_competitor}
                        onChange={e => updateConfig(activeTab, 'max_ranked_keywords_per_competitor', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-black"
                        min={10} max={1000}
                      />
                      <p className="text-xs text-gray-500 mt-1">Keywords to extract per competitor (10-1000, higher = more cost)</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-black mb-2">Keyword Suggestion Limit</label>
                      <input
                        type="number"
                        value={config.keyword_suggestion_limit}
                        onChange={e => updateConfig(activeTab, 'keyword_suggestion_limit', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-black"
                        min={10} max={500}
                      />
                      <p className="text-xs text-gray-500 mt-1">Max keyword suggestions from seed (10-500)</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-black mb-2">Enrichment Batch Size</label>
                      <input
                        type="number"
                        value={config.keyword_enrichment_batch_size}
                        onChange={e => updateConfig(activeTab, 'keyword_enrichment_batch_size', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-black"
                        min={10} max={1000}
                      />
                      <p className="text-xs text-gray-500 mt-1">Max keywords to enrich with metrics (10-1000)</p>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'phase3' && (
                <>
                  <h3 className="text-lg font-semibold text-black border-b pb-2 mt-8">Phase 3: On-Page Audit Settings</h3>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-black mb-2">Max URLs to Audit</label>
                      <input
                        type="number"
                        value={config.max_urls_to_audit}
                        onChange={e => updateConfig(activeTab, 'max_urls_to_audit', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-black"
                        min={1} max={10}
                      />
                      <p className="text-xs text-gray-500 mt-1">Competitor URLs to audit (1-10, each costs ~$0.01)</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-black mb-2">Max Crawl Pages Per URL</label>
                      <input
                        type="number"
                        value={config.max_crawl_pages}
                        onChange={e => updateConfig(activeTab, 'max_crawl_pages', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-black"
                        min={1} max={100}
                      />
                      <p className="text-xs text-gray-500 mt-1">Pages to crawl per URL (1-100)</p>
                    </div>
                    <div>
                      <label className="flex items-center space-x-3 cursor-pointer mt-4">
                        <input
                          type="checkbox"
                          checked={config.enable_javascript_rendering}
                          onChange={e => updateConfig(activeTab, 'enable_javascript_rendering', e.target.checked)}
                          className="w-5 h-5 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                        />
                        <div>
                          <span className="text-sm font-medium text-black">Enable JavaScript Rendering</span>
                          <p className="text-xs text-gray-500">More accurate but slower and costs more</p>
                        </div>
                      </label>
                    </div>
                    <div>
                      <label className="flex items-center space-x-3 cursor-pointer mt-4">
                        <input
                          type="checkbox"
                          checked={config.load_resources}
                          onChange={e => updateConfig(activeTab, 'load_resources', e.target.checked)}
                          className="w-5 h-5 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                        />
                        <div>
                          <span className="text-sm font-medium text-black">Load Resources</span>
                          <p className="text-xs text-gray-500">Load CSS, JS, images for full page analysis</p>
                        </div>
                      </label>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Action Buttons */}
            <div className="mt-8 flex gap-4">
              <button
                onClick={() => saveConfig(activeTab)}
                disabled={saving === activeTab}
                className="flex-1 bg-orange-600 text-white py-3 rounded-lg font-semibold hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving === activeTab ? 'Saving...' : `Save ${currentPhase.label.split(':')[0]} Config`}
              </button>
              <button
                onClick={() => resetToDefaults(activeTab)}
                className="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Reset to Defaults
              </button>
            </div>
          </div>
        </div>

        {/* API Call Sequence Diagram */}
        <div className="mt-8 bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-black mb-4">🔄 API Call Sequence Per Research Session</h3>
          <div className="space-y-4 text-sm">
            <div className="flex items-start space-x-4">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold flex-shrink-0">1</div>
              <div>
                <p className="font-semibold text-black">Phase 1: Local Competition</p>
                <p className="text-gray-600">Business Data API (GMB Search) → SERP API (Local Pack for each keyword)</p>
              </div>
            </div>
            <div className="flex items-start space-x-4">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold flex-shrink-0">2</div>
              <div>
                <p className="font-semibold text-black">Phase 2: Keyword Research</p>
                <p className="text-gray-600">Labs (SERP Competitors) → Labs (Ranked Keywords for each competitor) → Labs (Keyword Suggestions) → Labs (Keyword Overview/Enrichment)</p>
              </div>
            </div>
            <div className="flex items-start space-x-4">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold flex-shrink-0">3</div>
              <div>
                <p className="font-semibold text-black">Phase 3: On-Page Audit</p>
                <p className="text-gray-600">On-Page API (Task Post for each URL) → On-Page API (Poll for results) → On-Page API (Get page data)</p>
              </div>
            </div>
            <div className="flex items-start space-x-4">
              <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-bold flex-shrink-0">4</div>
              <div>
                <p className="font-semibold text-black">Phase 4: Synthesis (Claude)</p>
                <p className="text-gray-600">All structured DataForSEO JSON data is passed to Claude alongside Tavily results for data-driven synthesis</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
