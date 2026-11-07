import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { isUserAdmin } from '@/lib/admin-check';
import {
  PHASE4_SUBPHASES,
  getPhase4DefaultTemplate,
  getPhase4DefaultMeta,
  type Phase4Subphase,
} from '@/lib/phase4-prompt-defaults';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check if user is admin
    const { isAdmin, user, error: adminError } = await isUserAdmin(supabase);
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Fetch all Phase 4 prompts (including disabled ones for admin editing)
    const { data: dbPrompts, error } = await supabase
      .from('phase4_prompts')
      .select('*')
      .order('subphase')
      .order('order_index');

    if (error) {
      console.error('Error fetching Phase 4 prompts:', error);
      return NextResponse.json({ error: 'Failed to fetch prompts' }, { status: 500 });
    }

    const bySubphase = new Map<string, (typeof dbPrompts)[0]>();
    for (const p of dbPrompts || []) {
      if (p.subphase) bySubphase.set(p.subphase, p);
    }

    // Merge with code defaults so admin always sees "live" prompts (DB or default)
    const prompts: Array<{
      id: string;
      subphase: string;
      order_index: number;
      name: string;
      prompt_template: string;
      internal_notes?: string | null;
      status: string;
      created_at: string;
      updated_at: string;
      _isDefault?: boolean;
    }> = [];

    for (let i = 0; i < PHASE4_SUBPHASES.length; i++) {
      const sub = PHASE4_SUBPHASES[i];
      const row = bySubphase.get(sub);
      const defaultTemplate = getPhase4DefaultTemplate(sub as Phase4Subphase);
      const defaultMeta = getPhase4DefaultMeta(sub as Phase4Subphase);

      if (row && row.prompt_template && row.prompt_template.trim()) {
        prompts.push({
          id: row.id,
          subphase: row.subphase,
          order_index: row.order_index ?? i,
          name: row.name,
          prompt_template: row.prompt_template,
          internal_notes: row.internal_notes ?? null,
          status: row.status ?? 'active',
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
      } else {
        prompts.push({
          id: `default-${sub}`,
          subphase: sub,
          order_index: i,
          name: defaultMeta.name,
          prompt_template: defaultTemplate,
          internal_notes: defaultMeta.internal_notes,
          status: 'active',
          created_at: '',
          updated_at: '',
          _isDefault: true,
        });
      }
    }

    return NextResponse.json({ prompts });
  } catch (error) {
    console.error('Phase 4 prompts GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check if user is admin
    const { isAdmin, user, error: adminError } = await isUserAdmin(supabase);
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = (await request.json()) as {
      subphase?: string; name?: string; prompt_template?: string;
      internal_notes?: string | null; order_index?: number; status?: string;
    };
    const { subphase, name, prompt_template, internal_notes, order_index, status } = body;

    // Validate required fields
    if (!subphase || !name || !prompt_template) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Upsert by subphase: if a row already exists (e.g. empty template), update it
    const { data: existing } = await supabase
      .from('phase4_prompts')
      .select('id')
      .eq('subphase', subphase)
      .maybeSingle();

    if (existing?.id) {
      const { data: updated, error: updateError } = await supabase
        .from('phase4_prompts')
        .update({
          name,
          prompt_template,
          internal_notes: internal_notes ?? null,
          order_index: order_index ?? 0,
          status: status ?? 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (updateError) {
        console.error('Error updating Phase 4 prompt:', updateError);
        return NextResponse.json({ error: 'Failed to update prompt' }, { status: 500 });
      }
      return NextResponse.json({ prompt: updated });
    }

    // Insert new prompt
    const { data: newPrompt, error } = await supabase
      .from('phase4_prompts')
      .insert({
        subphase,
        name,
        prompt_template,
        internal_notes: internal_notes || null,
        order_index: order_index || 0,
        status: status ?? 'active',
        created_by: user.id
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating Phase 4 prompt:', error);
      return NextResponse.json({ error: 'Failed to create prompt' }, { status: 500 });
    }

    return NextResponse.json({ prompt: newPrompt }, { status: 201 });
  } catch (error) {
    console.error('Phase 4 prompts POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check if user is admin
    const { isAdmin, user, error: adminError } = await isUserAdmin(supabase);
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = (await request.json()) as {
      id?: string; name?: string; prompt_template?: string;
      internal_notes?: string | null; status?: string;
    };
    const { id, name, prompt_template, internal_notes, status } = body;

    if (!id) {
      return NextResponse.json({ error: 'Prompt ID required' }, { status: 400 });
    }

    // Update prompt
    const { data: updatedPrompt, error } = await supabase
      .from('phase4_prompts')
      .update({
        name,
        prompt_template,
        internal_notes,
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating Phase 4 prompt:', error);
      return NextResponse.json({ error: 'Failed to update prompt' }, { status: 500 });
    }

    return NextResponse.json({ prompt: updatedPrompt });
  } catch (error) {
    console.error('Phase 4 prompts PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check if user is admin
    const { isAdmin, user, error: adminError } = await isUserAdmin(supabase);
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Prompt ID required' }, { status: 400 });
    }

    // Delete prompt
    const { error } = await supabase
      .from('phase4_prompts')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting Phase 4 prompt:', error);
      return NextResponse.json({ error: 'Failed to delete prompt' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Phase 4 prompts DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
