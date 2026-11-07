import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { isUserAdmin } from '@/lib/admin-check';

/**
 * GET - List all research prompts (optionally filtered by phase)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const phase = searchParams.get('phase');

    // Check if user is admin
    const { isAdmin, user, error: adminError } = await isUserAdmin(supabase);
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Build query
    let query = supabase
      .from('research_prompts')
      .select('*')
      .order('phase', { ascending: true })
      .order('order_index', { ascending: true });

    if (phase) {
      query = query.eq('phase', parseInt(phase));
    }

    const { data: prompts, error } = await query;

    if (error) {
      console.error('[API] Error fetching prompts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ prompts });
  } catch (error: any) {
    console.error('[API] Unexpected error in GET /api/admin/research-prompts:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST - Create new research prompt
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = (await request.json()) as {
      phase?: number; name?: string; prompt_template?: string;
      internal_notes?: string; status?: string; override_max_results?: number;
    };

    // Check if user is admin
    const { isAdmin, user, error: adminError } = await isUserAdmin(supabase);
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Validate required fields
    if (!body.phase || !body.name || !body.prompt_template) {
      return NextResponse.json(
        { error: 'Missing required fields: phase, name, prompt_template' },
        { status: 400 }
      );
    }

    // Get next order_index for phase
    const { data: existing } = await supabase
      .from('research_prompts')
      .select('order_index')
      .eq('phase', body.phase)
      .order('order_index', { ascending: false })
      .limit(1);

    const nextOrder = (existing?.[0]?.order_index ?? -1) + 1;

    // Insert new prompt
    const { data, error } = await supabase
      .from('research_prompts')
      .insert({
        phase: body.phase,
        order_index: nextOrder,
        name: body.name,
        prompt_template: body.prompt_template,
        internal_notes: body.internal_notes || null,
        status: body.status || 'active',
        override_max_results: body.override_max_results || null,
        created_by: user.id
      })
      .select()
      .single();

    if (error) {
      console.error('[API] Error creating prompt:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ prompt: data }, { status: 201 });
  } catch (error: any) {
    console.error('[API] Unexpected error in POST /api/admin/research-prompts:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
