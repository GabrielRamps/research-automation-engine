/**
 * Email notification helper for research completion
 * Sends secure magic link emails when research completes
 */

import { Resend } from 'resend';
import { supabase } from './supabase';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Get user email from user_access table
 */
async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('user_access')
      .select('email')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      // Fallback to auth.users if user_access doesn't have the email
      console.log(`[Email] User not found in user_access, trying auth.users for ${userId}`);
      const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userId);
      if (!authError && authUser?.user?.email) {
        return authUser.user.email;
      }
      return null;
    }

    return data.email;
  } catch (error) {
    console.error('[Email] Error fetching user email:', error);
    return null;
  }
}

/**
 * Validate redirect URL is internal (prevent open redirect attacks)
 */
function validateRedirectUrl(redirectPath: string, appUrl: string): boolean {
  try {
    // Must start with /results/ (whitelist allowed paths)
    if (!redirectPath.startsWith('/results/')) {
      console.warn(`[Email] Invalid redirect path (not /results/*): ${redirectPath}`);
      return false;
    }

    // Must not contain protocol or domain (prevent absolute URLs)
    if (redirectPath.includes('://') || redirectPath.startsWith('//')) {
      console.warn(`[Email] Invalid redirect path (contains protocol): ${redirectPath}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Email] Error validating redirect URL:', error);
    return false;
  }
}

/**
 * Send completion email notification with magic link
 * Returns true if email was sent successfully, false otherwise
 */
export async function sendCompletionEmail(
  sessionId: string,
  userId: string,
  businessName: string
): Promise<boolean> {
  // Don't fail if Resend is not configured
  if (!resend) {
    console.warn('[Email] RESEND_API_KEY not configured, skipping email notification');
    return false;
  }

  try {
    // Get user email
    const userEmail = await getUserEmail(userId);
    if (!userEmail) {
      console.warn(`[Email] Could not find email for user ${userId}`);
      return false;
    }

    // Build redirect path (support both variable names)
    const appUrl = process.env.NEXT_PUBLIC_SITE_URL || 
                   process.env.NEXT_PUBLIC_APP_URL || 
                   'http://localhost:3000';
    const redirectPath = `/results/${sessionId}/download`;

    // Validate redirect URL
    if (!validateRedirectUrl(redirectPath, appUrl)) {
      console.error(`[Email] Invalid redirect URL: ${redirectPath}`);
      return false;
    }

    // Generate magic link with redirect parameter
    const { data: magicLinkData, error: magicLinkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: userEmail,
      options: {
        redirectTo: `${appUrl}/api/auth/callback?redirect=${encodeURIComponent(redirectPath)}`
      }
    });

    if (magicLinkError || !magicLinkData?.properties?.action_link) {
      console.error('[Email] Failed to generate magic link:', magicLinkError);
      return false;
    }

    const magicLink = magicLinkData.properties.action_link;

    // Send email via Resend
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Research Automation Engine <onboarding@resend.dev>',
      to: userEmail,
      subject: `Your Research is Complete: ${businessName}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1f2937; margin-bottom: 16px;">🎉 Your Research is Complete!</h2>
          
          <p style="color: #4b5563; line-height: 1.6; margin-bottom: 16px;">
            Great news! Your research for <strong>${businessName}</strong> has been completed successfully.
          </p>
          
          <p style="color: #4b5563; line-height: 1.6; margin-bottom: 24px;">
            Click the button below to view your complete research report, download PDFs, and access your Cursor prompts.
          </p>
          
          <div style="text-align: center; margin: 32px 0;">
            <a href="${magicLink}" style="display: inline-block; padding: 14px 28px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
              View Your Research Report
            </a>
          </div>
          
          <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
            Or copy and paste this link into your browser:<br>
            <a href="${magicLink}" style="color: #2563eb; word-break: break-all;">${magicLink}</a>
          </p>
          
          <hr style="margin: 32px 0; border: none; border-top: 1px solid #e5e7eb;">
          
          <p style="color: #6b7280; font-size: 14px; margin: 0;">
            This secure link will log you in and take you directly to your results.<br>
            <small>Link expires in 1 hour. Need help? Reply to this email.</small>
          </p>
        </div>
      `
    });

    console.log(`[Email] Completion email sent successfully to ${userEmail} for session ${sessionId}`);
    return true;
  } catch (error: any) {
    // Log error but don't throw - email failure shouldn't break completion
    console.error(`[Email] Failed to send completion email for session ${sessionId}:`, error.message);
    return false;
  }
}
