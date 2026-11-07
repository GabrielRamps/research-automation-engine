import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { isUserAdmin } from '@/lib/admin-check';

/**
 * PUT - Update a research prompt
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  try {
    const supabase = await createClient();
    const body = (await request.json()) as {
      name?: string; prompt_template?: string; internal_notes?: string;
      status?: string; override_max_results?: number;
    };
    const { id } = params;

    // Check if user is admin
    const { isAdmin, user } = await isUserAdmin(supabase);
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Build update object (only include provided fields)
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (body.name !== undefined) updateData.name = body.name;
    if (body.prompt_template !== undefined) updateData.prompt_template = body.prompt_template;
    if (body.internal_notes !== undefined) updateData.internal_notes = body.internal_notes;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.override_max_results !== undefined) updateData.override_max_results = body.override_max_results;

    // Update prompt
    const { data, error } = await supabase
      .from('research_prompts')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[API] Error updating prompt:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    return NextResponse.json({ prompt: data });
  } catch (error: any) {
    console.error('[API] Unexpected error in PUT /api/admin/research-prompts/[id]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE - Delete a research prompt
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  try {
    const supabase = await createClient();
    const { id } = params;

    // Check if user is admin
    const { isAdmin, user } = await isUserAdmin(supabase);
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get prompt to find its phase and order_index
    const { data: prompt } = await supabase
      .from('research_prompts')
      .select('phase, order_index')
      .eq('id', id)
      .single();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    // Delete prompt
    const { error } = await supabase
      .from('research_prompts')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[API] Error deleting prompt:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Reorder remaining prompts in the same phase
    const { data: remainingPrompts } = await supabase
      .from('research_prompts')
      .select('id, order_index')
      .eq('phase', prompt.phase)
      .gt('order_index', prompt.order_index)
      .order('order_index', { ascending: true });

    if (remainingPrompts && remainingPrompts.length > 0) {
      // Decrement order_index for all prompts after the deleted one
      for (const p of remainingPrompts) {
        await supabase
          .from('research_prompts')
          .update({ order_index: p.order_index - 1 })
          .eq('id', p.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API] Unexpected error in DELETE /api/admin/research-prompts/[id]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
