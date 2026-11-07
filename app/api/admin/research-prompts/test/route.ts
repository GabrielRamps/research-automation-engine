import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { searchWithTavily } from '@/lib/tavily-client';
import { decrypt, DecryptionError } from '@/lib/encryption';
import { isUserAdmin } from '@/lib/admin-check';

/**
 * POST - Test a single research prompt with sample data
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = (await request.json()) as {
      promptTemplate?: string;
      testData?: { industry?: string; location?: string; services?: string; target_audience?: string; search_radius?: string };
    };
    const { promptTemplate, testData } = body;

    // Check if user is admin
    const { isAdmin, user } = await isUserAdmin(supabase);
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Validate input
    if (!promptTemplate || !testData) {
      return NextResponse.json(
        { error: 'Missing required fields: promptTemplate, testData' },
        { status: 400 }
      );
    }

    // Replace template variables
    let query = promptTemplate
      .replace(/\{\{INDUSTRY\}\}/g, testData.industry || 'test industry')
      .replace(/\{\{LOCATION\}\}/g, testData.location || 'test location')
      .replace(/\{\{SERVICES\}\}/g, testData.services || 'test services')
      .replace(/\{\{TARGET_AUDIENCE\}\}/g, testData.target_audience || 'test audience')
      .replace(/\{\{SEARCH_RADIUS\}\}/g, testData.search_radius || '25');

    // Get user's Tavily API key
    const { data: keys, error: keysError } = await supabase
      .from('user_api_keys')
      .select('tavily_api_key_encrypted')
      .eq('user_id', user.id)
      .single();

    if (keysError || !keys) {
      return NextResponse.json(
        { error: 'Tavily API key not found. Please configure your API keys first.' },
        { status: 400 }
      );
    }

    let tavilyKey: string;
    try {
      tavilyKey = await decrypt(keys.tavily_api_key_encrypted);
    } catch (err) {
      if (err instanceof DecryptionError) {
        return NextResponse.json(
          {
            error: 'Saved Tavily key cannot be decrypted. Re-enter your keys at /setup.',
            code: 'decryption_error',
          },
          { status: 409 }
        );
      }
      throw err;
    }

    // Run Tavily search with small result set for testing
    const result = await searchWithTavily(tavilyKey, {
      query,
      searchDepth: 'advanced',
      maxResults: 5 // Small test
    });

    return NextResponse.json({
      query,
      sources: result.results.map(r => ({
        url: r.url,
        title: r.title,
        content: r.content.substring(0, 300) + '...', // Truncate for preview
        score: r.score
      }))
    });
  } catch (error: any) {
    console.error('[API] Error testing prompt:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to test prompt' },
      { status: 500 }
    );
  }
}
