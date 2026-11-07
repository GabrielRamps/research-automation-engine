import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/encryption';
import { logger } from '@/lib/secure-logger';
import { getAuthenticatedUser, unauthorizedResponse } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return unauthorizedResponse();
    }

    const { data: keys } = await supabase
      .from('user_api_keys')
      .select('dataforseo_login_encrypted, dataforseo_password_encrypted')
      .eq('user_id', auth.userId)
      .single();

    if (!keys?.dataforseo_login_encrypted || !keys?.dataforseo_password_encrypted) {
      return NextResponse.json({ balance: null });
    }

    const login = await decrypt(keys.dataforseo_login_encrypted);
    const password = await decrypt(keys.dataforseo_password_encrypted);
    const encoded = Buffer.from(`${login}:${password}`).toString('base64');

    const response = await fetch('https://api.dataforseo.com/v3/appendix/user_data', {
      method: 'GET',
      headers: {
        Authorization: `Basic ${encoded}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.error(`[CheckBalance] DataForSEO returned status ${response.status}`);
      return NextResponse.json({ balance: null, error: 'Failed to fetch balance' });
    }

    const data = (await response.json()) as {
      tasks?: Array<{ result?: Array<{ money?: { balance?: number } }> }>;
    };
    const balance = data.tasks?.[0]?.result?.[0]?.money?.balance ?? null;

    return NextResponse.json({ balance });
  } catch (error: any) {
    logger.error('[CheckBalance] Error:', error.message);

    // Decryption failures mean the user's stored keys were encrypted with an old
    // ENCRYPTION_SECRET_KEY/SALT (e.g., after a security rotation). Surface this
    // distinctly so the UI can prompt them to re-enter their keys at /setup.
    if (typeof error?.message === 'string' && /Failed to decrypt data/i.test(error.message)) {
      return NextResponse.json(
        { balance: null, error: 'Stored API keys cannot be decrypted. Please re-enter them.', code: 'decryption_error' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { balance: null, error: 'Failed to check balance' },
      { status: 500 }
    );
  }
}
