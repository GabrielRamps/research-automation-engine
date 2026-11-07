import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { isUserAdmin } from '@/lib/admin-check';

/**
 * GET - Export research prompts as JSON
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const phase = searchParams.get('phase');

    // Check if user is admin
    const { isAdmin, user } = await isUserAdmin(supabase);
    
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

    const { data, error } = await query;

    if (error) {
      console.error('[API] Error exporting prompts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Return as downloadable JSON file
    const filename = phase 
      ? `research-prompts-phase${phase}.json` 
      : 'research-prompts-all.json';

    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });
  } catch (error: any) {
    console.error('[API] Unexpected error in GET /api/admin/research-prompts/import-export:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST - Import research prompts from JSON
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    type ImportPrompt = { phase?: number; name?: string; prompt_template?: string; internal_notes?: string; status?: string; override_max_results?: number };
    const body = (await request.json()) as { prompts?: ImportPrompt[]; mode?: 'append' | 'replace' };
    const { prompts, mode = 'append' } = body; // mode: 'append' or 'replace'

    // Check if user is admin
    const { isAdmin, user } = await isUserAdmin(supabase);
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Validate input
    if (!Array.isArray(prompts)) {
      return NextResponse.json(
        { error: 'Invalid input: prompts must be an array' },
        { status: 400 }
      );
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const prompt of prompts) {
      try {
        // Validate required fields
        if (!prompt.phase || !prompt.name || !prompt.prompt_template) {
          skipped++;
          errors.push(`Skipped prompt "${prompt.name || 'unnamed'}": missing required fields`);
          continue;
        }

        // Get next order_index for phase
        const { data: existing } = await supabase
          .from('research_prompts')
          .select('order_index')
          .eq('phase', prompt.phase)
          .order('order_index', { ascending: false })
          .limit(1);

        const nextOrder = (existing?.[0]?.order_index ?? -1) + 1;

        // Insert prompt (excluding id to generate new one)
        const { error: insertError } = await supabase
          .from('research_prompts')
          .insert({
            phase: prompt.phase,
            order_index: nextOrder,
            name: prompt.name,
            prompt_template: prompt.prompt_template,
            internal_notes: prompt.internal_notes || null,
            status: prompt.status || 'active',
            override_max_results: prompt.override_max_results || null,
            created_by: user.id
          });

        if (insertError) {
          skipped++;
          errors.push(`Failed to import "${prompt.name}": ${insertError.message}`);
        } else {
          imported++;
        }
      } catch (err: any) {
        skipped++;
        errors.push(`Error importing "${prompt.name || 'unnamed'}": ${err.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: any) {
    console.error('[API] Unexpected error in POST /api/admin/research-prompts/import-export:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
