# Terminology update — Admin Settings → Terminology

Lets IT replace the portal's standard words with the organisation's own, e.g. **"Clinic" instead of "My Requests"**, while **keeping the original wording**:
- Each term shows its **original (kept)** next to **your term**. Leave a box empty to use the original.
- **Use original** on any term, or **Restore all originals**, brings the standard wording back. The originals are built into the portal and are never changed.
- **Off until you switch it on:** nothing changes for users until you tick **Use these terms** and click **Save**. Changes are recorded in Audit History.
- Two terms in the same group can't get the same wording, e.g. two statuses both called "Confirmed".

**Terms you can rename (40):**
- **Menu and pages:** My Requests, Work Queue, Requests, Patients, Reports, Admin Settings, Help.
- **Buttons:** New Request, Register patient, Save as draft, Submit request.
- **New Request steps:** 1–4.
- **Field names:** Patient MRN, Patient name, Home clinic, Requesting staff, Destination type, Receiving facility.
- **Destination types:** Internal, External KSA, International.
- **Request statuses:** all 9.

The new wording appears in the menu, page titles, buttons, the New Request steps, field labels, status labels, filters, reports and request details. Emails and the confirmation letter keep their own wording; edit emails in **Notification Templates**.

## Install
1. Run **`016_terminology.sql`** on the database (Supabase SQL Editor, or your own PostgreSQL). It is safe to run twice.
2. Unzip into the project folder and paste the prompt below into Cursor.
3. Run `npm test` and `npm run build`, then deploy.

## Paste this into the Cursor Agent

```
Apply the "Terminology" update from the folder terminology-update (unzipped in the project root).
MERGE carefully — keep my existing layout, wording elsewhere, logo, login page, MRN-first order, Form Fields,
Validation Rules, Patients, Integrations and any changes I made; only overwrite files marked NEW.

1. Copy the NEW files to the same paths:
   backend/db/migrations/016_terminology.sql, backend/src/domain/terminology.js, backend/src/services/terminology.js,
   backend/test/unit/terminology.test.js, frontend/src/terms.jsx, frontend/src/pages/TerminologyPage.jsx
2. backend/src/routes/branding.js: import * as terminology from '../services/terminology.js' and add
   brandingRouter.get('/terminology', …publicTerminology…) (public, like branding — no sign-in needed).
3. backend/src/routes/admin.js: import the terminology service; add GET and PUT '/terminology'.
4. frontend/src/main.jsx: wrap <App /> in <TerminologyProvider> (import from './terms.jsx'), inside UiProvider.
5. Wherever these words are shown, use the helpers from frontend/src/terms.jsx instead of fixed text
   (compare each file with the reference and change ONLY these words):
   - App.jsx nav labels → t('nav.myRequests') / t('nav.workQueue') / t('nav.reports') / t('nav.patients') /
     t('nav.adminSettings') / t('nav.help')
   - components/ui.jsx StatusPill → statusLabel(status) / statusShort(status); DestChip → destLabel(type)
   - components/RequestsTabs.jsx → t('nav.requestsTab'), t('nav.patients')
   - pages/DashboardPage.jsx → page title, "Register patient", "New Request", status filter labels (statusLabel),
     destination filter labels (destLabel)
   - pages/ReportsPage.jsx → STATUS_META[x].label → statusLabel(x); DEST_LABELS[x] → destLabel(x)
   - pages/RequestDetailPage.jsx → breadcrumb, destLabel, and the row labels Home clinic / Requesting staff /
     Destination type / Receiving facility / Patient name via t('field.…')
   - pages/WizardPage.jsx → step titles via t('step.1'…'step.4'), field labels via t('field.…'),
     "Save as draft" t('action.saveDraft'), "Submit request" t('action.submitRequest'), breadcrumb,
     destination names via destLabel(…). Keep my MRN-first order, Form Fields, Validation Rules and EMR lookup.
   - pages/PatientsPage.jsx → page title t('nav.patients'), "Register patient" t('action.registerPatient')
   - pages/AdminPage.jsx → tab ['terminology', 'Terminology', 'edit'] after Branding, route path="terminology",
     import TerminologyPage, and the page heading t('nav.adminSettings')
6. frontend/src/styles.css: append the block starting "/* ---------- Admin Settings → Terminology".
7. Run migration 016 against the database (safe to run again), then npm test and npm run build.
   Report anything that didn't apply cleanly.
```

## Check it
1. As IT Admin, go to Admin Settings → **Terminology** and type **Clinic** next to *My Requests*.
2. Tick **Use these terms** and click **Save**. The menu now says **Clinic**.
3. Click **Use original**, or **Restore all originals**, then **Save**. The menu says **My Requests** again.
