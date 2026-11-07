import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getAuthenticatedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { BUILD_SITE_MASTER_PROMPT_DEFAULT } from '@/lib/build-site-prompt-default';

const CONFIG_KEY = 'build_site_master_prompt';

/**
 * GET /api/build-site-prompt
 * Returns the build-site master prompt for the results page.
 * Authenticated (any logged-in user), not admin-only.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth) return unauthorizedResponse();

    const supabase = await createClient();
    const { data: row } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', CONFIG_KEY)
      .single();

    let prompt = BUILD_SITE_MASTER_PROMPT_DEFAULT;
    if (row?.config_value) {
      const val = row.config_value;
      if (typeof val === 'string' && val.trim()) {
        prompt = val;
      } else if (val && typeof val === 'object' && 'template' in val) {
        const t = (val as { template: string }).template;
        if (t.trim()) prompt = t;
      }
    }

    return NextResponse.json({ prompt });
  } catch (error) {
    console.error('Build site prompt public GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
