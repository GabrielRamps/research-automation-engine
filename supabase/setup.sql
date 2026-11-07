-- =====================================================================
-- Research Automation Engine - complete database setup
-- =====================================================================
-- Run this ONCE on a brand-new, empty Supabase project:
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file -> Run
--
-- It creates every table, index, function, trigger and Row Level Security
-- policy the app and worker need, and loads the default research prompts.
-- It does NOT create any users. After you sign up, run supabase/add-user.sql
-- with your own email to give yourself access (and admin rights).
--
-- Running it a second time on the same project will fail with
-- "already exists" errors - that is expected and harmless.
-- =====================================================================

SET check_function_bodies = false;
SET client_min_messages = warning;
SET search_path = public, extensions;

-- =====================================================================
-- Schema
-- =====================================================================

--
-- Name: calculate_phase_progress(jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_phase_progress(checkpoint jsonb, phase_num integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  total_items INTEGER;
  completed_items INTEGER;
BEGIN
  -- For phase 4, calculate based on subphases and pages
  IF phase_num = 4 THEN
    -- Count completed subphases (5 total: 4.1-4.5) and pages
    completed_items := COALESCE(jsonb_array_length(checkpoint -> 'completed_subphases'), 0);
    total_items := 5; -- Base subphases
    
    -- If we have page data, include it
    IF checkpoint ? 'completed_pages_copy' THEN
      total_items := total_items + COALESCE((checkpoint ->> 'total_pages')::INTEGER, 0);
      completed_items := completed_items + COALESCE(jsonb_array_length(checkpoint -> 'completed_pages_copy'), 0);
    END IF;
  ELSE
    -- For phases 1-3, calculate based on prompts
    total_items := COALESCE((checkpoint ->> 'total_prompts')::INTEGER, 0);
    completed_items := COALESCE(jsonb_array_length(checkpoint -> 'completed_prompts'), 0);
  END IF;
  
  -- Return percentage (0 if no data)
  IF total_items = 0 THEN
    RETURN 0;
  END IF;
  
  RETURN (completed_items * 100 / total_items);
END;
$$;


--
-- Name: get_active_terms_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_terms_version() RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT version FROM terms_and_conditions WHERE is_active = true LIMIT 1;
$$;


--
-- Name: get_checkpoint_progress(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_checkpoint_progress(session_id uuid, phase_num integer) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  checkpoint JSONB;
  phase_key TEXT;
BEGIN
  phase_key := 'phase' || phase_num;
  
  SELECT checkpoint_data -> phase_key INTO checkpoint
  FROM research_sessions
  WHERE id = session_id;
  
  RETURN COALESCE(checkpoint, '{}'::jsonb);
END;
$$;


--
-- Name: is_admin_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin_user() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  user_email TEXT;
  admin_emails JSONB;
BEGIN
  -- Get the current user's email
  user_email := auth.email();
  
  -- If no user is authenticated, return false
  IF user_email IS NULL THEN
    RETURN false;
  END IF;
  
  -- Get admin emails list (bypassing RLS with SECURITY DEFINER)
  SELECT config_value INTO admin_emails
  FROM admin_config
  WHERE config_key = 'admin_emails'
  LIMIT 1;
  
  -- If admin_emails config doesn't exist, return false
  IF admin_emails IS NULL THEN
    RETURN false;
  END IF;
  
  -- Check if user's email is in the admin list
  RETURN user_email = ANY(
    SELECT jsonb_array_elements_text(admin_emails)
  );
END;
$$;


--
-- Name: reorder_research_prompts(integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reorder_research_prompts(p_phase integer, p_reorder_data jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  item JSONB;
BEGIN
  -- Validate phase
  IF p_phase NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'Invalid phase: %. Must be 1, 2, or 3.', p_phase;
  END IF;

  -- Validate input is an array
  IF jsonb_typeof(p_reorder_data) != 'array' THEN
    RAISE EXCEPTION 'p_reorder_data must be a JSON array';
  END IF;

  -- Update all prompts in a single transaction
  -- This is atomic - either all succeed or all fail
  FOR item IN SELECT * FROM jsonb_array_elements(p_reorder_data)
  LOOP
    UPDATE research_prompts
    SET 
      order_index = (item->>'order_index')::INTEGER,
      updated_at = NOW()
    WHERE 
      id = (item->>'id')::UUID
      AND phase = p_phase;
    
    -- Verify the update happened
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Prompt with id % not found in phase %', 
        (item->>'id')::UUID, p_phase;
    END IF;
  END LOOP;
END;
$$;


--
-- Name: session_drafts_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.session_drafts_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: user_has_accepted_current_terms(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_has_accepted_current_terms(p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM user_terms_acceptance uta
    JOIN terms_and_conditions tc ON uta.terms_version = tc.version
    WHERE uta.user_id = p_user_id AND tc.is_active = true
  );
$$;


--
-- Name: active_users_now; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.active_users_now WITH (security_invoker='true') AS
 SELECT id,
    email,
    last_sign_in_at,
    EXTRACT(epoch FROM (now() - last_sign_in_at)) AS seconds_since_activity
   FROM auth.users
  WHERE (last_sign_in_at > (now() - '00:15:00'::interval))
  ORDER BY last_sign_in_at DESC;


--
-- Name: admin_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    config_key text NOT NULL,
    config_value jsonb NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid
);


--
-- Name: context_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.context_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doc_type text NOT NULL,
    content text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: dataforseo_async_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dataforseo_async_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid,
    task_id text NOT NULL,
    task_type text NOT NULL,
    endpoint text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    result jsonb,
    error_message text,
    cost numeric(10,6),
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    CONSTRAINT dataforseo_async_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: dataforseo_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dataforseo_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cache_key text NOT NULL,
    result jsonb NOT NULL,
    cost numeric(10,6),
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: phase4_prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phase4_prompts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subphase text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    name text NOT NULL,
    prompt_template text NOT NULL,
    internal_notes text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT phase4_prompts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text]))),
    CONSTRAINT phase4_prompts_subphase_check CHECK ((subphase ~ '^(4|10)\.\d+$'::text))
);


--
-- Name: research_prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_prompts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phase integer NOT NULL,
    order_index integer NOT NULL,
    name text NOT NULL,
    prompt_template text NOT NULL,
    internal_notes text,
    status text DEFAULT 'active'::text,
    override_max_results integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT research_prompts_override_max_results_check CHECK (((override_max_results >= 1) AND (override_max_results <= 20))),
    CONSTRAINT research_prompts_phase_check CHECK ((phase = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT research_prompts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);


--
-- Name: research_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    business_name text NOT NULL,
    industry text NOT NULL,
    services text,
    location text NOT NULL,
    target_audience text,
    unique_selling_points text,
    contact_email text,
    project_type text DEFAULT 'Website'::text,
    research_data text,
    prompts_data text,
    generation_time integer,
    claude_model text DEFAULT 'claude-sonnet-4-20250514'::text,
    created_at timestamp with time zone DEFAULT now(),
    citations jsonb DEFAULT '[]'::jsonb,
    session_id uuid
);


--
-- Name: research_session_checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_session_checkpoints (
    session_id uuid NOT NULL,
    checkpoint_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)
WITH (fillfactor='70', autovacuum_vacuum_scale_factor='0.05', autovacuum_analyze_scale_factor='0.02', autovacuum_vacuum_cost_delay='2');


--
-- Name: research_session_dataforseo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_session_dataforseo (
    session_id uuid NOT NULL,
    wave_results jsonb DEFAULT '{}'::jsonb NOT NULL,
    seo_audit_data jsonb,
    location_code integer,
    location_name text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)
WITH (toast_tuple_target='128', autovacuum_vacuum_scale_factor='0.1', autovacuum_analyze_scale_factor='0.05');


--
-- Name: research_session_phase4; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_session_phase4 (
    session_id uuid NOT NULL,
    phase4_synthesis jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)
WITH (toast_tuple_target='128', fillfactor='70', autovacuum_vacuum_scale_factor='0.05', autovacuum_analyze_scale_factor='0.02', autovacuum_vacuum_cost_delay='2');


--
-- Name: research_session_phase_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_session_phase_data (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    phase smallint NOT NULL,
    raw_data jsonb,
    summary jsonb,
    citations jsonb DEFAULT '[]'::jsonb,
    dataforseo_data jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT research_session_phase_data_phase_check CHECK (((phase >= 1) AND (phase <= 3)))
)
WITH (toast_tuple_target='128');


--
-- Name: research_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    business_name text NOT NULL,
    industry text NOT NULL,
    services text,
    location text NOT NULL,
    search_radius integer DEFAULT 25,
    target_audience text,
    unique_selling_points text,
    contact_email text,
    project_type text DEFAULT 'Website'::text,
    brand_colors text,
    current_phase integer DEFAULT 1,
    status text DEFAULT 'in_progress'::text,
    phase1_raw jsonb,
    phase1_summary jsonb,
    phase2_raw jsonb,
    phase2_summary jsonb,
    phase3_raw jsonb,
    phase3_summary jsonb,
    phase4_synthesis jsonb,
    phase5_blueprint jsonb,
    total_generation_time integer,
    api_costs jsonb DEFAULT '{}'::jsonb,
    error_log jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    balance_errors jsonb[] DEFAULT ARRAY[]::jsonb[],
    phase1_citations jsonb DEFAULT '[]'::jsonb,
    phase2_citations jsonb DEFAULT '[]'::jsonb,
    phase3_citations jsonb DEFAULT '[]'::jsonb,
    business_type text,
    primary_service text,
    city text,
    state text,
    phone_number text,
    street_address text,
    zip_code text,
    operating_hours text,
    service_area integer,
    has_brand_colors boolean DEFAULT false,
    brand_colors_array text[],
    years_in_business text,
    license_number text,
    phase1_dataforseo jsonb,
    phase2_dataforseo jsonb,
    phase3_dataforseo jsonb,
    google_business_url text,
    checkpoint_data jsonb DEFAULT '{}'::jsonb,
    error_type text,
    tier text DEFAULT 'basic'::text NOT NULL,
    location_code integer,
    location_name text,
    dataforseo_tasks jsonb DEFAULT '{}'::jsonb,
    seo_audit_data jsonb,
    website_url text,
    primary_service_category text,
    service_area_cities text[] DEFAULT '{}'::text[],
    competitor_domains text[] DEFAULT '{}'::text[],
    target_customer_type text,
    brand_keywords text[] DEFAULT '{}'::text[],
    certifications text[] DEFAULT '{}'::text[],
    has_brand_fonts boolean DEFAULT false,
    brand_fonts_array text[],
    brand_fonts text,
    additional_services text,
    CONSTRAINT research_sessions_tier_check CHECK ((tier = ANY (ARRAY['basic'::text, 'intermediate'::text, 'advanced'::text])))
)
WITH (fillfactor='85', autovacuum_vacuum_scale_factor='0.1', autovacuum_analyze_scale_factor='0.05', autovacuum_vacuum_cost_delay='2');


--
-- Name: security_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    severity text NOT NULL,
    user_id uuid,
    user_email text,
    ip_address inet,
    user_agent text,
    route_path text,
    event_details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: security_events_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.security_events_summary WITH (security_invoker='true') AS
 SELECT event_type,
    severity,
    count(*) AS event_count,
    count(DISTINCT user_id) AS unique_users,
    max(created_at) AS last_occurrence
   FROM public.security_events
  WHERE (created_at > (now() - '7 days'::interval))
  GROUP BY event_type, severity
  ORDER BY (count(*)) DESC;


--
-- Name: session_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_drafts (
    user_id uuid NOT NULL,
    draft jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: terms_and_conditions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.terms_and_conditions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version integer NOT NULL,
    content text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    email text NOT NULL,
    status text DEFAULT 'active'::text,
    highlevel_contact_id text,
    created_at timestamp with time zone DEFAULT now(),
    activated_at timestamp with time zone
);


--
-- Name: user_api_key_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_api_key_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action text NOT NULL,
    ip_address inet,
    user_agent text,
    success boolean DEFAULT true,
    error_message text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    claude_api_key_encrypted text,
    perplexity_api_key_encrypted text,
    gemini_api_key_encrypted text,
    claude_validated boolean DEFAULT false,
    perplexity_validated boolean DEFAULT false,
    gemini_validated boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    tavily_api_key_encrypted text,
    tavily_validated boolean DEFAULT false,
    dataforseo_login_encrypted text,
    dataforseo_password_encrypted text,
    dataforseo_validated boolean DEFAULT false,
    health_status jsonb
);


--
-- Name: user_terms_acceptance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_terms_acceptance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    terms_version integer NOT NULL,
    ip_address text,
    user_agent text,
    accepted_at timestamp with time zone DEFAULT now()
);


--
-- Name: admin_config admin_config_config_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_config
    ADD CONSTRAINT admin_config_config_key_key UNIQUE (config_key);


--
-- Name: admin_config admin_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_config
    ADD CONSTRAINT admin_config_pkey PRIMARY KEY (id);


--
-- Name: context_documents context_documents_doc_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_documents
    ADD CONSTRAINT context_documents_doc_type_key UNIQUE (doc_type);


--
-- Name: context_documents context_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_documents
    ADD CONSTRAINT context_documents_pkey PRIMARY KEY (id);


--
-- Name: dataforseo_async_tasks dataforseo_async_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataforseo_async_tasks
    ADD CONSTRAINT dataforseo_async_tasks_pkey PRIMARY KEY (id);


--
-- Name: dataforseo_async_tasks dataforseo_async_tasks_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataforseo_async_tasks
    ADD CONSTRAINT dataforseo_async_tasks_task_id_key UNIQUE (task_id);


--
-- Name: dataforseo_cache dataforseo_cache_cache_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataforseo_cache
    ADD CONSTRAINT dataforseo_cache_cache_key_key UNIQUE (cache_key);


--
-- Name: dataforseo_cache dataforseo_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataforseo_cache
    ADD CONSTRAINT dataforseo_cache_pkey PRIMARY KEY (id);


