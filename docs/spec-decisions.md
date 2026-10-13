# Spec decisions and open questions

The build follows *Holiday Dialysis Portal — Screen-by-Screen Functional Specification* (v5).
Where the spec was silent or contradicted itself, this file records what the code does, so the requirements workshop can
confirm or change it. Each item names where to change it.

## Contradictions and gaps resolved in code

| # | Spec says | What the code does | Change it in |
|---|---|---|---|
| 1 | Step 3 "Next" needs MOH, Medical Report **and ID Copy**, but no ID Copy upload field is defined | ID Copy is a required upload | `domain/constants.js` `DOC_TYPES`, `validation.js` `validateAttachmentsStep` |
| 2 | MOD approval "required only if MOD applies", but the MOD flag was removed from Step 2 | Checkbox "MOD approval applies to this patient" on Step 3 (`mod_applies` column) | `WizardPage.jsx`, `validation.js` |
| 3 | §7 says only the Coordination Team marks Completed; §11 matrix also gives it to Clinic Staff | Coordination team that owns the destination type only (§7) | `workflow.js` `RULES.complete` |
| 4 | Status "Pending Provider Email" is used in §6.4/§7 but missing from §3 diagram and §5 filter; "Withdrawn" also missing from the filter | Both are full statuses and appear in filters | `constants.js` `STATUS_ORDER` |
| 5 | Login screen has a password field; §13/§14 say Active Directory SSO and no password table | Dev sign-in now (pick a user); Entra ID SSO is the target (`AUTH_MODE=entra`) | `routes/auth.js`, `docs/next-steps.md` #1 |
| 6 | Confirmed session dates must "reasonably match" travel dates — no tolerance given | Within requested dates ± 2 days | `constants.js` `CONFIRMED_DATES_TOLERANCE_DAYS` |
| 7 | Withdraw notifies the Coordination Team only | Internal: Coordination – Internal **and** the receiving clinic; External: Coordination – International | `services/requests.js` `withdraw` |
| 8 | Dashboard date filter = travel start; Reports date filter unspecified | Reports filter by **submission** date (last 90 days default) | `services/reports.js` |
| 9 | One field for "National ID / Iqama / Passport" — a 9-digit value is ambiguous | ID-type selector next to the field; validation per type | `validation.js` `validateIdentifier` |
| 10 | "Save as Draft" must work with empty fields, but uploads need a stored request | Draft is saved when the user moves to Step 3 or uploads; Cancel on a draft created in this session deletes it | `WizardPage.jsx` |
| 11 | Excel/PDF export | CSV (opens in Excel, UTF-8 BOM) with masked identifiers; PDF export not built yet | `next-steps.md` #5 |
| 12 | Receiving clinic for Internal requests | Your own clinic is never offered; inactive facilities are hidden | `services/reference.js`, `requests.js` `checkFacilityForDraft` |
| 13 | Unlisted international facility | "Not listed — enter name" free text; coordination team types the recipient email when sending | `SendPanel` in `RequestDetailPage.jsx` |
| 14 | Patient master search | Searches patients registered at the user's own clinic(s) (Phase 1 local table; Phase 2 = d.care API) | `services/reference.js` |
| 16 | Which service sends email (§13.3) | IT configures the company SMTP server in Admin Settings → Email (SMTP): SSL/TLS, STARTTLS or relay; sender name/address, reply-to; test connection and test email; delivery log with retry | `services/emailSettings.js`, `EmailSettingsPage.jsx` |
| 17 | Login (§4): AD/SSO, account lockout after 5 attempts | All methods are **off until IT activates them** (nothing changes on install). Admin-configurable Microsoft (Entra ID) sign-in, directory (LDAP/AD) user name + password, and local passwords side by side; lockout N attempts / M minutes; optional auto-create users and role sync from groups; break-glass command | `services/authentication.js`, `AuthSettingsPage.jsx` |
| 19 | Which clinic a user acts for (spec: home clinic submits, receiving clinic confirms) | User name + password sign-in has a **Clinic** field. Staff linked to several clinics must choose one; one clinic is picked automatically; coordination / IT leave it empty. The session then covers that clinic only (lists, approvals, new requests). Microsoft and dev sign-in keep all of the person's clinics | `domain/auth.js` `resolveSignInClinic`, `middleware/auth.js`, `LoginPage.jsx` |
| 18 | Company branding (not in spec) | Admin Settings → Branding: logo, company / clinic name, portal title, sign-in text, contact details on the sign-in page, header and Help. Off until IT switches it on | `services/branding.js`, `BrandingPage.jsx`, `components/Brand.jsx` |
| 15 | Manual patient entry | On submit, matched by MRN + home clinic; if the MRN exists with a different ID number the submit is refused (no silent duplicates — §13.3 "do not create a new patient automatically" spirit) | `requests.js` `resolveManualPatient` |

## Items the spec lists as "to confirm before build" (§13.3) — still open
- d.care APIs, identifiers and fields available in Saudi Arabia; snapshot vs on-demand retrieval.
- Which AD security groups map to each portal role; whether AD clinic attributes are reliable for scope.
- Owner and update frequency of the clinic / provider / branch / email reference lists.
- Which service sends provider email (Microsoft 365 SMTP, shared mailbox, Graph API).
- Retention periods; whether data may leave Saudi Arabia for international requests; write-back to d.care (default: none).
- Malware scanning service for uploads.

## Security posture (current)
- Server-side authorisation on every read and action (`domain/access.js`, `domain/workflow.js`); SQL-level row filter
  for lists; same 404 for "missing" and "not yours".
- Session: httpOnly SameSite=Lax cookie (JWT, 8 h); deactivation and role changes apply on the next request.
- CSRF: writes require `X-Requested-With: hdp`.
- Patient national identifiers encrypted (pgcrypto) with HMAC lookup hash; lists/exports/notifications show masked values.
  **Patient names are not yet encrypted** (spec §14.6) — see next-steps #4.
- Append-only audit trail + status history (DB triggers). Supabase REST API locked out with RLS (no policies).
- Documents in a private bucket; downloads stream through the API (permission-checked and audited).
- Not yet: malware scanning (files are marked `NotScanned`), rate limiting, Entra SSO, data-retention jobs.
