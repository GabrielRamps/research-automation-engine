import { NextRequest, NextResponse } from 'next/server';
import { SessionManager, SessionFetchTransientError } from '@/lib/session-manager';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;
export const runtime = 'nodejs';

const RESULTS_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('RESULTS_TIMEOUT')), ms)
    ),
  ]);
}

/**
 * GET /api/sessions/[id]/results
 * Returns full session (including seo_audit_data, tier, phase summaries) for the results page.
 * Only returns data when session is completed. Same auth as status endpoint.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  try {
    const result = await withTimeout(
      (async () => {
        const auth = await getAuthenticatedUser(request);
        if (!auth) {
          return unauthorizedResponse();
        }

        const sessionId = params.id;
        const session = await SessionManager.getSession(sessionId);

        if (!session) {
          return NextResponse.json(
            { error: 'Session not found' },
            { status: 404 }
          );
        }

        if (session.user_id !== auth.userId) {
          return forbiddenResponse('This session belongs to another user.');
        }

        if (session.status !== 'completed') {
          return NextResponse.json(
            { error: 'Results are only available for completed sessions.' },
            { status: 400 }
          );
        }

        return NextResponse.json(
          { success: true, session },
          {
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'Expires': '0',
            },
          }
        );
      })(),
      RESULTS_TIMEOUT_MS
    );

    return result;
  } catch (error: unknown) {
    const err = error as { message?: string };
    if (err?.message === 'RESULTS_TIMEOUT') {
      logger.error('Session results timeout', { sessionId: params.id });
      return NextResponse.json(
        { error: 'Request timeout', retry: true },
        { status: 503, headers: { 'Retry-After': '2' } }
      );
    }
    if (error instanceof SessionFetchTransientError) {
      logger.error('Session fetch transient (DB timeout/cancel)', { sessionId: params.id });
      return NextResponse.json(
        { error: 'Temporary database load; please retry.', retry: true },
        { status: 503, headers: { 'Retry-After': '2' } }
      );
    }
    logger.error('Session results error:', error);
    return NextResponse.json(
      { error: 'Failed to get session results', details: err?.message },
      { status: 500 }
    );
  }
}