--
-- Name: phase4_prompts phase4_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phase4_prompts
    ADD CONSTRAINT phase4_prompts_pkey PRIMARY KEY (id);


--
-- Name: phase4_prompts phase4_prompts_subphase_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phase4_prompts
    ADD CONSTRAINT phase4_prompts_subphase_unique UNIQUE (subphase);


--
-- Name: research_prompts research_prompts_phase_order_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_prompts
    ADD CONSTRAINT research_prompts_phase_order_index_key UNIQUE (phase, order_index);


--
-- Name: research_prompts research_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_prompts
    ADD CONSTRAINT research_prompts_pkey PRIMARY KEY (id);


--
-- Name: research_results research_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_results
    ADD CONSTRAINT research_results_pkey PRIMARY KEY (id);


--
-- Name: research_session_checkpoints research_session_checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_session_checkpoints
    ADD CONSTRAINT research_session_checkpoints_pkey PRIMARY KEY (session_id);


--
-- Name: research_session_dataforseo research_session_dataforseo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_session_dataforseo
    ADD CONSTRAINT research_session_dataforseo_pkey PRIMARY KEY (session_id);


--
-- Name: research_session_phase4 research_session_phase4_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_session_phase4
    ADD CONSTRAINT research_session_phase4_pkey PRIMARY KEY (session_id);


--
-- Name: research_session_phase_data research_session_phase_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_session_phase_data
    ADD CONSTRAINT research_session_phase_data_pkey PRIMARY KEY (id);


--
-- Name: research_session_phase_data research_session_phase_data_session_id_phase_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_session_phase_data
    ADD CONSTRAINT research_session_phase_data_session_id_phase_key UNIQUE (session_id, phase);


--
-- Name: research_sessions research_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_sessions
    ADD CONSTRAINT research_sessions_pkey PRIMARY KEY (id);


--
-- Name: security_events security_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_pkey PRIMARY KEY (id);


--
-- Name: session_drafts session_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_drafts
    ADD CONSTRAINT session_drafts_pkey PRIMARY KEY (user_id);


--
-- Name: terms_and_conditions terms_and_conditions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terms_and_conditions
    ADD CONSTRAINT terms_and_conditions_pkey PRIMARY KEY (id);


--
-- Name: user_access user_access_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_access
    ADD CONSTRAINT user_access_email_key UNIQUE (email);


--
-- Name: user_access user_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_access
    ADD CONSTRAINT user_access_pkey PRIMARY KEY (id);


--
-- Name: user_api_key_audit user_api_key_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_key_audit
    ADD CONSTRAINT user_api_key_audit_pkey PRIMARY KEY (id);


--
-- Name: user_api_keys user_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_pkey PRIMARY KEY (id);


--
-- Name: user_api_keys user_api_keys_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_user_id_key UNIQUE (user_id);


--
-- Name: user_terms_acceptance user_terms_acceptance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_terms_acceptance
    ADD CONSTRAINT user_terms_acceptance_pkey PRIMARY KEY (id);


--
-- Name: user_terms_acceptance user_terms_acceptance_user_id_terms_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_terms_acceptance
    ADD CONSTRAINT user_terms_acceptance_user_id_terms_version_key UNIQUE (user_id, terms_version);


--
-- Name: idx_access_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_email ON public.user_access USING btree (email);


--
-- Name: idx_access_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_user_id ON public.user_access USING btree (user_id);


--
-- Name: idx_admin_config_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_config_key ON public.admin_config USING btree (config_key);


--
-- Name: idx_api_keys_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_keys_user ON public.user_api_keys USING btree (user_id);


--
-- Name: idx_async_tasks_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_async_tasks_session ON public.dataforseo_async_tasks USING btree (session_id);


--
-- Name: idx_async_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_async_tasks_status ON public.dataforseo_async_tasks USING btree (status);


--
-- Name: idx_async_tasks_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_async_tasks_task_id ON public.dataforseo_async_tasks USING btree (task_id);


--
-- Name: idx_audit_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_created_at ON public.user_api_key_audit USING btree (created_at DESC);


--
-- Name: idx_audit_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user_id ON public.user_api_key_audit USING btree (user_id);


--
-- Name: idx_cache_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cache_expires ON public.dataforseo_cache USING btree (expires_at);


--
-- Name: idx_cache_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cache_key ON public.dataforseo_cache USING btree (cache_key);


--
-- Name: idx_checkpoints_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checkpoints_updated ON public.research_session_checkpoints USING btree (updated_at);


--
-- Name: idx_dataforseo_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dataforseo_updated ON public.research_session_dataforseo USING btree (updated_at);


--
-- Name: idx_phase1_citations; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phase1_citations ON public.research_sessions USING gin (phase1_citations);


--
-- Name: idx_phase2_citations; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phase2_citations ON public.research_sessions USING gin (phase2_citations);


--
-- Name: idx_phase3_citations; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phase3_citations ON public.research_sessions USING gin (phase3_citations);


--
-- Name: idx_phase4_prompts_subphase_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phase4_prompts_subphase_order ON public.phase4_prompts USING btree (subphase, order_index);


--
-- Name: idx_phase4_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phase4_updated ON public.research_session_phase4 USING btree (updated_at);


--
-- Name: idx_phase_data_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phase_data_session ON public.research_session_phase_data USING btree (session_id);


--
-- Name: idx_phase_data_session_phase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phase_data_session_phase ON public.research_session_phase_data USING btree (session_id, phase);


--
-- Name: idx_research_citations; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_citations ON public.research_results USING gin (citations);


--
-- Name: idx_research_prompts_phase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_prompts_phase ON public.research_prompts USING btree (phase);


--
-- Name: idx_research_prompts_phase_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_prompts_phase_order ON public.research_prompts USING btree (phase, order_index);


--
-- Name: idx_research_prompts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_prompts_status ON public.research_prompts USING btree (status);


--
-- Name: idx_research_sessions_balance_errors; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_sessions_balance_errors ON public.research_sessions USING gin (balance_errors) WHERE (array_length(balance_errors, 1) > 0);


--
-- Name: idx_research_sessions_checkpoint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_sessions_checkpoint ON public.research_sessions USING gin (checkpoint_data) WHERE ((checkpoint_data IS NOT NULL) AND (checkpoint_data <> '{}'::jsonb));


--
-- Name: idx_research_sessions_completed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_sessions_completed ON public.research_sessions USING btree (completed_at DESC) WHERE (completed_at IS NOT NULL);


--
-- Name: idx_research_sessions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_sessions_created_at ON public.research_sessions USING btree (created_at DESC);


--
-- Name: idx_research_sessions_error_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_sessions_error_type ON public.research_sessions USING btree (error_type) WHERE (error_type IS NOT NULL);


--
-- Name: idx_research_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_sessions_status ON public.research_sessions USING btree (status);


--
-- Name: idx_research_sessions_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_sessions_user_created ON public.research_sessions USING btree (user_id, created_at DESC);


--
-- Name: idx_results_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_results_session ON public.research_results USING btree (session_id);


--
-- Name: idx_results_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_results_user ON public.research_results USING btree (user_id);


--
-- Name: idx_security_events_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_events_created_at ON public.security_events USING btree (created_at DESC);


--
-- Name: idx_security_events_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_events_event_type ON public.security_events USING btree (event_type);


--
-- Name: idx_security_events_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_events_severity ON public.security_events USING btree (severity);


--
-- Name: idx_security_events_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_events_user_id ON public.security_events USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_sessions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_active ON public.research_sessions USING btree (user_id, created_at DESC) WHERE (status <> ALL (ARRAY['completed'::text, 'cancelled'::text]));


--
-- Name: idx_sessions_business_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_business_type ON public.research_sessions USING btree (business_type);


--
-- Name: idx_sessions_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_city ON public.research_sessions USING btree (city);


--
-- Name: idx_sessions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_created ON public.research_sessions USING btree (created_at DESC);


--
-- Name: idx_sessions_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_state ON public.research_sessions USING btree (state);


--
-- Name: idx_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_status ON public.research_sessions USING btree (status);


--
-- Name: idx_sessions_status_poll; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_status_poll ON public.research_sessions USING btree (id) INCLUDE (user_id, current_phase, status);


--
-- Name: idx_sessions_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_tier ON public.research_sessions USING btree (tier);


--
-- Name: idx_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user ON public.research_sessions USING btree (user_id);


--
-- Name: idx_terms_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_terms_is_active ON public.terms_and_conditions USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_terms_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_terms_version ON public.terms_and_conditions USING btree (version);


--
-- Name: idx_user_terms_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_terms_user_id ON public.user_terms_acceptance USING btree (user_id);


--
-- Name: idx_user_terms_user_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_terms_user_version ON public.user_terms_acceptance USING btree (user_id, terms_version);


--
-- Name: idx_user_terms_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_terms_version ON public.user_terms_acceptance USING btree (terms_version);


--
-- Name: session_drafts session_drafts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER session_drafts_updated_at BEFORE UPDATE ON public.session_drafts FOR EACH ROW EXECUTE FUNCTION public.session_drafts_set_updated_at();


--
-- Name: admin_config admin_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_config
    ADD CONSTRAINT admin_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: context_documents context_documents_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_documents
    ADD CONSTRAINT context_documents_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: dataforseo_async_tasks dataforseo_async_tasks_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataforseo_async_tasks
    ADD CONSTRAINT dataforseo_async_tasks_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.research_sessions(id) ON DELETE CASCADE;


--
-- Name: phase4_prompts phase4_prompts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phase4_prompts
    ADD CONSTRAINT phase4_prompts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: research_prompts research_prompts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_prompts
    ADD CONSTRAINT research_prompts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: research_results research_results_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_results
    ADD CONSTRAINT research_results_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.research_sessions(id);


--
-- Name: research_results research_results_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_results
    ADD CONSTRAINT research_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: research_session_checkpoints research_session_checkpoints_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_session_checkpoints
    ADD CONSTRAINT research_session_checkpoints_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.research_sessions(id) ON DELETE CASCADE;


--
-- Name: research_session_dataforseo research_session_dataforseo_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_session_dataforseo
    ADD CONSTRAINT research_session_dataforseo_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.research_sessions(id) ON DELETE CASCADE;


--
-- Name: research_session_phase4 research_session_phase4_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_session_phase4
    ADD CONSTRAINT research_session_phase4_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.research_sessions(id) ON DELETE CASCADE;


--
-- Name: research_session_phase_data research_session_phase_data_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_session_phase_data
    ADD CONSTRAINT research_session_phase_data_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.research_sessions(id) ON DELETE CASCADE;


--
-- Name: research_sessions research_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_sessions
    ADD CONSTRAINT research_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: security_events security_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: session_drafts session_drafts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_drafts
    ADD CONSTRAINT session_drafts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: terms_and_conditions terms_and_conditions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terms_and_conditions
    ADD CONSTRAINT terms_and_conditions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: user_access user_access_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_access
    ADD CONSTRAINT user_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_api_key_audit user_api_key_audit_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_key_audit
    ADD CONSTRAINT user_api_key_audit_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_api_keys user_api_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_terms_acceptance user_terms_acceptance_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_terms_acceptance
    ADD CONSTRAINT user_terms_acceptance_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: admin_config Admins can delete config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete config" ON public.admin_config FOR DELETE USING (public.is_admin_user());


--
-- Name: phase4_prompts Admins can delete phase4 prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete phase4 prompts" ON public.phase4_prompts FOR DELETE TO authenticated USING (((auth.jwt() ->> 'email'::text) IN ( SELECT jsonb_array_elements_text(admin_config.config_value) AS jsonb_array_elements_text
   FROM public.admin_config
  WHERE (admin_config.config_key = 'admin_emails'::text))));


--
-- Name: research_prompts Admins can delete prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete prompts" ON public.research_prompts FOR DELETE TO authenticated USING (((auth.jwt() ->> 'email'::text) IN ( SELECT jsonb_array_elements_text(admin_config.config_value) AS jsonb_array_elements_text
   FROM public.admin_config
  WHERE (admin_config.config_key = 'admin_emails'::text))));


--
-- Name: admin_config Admins can insert config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert config" ON public.admin_config FOR INSERT WITH CHECK (public.is_admin_user());


--
-- Name: phase4_prompts Admins can insert phase4 prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert phase4 prompts" ON public.phase4_prompts FOR INSERT TO authenticated WITH CHECK (((auth.jwt() ->> 'email'::text) IN ( SELECT jsonb_array_elements_text(admin_config.config_value) AS jsonb_array_elements_text
   FROM public.admin_config
  WHERE (admin_config.config_key = 'admin_emails'::text))));


--
-- Name: research_prompts Admins can insert prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert prompts" ON public.research_prompts FOR INSERT TO authenticated WITH CHECK (((auth.jwt() ->> 'email'::text) IN ( SELECT jsonb_array_elements_text(admin_config.config_value) AS jsonb_array_elements_text
   FROM public.admin_config
  WHERE (admin_config.config_key = 'admin_emails'::text))));


--
-- Name: security_events Admins can read security events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read security events" ON public.security_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.admin_config
  WHERE ((admin_config.config_key = 'admin_emails'::text) AND (admin_config.config_value @> to_jsonb((auth.jwt() ->> 'email'::text)))))));


--
-- Name: admin_config Admins can update config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update config" ON public.admin_config FOR UPDATE USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());


--
-- Name: phase4_prompts Admins can update phase4 prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update phase4 prompts" ON public.phase4_prompts FOR UPDATE TO authenticated USING (((auth.jwt() ->> 'email'::text) IN ( SELECT jsonb_array_elements_text(admin_config.config_value) AS jsonb_array_elements_text
   FROM public.admin_config
  WHERE (admin_config.config_key = 'admin_emails'::text)))) WITH CHECK (((auth.jwt() ->> 'email'::text) IN ( SELECT jsonb_array_elements_text(admin_config.config_value) AS jsonb_array_elements_text
   FROM public.admin_config
  WHERE (admin_config.config_key = 'admin_emails'::text))));


