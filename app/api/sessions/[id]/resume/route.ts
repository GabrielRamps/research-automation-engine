import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { SessionManager } from '@/lib/session-manager';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse, forbiddenResponse, hasActiveAccess, noAccessResponse } from '@/lib/auth-helpers';
import { USE_QUEUE_SYSTEM } from '@/lib/feature-flags';
import { queueResearchJob } from '@/lib/queue';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  try {
    // SECURITY FIX: Authenticate user first
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return unauthorizedResponse();
    }
    if (!(await hasActiveAccess(auth.userId))) {
      return noAccessResponse();
    }

    const sessionId = params.id;
    const session = await SessionManager.getSessionMinimal(sessionId);

    if (!session) {
      return NextResponse.json(
        {
          error: 'Session not found',
          detail: 'This research session no longer exists. It may have been removed or the link is invalid. Please start a new research from the dashboard.',
        },
        { status: 404 }
      );
    }

    // SECURITY FIX: Verify session belongs to authenticated user
    if (session.user_id !== auth.userId) {
      return forbiddenResponse('This session belongs to another user.');
    }

    // UPDATED: Allow resuming from both 'failed' and 'paused' status
    if (session.status !== 'failed' && session.status !== 'paused') {
      return NextResponse.json(
        { error: 'Can only resume failed or paused sessions' },
        { status: 400 }
      );
    }

    // CRITICAL FIX: Check if session is already being processed (prevent duplicate runs)
    const isLocked = await SessionManager.isSessionLocked(sessionId);
    if (isLocked) {
      return NextResponse.json(
        { error: 'Research is already in progress for this session' },
        { status: 409 } // Conflict
      );
    }

    // Reset status to in_progress
    await SessionManager.updatePhase(sessionId, session.current_phase, {
      status: 'in_progress'
    });

    // CRITICAL FIX: Use queue system if enabled, otherwise use direct API trigger
    if (USE_QUEUE_SYSTEM) {
      try {
        // Re-queue the job (worker will resume from correct phase)
        await queueResearchJob(sessionId);
        logger.info(`[Resume] Session ${sessionId} re-queued for phase ${session.current_phase}`);
        
        return NextResponse.json({
          success: true,
          message: `Resuming from phase ${session.current_phase} via queue`,
          sessionId,
          queued: true
        });
      } catch (queueError: any) {
        logger.error('[Resume] Failed to re-queue job:', queueError);
        // Fall through to direct trigger as fallback
      }
    }

    // Old system: direct API trigger
    const phaseUrl = `/api/research/phase${session.current_phase}`;
    
    logger.info(`[Resume] Triggering phase ${session.current_phase} directly for session ${sessionId}`);
    
    // Make async call to restart the phase
    fetch(`${process.env.NEXT_PUBLIC_SITE_URL}${phaseUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    }).catch(err => {
      logger.error('Failed to restart phase:', err);
    });

    return NextResponse.json({
      success: true,
      message: `Resuming from phase ${session.current_phase}`,
      sessionId,
      queued: false
    });

  } catch (error: any) {
    logger.error('Session resume error:', error);
    return NextResponse.json(
      { error: 'Failed to resume session', details: error.message },
      { status: 500 }
    );
  }
}

