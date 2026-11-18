# Form Fields update — Admin Settings → Form Fields

Lets IT choose, for each field on **Patient & Destination** and each **attachment**, whether it is
**Required**, **Optional** or **Hidden**, and pick the colours used to mark them (asterisk, "Optional" badge,
attachment tags, and an optional coloured edge on required boxes).

- Nothing changes until you save. Empty settings = today's behaviour.
- Patient name, MRN, ID number, destination type, destination/facility, travel dates and sessions are **always required** (locked) — the request can't be routed without them.
- MOH approval can be Required or Optional (not Hidden). MOD approval: "When MOD applies" (standard), Optional or Hidden.
- The server applies the same rules when a request is submitted, so the rules can't be bypassed.
- Colours must be readable on white (contrast 3:1 or more); in dark mode they are lightened automatically.

## Files

| File | Action |
|---|---|
| `backend/db/migrations/011_form_settings.sql` | NEW — run it (Supabase SQL editor or `npm run migrate`) |
| `backend/src/domain/formRules.js` | NEW |
| `backend/src/services/formSettings.js` | NEW |
| `backend/src/domain/validation.js` | CHANGED — `validatePatientStep`, `validateAttachmentsStep`, `validateForSubmit` take `rules` |
| `backend/src/services/requests.js` | CHANGED — submit passes the saved rules (2 lines) |
| `backend/src/routes/admin.js` | CHANGED — `GET/PUT /api/admin/form-settings` |
| `backend/src/routes/misc.js` | CHANGED — `GET /api/reference/form-rules` |
| `backend/test/unit/formRules.test.js` | NEW |
| `frontend/src/pages/FormFieldsPage.jsx` | NEW |
| `frontend/src/pages/AdminPage.jsx` | CHANGED — "Form Fields" tab |
| `frontend/src/pages/WizardPage.jsx` | CHANGED — reads the rules |
| `frontend/src/styles.css` | CHANGED — block appended at the end |

## Paste this into the Cursor Agent

```
Apply the "Form Fields" update from the folder form-fields-update (unzipped in the project root).
MERGE carefully — keep my existing layout, wording, logo, login page and any changes I made; do not overwrite whole files
unless they are marked NEW.

1. Copy the NEW files to the same paths:
   backend/db/migrations/011_form_settings.sql, backend/src/domain/formRules.js,
   backend/src/services/formSettings.js, backend/test/unit/formRules.test.js, frontend/src/pages/FormFieldsPage.jsx
2. backend/src/domain/validation.js: import { DEFAULT_FIELD_RULES, isRequired, isHidden } from './formRules.js';
   then make validatePatientStep(d, rules = DEFAULT_FIELD_RULES), validateAttachmentsStep(d, docTypes, rules = DEFAULT_FIELD_RULES)
   and validateForSubmit(d, docTypes, today, rules = DEFAULT_FIELD_RULES) follow the rules exactly as in the reference copy
   (hidden fields are skipped; required/optional comes from isRequired). validateForSubmit passes rules to both steps.
3. backend/src/services/requests.js: import { currentFieldRules } from './formSettings.js'; in submit() pass
   `await currentFieldRules(ctx.c)` as the 4th argument of validateForSubmit.
4. backend/src/routes/admin.js: add GET and PUT '/form-settings' (see reference). backend/src/routes/misc.js: add
   referenceRouter.get('/form-rules', ...) (see reference).
5. frontend/src/pages/AdminPage.jsx: add the tab ['form-fields', 'Form Fields', 'list'] after Branding, the route
   path="form-fields" and the import of FormFieldsPage.
6. frontend/src/pages/WizardPage.jsx: compare with the reference copy and merge only the Form Fields parts:
   load /reference/form-rules into `form` state; wrap the page in className "fr-scope" (+ "hl-req" when highlightRequired)
   with style --fr-req / --fr-opt; pass `rules` to the validators, StepPatient, StepAttachments and StepReview;
   hide fields set to Hidden; show * or an "Optional" badge per the rules; attachment tags and the step-3 Next button
   follow validateAttachmentsStep(..., rules); hidden fields are sent as null.
7. frontend/src/styles.css: append the block that starts with "/* ---------- Form Fields" from the reference copy.
8. Run migration 011 against the database, then `npm test` and `npm run build`. Report anything that didn't apply cleanly.
```

## Check it

1. Sign in as IT Admin → Admin Settings → **Form Fields**.
2. Set "Relative's mobile" to Required, choose colours, tick "Also mark required boxes", **Save**.
3. Sign in as clinic staff → New Request: the relative's mobile now shows the coloured * and is needed to continue.