--
-- Name: research_prompts Admins can update prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update prompts" ON public.research_prompts FOR UPDATE TO authenticated USING (((auth.jwt() ->> 'email'::text) IN ( SELECT jsonb_array_elements_text(admin_config.config_value) AS jsonb_array_elements_text
   FROM public.admin_config
  WHERE (admin_config.config_key = 'admin_emails'::text)))) WITH CHECK (((auth.jwt() ->> 'email'::text) IN ( SELECT jsonb_array_elements_text(admin_config.config_value) AS jsonb_array_elements_text
   FROM public.admin_config
  WHERE (admin_config.config_key = 'admin_emails'::text))));


--
-- Name: research_prompts Admins can view all prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all prompts" ON public.research_prompts FOR SELECT TO authenticated USING (((auth.jwt() ->> 'email'::text) IN ( SELECT jsonb_array_elements_text(admin_config.config_value) AS jsonb_array_elements_text
   FROM public.admin_config
  WHERE (admin_config.config_key = 'admin_emails'::text))));


--
-- Name: phase4_prompts Admins can view phase4 prompts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view phase4 prompts" ON public.phase4_prompts FOR SELECT TO authenticated USING (((auth.jwt() ->> 'email'::text) IN ( SELECT jsonb_array_elements_text(admin_config.config_value) AS jsonb_array_elements_text
   FROM public.admin_config
  WHERE (admin_config.config_key = 'admin_emails'::text))));


--
-- Name: terms_and_conditions Anyone can read active terms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read active terms" ON public.terms_and_conditions FOR SELECT USING ((is_active = true));


--
-- Name: admin_config Anyone can view admin config; Type: POLICY; Schema: public; Owner: -
--

-- Settings and prompts are readable by the app; the admin email list is only visible to admins.
CREATE POLICY "Anyone can view admin config" ON public.admin_config FOR SELECT USING (((config_key <> 'admin_emails'::text) OR public.is_admin_user()));


--
-- Name: context_documents Anyone can view context documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view context documents" ON public.context_documents FOR SELECT USING (true);


--
-- Name: terms_and_conditions Authenticated users can read all terms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can read all terms" ON public.terms_and_conditions FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: user_terms_acceptance Service role can insert acceptance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert acceptance" ON public.user_terms_acceptance FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: user_api_key_audit Service role can insert audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert audit logs" ON public.user_api_key_audit FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: security_events Service role can insert security events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert security events" ON public.security_events FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: user_terms_acceptance Service role can manage acceptance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage acceptance" ON public.user_terms_acceptance TO service_role USING (true);


--
-- Name: terms_and_conditions Service role can manage terms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage terms" ON public.terms_and_conditions TO service_role USING (true) WITH CHECK (true);


--
-- Name: user_terms_acceptance Service role can read all acceptance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can read all acceptance" ON public.user_terms_acceptance FOR SELECT TO service_role USING (true);


--
-- Name: user_api_key_audit Service role can read audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can read audit logs" ON public.user_api_key_audit FOR SELECT TO service_role USING (true);


--
-- Name: user_access Service role can update user_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can update user_access" ON public.user_access FOR UPDATE TO service_role USING (true) WITH CHECK (true);


--
-- Name: dataforseo_async_tasks Service role full access on async tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access on async tasks" ON public.dataforseo_async_tasks TO service_role USING (true) WITH CHECK (true);


--
-- Name: dataforseo_cache Service role full access on cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access on cache" ON public.dataforseo_cache TO service_role USING (true) WITH CHECK (true);


--
-- Name: research_session_checkpoints Service role full access on checkpoints; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access on checkpoints" ON public.research_session_checkpoints TO service_role USING (true) WITH CHECK (true);


--
-- Name: research_session_dataforseo Service role full access on dataforseo; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access on dataforseo" ON public.research_session_dataforseo TO service_role USING (true) WITH CHECK (true);


--
-- Name: research_session_phase4 Service role full access on phase4; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access on phase4" ON public.research_session_phase4 TO service_role USING (true) WITH CHECK (true);


--
-- Name: research_session_phase_data Service role full access on phase_data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access on phase_data" ON public.research_session_phase_data TO service_role USING (true) WITH CHECK (true);


--
-- Name: user_terms_acceptance Users can accept terms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can accept terms" ON public.user_terms_acceptance FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: session_drafts Users can delete own draft; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own draft" ON public.session_drafts FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: user_api_keys Users can insert own API keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own API keys" ON public.user_api_keys FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: session_drafts Users can insert own draft; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own draft" ON public.session_drafts FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: research_results Users can insert own research results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own research results" ON public.research_results FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: research_sessions Users can insert own sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own sessions" ON public.research_sessions FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_api_keys Users can update own API keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own API keys" ON public.user_api_keys FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: user_access Users can update own access by email; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own access by email" ON public.user_access FOR UPDATE USING ((auth.email() = email)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: session_drafts Users can update own draft; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own draft" ON public.session_drafts FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: research_sessions Users can update own sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own sessions" ON public.research_sessions FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: user_api_keys Users can view own API keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own API keys" ON public.user_api_keys FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_terms_acceptance Users can view own acceptance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own acceptance" ON public.user_terms_acceptance FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_access Users can view own access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own access" ON public.user_access FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: research_session_checkpoints Users can view own checkpoints; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own checkpoints" ON public.research_session_checkpoints FOR SELECT USING ((session_id IN ( SELECT research_sessions.id
   FROM public.research_sessions
  WHERE (research_sessions.user_id = auth.uid()))));


--
-- Name: research_session_dataforseo Users can view own dataforseo; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own dataforseo" ON public.research_session_dataforseo FOR SELECT USING ((session_id IN ( SELECT research_sessions.id
   FROM public.research_sessions
  WHERE (research_sessions.user_id = auth.uid()))));


--
-- Name: session_drafts Users can view own draft; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own draft" ON public.session_drafts FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: research_session_phase4 Users can view own phase4; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own phase4" ON public.research_session_phase4 FOR SELECT USING ((session_id IN ( SELECT research_sessions.id
   FROM public.research_sessions
  WHERE (research_sessions.user_id = auth.uid()))));


--
-- Name: research_session_phase_data Users can view own phase_data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own phase_data" ON public.research_session_phase_data FOR SELECT USING ((session_id IN ( SELECT research_sessions.id
   FROM public.research_sessions
  WHERE (research_sessions.user_id = auth.uid()))));


--
-- Name: research_results Users can view own research results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own research results" ON public.research_results FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: research_sessions Users can view own sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own sessions" ON public.research_sessions FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: admin_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;

--
-- Name: context_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.context_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: dataforseo_async_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dataforseo_async_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: dataforseo_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dataforseo_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: phase4_prompts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.phase4_prompts ENABLE ROW LEVEL SECURITY;

--
-- Name: research_prompts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.research_prompts ENABLE ROW LEVEL SECURITY;

--
-- Name: research_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.research_results ENABLE ROW LEVEL SECURITY;

--
-- Name: research_session_checkpoints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.research_session_checkpoints ENABLE ROW LEVEL SECURITY;

--
-- Name: research_session_dataforseo; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.research_session_dataforseo ENABLE ROW LEVEL SECURITY;

--
-- Name: research_session_phase4; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.research_session_phase4 ENABLE ROW LEVEL SECURITY;

--
-- Name: research_session_phase_data; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.research_session_phase_data ENABLE ROW LEVEL SECURITY;

--
-- Name: research_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.research_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: security_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

--
-- Name: session_drafts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_drafts ENABLE ROW LEVEL SECURITY;

--
-- Name: terms_and_conditions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.terms_and_conditions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_access ENABLE ROW LEVEL SECURITY;

--
-- Name: user_api_key_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_api_key_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: user_api_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: user_terms_acceptance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_terms_acceptance ENABLE ROW LEVEL SECURITY;

--

-- =====================================================================
-- Realtime: lets the progress page update live (it also polls, so this is
-- a nice-to-have). Skipped silently if the publication doesn't exist.
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'research_sessions') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.research_sessions;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'research_session_phase4') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.research_session_phase4;
    END IF;
  END IF;
END $$;


-- =====================================================================
-- Default configuration and prompts
-- (all editable later in the Admin Panel)
-- =====================================================================

