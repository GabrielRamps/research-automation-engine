# Research Automation Engine

An AI research tool for local service businesses (plumbers, HVAC, roofers, landscapers and similar). You enter a business, its services and its service area. It then researches the market for you:

- live web research (Tavily)
- optional real SEO data (DataForSEO)
- AI write-ups with Claude

At the end you get downloadable reports: keyword strategy, competitive analysis, content strategy and blog calendar, conversion (CRO) guide, off-page and Google Business Profile roadmap, site architecture and SEO specs, UI design direction, and a project overview you can hand to an AI website builder like Cursor or Claude Code.

This repository is the complete source code, shared so anyone can run their own copy. **Everything you need to set it up is in the step-by-step guide below.**

## Easiest way: let Claude set it up for you

If you use **Claude Code** (claude.com/claude-code), it can do most of the setup for you:

1. Click the green **Code** button on this page, then **Download ZIP**, and unzip it. You can also clone it if you know how.
2. Open that folder in Claude Code.
3. Type **`/setup`**, or just say *"Set this up for me."*

Claude reads the instructions in [`CLAUDE.md`](CLAUDE.md), asks you a few questions, and handles the technical parts: settings files, secret values, the database setup and deploying. For the parts only you can do, it tells you exactly what to click: creating accounts, adding payment details, signing in and creating your API keys.

Other AI coding assistants, like Cursor or Codex, can follow the same instructions through [`AGENTS.md`](AGENTS.md).

Prefer to do it by hand? Everything is in the guide below.

---

# Step-by-step setup guide

This guide walks you through running your own copy of the Research Automation Engine. You don't need to write any code. You will create a few free (or cheap) online accounts, copy and paste some settings between them, and click "Deploy".

Plan on **about 1–2 hours** the first time. Go slowly and keep a notes file open, because you'll collect about a dozen values along the way.

