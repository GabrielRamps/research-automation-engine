import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Cap draft size — research forms are big but not huge. 256 KB is generous.
const MAX_DRAFT_BYTES = 256 * 1024;

/**
 * GET /api/drafts
 * Returns the current user's saved research form draft, or null if none.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);
  if (!auth) return unauthorizedResponse();

  const { data, error } = await supabase
    .from('session_drafts')
    .select('draft, updated_at')
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (error) {
    logger.warn('[/api/drafts GET] supabase error', error);
    return NextResponse.json({ ok: false, error: 'Could not load draft' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, draft: data?.draft ?? null, updatedAt: data?.updated_at ?? null });
}

/**
 * POST /api/drafts
 * Body: { draft: object }
 * Upserts the user's draft. Latest write wins.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);
  if (!auth) return unauthorizedResponse();

  let body: { draft?: unknown };
  try {
    body = (await request.json()) as { draft?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.draft || typeof body.draft !== 'object') {
    return NextResponse.json({ ok: false, error: 'draft must be an object' }, { status: 400 });
  }

  // Cheap size check
  const json = JSON.stringify(body.draft);
  if (json.length > MAX_DRAFT_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'Draft too large' },
      { status: 413 }
    );
  }

  const { error } = await supabase
    .from('session_drafts')
    .upsert(
      { user_id: auth.userId, draft: body.draft },
      { onConflict: 'user_id' }
    );

  if (error) {
    logger.warn('[/api/drafts POST] supabase upsert error', error);
    return NextResponse.json({ ok: false, error: 'Could not save draft' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/drafts
 * Wipes the user's saved draft. Called after a research session is created.
 */
export async function DELETE(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);
  if (!auth) return unauthorizedResponse();

  const { error } = await supabase
    .from('session_drafts')
    .delete()
    .eq('user_id', auth.userId);

  if (error) {
    logger.warn('[/api/drafts DELETE] supabase error', error);
    return NextResponse.json({ ok: false, error: 'Could not delete draft' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
