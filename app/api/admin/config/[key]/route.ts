import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { isUserAdmin } from '@/lib/admin-check';

/**
 * GET - Get admin config by key
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ key: string }> }
) {
  const params = await context.params;
  try {
    const supabase = await createClient();
    const { key } = params;

    // Check if user is admin
    const { isAdmin, user } = await isUserAdmin(supabase);
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Fetch config
    const { data: config, error } = await supabase
      .from('admin_config')
      .select('*')
      .eq('config_key', key)
      .single();

    if (error) {
      console.error('[API] Error fetching config:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    return NextResponse.json({ config: config.config_value });
  } catch (error: any) {
    console.error('[API] Unexpected error in GET /api/admin/config/[key]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST - Update admin config by key
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ key: string }> }
) {
  const params = await context.params;
  try {
    const supabase = await createClient();
    const { key } = params;
    const body = (await request.json()) as { config?: unknown };
    const { config } = body;

    // Check if user is admin
    const { isAdmin, user } = await isUserAdmin(supabase);
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    if (!config) {
      return NextResponse.json({ error: 'Missing config data' }, { status: 400 });
    }

    // Update config
    const { data, error } = await supabase
      .from('admin_config')
      .update({
        config_value: config,
        updated_at: new Date().toISOString()
      })
      .eq('config_key', key)
      .select()
      .single();

    if (error) {
      console.error('[API] Error updating config:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, config: data.config_value });
  } catch (error: any) {
    console.error('[API] Unexpected error in POST /api/admin/config/[key]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
