import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { isUserAdmin } from '@/lib/admin-check';
import { PHASE1_CLAUDE_SUMMARY_PROMPT } from '@/lib/prompts/phase1-claude-summary';
import { PHASE2_CLAUDE_SUMMARY_PROMPT } from '@/lib/prompts/phase2-claude-summary';
import { PHASE3_CLAUDE_SUMMARY_PROMPT } from '@/lib/prompts/phase3-claude-summary';

const CONFIG_KEYS = {
  phase1: 'phase1_claude_summary',
  phase2: 'phase2_claude_summary',
  phase3: 'phase3_claude_summary',
} as const;

const DEFAULTS = {
  phase1: PHASE1_CLAUDE_SUMMARY_PROMPT,
  phase2: PHASE2_CLAUDE_SUMMARY_PROMPT,
  phase3: PHASE3_CLAUDE_SUMMARY_PROMPT,
};

function extractPromptText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'template' in value) return (value as { template: string }).template;
  if (value != null) return String(value);
  return '';
}

/**
 * GET - Return all three Claude summary prompts (from admin_config or code defaults)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { isAdmin, user } = await isUserAdmin(supabase);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

    const { data: rows } = await supabase
      .from('admin_config')
      .select('config_key, config_value')
      .in('config_key', [CONFIG_KEYS.phase1, CONFIG_KEYS.phase2, CONFIG_KEYS.phase3]);

    const byKey = new Map<string, string>();
    for (const r of rows || []) {
      const text = extractPromptText(r.config_value);
      if (text) byKey.set(r.config_key, text);
    }

    const phase1 = byKey.get(CONFIG_KEYS.phase1) ?? DEFAULTS.phase1;
    const phase2 = byKey.get(CONFIG_KEYS.phase2) ?? DEFAULTS.phase2;
    const phase3 = byKey.get(CONFIG_KEYS.phase3) ?? DEFAULTS.phase3;

    return NextResponse.json({ phase1, phase2, phase3 });
  } catch (error) {
    console.error('Claude summary prompts GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT - Update one or more Claude summary prompts in admin_config
 * Body: { phase1?: string, phase2?: string, phase3?: string }
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { isAdmin, user } = await isUserAdmin(supabase);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

    const body = (await request.json()) as { phase1?: string; phase2?: string; phase3?: string };
    const updates: Array<{ config_key: string; config_value: string }> = [];
    if (typeof body.phase1 === 'string') updates.push({ config_key: CONFIG_KEYS.phase1, config_value: body.phase1 });
    if (typeof body.phase2 === 'string') updates.push({ config_key: CONFIG_KEYS.phase2, config_value: body.phase2 });
    if (typeof body.phase3 === 'string') updates.push({ config_key: CONFIG_KEYS.phase3, config_value: body.phase3 });

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Provide at least one of phase1, phase2, phase3' }, { status: 400 });
    }

    for (const u of updates) {
      const { error } = await supabase
        .from('admin_config')
        .upsert(
          { config_key: u.config_key, config_value: u.config_value, updated_at: new Date().toISOString() },
          { onConflict: 'config_key' }
        );
      if (error) {
        console.error('Error upserting admin_config:', error);
        return NextResponse.json({ error: 'Failed to save prompt' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Claude summary prompts PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
