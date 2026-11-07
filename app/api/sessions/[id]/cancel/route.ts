import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { researchQueue } from '@/lib/queue';
import { USE_QUEUE_SYSTEM } from '@/lib/feature-flags';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

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

    const sessionId = params.id;

    const { data: session, error: sessionError } = await supabase
      .from('research_sessions')
      .select('id, user_id, status')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    // SECURITY FIX: Verify session belongs to authenticated user
    if (session.user_id !== auth.userId) {
      return forbiddenResponse('This session belongs to another user.');
    }

    // Check if session is already completed or cancelled
    if (session.status === 'completed' || session.status === 'cancelled') {
      return NextResponse.json(
        { error: `Cannot cancel ${session.status} session` },
        { status: 400 }
      );
    }

    // Cancel the BullMQ job if queue system is enabled
    if (USE_QUEUE_SYSTEM) {
      try {
        const job = await researchQueue.getJob(sessionId);
        if (job) {
          const state = await job.getState();
          logger.info(`[Cancel] Job ${sessionId} current state: ${state}`);
          
          // Remove job from queue (works for waiting/delayed/active states)
          await job.remove();
          logger.info(`[Cancel] Removed job ${sessionId} from queue`);
        } else {
          logger.info(`[Cancel] No BullMQ job found for ${sessionId}`);
        }
      } catch (queueError: any) {
        logger.error(`[Cancel] Error removing job from queue:`, queueError);
        // Continue anyway - we'll still mark as cancelled in DB
      }
    }

    // Update session status to cancelled
    const { error: updateError } = await supabase
      .from('research_sessions')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString()
      })
      .eq('id', sessionId);

    if (updateError) {
      logger.error('[Cancel] Error updating session:', updateError);
      return NextResponse.json(
        { error: 'Failed to cancel session' },
        { status: 500 }
      );
    }

    logger.info(`[Cancel] Session ${sessionId} cancelled successfully`);

    return NextResponse.json({
      success: true,
      message: 'Research cancelled successfully',
      sessionId
    });

  } catch (error: any) {
    logger.error('[Cancel] Error:', error);
    return NextResponse.json(
      { error: 'Failed to cancel research', details: error.message },
      { status: 500 }
    );
  }
}

