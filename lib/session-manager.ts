import { createClient } from '@supabase/supabase-js';
import { logger } from './secure-logger';
import { queueResearchJob } from './queue';

/** Thrown when session fetch fails due to transient DB issues (e.g. statement timeout 57014). Route should return 503. */
export class SessionFetchTransientError extends Error {
  constructor(message: string = 'SESSION_FETCH_TRANSIENT') {
    super(message);
    this.name = 'SessionFetchTransientError';
  }
}

function isStatementCanceledError(error: { code?: string; message?: string }): boolean {
  return error?.code === '57014' || (typeof error?.message === 'string' && error.message.includes('canceling statement'));
}

function isTransientSupabaseError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (isStatementCanceledError(error)) return true;
  const msg = error.message || '';
  return (
    msg.includes('<!DOCTYPE') ||
    msg.includes('<html') ||
    msg.includes('Web server is down') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('fetch failed') ||
    msg.includes('network error') ||
    error.code === undefined
  );
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export interface BalanceError {
  service: 'claude' | 'tavily';
  message: string;
  instructions: string;
  link: string;
  phase: number;
  timestamp: string;
}

export type Tier = 'basic' | 'intermediate' | 'advanced';

export interface ResearchSession {
  id: string;
  user_id: string;
  business_name: string;
  industry: string;
  services?: string;
  additional_services?: string;
  location: string;
  search_radius: number;
  target_audience?: string;
  unique_selling_points?: string;
  contact_email?: string;
  project_type: string;
  brand_colors?: string;
  
  // Business information fields
  business_type?: string;
  primary_service?: string;
  city?: string;
  state?: string;
  phone_number?: string;
  street_address?: string;
  zip_code?: string;
  operating_hours?: string;
  service_area?: number;
  has_brand_colors?: boolean;
  brand_colors_array?: string[];
  has_brand_fonts?: boolean;
  brand_fonts_array?: string[];
  brand_fonts?: string;
  years_in_business?: string;
  license_number?: string;
  google_business_url?: string;

  // Tier & enhanced fields
  tier?: Tier;
  website_url?: string;
  service_area_cities?: string[];
  competitor_domains?: string[];
  target_customer_type?: 'residential' | 'commercial' | 'both';
  brand_keywords?: string[];
  certifications?: string[];
  
  // Pipeline data
  dataforseo_tasks?: any;
  seo_audit_data?: any;
  
  current_phase: number;
  status: 'in_progress' | 'completed' | 'failed' | 'paused' | 'cancelled' | 'pending';
  phase1_raw?: any;
  phase1_summary?: any;
  phase1_citations?: any[];
  phase2_raw?: any;
  phase2_summary?: any;
  phase2_citations?: any[];
  phase3_raw?: any;
  phase3_summary?: any;
  phase3_citations?: any[];
  phase4_synthesis?: any;
  phase5_blueprint?: any;
  total_generation_time?: number;
  api_costs?: any;
  error_log?: any[];
  balance_errors?: BalanceError[];
  created_at: string;
  completed_at?: string;
}