-- admin_config: 23 rows
INSERT INTO public.admin_config (config_key, config_value, description) VALUES ($q$admin_emails$q$, $q$[]$q$::jsonb, $q$List of admin email addresses$q$);
INSERT INTO public.admin_config (config_key, config_value, description) VALUES ($q$announcement_banner$q$, $q${"enabled":false,"message":""}$q$::jsonb, $q$Global announcement banner displayed at the top of all pages for all users$q$);
INSERT INTO public.admin_config (config_key, config_value, description) VALUES ($q$context_conversion_optimization$q$, $q${"title":"Conversion Optimization Principles","content":"# Conversion Optimization Best Practices\n\n## Key Principles\n\n1. **Clear Value Proposition**\n   - Above the fold messaging\n   - Benefits over features\n   - Unique selling points prominent\n\n2. **Trust Signals**\n   - Social proof (testimonials, reviews)\n   - Trust badges and certifications\n   - Case studies and results\n\n3. **Friction Reduction**\n   - Minimal form fields\n   - Clear CTAs\n   - Fast load times\n   - Mobile optimization\n\n4. **Urgency & Scarcity**\n   - Limited time offers\n   - Stock indicators\n   - Countdown timers (when genuine)\n\n5. **Visual Hierarchy**\n   - F-pattern or Z-pattern layouts\n   - Whitespace for breathing room\n   - Contrasting CTA buttons\n\n## Conversion Rate Benchmarks\n- Landing pages: 2-5% average\n- E-commerce: 1-3% average\n- SaaS: 3-7% average\n\n## Testing Framework\n- A/B test one element at a time\n- Statistical significance required\n- Test headlines, CTAs, images, forms"}$q$::jsonb, $q$Conversion optimization principles for AI to reference$q$);
INSERT INTO public.admin_config (config_key, config_value, description) VALUES ($q$context_seo_principles$q$, $q${"title":"SEO Best Practices","content":"# SEO Principles & Best Practices\n\n## Technical SEO\n\n1. **Site Structure**\n   - Clean URL structure\n   - XML sitemap\n   - Robots.txt properly configured\n   - HTTPS enabled\n\n2. **Page Speed**\n   - Core Web Vitals optimization\n   - Image optimization (WebP, lazy loading)\n   - Minified CSS/JS\n   - CDN usage\n\n3. **Mobile-First**\n   - Responsive design\n   - Mobile-friendly navigation\n   - Touch-friendly buttons\n\n## On-Page SEO\n\n1. **Content Optimization**\n   - Target keyword in H1\n   - Keyword in first 100 words\n   - Natural keyword density (1-2%)\n   - Long-form content (1500+ words for competitive keywords)\n\n2. **Meta Tags**\n   - Title tag: 50-60 characters\n   - Meta description: 150-160 characters\n   - Alt text for all images\n   - Schema markup where applicable\n\n3. **Internal Linking**\n   - Logical site hierarchy\n   - Descriptive anchor text\n   - Link to important pages from homepage\n\n## Content Strategy\n\n1. **Keyword Research**\n   - Target long-tail keywords\n   - Search intent matching\n   - Competitor gap analysis\n\n2. **Content Types**\n   - Blog posts for informational queries\n   - Service pages for commercial intent\n   - Landing pages for transactional queries\n\n## Local SEO (if applicable)\n- Google Business Profile optimization\n- NAP consistency\n- Local citations\n- Location-specific content\n\n## Link Building\n- Quality over quantity\n- Relevant, authoritative sources\n- Natural anchor text distribution"}$q$::jsonb, $q$SEO principles for AI to reference$q$);
INSERT INTO public.admin_config (config_key, config_value, description) VALUES ($q$global_tavily_params$q$, $q${"time_range":"","max_results":20,"search_depth":"advanced","include_answer":true,"include_images":false,"include_raw_content":true}$q$::jsonb, $q$Global Tavily search parameters for all research prompts$q$);
INSERT INTO public.admin_config (config_key, config_value, description) VALUES ($q$phase1_dataforseo_params$q$, $q${"enabled":true,"language_code":"en","location_code":2840,"gmb_search_depth":20,"local_pack_keywords":3}$q$::jsonb, NULL);
INSERT INTO public.admin_config (config_key, config_value, description) VALUES ($q$phase1_tavily_params$q$, $q${"topic":"general","time_range":"","max_results":50,"search_depth":"advanced","include_answer":true,"include_images":false,"exclude_domains":[],"include_domains":[],"include_raw_content":true}$q$::jsonb, $q$Tavily search parameters for Phase 1: Competitive Research$q$);
INSERT INTO public.admin_config (config_key, config_value, description) VALUES ($q$phase2_dataforseo_params$q$, $q${"enabled":true,"language_code":"en","location_code":2840,"max_serp_competitors":5,"keyword_suggestion_limit":50,"keyword_enrichment_batch_size":100,"max_ranked_keywords_per_competitor":100}$q$::jsonb, NULL);
INSERT INTO public.admin_config (config_key, config_value, description) VALUES ($q$phase2_tavily_params$q$, $q${"topic":"general","time_range":"","max_results":50,"search_depth":"advanced","include_answer":true,"include_images":false,"exclude_domains":[],"include_domains":[],"include_raw_content":true}$q$::jsonb, $q$Tavily search parameters for Phase 2: Keyword & SEO Research$q$);
INSERT INTO public.admin_config (config_key, config_value, description) VALUES ($q$phase3_dataforseo_params$q$, $q${"enabled":true,"load_resources":false,"max_crawl_pages":10,"max_urls_to_audit":3,"enable_javascript_rendering":false}$q$::jsonb, NULL);
INSERT INTO public.admin_config (config_key, config_value, description) VALUES ($q$phase3_tavily_params$q$, $q${"topic":"general","time_range":"","max_results":50,"search_depth":"advanced","include_answer":true,"include_images":false,"exclude_domains":[],"include_domains":[],"include_raw_content":true}$q$::jsonb, $q$Tavily search parameters for Phase 3: Industry Benchmarks Research$q$);
INSERT INTO public.admin_config (config_key, config_value, description) VALUES ($q$seed_expansion_prompt$q$, $q$"You are an expert local SEO keyword strategist. Your job is to generate a comprehensive, intent-classified seed keyword list for a local service business. You will produce between 500 and 1,000 unique keyword phrases, organized by intent tier.\nEvery keyword you generate must follow the LOCAL SEO KEYWORD PHILOSOPHY and GENERATION RULES defined below. Do not deviate from this system.\nCRITICAL: Your entire response must be a single valid JSON object. No markdown, no explanation, no text before or after the JSON. Start your response with { and end it with }. If you need to include notes or recommendations, put them inside the summary key of the JSON object.\n\nBUSINESS PROFILE\nBusiness Name: {{business_name}}\nBusiness Type: {{business_type}}\nIndustry: {{industry}}\nPrimary Service: {{primary_service}}\nAll Services Offered: {{services}}\nPrimary City: {{city}}\nState: {{state}}\nZIP Code: {{zip_code}}\nStreet Address: {{street_address}}\nService Area Radius: {{service_area}} miles\nService Area Cities: {{service_area_cities}}\nTarget Audience: {{target_audience}}\nCustomer Type: {{target_customer_type}}\nUnique Selling Points: {{unique_selling_points}}\nCertifications/Credentials: {{certifications}}\nYears in Business: {{years_in_business}}\nLicense Number: {{license_number}}\nBrands Serviced/Carried: {{brand_keywords}}\nOperating Hours: {{operating_hours}}\nCompetitors: {{competitor_domains}}\nPackage Tier: {{tier}}\n\nDYNAMIC GENERATION RULES\nCustomer type logic:\n\nIf {{target_customer_type}} = \"residential\" → generate ONLY residential keywords. Skip all commercial, industrial, and business-focused keywords.\nIf {{target_customer_type}} = \"commercial\" → generate ONLY commercial keywords. Skip residential and homeowner keywords.\nIf {{target_customer_type}} = \"both\" → generate BOTH residential and commercial keywords. Weight residential higher unless the business profile suggests otherwise.\n\nService area logic:\n\nGenerate location-modified keywords for EVERY city listed in the Service Area Cities field above.\nGenerate additional keywords for the Primary City + State as the primary location.\nIf Service Area Radius = \"Statewide\" → focus on major metro areas within the state rather than trying to list every city. Generate region-level and \"near me\" keywords more heavily.\nIf Service Area Radius ≤ 25 miles → also generate neighborhood-level keywords for the Primary City.\nIf Service Area Radius ≥ 50 miles → generate county-level and regional keywords in addition to city-level.\n\nOperating hours logic:\n\nIf Operating Hours contains \"24/7\" or \"emergency\" or \"after hours\" → generate FULL Tier 1 emergency/urgency keywords.\nIf Operating Hours indicates standard business hours only (e.g., \"Monday-Friday 8AM-5PM\") → STILL generate Tier 1 keywords but add \"OPPORTUNITY\" to the service field for those keywords to flag that the business does not currently offer this service window.\nIf Operating Hours mentions weekend availability → generate weekend-specific keywords (\"open Saturday,\" \"Sunday [service]\").\n\nBrand keywords logic:\n\nIf Brands Serviced/Carried is populated → generate brand + equipment + service + location keywords for EVERY brand listed across the Primary City and top 3 Service Area Cities.\nIf Brands Serviced/Carried is empty or \"N/A\" → skip brand-specific keywords entirely.\n\nCredentials logic:\n\nIf Certifications/Credentials includes specific credentials → incorporate them as modifier keywords (e.g., \"NATE certified HVAC technician [city],\" \"BBB accredited plumber [city]\").\nIf Years in Business ≥ 10 → include experience-based keywords (\"experienced [service] [city],\" \"established [service] [city]\").\n\nTier/package logic:\n\nIf Package Tier = \"basic\" → generate 300–500 keywords. Focus on Tiers 1, 2, and 4 (emergency, comparison, core service + location). Lighter coverage of Tiers 3, 5, 6, 7.\nIf Package Tier = \"intermediate\" → generate 500–750 keywords. Full coverage of all tiers.\nIf Package Tier = \"advanced\" → generate 750–1,000+ keywords. Maximum coverage including all brand keywords, all neighborhood keywords, full question/research keyword set, and competitor-differentiation keywords.\n\n\nLOCAL SEO KEYWORD PHILOSOPHY\nFollow these principles for every keyword you generate:\n1. Intent tier determines priority, not search volume.\nA keyword with 30 monthly searches where the searcher is ready to call is worth more than a keyword with 3,000 searches from people just browsing. Always classify keywords by intent tier:\n\nTIER 1 — EMERGENCY/IMMEDIATE (converts 12–20%): Searcher is in crisis. Needs someone NOW.\nTIER 2 — COMPARISON/SELECTION (converts 8–15%): Searcher has decided to hire. Picking who.\nTIER 3 — COST/PRICING (converts 5–12%): Searcher is serious. Gathering quotes, comparing costs.\nTIER 4 — CORE SERVICE + LOCATION (converts 6–15%): Foundational head terms. Broadest local commercial intent.\nTIER 5 — PROBLEM/SYMPTOM-AWARE (converts 1–5%): Searcher has a problem, may not know what service they need yet.\nTIER 6 — RESEARCH/EDUCATION (converts 1–5%): Searcher will buy but is doing due diligence first.\nTIER 7 — LONG-TAIL/SPECIALTY (variable): Niche combinations — brand + equipment + location, audience-specific, method-specific.\n\n2. Location multiplication is mandatory.\nEvery strong keyword formula must be generated across ALL service area cities, not just the primary city.\n3. Modifier stacking creates long-tail gold.\nCombine multiple modifier types: urgency + problem + location, quality + service + location, problem + action + location. Always generate stacked variants, not just single-modifier keywords.\n4. Problem keywords are an untapped goldmine.\nGenerate symptom-based and problem-based keywords. Think like the customer experiencing the problem, not the trade professional diagnosing it.\n5. Every keyword must pass these validation rules:\n\nHas local intent (contains a location, \"near me,\" or triggers Google's local pack)\nSignals buying or hiring intent (not DIY, not job seekers, not students)\nIs something a real person would actually type into Google\nMaps to a service the business actually offers\nDoes not duplicate the intent of another keyword in the list\n\n6. Exclude these keyword types entirely:\n\nDIY keywords (\"how to fix it yourself,\" \"DIY [service]\")\nEmployment keywords (\"jobs,\" \"salary,\" \"career,\" \"hiring\")\nEducation/training keywords (\"certification,\" \"school,\" \"course,\" \"apprenticeship\")\nWholesale/supply keywords (\"wholesale,\" \"parts supplier,\" \"equipment for sale\")\nSoftware/tool keywords (\"software,\" \"app,\" \"CRM\")\nKeywords with \"free\" alone (without \"estimate,\" \"quote,\" or \"consultation\")\n\n\nKEYWORD FORMULA LIBRARY\nUse these proven formulas as your generation engine. Apply each relevant formula using the services from the business profile, multiplied across all locations.\nTIER 1 — EMERGENCY/IMMEDIATE FORMULAS:\nemergency + [service] + [city], emergency + [service] + near me, 24 hour + [service] + [city], 24/7 + [service] + [city], same day + [service] + [city], [service] + open now + near me, [service] + available today + [city], [service] + after hours + [city], urgent + [service] + near me, [service] + on weekends + [city], [service] + open Sunday + near me, late night + [service] + [city], need + [service] + now + [city], emergency + [specific problem] + repair + [city]\nTIER 2 — COMPARISON/SELECTION FORMULAS:\nbest + [service] + in + [city], best + [service] + near me, top rated + [service] + [city], [service] + reviews + [city], most trusted + [service] + [city], #1 + [service] + in + [city], recommended + [service] + [city], reliable + [service] + near me, professional + [service] + [city], licensed + [service] + [city], certified + [service] + [city], [service] + with good reviews + near me, 5 star + [service] + [city], [service] + companies in + [city], [service] + near me + reviews, best + [service] + [city] + reddit, [service] + recommendations + [city]\nTIER 3 — COST/PRICING FORMULAS:\n[service] + cost + [city], how much does + [service] + cost in + [city], affordable + [service] + [city], cheap + [service] + near me, [service] + free estimate + [city], [service] + free quote + [city], [service] + pricing + [city], [service] + rates + [city], average cost of + [service] + [city], low cost + [service] + near me, how much do + [professionals] + charge in + [city], [service] + financing + [city], [service] + payment plan + [city], [specific sub-service] + cost + [city]\nTIER 4 — CORE SERVICE + LOCATION FORMULAS:\n[service] + [city], [city] + [service], [service] + in + [city], [service] + [city] + [state], [service] + [neighborhood], local + [service] + [city], [city] + [service] + company, [service] + [direction] + [city], [service] + near me, [service] + [county], [service] + [region/metro name], [professional title] + [city], [service] + contractor + [city], [service] + company + [city], [service] + provider + [city]\nTIER 5 — PROBLEM/SYMPTOM FORMULAS:\n[problem] + repair + [city], [equipment] + not working + [city], fix + [problem] + [city], [symptom] + [service] + near me, [thing] + broken + [city], [thing] + replacement + [city], [thing] + making noise + [city], [thing] + won't turn on + [city], [thing] + leaking + [city], [damage type] + restoration + [city], [thing] + backed up + [city], no + [expected result] + [city] + [professional], [thing] + running constantly + [city], [thing] + won't stop + [city]\nTIER 6 — RESEARCH/QUESTION FORMULAS:\nhow much does + [service] + cost + [city], how to choose a + [professional] + in + [city], what to look for in a + [professional], questions to ask + [professional] + before hiring, do I need + [service], when should I + [service action], is + [service] + worth it, signs you need + [service], [option A] vs [option B], should I repair or replace + [thing], what to expect from + [service], how long does + [service] + take, what does + [service] + include, how often should I + [maintenance action], what causes + [problem], why is my + [thing] + [symptom]\nTIER 7 — LONG-TAIL/SPECIALTY FORMULAS:\nresidential + [service] + [city], commercial + [service] + [city], [brand] + [equipment] + repair + [city], [brand] + [equipment] + installation + [city], [material/method] + [service] + [city], [audience] + [service] + [city], [service] + for + [property type] + [city], hire + [professional] + in + [city], book + [service] + [city], schedule + [service] + [city], get + [service] + quote + [city], [service] + that offers financing + [city], [credential] + [professional] + [city], [service] + [specific method/technology] + [city]\n\nMODIFIER REFERENCE LISTS\nPick the most relevant modifiers for this business type and industry.\nUrgency: emergency, urgent, same day, 24 hour, 24/7, now, today, immediate, ASAP, quick, fast, rush, last minute, after hours, weekend, overnight, rapid, express, open now, late night, early morning, holiday, Sunday, Saturday, on-call, next available, walk-in\nQuality/Trust: best, top, top rated, highest rated, #1, trusted, reliable, professional, certified, licensed, insured, bonded, experienced, expert, specialist, recommended, award-winning, 5-star, reputable, premier, established, accredited, qualified, vetted, guaranteed, master, family-owned, locally owned\nValue/Price: affordable, cheap, budget, low cost, discount, free estimate, free quote, free consultation, best price, competitive pricing, reasonable, pricing, rates, fees, cost, how much, payment plan, financing, upfront pricing, flat rate, no hidden fees, fair price, cost-effective, specials\nAction: hire, book, schedule, call, get, find, request, need, looking for, contact, appointment, consultation, estimate, quote, inspection, get a quote, request estimate, arrange, reserve\nProblem/Need: repair, fix, broken, not working, replacement, replace, issue, problem, help, troubleshoot, inspect, maintain, maintenance, restore, resolve, install, installation, removal, cleanup, upgrade, remodel, renovate, unclog, leak, damage, burst, backed up, flooded, cracked, failed, worn out, noisy, overheating, won't turn on, won't stop, making noise\nComparison: reviews, ratings, testimonials, recommendations, vs, compare, which is better, pros and cons, alternatives, top 10, reddit, options\nAudience/Context: residential, commercial, industrial, home, office, apartment, condo, townhouse, new construction, historic home, mobile home, rental property, multi-family, senior, family, eco-friendly, energy-efficient, luxury, custom, small business\nCredential: licensed, certified, insured, bonded, BBB accredited, background checked, family-owned, veteran-owned, woman-owned, locally owned, factory authorized, EPA certified, NATE certified, master, fully insured, years experience, established\nSeasonal/Timing: spring, summer, fall, winter, pre-season, end-of-season, seasonal, annual, before winter, winterize, spring cleaning, this week, this weekend\n\nGENERATION PROCESS\nPHASE 1: Build the service term matrix.\nParse the comma-separated services list and primary service into individual service terms. For each, determine the core keyword, professional title variant, company variant, and sub-service breakdowns.\nPHASE 2: Build the location matrix.\nParse the service area cities into individual cities. Build the complete location list including: primary city, primary city + state, each service area city, \"near me,\" county and region names. Add neighborhoods if radius ≤ 25 miles, major metros if statewide.\nPHASE 3: Generate keywords tier by tier.\nFor each tier, select relevant formulas, fill them with service terms, multiply across locations, add stacked modifier variants, and prune duplicates.\nPHASE 4: Generate problem/symptom keywords.\nBased on the business type, industry, and services, brainstorm every common problem and symptom that drives customers to search. Think from the target audience's perspective.\nPHASE 5: Generate question keywords.\nGenerate research-intent keywords specific to this business's services and locations.\nPHASE 6: Generate specialty/long-tail keywords.\nUsing brand keywords, certifications, customer type, and method specifics, generate niche long-tail keywords.\nPHASE 7: Final validation pass.\nRemove any keywords that lack local intent, target DIY/jobs/students, don't map to offered services, or duplicate another keyword's intent.\n\nVOLUME TARGETS BY TIER\nScale based on Package Tier:\n\nTier | Basic (300–500) | Intermediate (500–750) | Advanced (750–1,000+)\nTier 1 — Emergency | 20–30 | 40–60 | 60–100\nTier 2 — Comparison | 25–40 | 50–80 | 80–120\nTier 3 — Cost/Pricing | 20–30 | 40–60 | 60–100\nTier 4 — Core + Location | 60–100 | 100–180 | 150–250\nTier 5 — Problem/Symptom | 30–50 | 60–100 | 100–150\nTier 6 — Research | 15–25 | 35–55 | 50–80\nTier 7 — Specialty | 15–25 | 40–60 | 60–100\n\nScaling multipliers:\nFor every service area city beyond the first 3, add ~30–50 keywords distributed across tiers.\nFor every service beyond the first 3, add ~20–40 keywords distributed across tiers.\nIf brand keywords has 3+ brands, add ~20–40 Tier 7 keywords.\n\n\nOUTPUT FORMAT — JSON ONLY\nYour entire response must be a single valid JSON object. No text before or after. No markdown code fences. Start with { and end with }.\nUse this exact structure:\n{\n\"report_metadata\": {\n\"business_name\": \"{{business_name}}\",\n\"primary_city\": \"{{city}}\",\n\"state\": \"{{state}}\",\n\"service_area_radius\": \"{{service_area}}\",\n\"service_area_cities\": [\"city1\", \"city2\", \"...\"],\n\"customer_type\": \"{{target_customer_type}}\",\n\"package_tier\": \"{{tier}}\",\n\"total_keywords\": 0\n},\n\"tier_1_emergency\": [\n{\n\"keyword\": \"emergency plumbing tampa\",\n\"location\": \"Tampa\",\n\"service\": \"Emergency Plumbing\"\n}\n],\n\"tier_2_comparison\": [\n{\n\"keyword\": \"best plumber in tampa\",\n\"location\": \"Tampa\",\n\"service\": \"General Plumbing\"\n}\n],\n\"tier_3_pricing\": [\n{\n\"keyword\": \"plumbing cost tampa\",\n\"location\": \"Tampa\",\n\"service\": \"General Plumbing\"\n}\n],\n\"tier_4_core\": [\n{\n\"keyword\": \"plumber tampa fl\",\n\"location\": \"Tampa\",\n\"service\": \"General Plumbing\"\n}\n],\n\"tier_5_problem\": [\n{\n\"keyword\": \"water heater not working tampa\",\n\"location\": \"Tampa\",\n\"service\": \"Water Heater Repair\"\n}\n],\n\"tier_6_research\": [\n{\n\"keyword\": \"how much does a plumber cost in tampa\",\n\"location\": \"Tampa\",\n\"service\": \"General Plumbing\"\n}\n],\n\"tier_7_specialty\": [\n{\n\"keyword\": \"rheem water heater repair tampa\",\n\"location\": \"Tampa\",\n\"service\": \"Water Heater Repair\"\n}\n],\n\"summary\": {\n\"keyword_counts\": {\n\"tier_1_emergency\": 0,\n\"tier_2_comparison\": 0,\n\"tier_3_pricing\": 0,\n\"tier_4_core\": 0,\n\"tier_5_problem\": 0,\n\"tier_6_research\": 0,\n\"tier_7_specialty\": 0,\n\"total\": 0\n},\n\"top_20_priority_keywords\": [\n\"keyword1\",\n\"keyword2\"\n],\n\"recommended_pages\": [\n\"Emergency [Service] landing page targeting Tier 1 keywords\",\n\"[Service] + [City] service pages for each service area city\"\n],\n\"industry_notes\": \"Seasonal patterns, unique search behaviors, etc.\",\n\"blog_topics\": [\n\"Topic derived from Tier 6 keyword 1\",\n\"Topic derived from Tier 6 keyword 2\"\n],\n\"credential_differentiation\": \"How to leverage certifications and years in business for SEO\"\n}\n}\nRules for the JSON output:\n\nEvery keyword string must be lowercase\nThe \"location\" field must be the specific city or \"Near Me\" for near-me variants\nThe \"service\" field must match one of the services from the All Services Offered list, or use the Primary Service as fallback. If the keyword targets the business broadly (not a specific sub-service), use the Primary Service value. If the operating hours do NOT support a keyword (e.g., emergency keywords when hours are M-F 9-5), append \" [OPPORTUNITY]\" to the service value to flag it.\nThe \"total_keywords\" in report_metadata must equal the actual count of all keywords across all tiers\nThe keyword_counts in summary must accurately reflect the count of items in each tier array\nDo not include any duplicate keywords across tiers. Each keyword appears in exactly one tier.\nDo not wrap the JSON in markdown code fences or backticks. Raw JSON only.\n\n\nCRITICAL REMINDERS\n\nRESPOND WITH ONLY JSON. No markdown. No explanation. No code fences. Just the JSON object.\nDO NOT skip location multiplication. Generate \"[service] [city]\" for EVERY service area city, not just the primary city.\nDO NOT generate keywords for services not listed in the business profile. Stay within what the business actually offers.\nDO include professional title variations. \"[business_type] [city]\" and \"[service] contractor [city]\" and \"[service] company [city]\" are different keywords.\nDO stack modifiers for long-tail opportunities. 5–6 word keyword phrases are fine and often convert highest.\nDO think like the target audience, not the business owner. Use customer language for problems and symptoms, not trade terminology.\nDO generate brand + equipment + location keywords for every brand listed, across the primary city and top 3 service area cities.\nDO include \"near me\" variants for every core formula.\nDO generate neighborhood-level keywords for the primary city when service area radius ≤ 25 miles.\nDO incorporate unique selling points into Tier 2 and Tier 7 keywords where they create natural search terms (e.g., \"financing available\" → \"[service] financing [city]\"; \"family-owned\" → \"family-owned [service] [city]\").\nDO reference operating hours to determine whether emergency/after-hours keywords are confirmed services vs. expansion opportunities flagged with [OPPORTUNITY].\n\nNow generate the complete keyword list as a JSON object based on the business profile provided above."$q$::jsonb, $q$Claude v2 prompt for generating 300-1000 intent-classified, location-multiplied keywords in 7 tiers (emergency, comparison, pricing, core+location, problem/symptom, research, specialty). Includes full keyword formula library, modifier reference lists, 7-phase generation process, and tier-aware volume targets (basic 300-500, intermediate 500-750, advanced 750-1000+). Dynamic rules for customer type, operating hours, brands, credentials. JSON output with {keyword, location, service} per entry.$q$);
INSERT INTO public.admin_config (config_key, config_value, description) VALUES ($q$seed_optimizer_prompt$q$, $q$"You are a Google Ads keyword strategist. Given the following business details, generate exactly 20 seed keywords optimized for Google Ads \"keywords for keywords\" API to discover the broadest, most relevant set of paid advertising keyword opportunities.\n\nBUSINESS:\n- Name: {{business_name}}\n- Industry: {{industry}}\n- Location: {{city}}, {{state}}\n- Services: {{services}}\n\nRULES:\n1. Focus on commercial and transactional intent terms (people ready to buy/hire).\n2. Mix broad service terms with specific high-value service terms.\n3. Include location-modified variants for the primary city.\n4. Include \"near me\" variants for the most important services.\n5. Prioritize terms that will yield the most diverse and relevant Google Ads keyword suggestions.\n6. Do NOT include brand names, competitor names, or informational-only terms.\n7. Keep keywords concise (2-4 words each).\n8. Cover the full breadth of services offered — do not over-index on a single service.\n9. Include at least 3-4 \"near me\" variants for the highest-value services.\n10. Include at least 2-3 location-specific variants using the city name.\n\nSTRATEGY:\n- Think about what a potential customer would type into Google when they are ready to hire or purchase.\n- Broad seeds like \"plumber\" will return broad suggestions; specific seeds like \"emergency water heater repair\" will return targeted suggestions.\n- The goal is to get Google to suggest the widest variety of relevant, high-commercial-intent keywords.\n- Balance between broad category terms and specific service terms.\n\nReturn ONLY a JSON array of exactly 20 strings. No explanation, no markdown, no code fences. Start with [ and end with ].\nExample: [\"plumber tampa\", \"emergency plumbing near me\", \"water heater repair tampa\", ...]"$q$::jsonb, $q$Claude prompt for generating 20 optimized seed keywords for Google Ads keywords_for_keywords API. Supports template variables: {{business_name}}, {{industry}}, {{city}}, {{state}}, {{services}}, {{additional_services}}, {{primary_services}}$q$);

