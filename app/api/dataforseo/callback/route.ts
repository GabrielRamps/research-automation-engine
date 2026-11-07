/**
 * DataForSEO Webhook Callback Endpoint
 * 
 * Receives pingback GET requests when async DataForSEO tasks complete.
 * URL format: GET /api/dataforseo/callback?id=$id&tag=$tag&secret={WEBHOOK_SECRET}
 * 
 * - $id: DataForSEO task ID (substituted automatically)
 * - $tag: Custom tag set in task_post (format: {session_id}:{task_type})
 * - secret: Shared secret for authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const WEBHOOK_SECRET = process.env.DATAFORSEO_WEBHOOK_SECRET;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('id');
    const tag = searchParams.get('tag');
    const secret = searchParams.get('secret');

    // Validate secret
    // Fail closed: if no secret is configured, this callback is switched off
    if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
      console.warn(`[DataForSEO Webhook] Invalid secret received`);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!taskId) {
      return NextResponse.json({ error: 'Missing task ID' }, { status: 400 });
    }

    console.log(`[DataForSEO Webhook] Received pingback for task ${taskId} (tag: ${tag})`);

    // Parse tag to extract session_id and task_type
    let sessionId: string | null = null;
    let taskType: string | null = null;

    if (tag) {
      const parts = tag.split(':');
      if (parts.length >= 2) {
        sessionId = parts[0];
        taskType = parts.slice(1).join(':');
      }
    }

    // Update the async task record
    const { error: updateError } = await supabase
      .from('dataforseo_async_tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('task_id', taskId);

    if (updateError) {
      // Task might not exist in our table (e.g., if created before migration)
      // Try to insert it instead
      console.warn(`[DataForSEO Webhook] Update failed, attempting upsert:`, updateError.message);

      if (sessionId && taskType) {
        const { error: insertError } = await supabase
          .from('dataforseo_async_tasks')
          .upsert({
            task_id: taskId,
            session_id: sessionId,
            task_type: taskType,
            endpoint: `unknown`, // Will be updated when results are fetched
            status: 'completed',
            completed_at: new Date().toISOString(),
          }, { onConflict: 'task_id' });

        if (insertError) {
          console.error(`[DataForSEO Webhook] Upsert failed:`, insertError.message);
        }
      }
    }

    // Update DataForSEO task status in the dedicated table
    if (sessionId && taskType) {
      const { data: dfData } = await supabase
        .from('research_session_dataforseo')
        .select('wave_results')
        .eq('session_id', sessionId)
        .maybeSingle();

      if (dfData) {
        const tasks = dfData.wave_results || {};
        tasks[taskType] = {
          ...tasks[taskType],
          task_id: taskId,
          status: 'completed',
          completed_at: new Date().toISOString(),
        };

        await supabase
          .from('research_session_dataforseo')
          .update({ wave_results: tasks, updated_at: new Date().toISOString() })
          .eq('session_id', sessionId);
      }
    }

    console.log(`[DataForSEO Webhook] Successfully processed pingback for task ${taskId}`);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(`[DataForSEO Webhook] Error:`, error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
