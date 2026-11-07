# CLAUDE.md

Instructions for Claude (and other AI assistants) working in this repository.

This repo is a **self-hosted copy of the Research Automation Engine**: an AI research app for local home service businesses. Most people who open it with you want **help getting their own copy running**, and most of them are not developers.

- If the user wants to **set up, install, deploy or run** the app, or types `/setup`: follow the [Setup playbook](#setup-playbook) below.
- If the user wants to **change or debug the code**: see [Project reference](#project-reference) at the bottom.

`README.md` is the human-readable version of the same setup. Keep what you tell the user consistent with it. Its Troubleshooting table covers the common failures.

---

## How to work with the user

- Assume a non-technical business owner. Use plain language, one step at a time. Say what you're about to do and why in one sentence, then do it.
- Find out early whether they're on **Mac or Windows**, and give commands and click-paths for that system.
- Do every technical step you can do yourself. For steps only the user can do, tell them exactly where to click and what to copy back to you. Then wait for them.
- After each stage, check that it actually worked before moving on (see the "Check" lines below).
- Keep a short running checklist in the chat so the user always knows where they are.

## Ground rules

- **Money:** ask before anything that creates a charge, such as upgrading a plan, buying credits or creating a paid resource. Mention the expected cost first.
- **Sign-ins and passwords belong to the user.** Never ask for their account passwords. When a CLI login opens a browser (Supabase, Railway, Vercel), the user completes it.
- **Secrets the user gives you** (Supabase keys, Upstash URL and token) go straight into `.env.local`, `worker/.env` or the hosting provider's environment variables.
  - Don't repeat them back in chat.
  - Never commit them. `.env*` files are already gitignored, except `.env.example`.
  - Never hard-code them in source files.
- **Generate the three app secrets yourself:** `ENCRYPTION_SECRET_KEY`, `ENCRYPTION_SALT` and `WORKER_CALLBACK_SECRET`. Use random 32-byte hex, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  - Use the same values in the website and the worker.
  - Tell the user to save a copy in a password manager.
  - **Never regenerate or change the two encryption values once the app is in use.** If they change, every API key saved in the app becomes unreadable.
- **The user's research API keys** (Claude, Tavily, DataForSEO) are entered by the user on the app's own Setup page after logging in. You don't need them, and they don't belong in any `.env` file.
- **Don't edit application code to work around setup problems** unless the user asks. Setup failures are almost always one of three things: a wrong or missing environment variable, Supabase's Auth URL settings, or a missed redeploy.
- **Don't delete anything** (projects, databases, files) without asking.
- CLI syntax changes over time. Before relying on a command, check `--help` or the provider's docs, and adapt.

## Who does what

| Only the user can do this | You can usually do this |
|---|---|
| Create accounts: Supabase, Upstash, Railway, Vercel, GitHub (if needed), Anthropic, Tavily, DataForSEO | Check prerequisites (`node -v` 20+, `npm`, `git`) and guide installing Node.js LTS |
| Add payment methods or credits (Railway Hobby, Anthropic credits, DataForSEO top-up) | Generate the three app secrets |
| Finish browser sign-ins that CLIs open | Write `.env.local` and `worker/.env` from `.env.example` and `worker/.env.example` |
| Create API keys in provider dashboards and type them into the app's Setup page | Run the database setup (`supabase/setup.sql`, then `supabase/add-user.sql`) with the Supabase CLI, or guide the user through the SQL Editor |
| Click the magic login link in their email, in the same browser | Fetch the Supabase URL and keys with the Supabase CLI once they're signed in |
| Accept the app's terms page | Install, build and start the app locally |
| | Deploy the worker to Railway and set its variables (Railway CLI) |
| | Deploy the website to Vercel and set its variables (Vercel CLI, or a connected Vercel tool) |
| | Read logs and fix configuration problems |

---

## Setup playbook

### 0. Ask three questions first

1. **Which setup?**
   - **A. Cloud (recommended):** always online, works from any device. Costs about $5/month on Railway, plus Vercel's free Hobby plan. Vercel's Hobby plan is for personal, non-commercial use, so business use needs Vercel Pro ($20/month) or hosting the website on Railway too.
   - **B. Their own computer:** $0 hosting, but it only works while that computer is on and both processes are running.
2. **Mac or Windows?**
3. **Which email address will they log into the app with?** Tell them to sign up for Supabase with that same email. Supabase's built-in email sender only delivers login links to members of the Supabase team, until they set up custom SMTP.

### 1. Prerequisites

- Node.js 20 or newer (`node -v`), npm and git. If Node is missing, have them install the **LTS** version from nodejs.org, then reopen the terminal.
- Confirm you're at the repo root (`package.json`, `worker/` and `supabase/` are present).

### 2. Database and login: Supabase

1. **Create the project.**
   - The user signs up at supabase.com with their login email, then creates a new project on the Free plan, in the region nearest them.
   - Or, with the user's agreement, use the Supabase CLI (`npx supabase login`, then create the project). Generate a strong database password and tell them to save it.
2. **Run `supabase/setup.sql` exactly once on the new, empty project.**
   - **Preferred:** apply it with the Supabase CLI. For example, link the project and push the file as a single migration, or run it with `psql` against the project's connection string.
   - **Fallback:** the user opens **SQL Editor → New query**, pastes the whole file and clicks **Run**. If Supabase warns about destructive operations, it's safe to confirm; the script only creates objects.
   - "Already exists" errors mean it already ran. Don't drop anything to "fix" that.
3. **Grant access with `supabase/add-user.sql`.**
   - Replace `you@example.com` with the user's login email.
   - Keep `v_make_admin := true`.
   - Run it the same way as `setup.sql`.
4. **Collect three values for the settings files.** Get them with the CLI (e.g. the project's API keys command) or from **Project Settings → API Keys** in the dashboard:
   - **Project URL** (`https://<ref>.supabase.co`) → `NEXT_PUBLIC_SUPABASE_URL`
   - **Publishable key** (`sb_publishable_…`, or the legacy `anon` key) → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **Secret key** (`sb_secret_…`, or the legacy `service_role` key) → `SUPABASE_SERVICE_ROLE_KEY`. This key bypasses all security. Keep it server-side only.
5. **Set the Auth URLs** in **Authentication → URL Configuration**. You can do this with the CLI or Management API if one is available and the user is signed in; otherwise guide them through it.
   - **Site URL** = the app's address. Use `http://localhost:3000` until the real one exists.
   - **Redirect URLs** must include `<app address>/**`. Keep `http://localhost:3000/**` if they'll also run it locally.

**Check:** `select config_value from public.admin_config where config_key = 'admin_emails';` returns their email, and `select count(*) from public.research_prompts;` returns more than 0.

### 3. Job queue: Upstash Redis

The user creates a free Redis database at upstash.com, in a region near their hosting. They give you three values:

- the TCP connection string, which must start with `rediss://` → `REDIS_URL`
- the REST URL → `UPSTASH_REDIS_REST_URL`
- the REST token → `UPSTASH_REDIS_REST_TOKEN`

### 4. App secrets

Generate `ENCRYPTION_SECRET_KEY`, `ENCRYPTION_SALT` and `WORKER_CALLBACK_SECRET` (see Ground rules).

### 5B. Run it on their own computer

1. Create `.env.local` from `.env.example`, and `worker/.env` from `worker/.env.example`.
   - Fill in the values from steps 2–4.
   - Set `USE_QUEUE_SYSTEM=true`.
   - Set `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SITE_URL` to `http://localhost:3000`, in both files where they apply.
2. In the repo root, run `npm install` and `npm run build`. In `worker/`, run `npm install` and `npm run build`.
3. Start both processes with `npm start`, in the repo root and in `worker/`. Each one has to keep running.
   - If you're running them yourself, run them in the background.
   - Otherwise give the user two terminal windows' worth of instructions.

**Check:** the worker prints `[Worker] Started (concurrency: 3)`, and http://localhost:3000 shows the login page.

Tell the user how to start it again later: run `npm start` in each folder. After changing any `.env` value, they need to run `npm run build` again first.

### 5A. Put it in the cloud

**Worker (Railway)**

1. The user signs up at railway.com. Mention the Hobby plan (~$5/month) and ask before upgrading.
2. Install or run the Railway CLI. The user completes `railway login` in the browser.
3. Create a project and service, then deploy the `worker/` folder. It has its own `Dockerfile`; deploy from inside `worker/`, or set the service's Root Directory to `worker` if deploying from GitHub.
4. Set these variables on the service:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `REDIS_URL`
   - `ENCRYPTION_SECRET_KEY`
   - `ENCRYPTION_SALT`
   - `WORKER_CALLBACK_SECRET`
   - `NEXT_PUBLIC_SITE_URL`: temporarily `http://localhost:3000`
   - `LOG_LEVEL=warn`
5. No public domain is needed for the worker.

**Check:** the deploy logs show `[Worker] Started (concurrency: 3)`.

**Website (Vercel)**

1. The user signs up at vercel.com. You use the Vercel CLI (`npx vercel login`, completed by the user), or a connected Vercel tool if one is available.
2. Deploy from the **repo root**, not `worker/`. The framework is Next.js.
3. Set the production environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `REDIS_URL`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `USE_QUEUE_SYSTEM=true`
   - `ENCRYPTION_SECRET_KEY`, `ENCRYPTION_SALT` and `WORKER_CALLBACK_SECRET`, identical to the worker's
   - `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SITE_URL`
4. Get the production URL, with no trailing slash. Then:
   - Set `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SITE_URL` to it and **redeploy**. `NEXT_PUBLIC_*` values are baked in at build time.
   - Set the worker's `NEXT_PUBLIC_SITE_URL` to it as well.
   - Update Supabase's Site URL and Redirect URLs (step 2.5).

**Alternative: website on Railway too.** Add a second service from the repo root (no root directory), add the website variables, and generate a domain. Use that domain as the app address.

**Check:** the site loads, and the login page appears.

### 6. First login and first run (mostly the user)

1. The user enters their email on the login page and clicks **Send Magic Link**. They open the email **in the same browser** and click the link.
2. They accept the terms. The default is a short self-hosted, as-is notice that the admin can edit later.
3. On the Setup page they add their own keys:
   - **Claude:** create a key in the Claude Console (platform.claude.com) under **API Keys**, after adding credits under **Billing**. A key with no credits fails validation.
   - **Tavily:** app.tavily.com. The free plan gives 1,000 credits a month, and a run uses about 40.
   - **DataForSEO** (optional, for the Intermediate and Advanced tiers only): use the API login and API password from the DataForSEO dashboard, not their website password. A $50 minimum top-up is required. The Advanced tier needs a balance of $100 or more.
4. Start a **Basic** tier run as a test.
   - If it sits in "queued", the worker isn't running, or `REDIS_URL` doesn't match between the website and the worker.
   - Check the worker logs.

### 7. Wrap up

Give the user a short summary:

- where each piece lives: Supabase, Upstash, Railway/Vercel, or their computer
- the admin panel at `/admin`
- how to add people:
  - run `add-user.sql`, or use Admin → User Management
  - and either invite them to the Supabase team or set up custom SMTP so login emails reach them
- what to save: the encryption values and the database password
- running costs
- that Supabase free projects pause after about a week without use (restore from the dashboard)
- that if Anthropic retires a model, the user sets `CLAUDE_MODEL` / `CLAUDE_FAST_MODEL` to the replacement and redeploys

---

## Environment variables

| Variable | Website | Worker | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | ✓ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | | Publishable or anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | ✓ | Secret or service_role key. Never expose it to the browser. |
| `REDIS_URL` | ✓ | ✓ | Upstash `rediss://…`. Must match in both. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | ✓ | | Rate limiting |
| `USE_QUEUE_SYSTEM` | ✓ | | Must be `true` |
| `ENCRYPTION_SECRET_KEY` (32+ chars) / `ENCRYPTION_SALT` (16+ chars) | ✓ | ✓ | Identical in both. Never change after first use. |
| `WORKER_CALLBACK_SECRET` | ✓ | ✓ | Identical in both |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL` | ✓ | `SITE_URL` only | The app's address, no trailing slash |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | optional | Completion and invite emails. Without a verified domain, Resend only delivers to the account owner. |
| `CLAUDE_MODEL`, `CLAUDE_FAST_MODEL`, `CLAUDE_KEY_CHECK_MODEL` | optional | optional | Model overrides. Defaults: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`. |
| `HIGHLEVEL_WEBHOOK_SECRET` | optional | | Enables `POST /api/provision` for automatic sign-ups |
| `LOG_LEVEL` | | optional | `warn` by default |

---

## Project reference

**Stack:** Next.js 15 (App Router, React 19, TypeScript, Tailwind), Supabase (Postgres, Auth with magic links, Row Level Security), BullMQ on Upstash Redis, and a separate Node worker in `worker/` (built with its own `Dockerfile`).

**Layout**
- `app/`: pages and API routes. `app/api/*` route handlers authenticate with `getAuthenticatedUser()` (`lib/auth-helpers.ts`), and admin routes check `admin_config.admin_emails`.
- `lib/`: shared server code:
  - encryption (`lib/encryption.ts`, AES-256-GCM)
  - the queue (`lib/queue.ts`)
  - sessions (`lib/session-manager.ts`)
  - default prompts (`lib/phase4-prompt-defaults.ts`)
- `worker/src/`: the job processor:
  - `processor.ts`
  - research phases (`phases/phase1.ts` to `phase4.ts`)
  - DataForSEO pipelines (`lib/seo-pipeline-*.ts`)
  - Claude calls (`lib/claude-with-caching.ts`)
- `supabase/setup.sql`: the full schema, RLS policies and default prompts. `supabase/add-user.sql`: grants access and admin rights.

**Pipeline**
- Phases 1–3 are Tavily searches with Claude summaries.
- The basic tier runs Phase 4 as sub-phases 4.1–4.5.
- The intermediate and advanced tiers add DataForSEO data and run the enhanced pipeline 10.1–10.8.
- Prompts live in the `research_prompts` and `phase4_prompts` tables and can be edited at `/admin/research-prompts`. Hardcoded defaults are the fallback.

**Rules for code changes**
- On the server, use `supabase.auth.getUser()` to identify users, never `getSession()`, which only reads the cookie and can be forged.
- Writes to the side tables (`research_session_*`, `dataforseo_*`, audit and terms tables) go through the service-role client. Their RLS policies are scoped `TO service_role`.
- Routes that start research must check `hasActiveAccess()`.
- Check types with `npm run type-check` at the root and `npx tsc --noEmit` in `worker/`. Build with `npm run build`, and `npm run build` in `worker/`.
- Don't commit `worker/dist`, `node_modules` or any `.env` file.
