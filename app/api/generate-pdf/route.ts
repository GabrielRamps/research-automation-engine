import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { SessionManager } from '@/lib/session-manager';
import { generateMasterReportPDF, generateChecklistPDF, generateRawDataPDF } from '@/lib/pdf-generator';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    // SECURITY FIX: Authenticate user first
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      logger.warn('Unauthorized PDF generation attempt');
      return unauthorizedResponse();
    }

    const body = (await request.json()) as { sessionId?: string; type?: string };
    const { sessionId, type } = body;

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
      logger.warn('User attempted to download PDF for another user\'s session', {
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

    // Generate appropriate PDF
    let pdfBlob: Blob;
    let filename: string;

    if (type === 'checklist') {
      pdfBlob = await generateChecklistPDF(session);
      filename = `checklist-${session.business_name.replace(/\s+/g, '-').toLowerCase()}.pdf`;
    } else if (type === 'raw-data') {
      pdfBlob = await generateRawDataPDF(session);
      filename = `raw-research-data-${session.business_name.replace(/\s+/g, '-').toLowerCase()}.pdf`;
    } else {
      // Default to master report (keeping for backward compatibility)
      pdfBlob = await generateMasterReportPDF(session);
      filename = `research-report-${session.business_name.replace(/\s+/g, '-').toLowerCase()}.pdf`;
    }

    // Convert blob to buffer for Next.js response
    const buffer = Buffer.from(await pdfBlob.arrayBuffer());

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString()
      }
    });

  } catch (error: any) {
    logger.error('PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF', details: error.message },
      { status: 500 }
    );
  }
}