> **No support is provided.** This software is shared as-is under the MIT License (see [`LICENSE`](LICENSE)). If you get stuck, the [Troubleshooting](#troubleshooting) section covers the problems people usually hit. You can also paste an error message into Claude or ChatGPT along with this guide and ask for help.

---

## Contents

1. [How it fits together](#1-how-it-fits-together)
2. [What it costs](#2-what-it-costs)
3. [Pick your setup](#3-pick-your-setup)
4. [Step 1: Get your own copy of the code](#step-1-get-your-own-copy-of-the-code)
5. [Step 2: Set up the database (Supabase)](#step-2-set-up-the-database-supabase)
6. [Step 3: Set up the job queue (Upstash)](#step-3-set-up-the-job-queue-upstash)
7. [Step 4: Make your three secret values](#step-4-make-your-three-secret-values)
8. [Step 5: Put the worker online (Railway)](#step-5-put-the-worker-online-railway)
9. [Step 6: Put the website online (Vercel)](#step-6-put-the-website-online-vercel)
10. [Step 7: Connect the pieces](#step-7-connect-the-pieces)
11. [Step 8: Log in and run your first research](#step-8-log-in-and-run-your-first-research)
12. [Option B: Run everything on your own computer](#option-b-run-everything-on-your-own-computer)
13. [Adding other people](#adding-other-people)
14. [Keeping it running](#keeping-it-running)
15. [Troubleshooting](#troubleshooting)
16. [Reference: every setting](#reference-every-setting)

---

## 1. How it fits together

There are four pieces. Each one runs on a different service:

| Piece | What it does | Where it runs |
|---|---|---|
| **Website (the app)** | The pages you log into, the research form and the download page | Vercel, or your own computer |
| **Database** | Stores accounts, settings, prompts and finished reports. It also sends the login emails. | Supabase |
| **Queue** | A to-do list for research jobs, so long jobs don't time out | Upstash (Redis) |
| **Worker** | Picks jobs off the queue and does the research: web searches, SEO data and the Claude write-ups | Railway, or your own computer |

```
You (browser) ──► Website ──► Database (Supabase)
                     │
                     └──► Queue (Upstash) ──► Worker ──► Claude, Tavily, DataForSEO
                                                 └────► saves results to the Database
```

The research itself uses **your own API keys**: Anthropic (Claude), Tavily and, optionally, DataForSEO. You type those into the app after you log in. They are stored encrypted, and each provider bills you directly.

---

## 2. What it costs

Prices change, so check each provider's pricing page. These were the prices in late 2026.

**Hosting**

| Service | Cost |
|---|---|
| Supabase (database) | **Free** plan works. Free projects pause after a week with no use; see [Keeping it running](#keeping-it-running). |
| Upstash (queue) | **Free** plan: 500,000 commands/month, which is enough for normal use. |
| Railway (worker) | About **$5/month** on the Hobby plan, which includes $5 of usage. New accounts get a one-time $5 trial credit. |
| Vercel (website) | **Free** Hobby plan, but Vercel limits it to personal, non-commercial use. Using it for a business needs Vercel Pro (**$20/month**), or you can host the website on Railway as well (see the box in Step 6). |
| Resend (email) | Optional. The free plan is plenty. |

If you run it on **your own computer** (Option B), the hosting cost is **$0**. It only works while that computer is on, though.

**Research (pay as you go, billed by each provider)**

| Provider | Needed for | Cost |
|---|---|---|
| Anthropic (Claude) | All tiers | Prepaid credits. One full research run uses a few dollars of Claude. Check your usage page after your first run to see your real number. |
| Tavily (web search) | All tiers | 1,000 free credits/month. A run with the default prompts uses about 40, so the free plan covers roughly 25 runs a month. |
| DataForSEO | Intermediate and Advanced tiers only | Prepaid, $50 minimum top-up. The Advanced tier (backlinks) needs a balance of $100 or more. |

---

## 3. Pick your setup

- **Option A: Cloud (recommended).** The app is always online, works from any device, and you can add teammates. Follow Steps 1–8 in order.
- **Option B: Your own computer.** Free hosting, but it only runs while your computer is on and the terminal windows are open. Do Steps 1–4, then jump to [Option B](#option-b-run-everything-on-your-own-computer).

Both options need Supabase (Step 2) and Upstash (Step 3).

---

## Step 1: Get your own copy of the code

**Option A needs your own copy on GitHub** when you set things up by hand, because Railway and Vercel deploy straight from a GitHub repository. If Claude is doing the setup for you, it can usually deploy from the downloaded folder instead.

1. Create a free account at **github.com** if you don't have one, and sign in.
2. At the top of this page, click the green **Use this template** button, then **Create a new repository**.
   - Name it something like `research-engine`.
   - Choose **Private**.
   - Click **Create repository**.

   You now have your own copy. It doesn't change if this original page is ever updated or removed. If you don't see **Use this template**, click **Fork** instead.

**Option B only:** on this page, click the green **Code** button, then **Download ZIP**. Unzip it somewhere easy to find, like your Documents folder.

---

## Step 2: Set up the database (Supabase)

> **Important:** sign up for Supabase with **the same email address you'll use to log into the app.** Supabase's built-in email sender only delivers login links to members of your Supabase team. Using the same email means your own login links arrive without any extra setup.

1. Go to **supabase.com**, sign up, and click **New project**.
   - Name it, for example `research-engine`.
   - Set a database password. Save it in your notes, although you won't need it again in this guide.
   - Pick the region closest to you, keep the Free plan, and click **Create**. Setup takes a minute or two.
2. **Create the tables.**
   1. In the left sidebar, open **SQL Editor** and start a new query.
   2. On your computer, open the file `supabase/setup.sql` from the code in any text editor (Notepad or TextEdit is fine). Select all, copy, and paste it into the SQL Editor.
   3. Click **Run**. You should see a success message. If Supabase warns that the query is destructive or asks you to confirm, confirm it. The script only creates new things.
   4. Only run this file once. Running it again shows "already exists" errors, which are harmless.
3. **Give yourself access.**
   1. Open `supabase/add-user.sql` the same way.
   2. Paste it into a **new** query.
   3. Change `you@example.com` to your email (keep the quote marks) and click **Run**. This creates your access and makes you an admin.
4. **Tell Supabase where your app lives.**
   1. Go to **Authentication → URL Configuration**.
   2. **Site URL:** for now, enter `http://localhost:3000`. You'll come back and change this in Step 7.
   3. Under **Redirect URLs**, add `http://localhost:3000/**`. You'll add your real web address in Step 7.
5. **Copy your keys.** Go to **Project Settings → API Keys** (on some screens it's labelled **Data API**) and copy these three values into your notes:
   - **Project URL**, which looks like `https://abcdefgh.supabase.co`. This becomes `NEXT_PUBLIC_SUPABASE_URL`.
   - **Publishable key** (`sb_publishable_…`), or on older projects the **anon** key. This becomes `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - **Secret key** (`sb_secret_…`), or on older projects the **service_role** key. This becomes `SUPABASE_SERVICE_ROLE_KEY`.

   ⚠️ **The secret key can read and change everything in your database.** Never share it or post it anywhere public.

---

## Step 3: Set up the job queue (Upstash)

1. Go to **upstash.com**, sign up, and create a **Redis** database.
   - Pick any name and the region closest to your Railway/Vercel region (any US region is fine for US users).
   - Keep the **Free** plan.
2. Open the database. Copy these values into your notes:
   - The **TCP connection string**, which starts with `rediss://default:` (note the double "s"). Look for the **Connect** section with the "Redis / ioredis" option and copy the full URL including the password. This becomes `REDIS_URL`.
   - The **REST URL**, which becomes `UPSTASH_REDIS_REST_URL`.
   - The **REST token**, which becomes `UPSTASH_REDIS_REST_TOKEN`.

---

## Step 4: Make your three secret values

The app needs three long random values, which you make up yourself:

- `ENCRYPTION_SECRET_KEY` encrypts the API keys people save in the app.
- `ENCRYPTION_SALT` is a second ingredient for that encryption.
- `WORKER_CALLBACK_SECRET` lets the worker tell the website "this job is done".

Generate each one by running a command three times, once per value. Copy each result into your notes.

**Mac:** open the **Terminal** app and run:
```
openssl rand -hex 32
```

**Windows:** open **PowerShell** and run:
```
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | % { $_.ToString('x2') }) -join ''
```

Each result is a 64-character string of numbers and letters a–f.

> ⚠️ **Never change `ENCRYPTION_SECRET_KEY` or `ENCRYPTION_SALT` after you start using the app.** If you do, every saved API key becomes unreadable and everyone has to re-enter their keys. Keep a copy somewhere safe, like a password manager.

---

## Step 5: Put the worker online (Railway)

1. Go to **railway.com** and sign up with your GitHub account.
2. Click **New Project → Deploy from GitHub repo** and choose your repository. Allow Railway access to it if asked.
3. Railway creates a service and may start building right away. The first build may fail. That's expected until the next two steps are done.
4. Click the service, open **Settings**, and set **Root Directory** to:
   ```
   worker
   ```
   Railway then finds the worker's `Dockerfile` and builds from it. If there is a "Config file path" setting, you can set it to `/worker/railway.json`, but this is optional.
5. Open the **Variables** tab and add these. Railway's **Raw Editor** lets you paste them all at once:

   ```
   NEXT_PUBLIC_SUPABASE_URL=     (Project URL from Step 2)
   SUPABASE_SERVICE_ROLE_KEY=    (Secret key from Step 2)
   REDIS_URL=                    (rediss://... from Step 3)
   ENCRYPTION_SECRET_KEY=        (from Step 4)
   ENCRYPTION_SALT=              (from Step 4)
   WORKER_CALLBACK_SECRET=       (from Step 4)
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   LOG_LEVEL=warn
   ```
   Replace each placeholder in brackets with your real value, with no spaces and no brackets. You'll update `NEXT_PUBLIC_SITE_URL` in Step 7.
6. Railway redeploys automatically. Open **Deployments → View logs**. When it's working, you'll see:
   ```
   [Worker] Started (concurrency: 3).
   ```
   A warning about `RESEND_API_KEY` is normal if you skip email.

The worker doesn't need a public web address, so you don't need to generate a domain for it.

---

## Step 6: Put the website online (Vercel)

1. Go to **vercel.com** and sign up with your GitHub account.
2. Click **Add New → Project** and **Import** your repository. Vercel detects it as **Next.js**. Leave the Root Directory as the top level, **not** `worker`.
3. Before clicking Deploy, open **Environment Variables** and add these (you can paste them all at once):

   ```
   NEXT_PUBLIC_SUPABASE_URL=       (Project URL from Step 2)
   NEXT_PUBLIC_SUPABASE_ANON_KEY=  (Publishable key from Step 2)
   SUPABASE_SERVICE_ROLE_KEY=      (Secret key from Step 2)
   REDIS_URL=                      (rediss://... from Step 3)
   UPSTASH_REDIS_REST_URL=         (from Step 3)
   UPSTASH_REDIS_REST_TOKEN=       (from Step 3)
   USE_QUEUE_SYSTEM=true
   ENCRYPTION_SECRET_KEY=          (same as the worker)
   ENCRYPTION_SALT=                (same as the worker)
   WORKER_CALLBACK_SECRET=         (same as the worker)
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```
4. Click **Deploy** and wait for it to finish, which takes a few minutes.
5. Vercel shows your web address, something like `https://research-engine-abc123.vercel.app`. Copy it into your notes **without a slash at the end**. You can add your own domain later under Settings → Domains.

> **Using it for a business?** Vercel's free Hobby plan is for personal, non-commercial use only. Your choices are:
> - Upgrade that Vercel project to **Pro**.
> - Host the website on **Railway** as well:
>   1. In your Railway project, add a second service from the same repository.
>   2. Leave its Root Directory **empty**.
>   3. Add the website variables from step 3 above.
>   4. Under **Settings → Networking**, click **Generate Domain** and use that address in Step 7.

---

## Step 7: Connect the pieces

Now replace the temporary `http://localhost:3000` placeholders with your real web address from Step 6.

1. **Vercel:** go to **Settings → Environment Variables**. Change both `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SITE_URL` to your web address. Then go to **Deployments**, open the **⋯** menu on the latest deployment, and click **Redeploy**.
   - This redeploy is required. Settings that start with `NEXT_PUBLIC_` only take effect when the site is rebuilt.
2. **Railway (worker):** change `NEXT_PUBLIC_SITE_URL` to your web address. Railway redeploys by itself.
3. **Supabase:** go to **Authentication → URL Configuration**.
   - Set **Site URL** to your web address.
   - Under **Redirect URLs**, add your web address followed by `/**`, for example `https://research-engine-abc123.vercel.app/**`.
   - Keep the `http://localhost:3000/**` entry if you also want to run it on your computer.

---

## Step 8: Log in and run your first research

1. Open your web address, enter **the email you added in Step 2**, and click **Send Magic Link**.
2. Open the email and click the link **in the same browser** you requested it from. The link expires after about an hour, and it only works in that browser.
3. **Accept the terms** when asked. The default text is a short "self-hosted, as-is" notice. You can edit it later in the Admin Panel.
4. **Add your API keys** on the setup screen:
   - **Claude:**
     1. Create a key in the Claude Console (platform.claude.com, formerly console.anthropic.com) under **API Keys**.
     2. Add credits under **Billing** first. A key with no credits fails validation.
   - **Tavily:** sign up at **app.tavily.com** and copy your API key.
   - **DataForSEO** (optional, Intermediate and Advanced tiers only):
     1. Sign up at **dataforseo.com** and top up your balance.
     2. Use the API login and API password shown in the dashboard under API access. That password is **not** your website password.
5. Go back to the dashboard, start a new research run, choose a tier, fill in the business details, and submit. A run takes a while. The progress page updates as each phase finishes, and you can close it and come back later.

**You're done.** Your Admin Panel is at **`/admin`** on your site (for example `https://your-site.vercel.app/admin`). From there you can:
- edit research prompts
- tune Tavily and DataForSEO settings
- manage users
- post an announcement banner
- check for stuck sessions

---

## Option B: Run everything on your own computer

You still need **Steps 2–4**: Supabase, Upstash and your secret values. Skip Railway and Vercel.

1. **Install Node.js:** download the **LTS** version from **nodejs.org** and install it. Version 20 or newer works. On Windows, click **Yes** when Windows asks for permission. Close and reopen your terminal afterwards so it can find Node.
2. **Open a terminal in the code folder.**
   - **Mac:** open Terminal, type `cd ` (with a space), drag the code folder onto the window, and press Enter.
   - **Windows:** open the code folder in File Explorer, click the address bar, type `powershell`, and press Enter.
3. **Create the website's settings file.**
   1. In the code folder, make a copy of `.env.example` and name the copy `.env.local`.
   2. Open `.env.local` in a text editor and fill in the values from Steps 2–4.
   3. Leave `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SITE_URL` as `http://localhost:3000`.
4. **Create the worker's settings file.** In the `worker` folder, copy `.env.example` to a file named `.env` and fill it in the same way. The values must match the website's file.
5. **Install and start the website** by running these one at a time in the terminal. The first command takes a few minutes.
   ```
   npm install
   npm run build
   npm start
   ```
   Leave this window open. The website is now at **http://localhost:3000**.
6. **Start the worker in a second terminal window.** Open the code folder again the same way as in step 2, then run:
   ```
   cd worker
   npm install
   npm run build
   npm start
   ```
   Wait for `[Worker] Started`, and leave this window open too.
7. Follow **Step 8** above, using `http://localhost:3000` as your web address.

To stop the app, close both windows or press **Ctrl + C** in each. To start it again later, run only `npm start` in each window: the main folder in one, and the `worker` folder in the other. If you change anything in a settings file, run `npm run build` again before `npm start`.

---

## Adding other people

1. **Give them access.** Choose one:
   - Run `supabase/add-user.sql` again with their email, and set `v_make_admin` to `false` unless they should be an admin.
   - Add them in the app under **Admin → User Management**.
2. **Make sure the login email reaches them.** Supabase's built-in email sender only sends to members of your Supabase team, and only a couple of emails per hour. Choose one:
   - **Easy:** invite them to your Supabase organization (**Organization settings → Team**).
   - **Better for more than a couple of people:** set up your own email sender in Supabase (**Authentication → Emails → SMTP settings**). Resend works well: create an account at resend.com, verify your domain, and use Resend's SMTP details. This also raises the email limit.
3. **Optional "your report is ready" emails:**
   1. Add `RESEND_API_KEY` to both the website and the worker settings.
   2. After verifying your domain in Resend, also set `EMAIL_FROM`, for example `Research Engine <reports@yourdomain.com>`.

   Without a verified domain, Resend can only send to your own Resend account email.

Each person adds their own Claude, Tavily and DataForSEO keys, and pays for their own usage.

---

## Keeping it running

- **Supabase free projects pause after about a week with no activity.** Supabase emails you before this happens. If your project gets paused, open the Supabase dashboard and click **Restore**. Your data is kept. To avoid pauses entirely, upgrade that project to Supabase Pro.
- **Claude models get retired.** This app uses `claude-opus-4-6` for the main write-ups and `claude-sonnet-4-6` for keyword expansion. Anthropic says neither will be retired before February 2027. When Anthropic announces a retirement, look up the recommended replacement on their **model deprecations** page and set it as an override:
  - In the **worker**: set `CLAUDE_MODEL` and/or `CLAUDE_FAST_MODEL`.
  - In the **website**: set `CLAUDE_MODEL` too, because it's used to test your key.
  - Then redeploy.

  A newer model may behave a little differently, so check the first report after switching.
- **Watch your spending.** Set monthly budget alerts or limits in the Claude Console and in Railway. DataForSEO is prepaid, so it can't overspend.
- **Back up anything you care about.** The Supabase free plan has no automatic backups. Download reports you want to keep. On the Pro plan you get daily backups.
- **Updating the code.** If you change the code or pull in an updated copy on GitHub, Railway and Vercel rebuild automatically.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| **"Email address not authorized"**, or no login email arrives | Supabase's built-in sender only emails your Supabase team members. Log in with the email you signed up to Supabase with, invite the person to your Supabase team, or set up custom SMTP (see [Adding other people](#adding-other-people)). Also check your spam folder. |
| **"Email rate limit exceeded"** | The built-in sender allows only a few emails per hour. Wait an hour, or set up custom SMTP. |
| Login link opens but sends you back to the login page | Open the link in the **same browser** you requested it from. Also check Step 7: Supabase's Site URL and Redirect URLs must match your web address exactly (with `/**` on the Redirect URL). |
| Login link goes to `localhost` | Supabase's **Site URL** is still `http://localhost:3000`. Update it (Step 7). |
| **"No Active Access"** after logging in | The email you logged in with isn't in your access list. Run `supabase/add-user.sql` with that exact email. |
| **No "Admin" area** | Run `supabase/add-user.sql` with your email and `v_make_admin := true`, then log out and back in. |
| Website shows **"Server misconfiguration"**, **500 errors**, or Vercel's build fails mentioning `ENCRYPTION_SECRET_KEY` | A website variable is missing or mistyped. Compare against [Reference](#reference-every-setting). `ENCRYPTION_SECRET_KEY` must be at least 32 characters and `ENCRYPTION_SALT` at least 16. Then redeploy. |
| Research stays on **"Queued" / "Starting"** forever | The worker isn't running, or it isn't connected to the same queue. Check the Railway logs for `[Worker] Started`. Make sure `REDIS_URL` is **exactly the same** in Vercel and Railway, and that the website has `USE_QUEUE_SYSTEM=true`. |
| Worker log: **"supabaseUrl is required"** or **"ENCRYPTION_SECRET_KEY environment variable is required"** | A worker variable is missing. Check Step 5. |
| Run fails with a **"could not decrypt"** or **"re-enter your keys"** message | The encryption values differ between the website and the worker, or were changed. Make them identical, redeploy both, then re-enter your API keys in the app. |
| Run **pauses** with a balance or credit message | Your Claude, Tavily or DataForSEO account is out of credit. Top it up, then click **Resume** on the dashboard. Your progress is saved. |
| Run fails with **"model not found"** or a deprecation error | Anthropic retired a model. See "Claude models get retired" in [Keeping it running](#keeping-it-running). |
| A second run sits in the queue after the first finishes | `WORKER_CALLBACK_SECRET` must be identical in both places, and the worker's `NEXT_PUBLIC_SITE_URL` must be your real web address. |
| Upstash shows **"max requests limit exceeded"** | You've used the free 500,000 commands for the month. Add a payment method in Upstash (pay-as-you-go, usually a few dollars), or stop the worker when you're not using it. |
| Supabase project is **paused** | Open the Supabase dashboard and click **Restore**. |
| Running locally: page is blank or errors after you changed `.env.local` | Stop it with Ctrl + C, then run `npm run build` and `npm start` again. |

Still stuck? In Vercel, the **Logs** tab shows website errors. In Railway, the **Deployments → View logs** tab shows worker errors. Copy the red error line and search for it, or ask an AI assistant about it.

---

## Reference: every setting

**Website (Vercel, or `.env.local` on your computer)**

| Setting | Required | Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase Publishable (or anon) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Secret (or service_role) key. **Keep private.** |
| `REDIS_URL` | Yes | Upstash `rediss://…` connection string. Same as the worker. |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash REST token |
| `USE_QUEUE_SYSTEM` | Yes | `true` |
| `ENCRYPTION_SECRET_KEY` | Yes | Random, 32+ characters. Same as the worker. Never change it. |
| `ENCRYPTION_SALT` | Yes | Random, 16+ characters. Same as the worker. Never change it. |
| `WORKER_CALLBACK_SECRET` | Yes | Random. Same as the worker. |
| `NEXT_PUBLIC_APP_URL` | Yes | Your web address, no trailing slash |
| `NEXT_PUBLIC_SITE_URL` | Yes | Same as above |
| `RESEND_API_KEY` | No | For invite emails sent from the Admin Panel |
| `EMAIL_FROM` | No | Sender for Resend emails. Defaults to Resend's test sender. |
| `CLAUDE_MODEL` | No | The main Claude model; in the website it's used to test your Claude key. Keep it the same as the worker's. Default `claude-opus-4-6`. |
| `CLAUDE_KEY_CHECK_MODEL` | No | Model for the quick key health check. Default `claude-haiku-4-5-20251001`. |
| `HIGHLEVEL_WEBHOOK_SECRET` | No | Lets a payment tool create accounts automatically. It sends `POST /api/provision` with `Authorization: Bearer <secret>` and `{"email": "..."}`. |

**Worker (Railway, or `worker/.env` on your computer)**

| Setting | Required | Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Same as the website |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Same as the website |
| `REDIS_URL` | Yes | Same as the website |
| `ENCRYPTION_SECRET_KEY` | Yes | Same as the website |
| `ENCRYPTION_SALT` | Yes | Same as the website |
| `WORKER_CALLBACK_SECRET` | Yes | Same as the website |
| `NEXT_PUBLIC_SITE_URL` | Yes | Your web address (used for links in emails and job-finished callbacks) |
| `LOG_LEVEL` | No | `warn` (default). Use `debug` when troubleshooting. |
| `RESEND_API_KEY` / `EMAIL_FROM` | No | "Your report is ready" emails |
| `CLAUDE_MODEL` | No | Main research model. Default `claude-opus-4-6`. |
| `CLAUDE_FAST_MODEL` | No | Keyword-expansion model. Default `claude-sonnet-4-6`. |

---

## Security notes

- Never share your Supabase **secret** key or your encryption values, and never paste them into a public place.
- People's API keys are encrypted (AES-256-GCM) before they are saved. They are only decrypted inside the worker while a run is in progress.
- The database setup turns on Row Level Security for every table, so logged-in users can only see their own sessions, reports and keys.
- Only people you add (with `add-user.sql` or Admin → User Management) can run research. Anyone else who manages to sign in just sees "No Active Access".
- Install security updates now and then. The code depends on open-source packages that get security fixes over time, so it's worth asking a developer or an AI assistant to update them every few months.
- To shut your installation down completely:
  1. Delete the Supabase project. This removes all data, including saved keys.
  2. Delete the Railway and Vercel projects.
  3. Revoke your Claude, Tavily and DataForSEO API keys in each provider's dashboard.

---

## No support, no warranty

This code is provided **as-is** under the [MIT License](LICENSE). Nobody is on the hook to fix bugs, answer questions or keep it working, and it may break when third-party services change their APIs or retire models. You're free to use it, change it, and run it for your own business or your clients.

## For developers

- **Stack:** Next.js 15 (App Router) + TypeScript + Tailwind, Supabase (Postgres + Auth + RLS), BullMQ on Upstash Redis, and a separate Node worker in `worker/`.
- **Database:** `supabase/setup.sql` is the full schema, RLS policies and default prompts in one file, consolidated from the original migrations. `supabase/add-user.sql` grants access and admin rights.
- **Pipeline:**
  - Phases 1–3 are Tavily research with Claude summaries (`worker/src/phases/phase1.ts` to `phase3.ts`).
  - The basic tier runs Phase 4 as sub-phases 4.1–4.5.
  - The intermediate and advanced tiers run the enhanced pipeline 10.1–10.8 (`worker/src/phases/phase4.ts`) on top of 7 waves of DataForSEO data (`worker/src/lib/seo-pipeline-*.ts`).
- **Prompts** live in the `research_prompts` and `phase4_prompts` tables and can be edited at `/admin/research-prompts`. Hardcoded fallbacks are in `lib/phase4-prompt-defaults.ts` and `worker/src/phases/phase4.ts`.
- **API keys** are BYOK and encrypted with AES-256-GCM (`lib/encryption.ts`, `worker/src/lib/encryption.ts`).
- **Common commands:**
  - Website: `npm run dev` / `npm run build` / `npm start` / `npm run type-check`
  - Worker: `cd worker && npm run build && npm start`
- **Settings:** `.env.example` (website) and `worker/.env.example` (worker). Every setting is explained in the guide above.
