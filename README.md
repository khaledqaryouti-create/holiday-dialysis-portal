# Holiday Dialysis Coordination Portal

Web portal for arranging dialysis for patients who travel. Clinics submit a request with MOH (and MOD) approval
attached; Internal requests go to the receiving network clinic, which approves or rejects in the portal; External KSA
and International requests go to the Coordination Team – International, who email the provider and record the reply on
the same request. Built from the *Screen-by-Screen Functional Specification* (v5).

**Stack:** JavaScript (ES modules) · npm workspaces (`backend`, `frontend`) · Node.js 22 + Express 4 · PostgreSQL on
Supabase via `pg` · React 18 + Vite 5.

---

## 1. Quick start (about 15 minutes)

### Prerequisites
- Node.js **22** (`nvm use` reads `.nvmrc`) and npm 10
- A Supabase project (free tier is fine for development) — or any PostgreSQL 14+ for local work

### Create the database (Supabase)
1. supabase.com → New project. Pick a region close to your users (and check data-residency rules for patient data).
2. **Connect** button → *Session pooler* → copy the URI (port 5432). Replace `[YOUR-PASSWORD]`.
3. Project Settings → API → copy the **Project URL** and the **service_role** key (server-side only, never in the browser).

### Configure
```bash
cp backend/.env.example backend/.env
```
Fill in `backend/.env`:
| Variable | Value |
|---|---|
| `DATABASE_URL` | the session-pooler URI from step 2 |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `FIELD_ENCRYPTION_KEY` | `openssl rand -base64 32` — keep it safe; losing it makes patient IDs unreadable |
| `STORAGE_DRIVER` | `local` to start; `supabase` + `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for the bucket |

(Local Postgres instead: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hdp` and `DATABASE_SSL=disable`.)

### Install, create tables, load sample data, run
```bash
npm install
npm run db:migrate          # creates all tables, triggers and the RLS lockdown
npm run db:seed             # sample clinics, providers, users, patients and requests (development only)
npm run storage:setup       # only if STORAGE_DRIVER=supabase — creates the private bucket
npm run dev                 # API http://localhost:4000 + web http://localhost:5173
```
Open http://localhost:5173 and pick a sample account. Good accounts to try:
| Account | Role | Try |
|---|---|---|
| Laila Al-Harbi | Clinic Staff, Riyadh North | New Request wizard, withdraw, drafts |
| Omar Khan | Clinic Staff, Jeddah Central | Approve/reject requests sent to Jeddah |
| Faisal Mahmoud | Coordination – International | Send to provider, record reply |
| Sara Ahmed | Coordination – Internal | Mark confirmed requests completed |
| Ziad Al-Mutairi | IT Admin | Users, facilities, SLA targets, templates, audit |

With `MAIL_TRANSPORT=log` every email (including provider emails with attachments) is printed in the API terminal.
To send real email, sign in as the IT Admin → **Admin Settings → Email (SMTP)**: enter the company SMTP host, security
(SSL/TLS 465, STARTTLS 587 or none), user name, password and sender identity, click **Test connection**, then
**Send test email**, tick "Send portal emails through this SMTP server" and **Save**. No restart needed.

### Check it works
```bash
npm test                    # unit tests for workflow, permissions and validation
npm run db:seed -- --reset  # fresh sample data (wipes the dev database!)
npm run test:api            # end-to-end API flow against that database
```

---

## 2. Project layout
```
backend/
  db/migrations/        001_init.sql (schema §14), 002_guards_and_rls.sql (triggers + Supabase REST lockdown)
  db/seed.sql           fictional sample data
  src/domain/           pure business rules — shared with the frontend via the @domain alias
    constants.js          statuses, roles, document types, SLA stages
    access.js             who can see which request (canView + equivalent SQL)
    workflow.js           every action: allowed from which status, by whom, to which status
    validation.js         field rules (IDs, dates, files, reasons)
  src/services/         requests (workflow transactions), reports, admin, notifications, storage, mailer, letters
  src/routes/           thin Express routers
  src/jobs/reminders.js SLA reminder job
  test/unit/            node --test unit tests;   test/api/  end-to-end API test
frontend/
  src/pages/            Login, Dashboard, Wizard, RequestDetail, Reports, Admin, Notifications, Help
  src/components/       UI kit (modal, toasts, pills, timeline, charts, icons)
  src/api.js            fetch wrapper
.cursor/rules/          rules Cursor's AI follows (stack, workflow, backend, frontend, database)
docs/spec-decisions.md  how gaps/contradictions in the spec were resolved — review at the workshop
docs/next-steps.md      ordered backlog with ready-to-paste Cursor prompts (SSO, d.care, scanning, exports…)
```