export class SessionManager {
  /**
   * Create a new research session
   */
  static async createSession(data: {
    userId: string;
    businessName: string;
    industry: string;
    services?: string;
    additionalServices?: string;
    location: string;
    targetAudience?: string;
    uniqueSellingPoints?: string;
    contactEmail?: string;
    projectType?: string;
    brandColors?: string;
    
    // Business information fields
    businessType?: string;
    primaryService?: string;
    city?: string;
    state?: string;
    phoneNumber?: string;
    streetAddress?: string;
    zipCode?: string;
    operatingHours?: string;
    hasBrandColors?: boolean;
    brandColorsArray?: string[];
    hasBrandFonts?: boolean;
    brandFontsArray?: string[];
    brandFonts?: string;
    yearsInBusiness?: string;
    licenseNumber?: string;
    googleBusinessUrl?: string;

    // Tier & enhanced fields
    tier?: Tier;
    websiteUrl?: string;
    serviceAreaCities?: string[];
    competitorDomains?: string[];
    targetCustomerType?: 'residential' | 'commercial' | 'both';
    brandKeywords?: string[];
    certifications?: string[];
  }, options?: { initialStatus?: 'pending' | 'in_progress' }): Promise<ResearchSession> {
    const initialStatus = options?.initialStatus ?? 'in_progress';
    const { data: session, error } = await supabase
      .from('research_sessions')
      .insert({
        user_id: data.userId,
        business_name: data.businessName,
        industry: data.industry,
        services: data.services,
        additional_services: data.additionalServices,
        location: data.location,
        search_radius: 25,
        target_audience: data.targetAudience,
        unique_selling_points: data.uniqueSellingPoints,
        contact_email: data.contactEmail,
        project_type: data.projectType || 'Website',
        brand_colors: data.brandColors,
        
        // Business information fields
        business_type: data.businessType,
        primary_service: data.primaryService,
        city: data.city,
        state: data.state,
        phone_number: data.phoneNumber,
        street_address: data.streetAddress,
        zip_code: data.zipCode,
        operating_hours: data.operatingHours,
        has_brand_colors: data.hasBrandColors,
        brand_colors_array: data.brandColorsArray,
        has_brand_fonts: data.hasBrandFonts,
        brand_fonts_array: data.brandFontsArray,
        brand_fonts: data.brandFonts,
        years_in_business: data.yearsInBusiness,
        license_number: data.licenseNumber,
        google_business_url: data.googleBusinessUrl,

        // Tier & enhanced fields
        tier: data.tier || 'basic',
        website_url: data.websiteUrl,
        service_area_cities: data.serviceAreaCities,
        competitor_domains: data.competitorDomains,
        target_customer_type: data.targetCustomerType,
        brand_keywords: data.brandKeywords,
        certifications: data.certifications,
        
        current_phase: 1,
        status: initialStatus
      })
      .select()
      .single();

    if (error) {
      logger.error('Session creation error:', error);
      throw new Error('Failed to create research session');
    }

    return session;
  }

  /**
   * Lightweight progress payload for streaming/polling. Selects only small columns to reduce disk I/O.
   * Use this instead of getSession() when you only need status, phase, and citation counts.
   */
  static async getSessionProgress(sessionId: string): Promise<{
    id: string;
    user_id?: string;
    current_phase: number;
    status: ResearchSession['status'];
    tier?: Tier;
    phase1_citations?: any[];
    phase2_citations?: any[];
    phase3_citations?: any[];
    balance_errors?: BalanceError[];
    phase4_synthesis?: any;
    error_log?: Array<{ phase?: number; error?: string; error_type?: string; timestamp?: string }>;
  } | null> {
    const { data, error } = await supabase
      .from('research_sessions')
      .select('id, user_id, current_phase, status, tier, balance_errors, error_log')
      .eq('id', sessionId)
      .single();

    if (error) {
      if (isTransientSupabaseError(error)) throw new SessionFetchTransientError('SESSION_FETCH_TRANSIENT');
      logger.error('Session progress fetch error:', error);
      return null;
    }
    if (!data) return null;

    // Load citation counts from dedicated table
    const { data: citationRows } = await supabase
      .from('research_session_phase_data')
      .select('phase, citations')
      .eq('session_id', sessionId);

    const result: any = { ...data };
    for (const row of (citationRows || [])) {
      result[`phase${row.phase}_citations`] = row.citations;
    }

    // Only load Phase 4 data when session is completed or in Phase 4.
    // During phases 1-3 (which can last 20-60 min), this avoids reading a 200-500KB JSONB every poll.
    if (data.status === 'completed' || data.current_phase >= 4) {
      const { data: phase4Row } = await supabase
        .from('research_session_phase4')
        .select('phase4_synthesis')
        .eq('session_id', sessionId)
        .maybeSingle();

      result.phase4_synthesis = phase4Row?.phase4_synthesis ?? null;
    } else {
      result.phase4_synthesis = null;
    }

    // DataForSEO wave progress (for intermediate/advanced in progress) so UI can show progress after refresh
    if ((data.tier === 'intermediate' || data.tier === 'advanced') && data.status === 'in_progress') {
      const checkpoint = await SessionManager.loadCheckpoint(sessionId);
      const waves = (checkpoint as { waves?: { completed_waves?: string[]; current_wave?: string | null } }).waves;
      if (waves) {
        result.dataforseo_progress = {
          completed_waves: waves.completed_waves ?? [],
          current_wave: waves.current_wave ?? null,
        };
      }
    }

    return result as {
      id: string;
      user_id?: string;
      current_phase: number;
      status: ResearchSession['status'];
      tier?: Tier;
      phase1_citations?: any[];
      phase2_citations?: any[];
      phase3_citations?: any[];
      balance_errors?: BalanceError[];
      phase4_synthesis?: any;
      error_log?: Array<{ phase?: number; error?: string; error_type?: string; timestamp?: string }>;
      dataforseo_progress?: { completed_waves: string[]; current_wave: string | null };
    };
  }

