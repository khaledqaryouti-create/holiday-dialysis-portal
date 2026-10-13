# Next steps — ready-to-paste Cursor prompts

Work through these in order. Each prompt is written for Cursor's Agent (Ctrl/Cmd+I). The project rules in
`.cursor/rules/` load automatically; keep `npm test` green after each step.

---

### 1. Sign-in — done
Microsoft (Entra ID), directory (LDAP/AD) and local passwords are built (Admin Settings → Sign-in & Directory).
Optional follow-up prompt:
> Add Microsoft Graph group lookup for users with more than 200 groups (the "groups overage" case in `lib/oidc.js`):
> when `groupsOverage` is true, call `https://graph.microsoft.com/v1.0/me/memberOf` with the access token (needs
> GroupMember.Read.All, admin-consented) and pass the group IDs to `provisionUser`. Add a unit test.

### 2. d.care patient lookup (spec §13 Phase 2)
> Add `backend/src/services/dcare.js` with `searchPatients(user, q)` and `getPatient(dcareId)` calling the d.care REST API
> (env `DCARE_BASE_URL`, `DCARE_CLIENT_ID`, `DCARE_CLIENT_SECRET`; OAuth client-credentials). Log every call in `integration_log`
> (no patient data in error text). When `DCARE_ENABLED=true`, `/api/reference/patients` uses d.care and upserts a `patient_reference`
> row keyed by `dcare_patient_id` (source_system 'DCare', source_retrieved_at now()). Keep the local search as fallback when disabled.
> Never create a patient when d.care returns no unique match.

### 3. Malware scanning of uploads (spec §14.5 Files)
> Add a scanning step for uploads: new `services/scanner.js` with a pluggable driver (`clamav` via `clamscan` TCP to `CLAMAV_HOST`,
> or `none`). Set `malware_scan_status` to 'Pending' on upload, scan synchronously for files ≤ 10 MB, then 'Clean' or 'Infected'.
> Infected files: delete from storage, keep the row, block submit and download, audit `MalwareDetected`. Add unit tests for the status logic.

### 4. Encrypt patient names (spec §14.6)
> Write migration `003_encrypt_patient_names.sql` adding `full_name_enc bytea` and `name_search_tokens text[]` (HMAC of
> lower-cased name tokens) to `patient_reference`; backfill from `full_name` using `current_setting('app.field_key')`; then drop `full_name`.
> Update `services/requests.js`, `reference.js` and `reports.js` to decrypt with `pgp_sym_decrypt` and search by token hash.
> Keep the API response shapes unchanged.

### 5. Excel and PDF exports (spec §5, §8)
> Replace CSV export with real `.xlsx` using `exceljs` (one sheet, header row bold, frozen, column widths, dates as dates)
> for `/api/requests/export.xlsx` and `/api/reports/export.xlsx`, and add `/api/reports/export.pdf` using `pdfkit` with the
> KPI totals and the status/destination tables. Keep identifiers masked and audit each export. Update the Export buttons to offer both.

### 6. Controlled Excel import of reference lists (spec §13.1)
> In Admin Settings → Facilities & Providers add "Import from Excel": upload `.xlsx` with columns provider ID, provider, branch, city,
> country code, primary email, CC email, active, last verified date. Validate every row (duplicate codes, bad emails, unknown country),
> show a preview with accepted/rejected rows, then apply in one transaction. Record a `reference_import_batch` row and audit it.

### 7. Deployment
> Add a `Dockerfile` (node:22-alpine, `npm ci`, `npm run build`, `npm start`), a `docker-compose.yml` for local Postgres, and a
> GitHub Actions workflow that runs `npm ci`, `npm test`, builds the frontend, and runs `npm run test:api` against a Postgres
> service container (`DATABASE_SSL=disable`, migrate + seed first). Document Azure App Service (Saudi region if required) settings in README.

### 8. Browser end-to-end tests
> Add Playwright tests in `frontend/e2e/` covering: clinic staff creates and submits an internal request; receiving clinic approves;
> coordination team sends and records an external reply; withdraw; complete; admin adds a user. Use the dev sign-in and the seed data.

### 9. Retention and housekeeping (spec §13.3, §14.6)
> Add `jobs/retention.js` that, given `RETENTION_YEARS_REQUESTS` and `RETENTION_YEARS_DOCUMENTS`, removes expired document files
> from storage (keeping metadata rows with `is_current=false`) and reports what it would delete in dry-run mode. Never touch audit_event.

### 10. Arabic / RTL (if required)
> Add i18n with a small `t()` helper and `en`/`ar` JSON dictionaries in `frontend/src/i18n/`; switch `dir="rtl"` on `<html>` for Arabic;
> convert directional CSS (margin-left etc.) to logical properties. Keep server messages in English with stable `code`s the UI can translate.
