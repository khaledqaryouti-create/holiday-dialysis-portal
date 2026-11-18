# Security test suite (`security/pentest.mjs`)

An on-demand security check for the Holiday Dialysis Portal. It runs **outside** the portal and is never imported by
the server, so it **cannot affect live performance**. It is **read-only** — a bounded set of sequential requests that
create and delete nothing (verified: the request count is unchanged before/after a run). It is not a load test.

## Rules before you run it
- **Test site or a local copy only.** Never run it against the production site that holds real patient data.
- Get **written sign-off** from whoever owns the deployment first.
- Don't put it on a schedule or in a health check. Run it by hand when you want a check, e.g. before a release.

## Run it

Local copy (development sign-in on):
```
TARGET=http://localhost:4100 node security/pentest.mjs
```

Your Vercel **test** site (real sign-in). Supply two clinic-staff accounts in **different** clinics, and optionally an
IT admin, so it can test that one clinic can't see another's data:
```
TARGET=https://holiday-dialysis.dev \
PENTEST_USERS='[{"username":"a@x.com","password":"...","clinicId":"<clinic-A-id>"},
                {"username":"b@x.com","password":"...","clinicId":"<clinic-B-id>"},
                {"username":"admin@x.com","password":"...","role":"admin"}]' \
node security/pentest.mjs
```
Clinic IDs come from the sign-in page's Clinic list (or ask IT). Use throwaway test accounts, not real staff logins.

Options:
- `SKIP_LOCKOUT=1` — skip the lockout probe. (It otherwise makes a few failed logins on a **random fake** user name,
  which cannot lock a real account.)
- `INBOUND_ID=<connection-uuid>` — also confirm that connection's EMR inbound endpoint returns 401 without a key.

Exit code is `1` if anything FAILs, else `0`, so you can use it in a pre-release check.

## What it checks
1. **Transport & headers** — CSP, `X-Content-Type-Options: nosniff`, clickjacking protection, no `X-Powered-By`, HSTS on https.
2. **Authentication required** — protected endpoints refuse anonymous callers; errors don't leak stack traces.
3. **CSRF guard** — a POST without the `X-Requested-With: hdp` header is refused (403).
4. **Access control (IDOR)** — one clinic's staff cannot read or act on another clinic's request; guessed/malformed IDs are refused.
5. **Role separation** — clinic staff cannot reach or write any `/api/admin/*` endpoint.
6. **Input handling** — SQL/XSS/path-traversal probes in search cause no server error and aren't reflected as HTML; oversized and malformed bodies are rejected cleanly.
7. **Integration endpoints** — the inbound EMR endpoint needs an API key; the jobs endpoint needs `CRON_SECRET`.
8. **Password reset** — the same answer for a known and an unknown email (no account fishing).
9. **Brute-force lockout** — the account locks after repeated failures.

## Reading the result
- **PASS** — the protection works.
- **FAIL** — fix before go-live; listed again at the end.
- **WARN** — review. On a **local dev** run the three header checks warn, because the dev harness stubs out `helmet`;
  they turn into PASS on Vercel or a real `npm start` build. Run the suite against the test site to confirm the headers.
- **SKIP** — not applicable (e.g. development sign-in is on, or no second account was supplied).

## This is not everything
A script covers the portal's own logic well. Round it out with:
- **`npm audit`** in `backend/` and `frontend/` — known vulnerabilities in dependencies.
- **OWASP ZAP** (free) — point its baseline scan at the test site to spider the UI and catch anything generic.
- **Supabase** — confirm Row Level Security is enabled on every table and `SESSION_SECRET` / `FIELD_ENCRYPTION_KEY`
  are long random values, not the examples.
- A professional review before handling real patient data, as your compliance process requires.