  /**
   * Ultra-lightweight status check: single query, no joins. Used by polling fallback
   * and Supabase Realtime initial load. Optionally includes business fields for first load.
   */
  static async getSessionStatus(sessionId: string, options?: { includeBusinessFields?: boolean }): Promise<{
    id: string;
    user_id?: string;
    current_phase: number;
    status: ResearchSession['status'];
    tier?: Tier;
    balance_errors?: BalanceError[];
    error_log?: Array<{ phase?: number; error?: string; error_type?: string; timestamp?: string }>;
    business_name?: string;
    industry?: string;
    location?: string;
    city?: string;
    state?: string;
    primary_service?: string;
    services?: string;
    created_at?: string;
    phase4_synthesis?: any;
  } | null> {
    const cols = options?.includeBusinessFields
      ? 'id, user_id, current_phase, status, tier, balance_errors, error_log, business_name, industry, location, city, state, primary_service, services, created_at'
      : 'id, user_id, current_phase, status, tier, balance_errors, error_log';

    const { data, error } = await supabase
      .from('research_sessions')
      .select(cols)
      .eq('id', sessionId)
      .single();

    if (error) {
      if (isTransientSupabaseError(error)) throw new SessionFetchTransientError('SESSION_FETCH_TRANSIENT');
      logger.error('Session status fetch error:', error);
      return null;
    }
    if (!data) return null;

    const result: Record<string, any> = { ...(data as Record<string, any>) };

    const phase = result.current_phase as number;
    if (result.status === 'completed' || phase >= 4) {
      const { data: phase4Row } = await supabase
        .from('research_session_phase4')
        .select('phase4_synthesis')
        .eq('session_id', sessionId)
        .maybeSingle();

      result.phase4_synthesis = phase4Row?.phase4_synthesis ?? null;
    }

    return result as any;
  }

  /**
   * Lightweight existence check: only selects id. Use instead of getSession() when you only need to verify the session exists.
   */
  static async getSessionExists(sessionId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('research_sessions')
      .select('id')
      .eq('id', sessionId)
      .maybeSingle();
    return !error && data != null;
  }

  /**
   * Minimal session fields for auth and status checks (e.g. resume route). Avoids loading heavy JSONB columns.
   */
  static async getSessionMinimal(sessionId: string): Promise<{ id: string; user_id: string; status: string; current_phase: number } | null> {
    const { data, error } = await supabase
      .from('research_sessions')
      .select('id, user_id, status, current_phase')
      .eq('id', sessionId)
      .maybeSingle();
    if (error || !data) return null;
    return data as { id: string; user_id: string; status: string; current_phase: number };
  }

  /**
   * Session fields needed for building research queries (industry, location, business_name, etc.). Use instead of getSession() when you only need to build prompts or display context.
   */
  static async getSessionForResearch(sessionId: string): Promise<{
    id: string;
    user_id: string;
    industry: string;
    location: string;
    business_name: string;
    services?: string;
    target_audience?: string;
    search_radius: number;
  } | null> {
    const { data, error } = await supabase
      .from('research_sessions')
      .select('id, user_id, industry, location, business_name, services, target_audience, search_radius')
      .eq('id', sessionId)
      .maybeSingle();
    if (error || !data) return null;
    return data as {
      id: string;
      user_id: string;
      industry: string;
      location: string;
      business_name: string;
      services?: string;
      target_audience?: string;
      search_radius: number;
    };
  }

