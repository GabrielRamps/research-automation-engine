import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    // Only logged-in users can use the app's servers to test API keys
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return unauthorizedResponse();
    }

    const { apiKey } = (await request.json()) as { apiKey?: string };

    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      return NextResponse.json(
        { error: 'Invalid API key format' },
        { status: 400 }
      );
    }

    // Test the API key with a minimal request
    const anthropic = new Anthropic({
      apiKey: apiKey
    });

    const message = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-opus-4-6',
      max_tokens: 10,
      messages: [
        { role: 'user', content: 'test' }
      ]
    });

    // If we get here, the API key is valid
    return NextResponse.json({
      success: true,
      valid: true
    });

  } catch (error: any) {
    logger.error('API key validation error:', error);

    if (error.status === 401) {
      return NextResponse.json(
        { error: 'Invalid API key. Please check your key and try again.' },
        { status: 401 }
      );
    }

    if (error.status === 429) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again in a moment.' },
        { status: 429 }
      );
    }

    const msg: string = (error.message || '').toLowerCase();
    const isBilling =
      msg.includes('credit') ||
      msg.includes('balance') ||
      msg.includes('billing') ||
      msg.includes('payment') ||
      msg.includes('quota');
    if (isBilling) {
      return NextResponse.json(
        { error: 'Your Claude API key was found but billing is not set up. Please visit console.anthropic.com → Settings → Billing to add a payment method and purchase credits, then try again.' },
        { status: 402 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to validate API key. Please try again.' },
      { status: 500 }
    );
  }
}

