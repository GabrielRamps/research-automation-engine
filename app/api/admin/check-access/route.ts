import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { isUserAdmin } from '@/lib/admin-check';

/**
 * GET - Check if current user has admin access
 */
export async function GET() {
  try {
    const supabase = await createClient();
    
    // Check if user is admin
    const { isAdmin, user, error: adminError } = await isUserAdmin(supabase);
    
    if (!user) {
      return NextResponse.json({ 
        isAdmin: false,
        error: 'Not authenticated' 
      }, { status: 401 });
    }

    if (!isAdmin) {
      return NextResponse.json({ 
        isAdmin: false,
        error: 'Admin access required' 
      }, { status: 403 });
    }

    return NextResponse.json({ 
      isAdmin: true,
      user: {
        id: user.id,
        email: user.email
      }
    });
  } catch (error: any) {
    console.error('[API] Error checking admin access:', error);
    return NextResponse.json({ 
      isAdmin: false,
      error: error.message 
    }, { status: 500 });
  }
}