## 3. Sign-in (Admin Settings → Sign-in & Directory)
Three methods can run side by side. **All three start switched off**: installing or upgrading changes nothing for staff
until IT switches a method on, tests it and clicks **Save**. The sign-in page shows only the methods that are active:
- **Microsoft (Entra ID)** — OpenID Connect with PKCE. Register an app in Entra ID (single tenant), add the Web redirect
  URI shown on the page, create a client secret, then enter tenant ID, client ID and secret. "Check Microsoft settings"
  verifies the tenant and secret. Add the *groups* claim (Token configuration) to map roles from groups.
- **Directory (Active Directory / LDAP)** — user name + network password, checked against AD over LDAPS (636) or
  StartTLS (389) using a read-only service account. "Test connection" and "Test a user sign-in" show exactly what the
  portal sees (DN, e-mail, groups, roles). User names are escaped, so the filter can't be abused (LDAP injection).
- **Local portal passwords** — scrypt-hashed; IT sets or generates a temporary password in User Management → Password,
  and the user must change it at first sign-in. Passwords can be prepared before activation; they only work (and the
  "change your temporary password" screen only appears) once Local passwords is switched on and the person signs in with it. Policy (length, character types) is configurable.
- **Lockout** after N wrong passwords for M minutes (default 5 / 15) applies to local and directory sign-in; IT can
  unlock from the same page.
- **Users & groups** — optionally create portal accounts automatically at first sign-in, and keep roles in step with
  directory/Microsoft groups, using the Group → role mappings table. Otherwise IT adds users and sign-in matches by e-mail.
- **Break-glass:** keep one IT Admin with a local password. If sign-in is misconfigured, run on the server:
  `npm run auth:set-password -- it.admin@company.com` (prints a temporary password and switches local sign-in on).
- Set `AUTH_MODE=standard` to remove the development pick-a-user list.

## 4. Branding (Admin Settings → Branding)
Upload the company logo (PNG, JPEG, WebP or SVG, up to 1 MB) and enter the company name, clinic / site name, portal title,
optional sign-in page headline and message, and contact details (phone, email, website, address, support hours).
They appear on the sign-in page, in the header (with a **Contact** button), on the Help page and in the browser tab.
Branding starts **switched off**: staff see the standard look until IT ticks **Show this branding** and clicks **Save**.
The page has a live preview. Logos are checked by their content (not the file name); SVGs with scripts or external
links are refused, and logos are served with a sandboxing Content-Security-Policy.

## 5. How the important parts work
- **Permissions are enforced on the server.** `domain/access.js` filters every list in SQL and every detail view;
  `domain/workflow.js` gates every action on status + destination type + role/clinic. The UI only renders what the API's
  `allowedActions` says.
