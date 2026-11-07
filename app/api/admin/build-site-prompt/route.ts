import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { isUserAdmin } from '@/lib/admin-check';
import { BUILD_SITE_MASTER_PROMPT_DEFAULT } from '@/lib/build-site-prompt-default';

const CONFIG_KEY = 'build_site_master_prompt';

function extractPromptText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'template' in value) return (value as { template: string }).template;
  if (value != null) return String(value);
  return '';
}

/**
 * GET - Return the build-site master prompt (from admin_config or code default)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { isAdmin, user } = await isUserAdmin(supabase);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

    const { data: row } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', CONFIG_KEY)
      .single();

    const text = row ? extractPromptText(row.config_value) : '';
    const prompt = text || BUILD_SITE_MASTER_PROMPT_DEFAULT;

    return NextResponse.json({ prompt });
  } catch (error) {
    console.error('Build site prompt GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT - Update the build-site master prompt in admin_config
 * Body: { prompt: string }
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { isAdmin, user } = await isUserAdmin(supabase);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

    const body = (await request.json()) as { prompt?: string };
    if (typeof body.prompt !== 'string') {
      return NextResponse.json({ error: 'Provide a "prompt" string' }, { status: 400 });
    }

    const { error } = await supabase
      .from('admin_config')
      .upsert(
        { config_key: CONFIG_KEY, config_value: body.prompt, updated_at: new Date().toISOString() },
        { onConflict: 'config_key' }
      );

    if (error) {
      console.error('Error upserting build site prompt:', error);
      return NextResponse.json({ error: 'Failed to save prompt' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Build site prompt PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
