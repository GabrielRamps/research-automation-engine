/**
 * Admin Check Helper
 * Reusable function to check if a user is an admin
 */

import { SupabaseClient } from '@supabase/supabase-js';

export async function isUserAdmin(supabase: SupabaseClient): Promise<{ isAdmin: boolean; user: any; error?: string }> {
  try {
    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return { isAdmin: false, user: null, error: 'Unauthorized' };
    }

    // Check if user email is in admin_emails config
    const { data: adminConfig, error: configError } = await supabase
      .from('admin_config')
      .select('config_value')
      .eq('config_key', 'admin_emails')
      .single();

    if (configError) {
      console.error('[Admin Check] Error fetching admin config:', configError);
      return { isAdmin: false, user, error: 'Failed to verify admin status' };
    }

    const adminEmails = adminConfig?.config_value as string[];
    const isAdmin = adminEmails?.includes(user.email || '');

    return { isAdmin, user };
  } catch (error) {
    console.error('[Admin Check] Unexpected error:', error);
    return { isAdmin: false, user: null, error: 'Failed to verify admin status' };
  }
}