- **One transaction per action.** `services/requests.js → runAction()` locks the request, checks `rowVersion` (two people
  can't act on the same request at once), runs the rule check, writes the status change, status history, decision,
  audit event and notifications, commits, and only then sends emails. Provider emails are sent inside the transaction, so
  a failed send leaves the status unchanged.
- **Data protection.** National ID / Iqama / passport numbers are encrypted with pgcrypto and shown masked. Audit,
  status history, decisions, provider emails and letters are append-only (DB triggers). Every table has RLS on with no
  policies, so Supabase's public REST API returns nothing — all access goes through the Express API.
- **Documents** are stored in a private Supabase bucket (or `backend/storage` locally) and streamed through the API;
  each view/download is audited.
- **Email (SMTP) settings** are stored in the `email_settings` table (password encrypted with pgcrypto, never sent to
  the browser) and take effect within 30 seconds of saving. When switched off, the `.env` `MAIL_TRANSPORT` fallback is
  used. The delivery log on the same page lists every notification and provider email with status, error and retry.
- **SLA reminders.** Run `npm run jobs:reminders` on a schedule (cron / Task Scheduler), or set
  `REMINDER_INTERVAL_MINUTES` so the API runs it.

## 6. API overview
All under `/api`; JSON; session cookie; writes need header `X-Requested-With: hdp`.
| Method & path | Purpose |
|---|---|
| `GET /auth/clinics` (sign-in Clinic list) · `GET /auth/config · me`, `POST /auth/login` (`username`, `password`, `clinicId`) `· logout · change-password`, `GET /auth/microsoft/login · callback`, `GET /auth/dev-users`, `POST /auth/dev-login` | sign-in (dev list only when `AUTH_MODE=dev`) |
| `GET/PUT /admin/auth-settings`, `POST /admin/auth-settings/test-ldap · test-ldap-user · test-microsoft`, `GET/POST/DELETE /admin/auth-settings/mappings`, `GET /admin/auth-settings/lockouts`, `POST …/lockouts/unlock`, `POST/DELETE /admin/users/:id/password` | Sign-in & Directory settings |
| `GET /requests?q&status&dest&clinic&from&to&kpi&sort&dir&page` | dashboard list + summary cards |
| `GET /requests/export.csv` | export current list (masked) |
| `POST /requests`, `PATCH /requests/:id`, `DELETE /requests/:id` | create / update / discard draft |
| `POST /requests/:id/documents` (multipart `docType`, `file`), `DELETE …/documents/:docId`, `GET …/documents/:docId` | attachments |
| `GET /requests/:id` | detail incl. history, documents, comments, emails, `allowedActions` |
| `POST /requests/:id/submit · approve · reject · send-to-provider · resend-to-provider · provider-response · withdraw · complete · comments` | workflow actions |
| `GET /requests/:id/provider-email` | preview of the provider email |
| `GET /requests/:id/letter.pdf` | confirmation letter |
| `GET /reference/patients · facilities · destination-cities · countries · providers` | wizard lookups |
| `GET /reports/summary`, `GET /reports/export.csv` | reports |
| `GET/POST /notifications…` | in-portal notifications |
| `/admin/users · facilities · sla · templates · audit` | IT Admin settings |
| `GET /branding`, `GET /branding/logo` (no sign-in needed; only what IT switched on) · `GET/PUT /admin/branding`, `POST/DELETE/GET /admin/branding/logo` (multipart `logo`) | Branding |
| `GET/PUT /admin/email-settings`, `POST /admin/email-settings/test-connection · test-email`, `GET /admin/email-log`, `POST /admin/email-log/:id/retry` | Email (SMTP) settings |

## 7. Production checklist
- `NODE_ENV=production`, `AUTH_MODE=standard`; sign-in configured and tested in Admin Settings → Sign-in & Directory; a break-glass IT Admin with a local password.
- `DATABASE_SSL=verify` with Supabase's CA certificate (`DATABASE_SSL_CA`).
- `STORAGE_DRIVER=supabase`, bucket private; company SMTP configured in Admin Settings → Email (SMTP) and a test email received.
- Secrets (`SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, service-role key, SMTP) in a secret store, not in files.
- `npm run build` then `npm start` — Express serves `frontend/dist` and the API from one process behind HTTPS.
- Schedule `npm run jobs:reminders`; back up the database and bucket; confirm retention periods.
- Open items before go-live are listed in `docs/spec-decisions.md`.

## 8. Building with Cursor
Open the repo folder in Cursor. The rules in `.cursor/rules/` load automatically (the project rule always; backend,
frontend and database rules when you work in those folders; the workflow rule when a task touches requests).
Start with the prompts in `docs/next-steps.md`, one at a time, and run `npm test` after each.
