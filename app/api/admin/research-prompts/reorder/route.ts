import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { isUserAdmin } from '@/lib/admin-check';

/**
 * POST - Reorder research prompts within a phase
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = (await request.json()) as { phase?: number; promptIds?: string[] };
    const { phase, promptIds } = body;

    // Check if user is admin
    const { isAdmin, user } = await isUserAdmin(supabase);
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Validate input
    if (!phase || !Array.isArray(promptIds)) {
      return NextResponse.json(
        { error: 'Missing required fields: phase, promptIds (array)' },
        { status: 400 }
      );
    }

    // Prepare reorder data for atomic database function
    const reorderData = promptIds.map((id: string, index: number) => ({
      id,
      order_index: index
    }));

    // Call the atomic reorder function (single transaction, no race conditions)
    const { error } = await supabase.rpc('reorder_research_prompts', {
      p_phase: phase,
      p_reorder_data: reorderData
    });

    if (error) {
      console.error('[API] Error reordering prompts:', error);
      return NextResponse.json(
        { error: 'Failed to reorder prompts', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API] Unexpected error in POST /api/admin/research-prompts/reorder:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
