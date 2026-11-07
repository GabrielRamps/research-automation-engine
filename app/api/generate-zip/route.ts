import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { SessionManager } from '@/lib/session-manager';
import { generateCursorPromptsZip } from '@/lib/zip-generator';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    // SECURITY FIX: Authenticate user first
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      logger.warn('Unauthorized ZIP generation attempt');
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

    // Load session
    const session = await SessionManager.getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    // SECURITY FIX: Verify session belongs to authenticated user
    if (session.user_id !== auth.userId) {
      logger.warn('User attempted to download ZIP for another user\'s session', {
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

    // Generate ZIP
    const zipBlob = await generateCursorPromptsZip(session);
    
    const filename = `cursor-prompts-${session.business_name.replace(/\s+/g, '-').toLowerCase()}.zip`;

    // Convert blob to buffer for Next.js response
    const buffer = Buffer.from(await zipBlob.arrayBuffer());

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString()
      }
    });

  } catch (error: any) {
    logger.error('ZIP generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate ZIP', details: error.message },
      { status: 500 }
    );
  }
}

