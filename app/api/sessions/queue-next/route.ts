import { NextRequest, NextResponse } from 'next/server';
import { SessionManager } from '@/lib/session-manager';
import { logger } from '@/lib/secure-logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const WORKER_CALLBACK_SECRET = process.env.WORKER_CALLBACK_SECRET;

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      request.headers.get('x-internal-secret');
    if (!WORKER_CALLBACK_SECRET || secret !== WORKER_CALLBACK_SECRET) {
      logger.warn('[Queue Next] Rejected: missing or invalid secret');
      return unauthorized();
    }

    const body = await request.json().catch(() => ({})) as { userId?: string };
    const userId = body.userId;
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid userId' },
        { status: 400 }
      );
    }

    const sessionId = await SessionManager.enqueueNextPendingForUser(userId);
    return NextResponse.json({
      enqueued: !!sessionId,
      sessionId: sessionId ?? undefined,
    });
  } catch (error: any) {
    logger.error('[Queue Next] Error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
