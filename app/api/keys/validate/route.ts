import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Anthropic from '@anthropic-ai/sdk';
import { tavily } from '@tavily/core';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    // Only logged-in users can use the app's servers to test API keys
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return unauthorizedResponse();
    }

    const body = (await request.json()) as { claudeKey?: string; tavilyKey?: string; dataforseoLogin?: string; dataforseoPassword?: string };
    const { claudeKey, tavilyKey, dataforseoLogin, dataforseoPassword } = body;
    
    const results: Record<string, { valid: boolean; error: string; balance?: number }> = {
      claude: { valid: false, error: '' },
      tavily: { valid: false, error: '' },
      dataforseo: { valid: false, error: '' }
    };
    
    // Validate Claude API key
    if (claudeKey) {
      try {
        const anthropic = new Anthropic({ apiKey: claudeKey });
        
        // Make a minimal test call
        await anthropic.messages.create({
          model: process.env.CLAUDE_MODEL || 'claude-opus-4-6',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'test' }]
        });
        
        results.claude.valid = true;
      } catch (error: any) {
        const msg: string = (error.message || '').toLowerCase();
        const isBilling =
          msg.includes('credit') ||
          msg.includes('balance') ||
          msg.includes('billing') ||
          msg.includes('payment') ||
          msg.includes('quota');
        if (isBilling) {
          results.claude.error = 'Billing not set up. Please visit console.anthropic.com → Settings → Billing to add a payment method and purchase credits, then try again.';
        } else if (error.status === 401) {
          results.claude.error = 'Invalid API key. Please check your key and try again.';
        } else {
          results.claude.error = error.message || 'Invalid Claude API key';
        }
      }
    }
    
    // Validate Tavily API key
    if (tavilyKey) {
      try {
        if (!tavilyKey.startsWith('tvly-')) {
          throw new Error('Invalid Tavily API key format (must start with tvly-)');
        }
        
        const tavilyClient = tavily({ apiKey: tavilyKey });
        
        // Make a minimal test call
        await tavilyClient.search('test', {
          maxResults: 1
        });
        
        results.tavily.valid = true;
      } catch (error: any) {
        results.tavily.error = error.message || 'Invalid Tavily API key';
      }
    }
    
    // Validate DataForSEO credentials (optional)
    if (dataforseoLogin && dataforseoPassword) {
      try {
        const encoded = Buffer.from(`${dataforseoLogin}:${dataforseoPassword}`).toString('base64');
        const response = await fetch('https://api.dataforseo.com/v3/appendix/user_data', {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${encoded}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error('Invalid DataForSEO credentials');
          }
          throw new Error(`DataForSEO returned status ${response.status}`);
        }

        const data = (await response.json()) as { tasks?: Array<{ result?: Array<{ money?: { balance?: number } }> }> };
        const balance = data.tasks?.[0]?.result?.[0]?.money?.balance || 0;
        results.dataforseo = { valid: true, error: '', balance };
      } catch (error: any) {
        results.dataforseo.error = error.message || 'Invalid DataForSEO credentials';
      }
    }

    return NextResponse.json({
      success: true,
      results
    });
    
  } catch (error: any) {
    logger.error('Validation error:', error);
    return NextResponse.json(
      { error: 'Failed to validate API keys', details: error.message },
      { status: 500 }
    );
  }
}

