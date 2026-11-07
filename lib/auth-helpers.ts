import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

/**
 * Get authenticated user from request session
 * @returns User object with userId and email, or null if not authenticated
 */
export async function getAuthenticatedUser(request: NextRequest) {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        }
      }
    }
  )

  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return null
  }

  return {
    userId: user.id,
    email: user.email
  }
}

/**
 * Returns a standardized unauthorized response
 */
export function unauthorizedResponse() {
  return NextResponse.json(
    { error: 'Unauthorized. Please login.' },
    { status: 401 }
  )
}

/**
 * Returns a standardized forbidden response
 */
export function forbiddenResponse(message: string = 'Forbidden. You do not have access to this resource.') {
  return NextResponse.json(
    { error: message },
    { status: 403 }
  )
}

/**
 * Checks that a logged-in user has been given access to this installation
 * (an active row in user_access). Anyone can get a Supabase login by
 * requesting a magic link, so routes that start research must also check this.
 */
export async function hasActiveAccess(userId: string): Promise<boolean> {
  const { createClient } = await import('@supabase/supabase-js')
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data, error } = await service
    .from('user_access')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
  if (error) return false
  return (data?.length ?? 0) > 0
}

/**
 * Returns a standardized "no access" response
 */
export function noAccessResponse() {
  return NextResponse.json(
    { error: 'Your account does not have access to this installation. Ask the admin to add your email.' },
    { status: 403 }
  )
}
