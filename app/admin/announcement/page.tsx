'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useRouter } from 'next/navigation';
import AdminNav from '@/components/AdminNav';
import { FullPageLoading } from '@/components/ui/loading-spinner';

interface BannerConfig {
  enabled: boolean;
  message: string;
}

export default function AnnouncementPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<BannerConfig>({ enabled: false, message: '' });
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    checkAdminAndLoad();
  }, []);

  async function checkAdminAndLoad() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) { router.push('/'); return; }

    const { data: adminConfig } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'admin_emails')
      .single();

    const adminEmails = adminConfig?.config_value as string[];
    if (!adminEmails?.includes(user.email || '')) {
      router.push('/dashboard');
      return;
    }

    await loadBanner();
    setLoading(false);
  }

  async function loadBanner() {
    const { data } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'announcement_banner')
      .single();

    if (data?.config_value) {
      setBanner(data.config_value as BannerConfig);
    }
  }

  async function saveBanner() {
    setSaving(true);
    setStatus(null);
    try {
      const { error } = await supabase
        .from('admin_config')
        .upsert({
          config_key: 'announcement_banner',
          config_value: banner,
          description: 'Global announcement banner shown to all users',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'config_key' });

      if (error) throw error;
      setStatus({ type: 'success', text: 'Banner saved successfully.' });
    } catch (err: any) {
      setStatus({ type: 'error', text: err.message || 'Failed to save banner.' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <FullPageLoading />;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <AdminNav />

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Announcement Banner</h1>
            <p className="text-sm text-gray-500 mt-1">
              This banner appears at the top of every page for all users. Toggle it on/off and customize the message below.
            </p>
          </div>

          {/* Preview */}
          {banner.message && (
            <div className="rounded-lg overflow-hidden">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Preview</p>
              <div className="w-full bg-red-600 text-white px-4 py-3 flex items-center justify-between rounded-lg">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-lg flex-shrink-0">⚠️</span>
                  <p className="text-sm font-medium leading-snug">{banner.message}</p>
                </div>
                <span className="ml-4 text-white/60 text-2xl font-bold flex-shrink-0 leading-none">×</span>
              </div>
            </div>
          )}

          {/* Toggle */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <p className="text-sm font-semibold text-gray-800">Banner Status</p>
              <p className="text-xs text-gray-500">
                {banner.enabled ? 'Banner is live — visible to all users.' : 'Banner is hidden — not shown to any users.'}
              </p>
            </div>
            <button
              onClick={() => setBanner(b => ({ ...b, enabled: !b.enabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                banner.enabled ? 'bg-red-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  banner.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Message */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-800">
              Banner Message
            </label>
            <textarea
              value={banner.message}
              onChange={e => setBanner(b => ({ ...b, message: e.target.value }))}
              rows={3}
              placeholder="e.g. For security best practices, please cycle your API keys and DataForSEO login. If you do not, your research attempts may fail."
              className="w-full text-sm text-gray-900 placeholder-gray-400 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
            />
            <p className="text-xs text-gray-400">{banner.message.length} characters</p>
          </div>

          {/* Status */}
          {status && (
            <div className={`p-3 rounded-lg text-sm font-medium ${
              status.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {status.text}
            </div>
          )}

          {/* Save */}
          <button
            onClick={saveBanner}
            disabled={saving || !banner.message.trim()}
            className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : 'Save Banner'}
          </button>
        </div>
      </div>
    </div>
  );
}
