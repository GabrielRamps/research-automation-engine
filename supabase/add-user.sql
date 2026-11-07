-- =====================================================================
-- Give someone access to your installation
-- =====================================================================
-- 1. Change the email address on the line marked "EDIT ME" (keep the quotes).
-- 2. Leave make_admin as true for yourself. Use false for anyone else you
--    add later (admins can see the Admin Panel and edit prompts and settings).
-- 3. Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- Safe to run more than once. It works whether or not that person has
-- already tried to sign in.
-- (After you are an admin you can also add people from the app:
--  Admin Panel -> User Management.)
-- =====================================================================

DO $$
DECLARE
  v_email      TEXT    := lower(trim('you@example.com'));   -- EDIT ME
  v_make_admin BOOLEAN := true;
  v_user_id    UUID;
BEGIN
  IF v_email = 'you@example.com' OR v_email NOT LIKE '%@%' THEN
    RAISE EXCEPTION 'Edit the email address at the top of this script first.';
  END IF;

  -- If they've already signed in once, link their login to the access row now.
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = v_email LIMIT 1;

  INSERT INTO public.user_access (email, user_id, status, activated_at)
  VALUES (v_email, v_user_id, 'active', CASE WHEN v_user_id IS NULL THEN NULL ELSE now() END)
  ON CONFLICT (email) DO UPDATE
    SET status       = 'active',
        user_id      = COALESCE(public.user_access.user_id, EXCLUDED.user_id),
        activated_at = COALESCE(public.user_access.activated_at, EXCLUDED.activated_at);

  IF v_make_admin THEN
    INSERT INTO public.admin_config (config_key, config_value, description)
    VALUES ('admin_emails', '[]'::jsonb, 'Email addresses that can open the Admin Panel')
    ON CONFLICT (config_key) DO NOTHING;

    UPDATE public.admin_config
       SET config_value = (
             SELECT COALESCE(jsonb_agg(DISTINCT e ORDER BY e), '[]'::jsonb)
               FROM jsonb_array_elements_text(config_value || to_jsonb(v_email)) AS e
           ),
           updated_at = now()
     WHERE config_key = 'admin_emails';
  END IF;

  RAISE NOTICE 'Access granted to % (admin: %). Signed in already: %',
    v_email, v_make_admin, (v_user_id IS NOT NULL);
END $$;
