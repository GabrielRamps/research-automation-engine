'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useRouter } from 'next/navigation';
import AdminNav from '@/components/AdminNav';
import { FullPageLoading } from '@/components/ui/loading-spinner';

interface ContextDoc {
  title: string;
  content: string;
}

export default function AdminPanel() {
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [conversionContext, setConversionContext] = useState<ContextDoc>({
    title: '',
    content: ''
  });

  const [seoContext, setSeoContext] = useState<ContextDoc>({
    title: '',
    content: ''
  });

  const [termsContent, setTermsContent] = useState('');
  const [currentTermsVersion, setCurrentTermsVersion] = useState<number | null>(null);
  const [loadingTerms, setLoadingTerms] = useState(false);
  const [savingTerms, setSavingTerms] = useState(false);
  const [loadingTermsFromRepo, setLoadingTermsFromRepo] = useState(false);

  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    checkAdminAccess();
  }, []);

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

    setIsAdmin(true);
    await loadConfigs();
    await loadTerms();
    setLoading(false);
  }

  async function loadConfigs() {
    // Load conversion context
    const { data: conversionData } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'context_conversion_optimization')
      .single();

    if (conversionData) {
      setConversionContext(conversionData.config_value as ContextDoc);
    }

    // Load SEO context
    const { data: seoData } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'context_seo_principles')
      .single();

    if (seoData) {
      setSeoContext(seoData.config_value as ContextDoc);
    }
  }

  async function saveConfig(configKey: string, configValue: ContextDoc) {
    setSaving(true);
    try {
      // Get current user for updated_by field
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      
      // Check if record exists (using maybeSingle to avoid error if not found)
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
            config_value: configValue,
            updated_at: new Date().toISOString(),
            updated_by: currentUser?.id || user?.id || null
          })
          .eq('config_key', configKey);
        
        error = updateError;
      } else {
        // Insert new record
        const { error: insertError } = await supabase
          .from('admin_config')
          .insert({
            config_key: configKey,
            config_value: configValue,
            updated_at: new Date().toISOString(),
            updated_by: currentUser?.id || user?.id || null
          });
        
        error = insertError;
      }

      if (error) throw error;

      alert('Configuration saved successfully!');
    } catch (error: any) {
      console.error('Error saving config:', error);
      alert('Failed to save configuration: ' + error.message);
    } finally {
      setSaving(false);
    }
  }

  async function loadTerms() {
    setLoadingTerms(true);
    try {
      const { data, error } = await supabase
        .from('terms_and_conditions')
        .select('*')
        .eq('is_active', true)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setTermsContent(data.content);
        setCurrentTermsVersion(data.version);
      }
    } catch (error: any) {
      console.error('Error loading terms:', error);
      alert('Failed to load terms: ' + error.message);
    } finally {
      setLoadingTerms(false);
    }
  }

  async function loadTermsFromRepo() {
    setLoadingTermsFromRepo(true);
    try {
      const response = await fetch('/api/admin/terms/load-default');
      if (!response.ok) {
        const err = (await response.json()) as { error?: string };
        throw new Error(err.error || 'Failed to load');
      }
      const { content } = (await response.json()) as { content: string };
      setTermsContent(content);
    } catch (error: any) {
      console.error('Error loading terms from repo:', error);
      alert('Failed to load terms from repo: ' + (error.message || 'Unknown error'));
    } finally {
      setLoadingTermsFromRepo(false);
    }
  }

  async function updateTerms() {
    if (!termsContent.trim()) {
      alert('Terms content cannot be empty');
      return;
    }

    const confirmed = confirm(
      'This will create a new version of the Terms & Conditions and require all users to re-accept them. Continue?'
    );

    if (!confirmed) return;

    setSavingTerms(true);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      // Call API to update terms (uses service role)
      const response = await fetch('/api/admin/terms/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: termsContent,
          userId: currentUser?.id || user?.id
        })
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error || 'Failed to update terms');
      }

      const result = (await response.json()) as { version?: number };
      setCurrentTermsVersion(result.version ?? null);
      
      alert(`Terms & Conditions updated successfully! New version: ${result.version}`);
    } catch (error: any) {
      console.error('Error updating terms:', error);
      alert('Failed to update terms: ' + error.message);
    } finally {
      setSavingTerms(false);
    }
  }

  if (loading) {
    return (
      <FullPageLoading message="Loading…" variant="light" />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold text-black">Admin Panel</h1>
              <p className="text-black mt-1">Manage context documents and AI prompts</p>
            </div>
          </div>
          <AdminNav />
        </div>

        {/* Quick Actions */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg shadow-lg p-8 mb-8 text-white">
          <h2 className="text-2xl font-bold mb-4">🔬 Dynamic Research Prompt System</h2>
          <p className="mb-6 text-blue-100">
            Manage research prompts with drag-and-drop reordering, testing, and import/export capabilities. Configure Tavily search parameters and control execution order.
          </p>
          <div className="flex gap-4">
            <button
              onClick={() => router.push('/admin/research-prompts')}
              className="px-6 py-3 bg-white text-blue-600 rounded-lg font-semibold hover:bg-blue-50 transition-colors shadow-lg"
            >
              📝 Manage Research Prompts →
            </button>
            <button
              onClick={() => router.push('/admin/tavily-config')}
              className="px-6 py-3 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-400 transition-colors border-2 border-white"
            >
              ⚙️ Tavily Search Parameters →
            </button>
          </div>
        </div>

        {/* Terms & Conditions Section */}
        <div className="bg-white rounded-lg shadow mb-8">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-black">Terms & Conditions</h2>
            <p className="text-sm text-black mt-1">
              Manage the Terms & Conditions that all users must accept. Updating this will create a new version and require users to re-accept.
            </p>
            {currentTermsVersion && (
              <p className="text-sm font-medium text-blue-600 mt-2">
                Current Version: {currentTermsVersion}
              </p>
            )}
          </div>
          
          <div className="p-6">
            {loadingTerms ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-black mb-2">
                    Terms & Conditions Content
                  </label>
                  <textarea
                    value={termsContent}
                    onChange={(e) => setTermsContent(e.target.value)}
                    className="w-full h-96 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm text-black"
                    placeholder="Enter Terms & Conditions content..."
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    Tip: Use clear section headers (UPPERCASE), numbered sections (1., 2.), and sub-sections (1.1, 1.2) for better formatting.
                  </p>
                </div>
                
                <div className="flex flex-wrap gap-4">
                  <button
                    onClick={loadTerms}
                    disabled={loadingTerms || savingTerms}
                    className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Reload Current Version
                  </button>
                  <button
                    onClick={loadTermsFromRepo}
                    disabled={loadingTermsFromRepo || savingTerms}
                    className="px-6 py-3 border border-blue-400 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loadingTermsFromRepo ? 'Loading...' : 'Load latest from repo'}
                  </button>
                  <button
                    onClick={updateTerms}
                    disabled={loadingTerms || savingTerms || !termsContent.trim()}
                    className="flex-1 min-w-[200px] bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingTerms ? 'Updating...' : 'Update Terms & Create New Version'}
                  </button>
                </div>

                <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <h4 className="text-sm font-semibold text-yellow-800 mb-2">⚠️ Important Notes</h4>
                  <ul className="text-xs text-yellow-700 space-y-1 list-disc list-inside">
                    <li>Updating the terms will increment the version number automatically</li>
                    <li>All existing users will be required to accept the new terms on their next login</li>
                    <li>Users who decline the terms will be signed out</li>
                    <li>The previous version will be deactivated but preserved in the database</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Context Documents Section */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-black">Context Documents</h2>
            <p className="text-sm text-black mt-1">
              These documents are provided to Claude as reference material for all research generations
            </p>
          </div>
          
          <div className="p-6 space-y-8">
            {/* Conversion Optimization Doc */}
            <div className="border-b pb-8">
              <h3 className="text-lg font-semibold text-black mb-4">Conversion Optimization</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-black mb-2">
                    Document Title
                  </label>
                  <input
                    type="text"
                    value={conversionContext.title}
                    onChange={(e) => setConversionContext({ ...conversionContext, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-black"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-black mb-2">
                    Content (Markdown supported)
                  </label>
                  <textarea
                    value={conversionContext.content}
                    onChange={(e) => setConversionContext({ ...conversionContext, content: e.target.value })}
                    className="w-full h-96 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm text-black"
                    placeholder="Enter conversion optimization principles..."
                  />
                </div>
                
                <button
                  onClick={() => saveConfig('context_conversion_optimization', conversionContext)}
                  disabled={saving}
                  className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Conversion Context'}
                </button>
              </div>
            </div>
            
            {/* SEO Principles Doc */}
            <div>
              <h3 className="text-lg font-semibold text-black mb-4">SEO Principles</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-black mb-2">
                    Document Title
                  </label>
                  <input
                    type="text"
                    value={seoContext.title}
                    onChange={(e) => setSeoContext({ ...seoContext, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-black"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-black mb-2">
                    Content (Markdown supported)
                  </label>
                  <textarea
                    value={seoContext.content}
                    onChange={(e) => setSeoContext({ ...seoContext, content: e.target.value })}
                    className="w-full h-96 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm text-black"
                    placeholder="Enter SEO principles..."
                  />
                </div>
                
                <button
                  onClick={() => saveConfig('context_seo_principles', seoContext)}
                  disabled={saving}
                  className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save SEO Context'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