  /**
   * Get session by ID.
   * Retries once on statement timeout (57014). On repeated transient failure, throws SessionFetchTransientError so callers can return 503.
   */
  static async getSession(sessionId: string): Promise<ResearchSession | null> {
    const SESSION_META_COLS = 'id, user_id, business_name, industry, primary_service, services, additional_services, location, city, state, zip_code, tier, phone_number, street_address, operating_hours, website_url, google_business_url, service_area_cities, target_audience, search_radius, location_code, location_name, status, current_phase, created_at, completed_at, project_type, api_costs, business_type, unique_selling_points, contact_email, error_log, balance_errors, total_generation_time';

    const run = async (): Promise<ResearchSession | null> => {
      const { data: sessionMeta, error } = await supabase
        .from('research_sessions')
        .select(SESSION_META_COLS)
        .eq('id', sessionId)
        .single();

      if (error) {
        if (isStatementCanceledError(error)) {
          throw new SessionFetchTransientError('SESSION_FETCH_TRANSIENT');
        }
        logger.error('Session fetch error:', error);
        return null;
      }

      const session: any = { ...sessionMeta };

      // Load phase 1-3 data from dedicated table
      const { data: phaseRows } = await supabase
        .from('research_session_phase_data')
        .select('phase, raw_data, summary, citations, dataforseo_data')
        .eq('session_id', sessionId);

      for (const row of (phaseRows || [])) {
        session[`phase${row.phase}_raw`] = row.raw_data;
        session[`phase${row.phase}_summary`] = row.summary;
        session[`phase${row.phase}_citations`] = row.citations;
        session[`phase${row.phase}_dataforseo`] = row.dataforseo_data;
      }

      // Load DataForSEO data from dedicated table
      const { data: dfData } = await supabase
        .from('research_session_dataforseo')
        .select('seo_audit_data, wave_results, location_code, location_name')
        .eq('session_id', sessionId)
        .maybeSingle();

      if (dfData) {
        session.seo_audit_data = dfData.seo_audit_data;
        session.dataforseo_tasks = dfData.wave_results;
        if (dfData.location_code) session.location_code = dfData.location_code;
        if (dfData.location_name) session.location_name = dfData.location_name;
      }

      // Load Phase 4 synthesis from dedicated table
      const { data: phase4Row } = await supabase
        .from('research_session_phase4')
        .select('phase4_synthesis')
        .eq('session_id', sessionId)
        .maybeSingle();
      if (phase4Row?.phase4_synthesis != null) {
        session.phase4_synthesis = phase4Row.phase4_synthesis;
      }

      return session;
    };

    const MAX_RETRIES = 3;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await run();
      } catch (err) {
        lastErr = err;
        if (err instanceof SessionFetchTransientError && attempt < MAX_RETRIES) {
          const delay = 1000 * Math.pow(2, attempt);
          logger.warn(`[getSession] Transient error, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`, { sessionId });
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  /**
   * Update session phase data
   */
  static async updatePhase(
    sessionId: string,
    phase: number,
    data: {
      raw?: any;
      summary?: any;
      citations?: any[];
      nextPhase?: number;
      status?: 'in_progress' | 'completed' | 'failed';
      apiCost?: number;
    }
  ): Promise<void> {
    // Phase 1-3 data goes to the dedicated phase_data table
    if (phase >= 1 && phase <= 3 && (data.raw !== undefined || data.summary !== undefined || data.citations !== undefined)) {
      const phaseUpdate: any = {
        session_id: sessionId,
        phase,
        updated_at: new Date().toISOString(),
      };
      if (data.raw !== undefined) phaseUpdate.raw_data = data.raw;
      if (data.summary !== undefined) phaseUpdate.summary = data.summary;
      if (data.citations !== undefined) phaseUpdate.citations = data.citations;

      const { error: phaseError } = await supabase
        .from('research_session_phase_data')
        .upsert(phaseUpdate, { onConflict: 'session_id,phase' });

      if (phaseError) {
        logger.error('Phase data update error:', phaseError);
        throw new Error('Failed to update phase data');
      }
    }

    // Metadata updates (status, current_phase, api_costs) stay on research_sessions
    const metaUpdates: any = {};

    // Phase 4+ data stays on research_sessions (or dedicated table)
    if (phase === 4 && data.raw !== undefined) {
      metaUpdates.phase4_synthesis = data.raw;
    } else if (phase === 5 && data.raw !== undefined) {
      metaUpdates.phase5_blueprint = data.raw;
    }

    if (data.nextPhase !== undefined) {
      metaUpdates.current_phase = data.nextPhase;
    }

    if (data.status) {
      metaUpdates.status = data.status;
      if (data.status === 'completed') {
        metaUpdates.completed_at = new Date().toISOString();
      }
    }

    if (data.apiCost !== undefined) {
      const { data: row } = await supabase
        .from('research_sessions')
        .select('api_costs')
        .eq('id', sessionId)
        .maybeSingle();
      const currentCosts = (row?.api_costs as Record<string, unknown>) || {};
      currentCosts[`phase${phase}`] = data.apiCost;
      metaUpdates.api_costs = currentCosts;
    }

    if (Object.keys(metaUpdates).length > 0) {
      const { error } = await supabase
        .from('research_sessions')
        .update(metaUpdates)
        .eq('id', sessionId);

      if (error) {
        logger.error('Session update error:', error);
        throw new Error('Failed to update session');
      }
    }
  }

  /**
   * Load checkpoint data for a session (from research_session_checkpoints; fallback to research_sessions).
   */
  static async loadCheckpoint(sessionId: string): Promise<any> {
    const { data, error } = await supabase
      .from('research_session_checkpoints')
      .select('checkpoint_data')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (!error && data?.checkpoint_data != null) {
      return data.checkpoint_data;
    }
    const { data: legacy } = await supabase
      .from('research_sessions')
      .select('checkpoint_data')
      .eq('id', sessionId)
      .single();
    return legacy?.checkpoint_data ?? {};
  }

  /**
   * Save checkpoint data for a session (merges with existing; writes to research_session_checkpoints).
   */
  static async saveCheckpoint(
    sessionId: string,
    checkpointData: any
  ): Promise<void> {
    const existingCheckpoint = await this.loadCheckpoint(sessionId);
    const updatedCheckpoint = { ...existingCheckpoint, ...checkpointData };
    const { error } = await supabase
      .from('research_session_checkpoints')
      .upsert(
        {
          session_id: sessionId,
          checkpoint_data: updatedCheckpoint,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'session_id' }
      );
    if (error) {
      logger.error('Checkpoint save error:', error);
      throw new Error('Failed to save checkpoint');
    }
  }

  /**
   * Get phase progress percentage from checkpoint
   */
  static async getPhaseProgress(
    sessionId: string,
    phase: number
  ): Promise<number> {
    const checkpoint = await this.loadCheckpoint(sessionId);
    const phaseKey = `phase${phase}`;
    const phaseCheckpoint = checkpoint[phaseKey];

    if (!phaseCheckpoint) {
      return 0;
    }

    if (phase === 4) {
      const completedSubphases = phaseCheckpoint.completed_subphases?.length || 0;
      const completedPagesPrompts = phaseCheckpoint.completed_pages_prompts?.length || 0;
      const totalPages = phaseCheckpoint.total_pages || 0;

      const totalItems = 5 + totalPages;
      const completedItems = completedSubphases + completedPagesPrompts;

      if (totalItems === 0) return 0;
      return Math.round((completedItems / totalItems) * 100);
    } else {
      const completed = phaseCheckpoint.completed_prompts?.length || 0;
      const total = phaseCheckpoint.total_prompts || 0;

      if (total === 0) return 0;
      return Math.round((completed / total) * 100);
    }
  }

  /**
   * Clear checkpoint for a phase (when phase completes)
   */
  static async clearPhaseCheckpoint(
    sessionId: string,
    phase: number
  ): Promise<void> {
    const checkpoint = await this.loadCheckpoint(sessionId);
    const phaseKey = `phase${phase}`;
    
    delete checkpoint[phaseKey];

    const { error } = await supabase
      .from('research_session_checkpoints')
      .upsert(
        {
          session_id: sessionId,
          checkpoint_data: checkpoint,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'session_id' }
      );

    if (error) {
      logger.error('Checkpoint clear error:', error);
    }
  }

  /**
   * Log error to session
   */
  static async logError(
    sessionId: string,
    phase: number,
    error: string
  ): Promise<void> {
    const { data: row } = await supabase
      .from('research_sessions')
      .select('error_log')
      .eq('id', sessionId)
      .maybeSingle();
    const errorLog = Array.isArray(row?.error_log) ? [...row.error_log] : [];
    errorLog.push({
      phase,
      error,
      timestamp: new Date().toISOString()
    });

    const { error: updateError } = await supabase
      .from('research_sessions')
      .update({
        error_log: errorLog,
        status: 'failed'
      })
      .eq('id', sessionId);

    if (updateError) {
      logger.error('Error log update failed:', updateError);
    }
  }

  /**
   * Log balance error to session
   */
  static async logBalanceError(
    sessionId: string,
    phase: number,
    balanceError: BalanceError
  ): Promise<void> {
    try {
      const { data: row } = await supabase
        .from('research_sessions')
        .select('error_log, balance_errors')
        .eq('id', sessionId)
        .maybeSingle();
      const errorLog = Array.isArray(row?.error_log) ? [...row.error_log] : [];
      const balanceErrors = Array.isArray(row?.balance_errors) ? [...row.balance_errors] : [];
      // Add to error log
      errorLog.push({
        phase,
        error: balanceError.message,
        type: 'balance_error',
        service: balanceError.service,
        timestamp: new Date().toISOString()
      });

      // Add to balance errors array (deduplicate by service)
      const existingBalanceErrors = Array.isArray(balanceErrors) 
        ? balanceErrors.filter(
            (be: BalanceError) => be.service !== balanceError.service
          )
        : [];
      
      existingBalanceErrors.push({
        ...balanceError,
        phase,
        timestamp: new Date().toISOString()
      });

      const { error: updateError } = await supabase
        .from('research_sessions')
        .update({
          error_log: errorLog,
          balance_errors: existingBalanceErrors,
          status: 'failed'
        })
        .eq('id', sessionId);

      if (updateError) {
        logger.error('Balance error log update failed:', updateError);
      }
    } catch (err) {
      logger.error('Error logging balance error:', err);
      // Fallback to regular error logging
      await this.logError(sessionId, phase, balanceError.message);
    }
  }

  /**
   * Get all sessions for a user
   */
  static async getUserSessions(userId: string): Promise<ResearchSession[]> {
    const { data, error } = await supabase
      .from('research_sessions')
      .select('id, user_id, business_name, industry, location, created_at, project_type, status, current_phase, completed_at, tier, services, search_radius, target_audience, contact_email')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Sessions fetch error:', error);
      return [];
    }

    return (data || []) as ResearchSession[];
  }

  /**
   * Update total generation time
   */
  static async updateGenerationTime(
    sessionId: string,
    timeMs: number
  ): Promise<void> {
    const { error } = await supabase
      .from('research_sessions')
      .update({ total_generation_time: timeMs })
      .eq('id', sessionId);

    if (error) {
      logger.error('Generation time update error:', error);
    }
  }

  /**
   * Count active sessions for a user (not completed, failed, or cancelled)
   * This counts sessions where status is NOT 'completed', 'failed', or 'cancelled'
   */
  static async countActiveSessions(userId: string): Promise<number> {
    // Get all sessions for the user, then filter in code for reliability
    const { data, error } = await supabase
      .from('research_sessions')
      .select('id, status')
      .eq('user_id', userId);

    if (error) {
      logger.error('Active sessions count error:', error);
      return 0;
    }

    // Filter out completed, failed, and cancelled sessions
    const activeSessions = (data || []).filter(
      (session) => 
        session.status !== 'completed' && 
        session.status !== 'failed' && 
        session.status !== 'cancelled'
    );

    return activeSessions.length;
  }

  /**
   * Enqueue the next pending session for a user (at most one in_progress per user).
   * Call after session create or when a worker completes/fails a job.
   * Returns the session id if one was enqueued, null otherwise.
   */
  static async enqueueNextPendingForUser(userId: string): Promise<string | null> {
    const { data: inProgress } = await supabase
      .from('research_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'in_progress');

    if (inProgress && inProgress.length >= 1) {
      return null;
    }

    const { data: next, error: fetchError } = await supabase
      .from('research_sessions')
      .select('id, tier')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (fetchError || !next) {
      return null;
    }

    try {
      await queueResearchJob(next.id, next.tier ?? 'basic');
    } catch (err: any) {
      logger.error('[SessionManager] enqueueNextPendingForUser: queueResearchJob failed', err);
      return null;
    }

    const { error: updateError } = await supabase
      .from('research_sessions')
      .update({ status: 'in_progress' })
      .eq('id', next.id);

    if (updateError) {
      logger.error('[SessionManager] enqueueNextPendingForUser: failed to set in_progress', updateError);
      return null;
    }

    logger.info(`[SessionManager] Enqueued next pending session ${next.id} for user ${userId}`);
    return next.id;
  }

  /**
   * Check if session is currently being processed (prevents duplicate runs)
   * A session is "locked" if it's in_progress and was updated recently (within 5 minutes)
   */
  static async isSessionLocked(sessionId: string): Promise<boolean> {
    const { data: session, error } = await supabase
      .from('research_sessions')
      .select('status, current_phase, created_at')
      .eq('id', sessionId)
      .single();
    
    if (error || !session) {
      logger.error('Session lock check error:', error);
      return false;
    }
    
    // If status is in_progress, consider it locked
    // (We're being conservative here - better to block a retry than allow duplicate processing)
    if (session.status === 'in_progress') {
      logger.info(`[Session Lock] Session ${sessionId} is locked (status: in_progress, phase: ${session.current_phase})`);
      return true;
    }
    
    return false;
  }
}
