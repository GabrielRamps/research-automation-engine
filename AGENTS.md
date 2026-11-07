# AGENTS.md

Instructions for AI coding assistants (Cursor, Codex, Copilot, Claude and others).

**Read `CLAUDE.md` in this folder and follow it.** It has a step-by-step "Setup playbook" for getting this app running for a non-developer, and a project reference for code changes.

The essentials, in case you only read this file:

- If the user wants the app set up, follow the Setup playbook in `CLAUDE.md`. Do the technical steps yourself, and guide the user through the steps only they can do: creating accounts, payments, browser sign-ins and creating API keys.
- Ask before anything that costs money or deletes anything. Never ask for the user's account passwords.
- Put secrets only in `.env.local`, `worker/.env` or the hosting provider's variables. Never commit them or repeat them back.
- Generate `ENCRYPTION_SECRET_KEY`, `ENCRYPTION_SALT` and `WORKER_CALLBACK_SECRET` once, use the same values in the website and the worker, and never change the encryption values after the app is in use.
- Run `supabase/setup.sql` once on a fresh Supabase project, then `supabase/add-user.sql` with the user's email.