-- research_prompts: 20 rows
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (1, 0, $q$Top Competitors & Market Leaders$q$, $q$Find the top-rated and most prominent {{INDUSTRY}} businesses in {{LOCATION}}. Look for business names, their Google review ratings and counts, how long they've been in business, and their overall market positioning.$q$, $q$Targets: Reviews, business listings, local directories, "best of" articles$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (1, 1, $q$Competitor Website Structure & Services$q$, $q$Analyze how successful {{INDUSTRY}} businesses in {{LOCATION}} structure their websites. What services do they feature prominently? How do they organize their service pages? What's their main navigation structure? What specializations do they emphasize?$q$, $q$Targets: Actual website structures, service page organization, navigation patterns$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (1, 2, $q$Positive Customer Themes$q$, $q$What do customers consistently praise in reviews of {{INDUSTRY}} companies in {{LOCATION}}? What specific aspects of service delivery, communication, quality, or experience generate 5-star reviews? What words and phrases appear repeatedly in positive feedback?$q$, $q$Targets: Review content, testimonials, customer feedback themes$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (1, 3, $q$Customer Pain Points & Complaints$q$, $q$What are the most common complaints and frustrations customers have with {{INDUSTRY}} services in {{LOCATION}}? What causes negative reviews? What problems do customers mention repeatedly? What unmet needs are expressed?$q$, $q$Targets: Negative reviews, complaint patterns, Reddit/forum discussions$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (1, 4, $q$Competitor Marketing & Value Propositions$q$, $q$How do successful {{INDUSTRY}} businesses in {{LOCATION}} position themselves? What guarantees, warranties, or promises do they make? What's their unique value proposition? What claims do they make in their hero sections and main headlines?$q$, $q$Targets: Homepage copy, value props, guarantees, marketing angles$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (1, 5, $q$Industry Gaps & Opportunities$q$, $q$What services or needs are {{INDUSTRY}} customers in {{LOCATION}} asking for but struggling to find? What complaints suggest market gaps? What do customers wish existed? Look for forum discussions, Q&A sites, and Reddit posts about {{INDUSTRY}} frustrations.$q$, $q$Targets: Forum posts, Q&A sites, "looking for" discussions$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (2, 0, $q$Target Keywords in Top-Ranking Sites$q$, $q$What keywords and phrases do top-ranking {{INDUSTRY}} websites in {{LOCATION}} use in their page titles, H1 headings, and meta descriptions? What search terms are they clearly targeting? Look at actual title tags and main headlines.$q$, $q$Targets: Actual title tags, H1s, visible keyword targeting$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (2, 1, $q$Local SEO Keyword Patterns$q$, $q$How do successful {{INDUSTRY}} websites optimize for local search in {{LOCATION}}? What city names, neighborhood references, and location modifiers do they use? How do they structure location-based keywords in their content?$q$, $q$Targets: Location page structures, city name usage, local keyword patterns$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (2, 2, $q$Customer Questions & FAQ Content$q$, $q$What questions do customers commonly ask about {{SERVICES}} and {{INDUSTRY}}? Look for "People Also Ask" content, FAQ pages on top-ranking sites, Quora questions, Reddit discussions, and forum posts. What information are people actively seeking?$q$, $q$Targets: FAQ content, Quora/Reddit questions, forum discussions$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (2, 3, $q$Comparison & Decision Content$q$, $q$How do customers compare {{INDUSTRY}} providers? What comparison content exists? What factors do review sites and blogs say customers should consider? What decision-making criteria appear in "how to choose" articles?$q$, $q$Targets: Comparison articles, buyer's guides, review criteria$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (2, 4, $q$Content Structure of Top-Ranking Pages$q$, $q$Analyze the content structure and organization of top-ranking {{INDUSTRY}} pages in {{LOCATION}}. What sections do they include? What's the typical content flow? How long and detailed is the content? What headings and subheadings do they use?$q$, $q$Targets: Page structures, content organization, section patterns$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (2, 5, $q$Schema Markup & Rich Results$q$, $q$What schema markup and structured data do top-ranking {{INDUSTRY}} websites use? Look for articles and documentation about implementing LocalBusiness schema, Service schema, FAQ schema, and review schema for {{INDUSTRY}} sites. What technical SEO best practices are documented?$q$, $q$Targets: Schema examples, technical SEO guides, implementation articles$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (2, 6, $q$Local Landing Page Best Practices$q$, $q$How should {{INDUSTRY}} businesses structure service area and location landing pages? Look for best practices articles, examples, and recommendations for creating location-specific pages that rank well locally.$q$, $q$Targets: Local SEO guides, location page templates, best practices$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (3, 0, $q$Homepage Layouts That Convert$q$, $q$What homepage layouts and structures work best for {{INDUSTRY}} websites? Analyze successful sites: What's in their hero section? How do they structure their value proposition? What content appears above the fold? How is the homepage organized?$q$, $q$Targets: Actual homepage structures, layout patterns, content organization$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (3, 1, $q$Trust Signals & Credibility Markers$q$, $q$What certifications, licenses, badges, and trust signals do successful {{INDUSTRY}} businesses display? Where are they placed? What industry-specific credentials matter? Look at actual websites and industry association requirements.$q$, $q$Targets: Visible trust badges, certification requirements, industry standards$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (3, 2, $q$Service Page Structures & Elements$q$, $q$How do high-converting {{INDUSTRY}} service pages structure their content? What sections do they include? How do they present pricing? What CTAs do they use? Analyze the anatomy of effective service pages.$q$, $q$Targets: Service page templates, content sections, CTA patterns$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (3, 3, $q$Lead Capture Forms & Strategies$q$, $q$What lead capture strategies work for {{INDUSTRY}} businesses targeting {{TARGET_AUDIENCE}}? What types of forms do they use? What fields do they request? What lead magnets do they offer (free quotes, consultations, assessments)? How is the form presented?$q$, $q$Targets: Form examples, lead magnet strategies, conversion tactics$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (3, 4, $q$Mobile Optimization Requirements$q$, $q$What are the critical mobile optimization requirements for {{INDUSTRY}} websites? Look for best practices: click-to-call implementation, mobile form design, mobile page speed, thumb-friendly navigation. What do mobile UX guides recommend?$q$, $q$Targets: Mobile best practice articles, UX guides, implementation tips$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (3, 5, $q$Industry-Specific Conversion Tactics$q$, $q$What conversion tactics are specific to {{INDUSTRY}}? Look for case studies, marketing guides, and best practices. How do {{INDUSTRY}} businesses optimize for emergency services, seasonal demand, financing options, or recurring services?$q$, $q$Targets: Industry-specific guides, case studies, marketing tactics$q$, $q$active$q$, NULL);
INSERT INTO public.research_prompts (phase, order_index, name, prompt_template, internal_notes, status, override_max_results) VALUES (3, 6, $q$Website CRO Best Practices & Testing$q$, $q$What conversion rate optimization tactics have proven successful for {{INDUSTRY}} websites? Look for case studies, A/B testing results, and marketing blogs. What specific changes improved conversions? What CTA copy works? What design patterns convert?$q$, $q$Targets: CRO case studies, testing results, optimization guides$q$, $q$active$q$, NULL);

-- phase4_prompts: 14 rows
INSERT INTO public.phase4_prompts (subphase, order_index, name, prompt_template, internal_notes, status) VALUES ($q$4.1$q$, 1, $q$Competitive Intelligence Synthesis$q$, $q$You are a competitive intelligence analyst. Synthesize the Phase 1 research below into a comprehensive Competitive Intelligence Report.

# Phase 1 Research Data (Tavily Web Research)
{{PHASE1_SOURCES}}

# Business Context
- Industry: {{INDUSTRY}}
- Location: {{LOCATION}}
- Business: {{BUSINESS_NAME}}

# Your Task
Create a detailed report covering:
1. Top competitors and market positioning
2. Competitive advantages and gaps
3. Local pack presence and ranking analysis
4. Market trends and opportunities
5. Key differentiators for {{BUSINESS_NAME}}

Format as a structured report with clear sections and bullet points.$q$, $q$Synthesizes Phase 1 Tavily research only. DataForSEO is not used in 4.1.$q$, $q$active$q$);
INSERT INTO public.phase4_prompts (subphase, order_index, name, prompt_template, internal_notes, status) VALUES ($q$4.2$q$, 1, $q$SEO Strategy Synthesis$q$, $q$You are an SEO strategist. Create a comprehensive SEO & Content Strategy Guide using two clearly separated data sources below. DataForSEO is real live SEO data; Tavily is scraped/web research for strategy and competitor layout only.

# SOURCE 1: Tavily Web Research (scraped / qualitative)
Use for: content structure, what competitors are doing layout-wise, schema and technical patterns, paid/organic strategy, and qualitative context. Do NOT use Tavily for specific keyword volumes, CPC, difficulty, or ranking numbers—Tavily does not provide real keyword metrics.
{{PHASE2_SOURCES}}

{{#if HAS_DATAFORSEO}}
# SOURCE 2: DataForSEO Live Data (real keywords, volumes, CPC, opportunities, local)
Use for: ALL real numbers—search volume, cost-per-click, difficulty, achievability, long-tail keywords, content ideas, ranking opportunities, and local SEO targets. This data is from live SEO tools and must be the PRIMARY basis for keyword recommendations and content priorities.
{{DATAFORSEO_KEYWORD_DATA}}

CRITICAL: Any specific keyword suggestions, volumes, CPC, difficulty scores, or opportunity metrics MUST come from the DataForSEO section above. Never cite or invent numbers from Tavily. Prioritize DataForSEO for real local data and keyword targets; use Tavily only for strategy, structure, and competitor content approach.
{{/if}}

# SEO Context Document
{{SEO_CONTEXT}}

# Business Context
- Industry: {{INDUSTRY}}
- Location: {{LOCATION}}
- Business: {{BUSINESS_NAME}}

# Your Task
Create a detailed guide with clearly separated grounding where helpful:
1. Primary and secondary keywords — use DataForSEO for volumes, CPC, difficulty; cite it explicitly (e.g. "per DataForSEO").
2. Low-hanging fruit and opportunities — from DataForSEO achievability/opportunity data.
3. Content ideas and long-tail targets — from DataForSEO; supplement with Tavily for content structure.
4. Local SEO targets — real local data from DataForSEO; strategy from Tavily.
5. Technical SEO and schema — use Tavily + SEO Context; do not use Tavily for keyword numbers.
6. Content strategy roadmap — keyword targets and metrics from DataForSEO; page structure and competitor layout from Tavily.

Format as a structured guide. Clearly distinguish recommendations based on live data (DataForSEO) vs strategy/web research (Tavily) where it helps the reader.$q$, $q$Two sources: Tavily (strategy/schema/layout), DataForSEO (real keywords, volumes, CPC, local). DataForSEO required for numbers.$q$, $q$active$q$);
INSERT INTO public.phase4_prompts (subphase, order_index, name, prompt_template, internal_notes, status) VALUES ($q$4.3$q$, 1, $q$CRO Strategy Synthesis$q$, $q$You are a conversion optimization expert. Synthesize the Phase 3 research below into a comprehensive Conversion Optimization Guide.

# Phase 3 Research Data
{{PHASE3_SOURCES}}

# CRO Context Document
{{CRO_CONTEXT}}

# Business Context
- Industry: {{INDUSTRY}}
- Location: {{LOCATION}}
- Business: {{BUSINESS_NAME}}

# Your Task
Create a detailed guide covering:
1. Trust signals and social proof
2. Key conversion elements
3. Call-to-action optimization
4. Form and checkout best practices
5. Industry-specific CRO tactics

Format as a structured guide with prioritized recommendations.$q$, $q$Synthesizes all Phase 3 Tavily research into conversion tactics$q$, $q$active$q$);
INSERT INTO public.phase4_prompts (subphase, order_index, name, prompt_template, internal_notes, status) VALUES ($q$4.4$q$, 1, $q$Website Wireframe & Outline$q$, $q$You are an expert website developer and information architect. Using the three comprehensive reports below, create a simple list of all pages needed for this website.

# Competitive Intelligence Report
{{COMPETITIVE_INTELLIGENCE_REPORT}}

# SEO & Content Strategy Guide
{{SEO_STRATEGY_GUIDE}}

# Conversion Optimization Guide
{{CRO_OPTIMIZATION_GUIDE}}

# Business Context
- Name: {{BUSINESS_NAME}}
- Industry: {{INDUSTRY}}
- Location: {{LOCATION}}
- Services: {{SERVICES}}
- Target Audience: {{TARGET_AUDIENCE}}

# Your Task
Create a comprehensive list of all pages this website needs. Consider:

1. **Core Pages**: Home, About, Services, Contact
2. **Service Detail Pages**: One per service if needed (e.g., "Plumbing Services", "Emergency Repairs")
3. **Industry Best Practices**: Additional pages common in {{INDUSTRY}} industry
4. **SEO Landing Pages**: Pages targeting specific keywords from the SEO guide
5. **Conversion Pages**: Pages designed for specific conversion goals from the CRO guide

## Format

Return a simple numbered list with clear, descriptive page names:

### SITE STRUCTURE

1. Homepage
2. About Us
3. Services Overview
4. [Service 1 Name] - Service Detail
5. [Service 2 Name] - Service Detail
6. Contact
7. [Additional pages as needed]

## Guidelines

- Be comprehensive but realistic (most small business websites need 5-15 pages)
- Use clear, descriptive page names (not generic like "Page 1")
- Include service detail pages if the business offers multiple distinct services
- Consider user journey: awareness → consideration → conversion
- Include pages that target important keywords from the SEO guide
- Include pages that support conversion goals from the CRO guide

## Example for a Plumbing Company

1. Homepage
2. About Us
3. Services Overview
4. Emergency Plumbing Services
5. Drain Cleaning Services
6. Water Heater Installation
7. Residential Plumbing
8. Commercial Plumbing
9. Service Areas
10. Contact Us

Return ONLY the numbered list. Do not include page outlines, sections, or detailed descriptions.$q$, $q$Generates simple page list for page-by-page copy and prompt generation with caching$q$, $q$active$q$);
INSERT INTO public.phase4_prompts (subphase, order_index, name, prompt_template, internal_notes, status) VALUES ($q$4.5$q$, 1, $q$UI Design & Color Palette$q$, $q$You are an expert UI/UX designer. Create a design philosophy and visual direction document for the website builder. The goal is to guide an AI (or developer) with principles and intent—NOT with exact pixel values, spacing numbers, or rigid specs. Spacing and layout should adapt to each page's content.

# Wireframe/Outline
{{WIREFRAME_OUTLINE}}

# Business Context
- Name: {{BUSINESS_NAME}}
- Industry: {{INDUSTRY}}
- Location: {{LOCATION}}
- Brand Colors Provided: {{BRAND_COLORS_LIST}}
- Has Brand Colors: {{HAS_BRAND_COLORS}}
- Brand Fonts (if provided): {{BRAND_FONTS_LIST}}

# Your Task
Create a design philosophy and visual system document. Do NOT specify exact spacing (padding/margin values), base units, spacing scales, or fixed font sizes. Do specify:

1. **Color Palette**
   - If brand colors are provided ({{BRAND_COLORS_LIST}}), use them as the foundation and name their roles (e.g. primary, secondary, accent).
   - If no brand colors, suggest a professional direction for {{INDUSTRY}} with hex codes for key roles.
   - Include primary, secondary, accent, background, and text colors with hex codes only.

2. **Typography Philosophy**
   - If brand fonts are provided ({{BRAND_FONTS_LIST}}), describe their roles (e.g. heading vs body) and how to use them for hierarchy and readability.
   - If not, suggest font pairing principles and roles (headings vs body). Do NOT specify exact sizes—describe intent (e.g. "clear hierarchy", "readable body text", "strong H1").

3. **Design Principles (First Principles)**
   - Visual hierarchy: how to establish importance and flow.
   - Consistency: same components should feel related; avoid rigid numbers.
   - Breathing room: spacing should adapt to content; avoid prescribing exact padding/margins.
   - Accessibility: contrast, focus states, semantic structure.
   - Responsive: mobile-first, flexible layouts.

4. **Component Intent (Not Specs)**
   - Buttons: primary CTA should stand out; secondary for less emphasis; describe feel, not dimensions.
   - Forms: clear, accessible, error states visible.
   - Cards/sections: consistent feel across the site; builder decides spacing per context.

5. **Rules for the Builder**
   - Use this document as philosophy and constraints. Adapt spacing and layout to each page so the site looks right for its content.
   - Do not copy exact spacing values from this doc—use judgment per component and page.

Format with clear sections: COLOR PALETTE (hex only), TYPOGRAPHY PHILOSOPHY (roles and intent, no px/rem), DESIGN PRINCIPLES, COMPONENT INTENT, RULES FOR BUILDER.$q$, $q$Design philosophy and brand colors/fonts; no exact spacing or font sizes so builder can adapt per page$q$, $q$active$q$);
INSERT INTO public.phase4_prompts (subphase, order_index, name, prompt_template, internal_notes, status) VALUES ($q$4.6$q$, 1, $q$Website Copy for All Pages$q$, $q$You are an expert copywriter specializing in SEO-optimized, conversion-focused web copy. Write all the copy for every single page in the website.

# Wireframe/Outline
{{WIREFRAME_OUTLINE}}

# UI Design System
{{UI_DESIGN_SYSTEM}}

# Competitive Intelligence Report
{{COMPETITIVE_INTELLIGENCE_REPORT}}

# SEO & Content Strategy Guide
{{SEO_STRATEGY_GUIDE}}

# Conversion Optimization Guide
{{CRO_OPTIMIZATION_GUIDE}}

# Business Context
- Name: {{BUSINESS_NAME}}
- Industry: {{INDUSTRY}}
- Location: {{LOCATION}}
- Services: {{SERVICES}}
- Target Audience: {{TARGET_AUDIENCE}}
- Phone: {{PHONE_NUMBER}}
- Address: {{STREET_ADDRESS}}, {{CITY}}, {{STATE}} {{ZIP_CODE}}
- Email: {{CONTACT_EMAIL}}

# CRITICAL SEO REQUIREMENTS
- Use exact business name: {{BUSINESS_NAME}}
- Use exact address: {{STREET_ADDRESS}}, {{CITY}}, {{STATE}} {{ZIP_CODE}}
- Use exact phone: {{PHONE_NUMBER}}
- NAP (Name, Address, Phone) must be IDENTICAL across ALL pages
- Include location-based keywords naturally in copy
- Optimize for local SEO where appropriate

# Your Task
Write complete, ready-to-use copy for EVERY SINGLE PAGE listed in the wireframe. For each page, include:

1. **Page Title** (SEO-optimized, 50-60 characters)
2. **Meta Description** (compelling, 150-160 characters)
3. **H1 Heading** (clear, keyword-rich)
4. **All Section Headings** (H2, H3, etc.)
5. **Body Copy** for each section (compelling, conversion-focused)
6. **Call-to-Action Text** (action-oriented, specific)
7. **Contact Information** (where appropriate, using exact NAP)

## Format:

### PAGE 1: [Page Name]

**SEO Meta Data**
- Page Title: [Title]
- Meta Description: [Description]

**Page Content**

# [H1 Heading]

## [H2 Section 1 Heading]
[Complete body copy for this section. Make it compelling, SEO-optimized, and conversion-focused. Include specific details about {{BUSINESS_NAME}} and their services.]

## [H2 Section 2 Heading]
[Complete body copy for this section...]

**Call-to-Action**
[Specific CTA text and placement]

**Contact Information**
Phone: {{PHONE_NUMBER}}
Address: {{STREET_ADDRESS}}, {{CITY}}, {{STATE}} {{ZIP_CODE}}
Email: {{CONTACT_EMAIL}}

---

### PAGE 2: [Page Name]
[Repeat format for every page]

---

### CRITICAL REQUIREMENTS
- Write copy for EVERY page in the wireframe - do not skip any
- Ensure NAP consistency: {{BUSINESS_NAME}}, {{STREET_ADDRESS}}, {{CITY}}, {{STATE}} {{ZIP_CODE}}, {{PHONE_NUMBER}}
- Optimize for SEO keywords from the SEO guide
- Include conversion elements from the CRO guide
- Make copy compelling, specific, and action-oriented
- Use the exact contact information provided - no variations
- Include location references naturally for local SEO$q$, $q$Generates all website copy with NAP consistency before creating individual page prompts$q$, $q$active$q$);
INSERT INTO public.phase4_prompts (subphase, order_index, name, prompt_template, internal_notes, status) VALUES ($q$10.1$q$, 1, $q$Keyword Strategy & Prioritization$q$, $q$You are an expert local SEO strategist and data analyst. You have been given comprehensive, real-time keyword research data for a local service business.

Your task: Analyze all data below and produce a comprehensive KEYWORD STRATEGY & PRIORITIZATION document with three priority tiers.

Label every recommendation with one of two tags:
[SITE BUILD] — Will be automatically implemented when the AI builds the site.
[OWNER ACTION] — Requires ongoing human effort after the site launches.

CRITICAL DATA PRIORITY: For keyword metrics (volume, CPC, difficulty, intent), use ONLY the DataForSEO "Full Keyword Universe" data. Tavily research is qualitative context only — do not cite Tavily for metrics.

Every recommendation must trace back to specific data. When using general best-practice knowledge, flag it with: [Best Practice — data not available for this].

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Primary Service:** {{PRIMARY_SERVICE}}
- **All Services:** {{ALL_SERVICES}}
- **Location:** {{LOCATION}}
- **Service Area:** {{SERVICE_AREA}} mile radius
- **Target Audience:** {{TARGET_AUDIENCE}}

---

## DATA INPUTS

### INPUT 1: FULL KEYWORD UNIVERSE (DataForSEO — PRIMARY DATA SOURCE)
{{KEYWORD_UNIVERSE_DATA}}

{{#if SEED_KEYWORDS}}
### INPUT 2: SEED KEYWORD EXPANSION (Claude-generated tier classification)
{{SEED_KEYWORDS}}
{{/if}}

---

## DELIVERABLE: KEYWORD STRATEGY & PRIORITIZATION
[SITE BUILD]

**A. Priority Tier Classification**
Organize all relevant keywords into three tiers. Present each tier as a table:

| Keyword | Monthly Volume | Difficulty | Intent | CPC | Recommended Content Type |

**Priority Tier 1 — Core Targets (Build First)**
High volume + transactional or commercial intent + difficulty under 55.

**Priority Tier 2 — Growth Targets (Build at Launch)**
Secondary services, additional service area cities, comparison searches.

**Priority Tier 3 — Content & Long-Tail (Ongoing Publishing)**
[OWNER ACTION]
Informational, research-phase, and long-tail specialty searches.

**B. Low-Hanging Fruit Keywords**
Keywords meeting ALL criteria: difficulty under 35, volume over 50/month, competitors beatable.

**C. Keywords to Deprioritize**
Difficulty above 70 with national brands in top 3, intent mismatch, zero commercial intent.

**D. Seasonal & Trend Considerations**
Using monthly_trends data: which clusters show seasonality? Peak months? Growing or declining?

**E. Paid Search Signal Analysis**
Highest CPC keywords, keywords with paid ads in SERP, high-CPC lower-difficulty opportunities.

---

## OUTPUT FORMAT
- Use tables for all keyword data and comparisons
- Name specific keywords, numbers, and competitors — no placeholders
- Flag data gaps where recommendations are based on best practice vs data$q$, $q$Keyword-only analysis: 3-tier classification, low-hanging fruit, deprioritization, seasonal trends, paid signals. Variables: KEYWORD_UNIVERSE_DATA, SEED_KEYWORDS$q$, $q$active$q$);
INSERT INTO public.phase4_prompts (subphase, order_index, name, prompt_template, internal_notes, status) VALUES ($q$10.2$q$, 2, $q$Market Position + Competitive Analysis & Gaps$q$, $q$You are a competitive intelligence analyst with access to REAL market data from DataForSEO.

Your task: Produce two integrated deliverables:
1. SECTION 1: MARKET OPPORTUNITY SNAPSHOT — A data-driven picture of this business's current position and potential.
2. SECTION 2: COMPETITIVE ANALYSIS & GAPS — Per-competitor breakdown with specific, actionable gaps to exploit.

Label every recommendation:
[SITE BUILD] — Will be automatically implemented when the AI builds the site.
[OWNER ACTION] — Requires ongoing human effort after the site launches.

CRITICAL: Use REAL numbers from the data. Name specific domains, keywords, volumes, and rankings.

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Service Area:** {{SERVICE_AREA}} mile radius
- **Target Audience:** {{TARGET_AUDIENCE}}
- **Years in Business:** {{YEARS_IN_BUSINESS}}
- **Website:** {{WEBSITE_URL}}
- **Target Customer Type:** {{TARGET_CUSTOMER_TYPE}}

---

## DATA INPUTS

### INPUT 1: KEYWORD STRATEGY (from 10.1)
{{KEYWORD_STRATEGY_OUTPUT}}

### INPUT 2: COMPETITOR PROFILES (DataForSEO — REAL DATA)
{{COMPETITOR_DATA}}

### INPUT 3: SERP ANALYSIS
{{SERP_DATA}}

### INPUT 4: REVIEW ANALYTICS
{{REVIEW_DATA}}

### INPUT 5: GOOGLE BUSINESS PROFILE
{{GBP_DATA}}

### INPUT 6: DOMAIN INTELLIGENCE
{{DOMAIN_INTELLIGENCE_DATA}}

### INPUT 7: SEO READINESS SCORES
{{SCORING_DATA}}

{{#if COMPETITOR_TECH_DATA}}
### INPUT 8: COMPETITOR TECHNICAL AUDIT
{{COMPETITOR_TECH_DATA}}
{{/if}}

{{#if BACKLINK_DATA}}
### INPUT 9: BACKLINK PROFILE (Advanced Tier)
{{BACKLINK_DATA}}
{{/if}}

### INPUT 10: QUALITATIVE COMPETITIVE RESEARCH (Tavily — context only)
{{PHASE1_SOURCES}}

---

## DELIVERABLE

### SECTION 1: MARKET OPPORTUNITY SNAPSHOT

**1A. Total Keyword Opportunity**
- Total keywords in universe and total addressable monthly traffic
- Breakdown by intent: transactional vs commercial vs informational vs navigational (with volumes)
- Realistic organic traffic capture estimate at 90 days
- Realistic organic traffic capture estimate at 6 months

**1B. Market Competitiveness (Rate 1–10)**
Justify using: average keyword difficulty, competitor domain authority distribution, local pack saturation, whether national brands dominate SERPs.

**1C. Current Business Position**
- Overall SEO readiness score and what it means in plain language
- Current organic traffic and keywords ranking
- GBP completeness score and the specific gaps hurting local pack visibility
- Review position vs competitor average (rating + count)
- Technical baseline: is the current site helping or hurting rankings?

**1D. Biggest Immediate Opportunity**
The single highest-leverage move available right now. Name the specific keyword cluster, content gap, GBP field, or technical fix. Back it with data.

**1E. Top Competitive Threats**
2–3 competitors most likely to block this business from ranking. For each: why they are dangerous.

---

### SECTION 2: COMPETITIVE ANALYSIS & GAPS

For each major competitor (top 5–8):
- Authority & Traffic, SERP Dominance, Local Pack Position
- Content Advantage, Technical Strengths & Weaknesses, GBP Weaknesses

**Cross-Competitor Summary**

**Top Keyword Gaps:**
| Keyword | Volume | Difficulty | Ranking Competitor | Their Position | Opportunity |

**Top Content Gaps:** 5–8 specific areas with rationale.

**Backlink Gap Opportunities:** [OWNER ACTION]
Domains linking to competitors but not this business.

---

## OUTPUT FORMAT
- Tables for keyword gaps and competitor comparisons
- Every claim backed by specific data from the inputs$q$, $q$Market opportunity snapshot (1A-1E) + per-competitor breakdown, keyword/content/backlink gaps. Variables: KEYWORD_STRATEGY_OUTPUT, COMPETITOR_DATA, SERP_DATA, REVIEW_DATA, GBP_DATA, DOMAIN_INTELLIGENCE_DATA, SCORING_DATA, COMPETITOR_TECH_DATA, BACKLINK_DATA, PHASE1_SOURCES$q$, $q$active$q$);
INSERT INTO public.phase4_prompts (subphase, order_index, name, prompt_template, internal_notes, status) VALUES ($q$10.3$q$, 3, $q$Content Strategy & Blog Calendar$q$, $q$You are an expert SEO content strategist.

Your task: Using the keyword strategy and competitive analysis from prior sub-phases, produce a comprehensive CONTENT STRATEGY with a 12-month blog calendar.

Label every recommendation:
[SITE BUILD] — Will be automatically implemented when the AI builds the site.
[OWNER ACTION] — Requires ongoing human effort after the site launches.

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Services:** {{ALL_SERVICES}}
- **Service Area Cities:** {{SERVICE_AREA_CITIES}}
- **Target Audience:** {{TARGET_AUDIENCE}}

---

## DATA INPUTS

### INPUT 1: KEYWORD STRATEGY (from 10.1)
{{KEYWORD_STRATEGY_OUTPUT}}

### INPUT 2: COMPETITIVE ANALYSIS (from 10.2)
{{COMPETITIVE_ANALYSIS_OUTPUT}}

### INPUT 3: SERP ANALYSIS (PAA, Related Searches, Autocomplete)
{{SERP_DATA}}

{{#if CITY_SERP_DATA}}
### INPUT 4: PER-CITY SERP DATA
{{CITY_SERP_DATA}}
{{/if}}

### INPUT 5: DOMAIN INTELLIGENCE
{{DOMAIN_INTELLIGENCE_DATA}}

### INPUT 6: REVIEW ANALYTICS
{{REVIEW_DATA}}

### INPUT 7: SEO & CONTENT RESEARCH (Tavily — qualitative only)
{{PHASE2_SOURCES}}

### INPUT 8: SEO BEST PRACTICES
{{SEO_CONTEXT}}

{{#if SEED_KEYWORDS}}
### INPUT 9: SEED KEYWORD DATA
{{SEED_KEYWORDS}}
{{/if}}

---

## DELIVERABLE: CONTENT STRATEGY & BLOG CALENDAR

**A. Topic Cluster Architecture** [SITE BUILD]
Map keyword tiers to content hubs. Define pillar pages and supporting content.

**B. People Also Ask & FAQ Strategy**
Extract PAA questions from SERP data. Map to pages and blog posts.

**C. Location & Service Area Content** [SITE BUILD]
Per-city landing page strategy. Service area content targeting.

**D. 12-Month Blog & Long-Tail Content Calendar** [OWNER ACTION]
Monthly publishing plan with target keywords, topics, and content types.

**E. Credential & Differentiation Content** [SITE BUILD]
Unique selling points, trust signals, and brand story content.

---

## OUTPUT FORMAT
- Tables for all keyword and competitor data
- Specific keywords, numbers, competitors throughout$q$, $q$Topic clusters, location content, 12-month blog calendar. Variables: KEYWORD_STRATEGY_OUTPUT, COMPETITIVE_ANALYSIS_OUTPUT, SERP_DATA, CITY_SERP_DATA, DOMAIN_INTELLIGENCE_DATA, REVIEW_DATA, PHASE2_SOURCES, SEO_CONTEXT, SEED_KEYWORDS$q$, $q$active$q$);
INSERT INTO public.phase4_prompts (subphase, order_index, name, prompt_template, internal_notes, status) VALUES ($q$10.4$q$, 4, $q$CRO Optimization Guide$q$, $q$You are a conversion rate optimization (CRO) specialist with deep expertise in local service business websites.

Your task: Produce a comprehensive CRO OPTIMIZATION GUIDE with data-backed recommendations for maximizing conversions.

Label every recommendation:
[SITE BUILD] — Will be automatically implemented when the AI builds the site.
[OWNER ACTION] — Requires ongoing human effort after the site launches.

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Target Audience:** {{TARGET_AUDIENCE}}
- **Target Customer Type:** {{TARGET_CUSTOMER_TYPE}}

---

## DATA INPUTS

### INPUT 1: COMPETITIVE ANALYSIS (from 10.2)
{{COMPETITIVE_ANALYSIS_OUTPUT}}

### INPUT 2: CRO & CONVERSION RESEARCH (Tavily — qualitative)
{{PHASE3_SOURCES}}

### INPUT 3: REVIEW ANALYTICS
{{REVIEW_DATA}}

### INPUT 4: DOMAIN INTELLIGENCE
{{DOMAIN_INTELLIGENCE_DATA}}

### INPUT 5: CRO BEST PRACTICES
{{CRO_CONTEXT}}

---

## DELIVERABLE: CRO OPTIMIZATION GUIDE

### 1. Trust Signal Strategy
[SITE BUILD]
- Review/testimonial placement strategy (informed by actual review data)
- Social proof elements (badges, certifications, affiliations)
- Before/after galleries, case studies
- Trust indicators above the fold
- Local trust signals (community involvement, local partnerships)

### 2. Conversion Element Strategy
[SITE BUILD]
- Primary CTA design and placement per page type
- Phone number prominence and click-to-call optimization
- Form design: fields, placement, multi-step vs single
- Chat/messaging integration recommendations
- Urgency and scarcity tactics appropriate for the industry
- Exit intent and scroll-triggered elements

### 3. Page Performance Targets
[SITE BUILD]
- Content length benchmarks per page type (based on competitor analysis)
- Heading structure and keyword density targets
- Image and media requirements
- Above-the-fold content priorities
- Mobile-specific conversion considerations

### 4. Industry-Specific CRO Tactics
[SITE BUILD] + [OWNER ACTION]
- Tactics unique to {{INDUSTRY}} that drive conversions
- Seasonal conversion optimization
- Service-specific landing page recommendations
- Local competitor conversion weaknesses to exploit

---

## OUTPUT FORMAT
- Prioritized recommendations with expected impact (high/medium/low)
- Specific, actionable items — no generic advice
- Reference competitor data and review insights throughout$q$, $q$Trust signals, conversion elements, page performance targets, industry-specific CRO. Variables: COMPETITIVE_ANALYSIS_OUTPUT, PHASE3_SOURCES, REVIEW_DATA, DOMAIN_INTELLIGENCE_DATA, CRO_CONTEXT$q$, $q$active$q$);
INSERT INTO public.phase4_prompts (subphase, order_index, name, prompt_template, internal_notes, status) VALUES ($q$10.5$q$, 5, $q$Off-Page Roadmap & Benchmarks$q$, $q$You are a local SEO implementation specialist creating a post-launch action plan.

Your task: Using the strategic analysis from prior sub-phases, produce:
1. SECTION 6: 90-DAY OFF-PAGE ROADMAP — Everything the business owner must do after the site launches.
2. SECTION 7: SEO SUCCESS BENCHMARKS — Specific, data-grounded targets for 30/60/90 days.

EVERYTHING in Section 6 is [OWNER ACTION] — requires human effort or third-party tools.

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Phone:** {{PHONE_NUMBER}}
- **Email:** {{CONTACT_EMAIL}}

{{NAP_BLOCK}}

---

## STRATEGIC CONTEXT (from prior analyses)

### Keyword Strategy Summary
{{KEYWORD_STRATEGY_OUTPUT}}

### Competitive Analysis Summary
{{COMPETITIVE_ANALYSIS_OUTPUT}}

### Content Strategy Summary
{{CONTENT_STRATEGY_OUTPUT}}

### CRO Guide Summary
{{CRO_GUIDE_OUTPUT}}

---

## DATA INPUTS
### GBP DATA
{{GBP_DATA}}

### REVIEW ANALYTICS
{{REVIEW_DATA}}

### DOMAIN INTELLIGENCE
{{DOMAIN_INTELLIGENCE_DATA}}

### SEO READINESS SCORES
{{SCORING_DATA}}

{{#if BACKLINK_DATA}}
### BACKLINK PROFILE (Advanced Tier)
{{BACKLINK_DATA}}
{{/if}}

{{#if QA_DATA}}
### Google Q&A Data
{{QA_DATA}}
{{/if}}

---

## DELIVERABLE

### SECTION 6: 90-DAY OFF-PAGE ROADMAP [OWNER ACTION]
Week 1–2: GBP Foundation, Month 1: Review Momentum & Citation Base, Month 2: Authority & Content Publishing, Month 3: Competitive Push

### SECTION 7: SEO SUCCESS BENCHMARKS
At 30 Days, At 60 Days, At 90 Days — keyword targets, traffic projections, GBP visibility, revenue potential model

---

## OUTPUT FORMAT
- Tables for all benchmarks and keyword targets
- Specific numbers throughout
- Flag projections as conservative vs optimistic$q$, $q$90-day GBP/citation/review/backlink plan + success targets. Variables: KEYWORD_STRATEGY_OUTPUT, COMPETITIVE_ANALYSIS_OUTPUT, CONTENT_STRATEGY_OUTPUT, CRO_GUIDE_OUTPUT, GBP_DATA, REVIEW_DATA, DOMAIN_INTELLIGENCE_DATA, SCORING_DATA, BACKLINK_DATA, NAP_BLOCK, QA_DATA$q$, $q$active$q$);
INSERT INTO public.phase4_prompts (subphase, order_index, name, prompt_template, internal_notes, status) VALUES ($q$10.6$q$, 6, $q$Site Architecture + SEO Specs + Linking + Technical SEO$q$, $q$You are a senior SEO architect creating the complete site structure for a local service business.

Your task: Using the strategic analysis from all prior sub-phases, produce a unified site architecture document containing:
1. Complete URL hierarchy (sitemap)
2. Per-page SEO specifications
3. Internal linking map
4. Technical SEO analysis and implementation plan

Every page, URL, keyword assignment, meta tag, and link must be defined here.

{{NAP_BLOCK}}

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Primary Service:** {{PRIMARY_SERVICE}}
- **Services:** {{ALL_SERVICES}}
- **Service Area Cities:** {{SERVICE_AREA_CITIES}}
- **Website:** {{WEBSITE_URL}}

---

## STRATEGIC CONTEXT (from analyses 10.1–10.5)

### Keyword Strategy
{{KEYWORD_STRATEGY_OUTPUT}}

### Competitive Analysis
{{COMPETITIVE_ANALYSIS_OUTPUT}}

### Content Strategy
{{CONTENT_STRATEGY_OUTPUT}}

### CRO Guide
{{CRO_GUIDE_OUTPUT}}

### Off-Page Roadmap
{{OFFPAGE_OUTPUT}}

---

## DATA INPUTS

### TECHNICAL SEO AUDIT
{{TECHNICAL_DATA}}

### SEO AUDIT DATA
{{AUDIT_DATA}}

### SEO & CONTENT RESEARCH (Tavily — qualitative only)
{{PHASE2_SOURCES}}

### SEO BEST PRACTICES
{{SEO_CONTEXT}}

### SCHEMA MARKUP TEMPLATES
{{SCHEMA_TEMPLATES}}

---

## DELIVERABLE: SITE ARCHITECTURE DOCUMENT

### PART 1: URL HIERARCHY & SITEMAP
| # | Page Name | URL Path | Page Type | Primary Keyword | Content Priority |

### PART 2: PER-PAGE SEO SPECIFICATIONS
For EVERY page: Primary Keyword, Secondary Keywords, Title Tag, Meta Description, H1, Schema Markup, Content Requirements, CTA Strategy

### PART 3: INTERNAL LINKING MAP
Page-by-Page Links, Cross-Linking Rules, Link Equity Distribution, Anchor Text Strategy, Navigation Structure

### PART 4: TECHNICAL SEO ANALYSIS
[SITE BUILD]
- Critical Issues (Must Fix)
- High-Priority Warnings
- Schema Gap Analysis
- Technical Competitive Gap
- Page Speed & Core Web Vitals targets
- Crawlability & indexation recommendations$q$, $q$URL hierarchy, per-page SEO specs, internal linking map, technical SEO analysis. Variables: KEYWORD_STRATEGY_OUTPUT, COMPETITIVE_ANALYSIS_OUTPUT, CONTENT_STRATEGY_OUTPUT, CRO_GUIDE_OUTPUT, OFFPAGE_OUTPUT, TECHNICAL_DATA, AUDIT_DATA, PHASE2_SOURCES, SEO_CONTEXT, SCHEMA_TEMPLATES, NAP_BLOCK$q$, $q$active$q$);
INSERT INTO public.phase4_prompts (subphase, order_index, name, prompt_template, internal_notes, status) VALUES ($q$10.7$q$, 7, $q$UI Design & Styling Direction$q$, $q$You are an expert UI/UX designer and brand strategist. Your job is to determine the right design direction for this business's website.

This is NOT a component library or pixel-level spec. This is a strategic design direction document.

---

## BUSINESS CONTEXT
- **Business Name:** {{BUSINESS_NAME}}
- **Industry:** {{INDUSTRY}}
- **Location:** {{LOCATION}}
- **Target Audience:** {{TARGET_AUDIENCE}}
- **Target Customer Type:** {{TARGET_CUSTOMER_TYPE}}
- **Years in Business:** {{YEARS_IN_BUSINESS}}
- **Brand Colors:** {{BRAND_COLORS_LIST}}
- **Brand Fonts:** {{BRAND_FONTS_LIST}}

---

## STRATEGIC CONTEXT
### Keyword Intent Breakdown
{{INTENT_BREAKDOWN}}

### Review Sentiment
{{REVIEW_DATA}}

### Competitive Landscape
{{COMPETITIVE_ANALYSIS_OUTPUT}}

### CRO Guide
{{CRO_GUIDE_OUTPUT}}

### Site Architecture
{{SITE_ARCHITECTURE_OUTPUT}}

---

## DESIGN ARCHETYPE LIBRARY (Reference)

Select ONE primary archetype or blend TWO. Justify your choice.

**1. Clean Minimal** — Generous whitespace, restrained color, typography-driven. Best for: professional services, higher-income clientele.
**2. Bold & Action-Oriented** — High contrast, prominent CTAs, urgency-friendly. Best for: emergency services, high-intent mobile traffic.
**3. Warm & Community** — Rounded corners, friendly palette, real photography. Best for: family-owned businesses, trust-first brands.
**4. Premium / Luxury** — Refined typography, muted palette, elegant spacing. Best for: high-end services, custom builders, med spas.
**5. Modern Professional** — Contemporary grids, bold geometry, data-driven trust signals. Best for: commercial/B2B services.
**6. Tech-Forward** — Gradients, glass morphism, dark sections. Best for: IT, smart home, solar, tech-adjacent trades.
**7. Traditional / Established** — Classic layouts, conservative palette, serif typography. Best for: legal, accounting, 20+ year trades.

**Theme Axis:** Light / Dark / Hybrid
**Density Axis:** Spacious / Balanced / Information-Rich

---

## DELIVERABLE: UI DESIGN & STYLING DIRECTION

1. Design Direction Selection (archetype + theme + density + rationale)
2. Color Palette (hex codes + rationale)
3. Typography Direction (font recommendations + hierarchy approach)
4. Photography & Imagery Direction
5. Conversion Element Treatment (CTA style, forms, phone prominence, trust signals)
6. Design First Principles (5–7 principles specific to THIS site)$q$, $q$Design archetype selection, color palette, typography, first principles. Variables: REVIEW_DATA, COMPETITIVE_ANALYSIS_OUTPUT, CRO_GUIDE_OUTPUT, SITE_ARCHITECTURE_OUTPUT, INTENT_BREAKDOWN, BRAND_COLORS_LIST, BRAND_FONTS_LIST$q$, $q$active$q$);
INSERT INTO public.phase4_prompts (subphase, order_index, name, prompt_template, internal_notes, status) VALUES ($q$10.8$q$, 8, $q$Project Overview$q$, $q$You are an expert technical writer. Create a concise Project Overview document for an AI (Cursor) that will build this website.

# Keyword Strategy & Market Analysis
{{KEYWORD_STRATEGY_OUTPUT}}

# Competitive Analysis
{{COMPETITIVE_ANALYSIS_OUTPUT}}

# Content Strategy
{{CONTENT_STRATEGY_OUTPUT}}

# CRO Guide
{{CRO_GUIDE_OUTPUT}}

# Site Architecture + SEO Specs
{{SITE_ARCHITECTURE_OUTPUT}}

# UI Design & Styling Direction
{{UI_DESIGN_OUTPUT}}

# Business
- Name: {{BUSINESS_NAME}}
- Industry: {{INDUSTRY}}
- Location: {{LOCATION}}

# Your Task
Write a concise **Project Overview** (under 1000 words) that:
1. Summarizes what this site is for and who it serves.
2. Lists the pages to build (from the site architecture).
3. Explains how to use each attached document.
4. States that the builder should follow principles and strategy, not rigid specs.

Format as clear sections.$q$, $q$Concise overview for Cursor AI builder. Variables: KEYWORD_STRATEGY_OUTPUT, COMPETITIVE_ANALYSIS_OUTPUT, CONTENT_STRATEGY_OUTPUT, CRO_GUIDE_OUTPUT, SITE_ARCHITECTURE_OUTPUT, UI_DESIGN_OUTPUT$q$, $q$active$q$);

-- terms_and_conditions: version 1 (edit in Admin Panel -> Terms)
INSERT INTO public.terms_and_conditions (version, content, is_active) VALUES (1, $terms$Terms of Use - Self-Hosted Installation

This copy of the Research Automation Engine is run by the person or business that set it up (the "operator"), on the operator's own hosting and database accounts. Using it means you agree to the points below.

1. Software provided as-is

The software is open source and is provided "as is", without warranty of any kind, under the MIT License included with the code. Nobody guarantees that it is free of bugs, that it will keep working, or that it fits any particular purpose. There is no official support.

2. Your own API keys and costs

Research runs use your own Anthropic (Claude), Tavily and, optionally, DataForSEO API keys. Those providers bill you directly for what you use. Keys are stored encrypted in the operator's database and are only decrypted while a research run is in progress. You are responsible for your keys, your usage limits and your spending with each provider.

3. AI-generated output

Reports are generated by AI from public web data and may be incomplete, out of date or wrong. Check anything important before you rely on it, and make sure your use of the output follows the rules of each data provider and any laws that apply to you.

4. Your data

Your account email, the business details you enter and the generated reports are stored in the operator's database. The operator controls that data and can export or delete it.

5. Changes

The operator can change these terms in the Admin Panel. When they do, you will be asked to accept the new version the next time you use the app.
$terms$, true);

-- Done. Next step: sign in to the app once, then run supabase/add-user.sql.
