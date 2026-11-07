import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { SessionManager } from '@/lib/session-manager';
import { generateAllReportsZip } from '@/lib/zip-generator';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

/**
 * POST body: { sessionId: string }
 * Returns: ZIP containing all reports + project overview + Cursor prompt.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      logger.warn('Unauthorized all-ZIP generation attempt');
      return unauthorizedResponse();
    }

    const body = (await request.json()) as { sessionId?: string };
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    const session = await SessionManager.getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    if (session.user_id !== auth.userId) {
      logger.warn('User attempted to download all-ZIP for another user\'s session', {
        userId: auth.userId,
        sessionId,
        sessionOwnerId: session.user_id
      });
      return forbiddenResponse('This session belongs to another user.');
    }

    if (session.status !== 'completed') {
      return NextResponse.json(
        { error: 'Research not yet completed' },
        { status: 400 }
      );
    }

    const zipBlob = await generateAllReportsZip(session);
    const filename = `research-all-reports-${session.business_name.replace(/\s+/g, '-').toLowerCase()}.zip`;
    const buffer = Buffer.from(await zipBlob.arrayBuffer());

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString()
      }
    });
  } catch (error: any) {
    logger.error('All-reports ZIP generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate ZIP', details: error.message },
      { status: 500 }
    );
  }
}
