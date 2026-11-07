import { NextRequest, NextResponse } from 'next/server';
import { SessionManager, SessionFetchTransientError } from '@/lib/session-manager';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

// Disable caching for this endpoint
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;
export const runtime = 'nodejs';

const STATUS_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('STATUS_TIMEOUT')), ms)
    ),
  ]);
}

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
        const { searchParams } = new URL(request.url);
        const initial = searchParams.get('initial') === 'true';
        const session = await SessionManager.getSessionStatus(sessionId, {
          includeBusinessFields: initial,
        });

        if (!session) {
          return NextResponse.json(
            { error: 'Session not found' },
            { status: 404 }
          );
        }

        if (session.user_id !== auth.userId) {
          return forbiddenResponse('This session belongs to another user.');
        }

        return NextResponse.json(
          { success: true, session },
          {
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'Expires': '0'
            }
          }
        );
      })(),
      STATUS_TIMEOUT_MS
    );

    return result;
  } catch (error: any) {
    if (error?.message === 'STATUS_TIMEOUT') {
      logger.error('Session status timeout', { sessionId: params.id });
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
    logger.error('Session status error:', error);
    return NextResponse.json(
      { error: 'Failed to get session status', details: error?.message },
      { status: 500 }
    );
  }
}

