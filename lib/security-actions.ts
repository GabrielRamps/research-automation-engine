import { createClient } from '@supabase/supabase-js';
import { logger } from './secure-logger';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

/**
 * Suspend a user's account for security violations
 * Updates the user_access table to mark account as suspended
 */
export async function suspendUserForSecurityViolation(
  userId: string, 
  userEmail: string,
  reason: string
): Promise<boolean> {
  try {
    // Update user_access to suspended
    const { error } = await serviceSupabase
      .from('user_access')
      .update({ 
        status: 'suspended'
      })
      .eq('user_id', userId);

    if (error) {
      logger.error('Failed to suspend user:', error);
      return false;
    }

    // Log the suspension as a critical security event
    await logger.logSecurityEvent({
      eventType: 'privilege_escalation',
      severity: 'critical',
      userId,
      userEmail,
      routePath: '/system/auto-suspend',
      eventDetails: {
        action: 'account_suspended',
        reason,
        timestamp: new Date().toISOString(),
        autoSuspend: true
      }
    });

    logger.warn('User suspended for security violation', {
      userId,
      userEmail,
      reason
    });

    return true;
  } catch (error) {
    logger.error('Error in suspendUserForSecurityViolation:', error);
    return false;
  }
}

/**
 * Get the count of recent unauthorized access attempts for a user
 * Looks at security events in the last 24 hours
 */
export async function getRecentUnauthorizedAttempts(userId: string): Promise<number> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data, error } = await serviceSupabase
      .from('security_events')
      .select('id')
      .eq('user_id', userId)
      .eq('event_type', 'unauthorized_admin_access')
      .gte('created_at', twentyFourHoursAgo);

    if (error) {
      logger.error('Error fetching unauthorized attempts:', error);
      return 0;
    }

    return data?.length || 0;
  } catch (error) {
    logger.error('Error in getRecentUnauthorizedAttempts:', error);
    return 0;
  }
}
