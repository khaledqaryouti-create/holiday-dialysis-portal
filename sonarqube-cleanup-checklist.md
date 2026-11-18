# SonarQube cleanup — Holiday Dialysis Portal (v3 — full backlog)

Consolidated from the issue exports + the structural refactor plan. Work it in **Cursor against your real `HEAD`**
(this container's copy is behind your repo). **Commit per file, run `npm test` after each, commit only if green.**

## Global rules (apply to every item)
- Pure cleanup: **do not change** message text, SQL semantics, status/transition rules, return shapes, JSX markup, or CSS class names.
- New helpers/components are **file-local — do not export**.
- Helpers used inside a DB transaction stay in the scope that holds the `client`/tx.
- **Do not touch** migrations. `seed.sql` only the one `AS` alias (L239), nothing else.
- Leave already-small functions alone.

---

## Bucket C — DO THESE BY HAND FIRST (behavior-sensitive)
These are not blind reshapes. Decide intent before changing.

### C1. "Only the first statement executes conditionally" — likely real bugs (comma/sequence expression)
A guarded line like `if (cond) a(), b();` runs `b()` unconditionally. Read each, decide what was meant, add braces.
- [ ] `backend/src/domain/json.js` — L78  *(and the two L51 items at the top of export 3, same file region — confirm)*
- [ ] `backend/src/domain/logoTidy.js` — L26, L27
- [ ] `backend/src/services/integrations/admin.js` — L63, L94
- [ ] `backend/src/services/integrations/transports.js` — L72
> Fixing these **may change behavior** — that's the point. Add a test capturing the intended behavior where you can.

### C2. Regex — must preserve exactly which strings pass/fail
- [ ] `backend/src/domain/auth.js` L92 — "simplify complexity 25→20" + 2× "remove duplicate chars in character class". Removing duplicates is safe; keep the matched language identical. Add pass/fail cases before editing.
- [ ] `backend/src/domain/branding.js` L96 — simplify hex/contrast regex, same matches.

### C3. Signature changes — update every caller ("move default parameter last")
- [ ] `backend/src/services/formSettings.js` L46
- [ ] `backend/src/services/integrations/admin.js` L91
- [ ] `backend/src/services/terminology.js` L30
- [ ] `backend/src/services/validationSettings.js` L31
- [ ] `backend/src/services/requests.js` L332
- [ ] `backend/src/db/pool.js` L10 — "always return the same type"; confirm all callers handle the unified shape.

### C4. Accessibility — native elements (behavior/visual change — test each)
- [ ] **`<dialog>` instead of `role="dialog"`** — `components/Brand.jsx` L71, `components/DateRangePicker.jsx` L131. **Not a trivial swap:** native `<dialog>` brings its own focus trap, `::backdrop`, `open`/`showModal()`, and Esc handling. Reconcile with the `tabIndex={-1}` + `onKeyDown` DateRangePicker already has; test keyboard + mouse close before and after.
- [ ] `<output>` instead of `role="status"` — `components/PasswordReset.jsx` L32, L98. Low risk; confirm the live region still announces.
- [ ] `<ul>`/`<ol>`/`<menu>` instead of `role="list"` — `components/Timeline.jsx`, and `<li>` instead of `role="listitem"`. Keep classes equivalent; check layout unchanged.

### C5. `await` inside a loop — **DO NOT blanket-convert to `Promise.all`**
Sonar flags every sequential `await` in a loop (migrate.js, jobs/run, jobs/scheduler, reminders, notifications, integrations/listener, and **~20 in integrations/engine + requests.js**). **Many of these are sequential on purpose** — migrations must run in order, the integration engine delivers/retries in order, advisory-lock jobs serialize deliberately, and parallelizing would change ordering, break transaction semantics, or exhaust the connection pool. Treat case-by-case: only parallelize a loop whose iterations are truly independent and safe to run at once; otherwise **leave it sequential** (suppress the rule with a one-line `// NOSONAR` + reason). This is a review, not a mechanical fix.

### C6. CSS — visual change, needs a look (and design sign-off for contrast)
- [ ] Remove `!important` (`styles.css` L7, L496, L560, L678) — often there to win a cascade; removing needs a specificity rework. Check the affected elements still render correctly in light **and** dark.
- [ ] Duplicate selectors (`body`, `.top-in`, `.top-right`, `.top .brand-logo`, `.lv-logo img`, `.btn.danger`) — merge, but confirm which declaration was winning so the merge keeps the intended value.
- [ ] **Contrast below minimum** (`styles.css` L810) — changing a colour is a brand/design decision; get sign-off, don't just darken it.
- [ ] Add `prefers-reduced-motion` guard (L716) — safe additive change.

### C7. "Opposite operator" (pitfall) — glance before applying
- [ ] `domain/integrations.js` L69 (`!==`), `domain/validation.js` L125 (`<=`), `jobs/scheduler.js` L59 (`<=`). Usually a safe simplification, but an operator flip changes `NaN`/edge behavior — confirm the condition's intent before flipping.

---

## Bucket A — Structural (reduce Cognitive Complexity / nesting). Split into file-local helpers/sub-components.
Backend domain/server splits: follow the detailed refactor plan (attachment 1) — auth, branding, inputRules, patients,
validation, fhir, json, payloads, integrations, logoTidy, config, smtp, middleware/auth, admin, authentication,
integrations/admin, integrations/engine, requests.

Frontend pages (from export 2) — do largest **last and in their own commit**, then manually click the page through every state:
- [ ] `Timeline.jsx` L5 — CC 35
- [ ] `AuthSettingsPage.jsx` L17 — CC 21
- [ ] `BrandingPage.jsx` L22 — CC 25
- [ ] `ChangePasswordPage.jsx` L9 — CC 20
- [ ] `DashboardPage.jsx` L18 — CC 19
- [ ] `EmailSettingsPage.jsx` L21 — CC 32
- [ ] `IntegrationsPage.jsx` L251 — CC 34
- [ ] `LoginPage.jsx` L29 — CC 23; L193 — CC 16
- [ ] `PatientsPage.jsx` L132 — CC 26
- [ ] `WizardPage.jsx` L248 / L249 — nesting >5 deep (lift inner fns out); L259 — CC 16; L364 — CC 16
- [ ] `RequestDetailPage.jsx` L18 — CC 42; L338 — CC 19; L349 — CC 23
- [ ] **`RequestDetailPage.jsx` L583 — CC 66 — its own commit; verify every action, document, proposal & timeline state renders.**

---

## Bucket B — Mechanical style (safe). Hoist to a `const`, or swap the method.

### "Prefer top-level await"
- [ ] `backend/db/migrate.js` L43
- [ ] `backend/db/seed.js` L63
- [ ] `backend/db/set-password.js` L23
- [ ] `backend/src/jobs/reminders.js` L69
- [ ] `backend/src/server.js` L30

### `String#startsWith` / `AS` alias
- [ ] `backend/src/domain/integration/fhir.js` L25 — use `startsWith`
- [ ] `backend/db/seed.sql` L239 — add `AS` before alias

### "Extract nested ternary into a statement" — hoist to a named `const`
- [ ] `domain/validation.js` L38
- [ ] `domain/integration/cda.js` L108, L110
- [ ] `domain/integration/fhir.js` L29, L133, L142
- [ ] `domain/integration/hl7v2.js` L133
- [ ] `domain/integration/json.js` L50, L51
- [ ] `jobs/run.js` L17
- [ ] `lib/ldap.js` L28, L33, L34
- [ ] `services/authSettings.js` L117, L118
- [ ] `services/authentication.js` L101
- [ ] `services/emailSettings.js` L71, L102
- [ ] `services/formSettings.js` L21
- [ ] `services/integrations/engine.js` L136, L295, L330, L331, L341, L354, L360, L363, L489
- [ ] `services/integrations/transports.js` L41, L58
- [ ] `services/patients.js` L33
- [ ] `services/reports.js` L11, L71
- [ ] `services/requests.js` — (ternary, line per export)

### "No nested template literals" — pull inner `${…}` into a `const` first
- [ ] `domain/dates.js` L40
- [ ] `domain/inputRules.js` L66
- [ ] `domain/integration/cda.js` L15, L16, L62, L80
- [ ] `domain/integration/fhir.js` L67
- [ ] `domain/integration/hl7v2.js` L90
- [ ] `jobs/run.js` L17
- [ ] `services/authSettings.js` L163
- [ ] `services/emailSettings.js` L102
- [ ] `services/integrations/engine.js` L187, L194, L256, L341, L529
- [ ] `services/integrations/transports.js` L33
- [ ] `services/mailer.js` L61 (×2)
- [ ] `services/storage.js` L50
- [ ] `services/requests.js` L810, L865, L883, L886
- [ ] `frontend/src/App.jsx` L70, L88
- [ ] `components/DateRangePicker.jsx` L125, L147

### v2 additions — nested ternary → `const`
- [ ] `services/terminology.js` L17 · `services/validationSettings.js` L18
- [ ] `services/requests.js` L305, L758, L759
- [ ] `components/DateRangePicker.jsx` L119, L125, L128, L159 · `components/PasswordReset.jsx` L96, L101 · `components/Timeline.jsx` L15, L16, L18, L19

---

## Bucket D — React correctness / perf (safe, behavior-neutral if deps are right)
- [ ] **`useMemo` the Context `value`** — `frontend/src/auth.jsx` L26, `frontend/src/branding.jsx` L31. Wrap the provider value and list every field it reads as deps, so consumers don't re-render each tick. (auth.jsx especially — it drives the whole app.)
- [ ] Missing `key` prop — `frontend/src/components/Brand.jsx` L42–46.
- [ ] Stable `key` instead of array index — `components/DateRangePicker.jsx` L151, `components/LoginVisual.jsx` L53, L56, `TreatmentDaysPicker.jsx` L97, and the `RequestDetailPage.jsx` key items (L134 missing, L432/stable-id). Use a stable id (the iso date), not the index.
- [ ] `useMemo` the Context `value` also in `frontend/src/components/ui.jsx` L21 and `frontend/src/terms.jsx` L35 (same as auth.jsx/branding.jsx).
- [ ] Move a component defined inside its parent out to module scope, pass data as props — `WizardPage.jsx` L500.

---

## Bucket B2 — Low-severity safe bulk (mostly `eslint --fix`-able — do it in one pass, then review the diff)
Run `eslint --fix` on `backend/` and `frontend/`, and a stylelint pass for the CSS duplicate selectors, to clear most of these at once. Then eyeball the diff. Families in the backlog:
- [ ] Remove **unused imports** (RequestDetailPage, DashboardPage, PatientsPage, WizardPage, BrandingPage, ui.jsx, requests.js `badRequest`, …) and **duplicate imports** (`@domain/constants.js` in RequestDetailPage).
- [ ] **Optional chaining** (`?.`) — branding, fhir, hl7v2, integrations, middleware/auth, routes/auth, routes/integrations, admin, requests, passwordReset, IntegrationsPage.
- [ ] **`.at(…)`** over `slice()[0]` / `[len-i]` — cda, fhir, hl7v2, validation, TreatmentDaysPicker.
- [ ] **`RegExp.exec()`** over `.match()` and **`String.raw`** for regex — cda, hl7v2, json, routes/integrations. *(Preserve `/g` `lastIndex` semantics where a regex is reused.)*
- [ ] **`Number` directly** instead of `(x) => Number(x)` — pool.js, domain/auth.js.
- [ ] **`export … from`** re-exports — integrations/admin (`CONFIG_FIELDS`), engine (`formatOf`), requests (`ACTIVE_STATUSES`, `FACILITY_TYPE`), lib/format (`fmtDate`/`fmtRange`/`daysBetween`).
- [ ] **catch param → `error_`** convention (many pages) · **merge `Array#push`** (access.js L64) · **remove useless empty-object spread** (integrations.js, errorHandler.js, IntegrationsPage) · **`.some()` over `.find()`** (IntegrationsPage L326) · **numeric group length** (engine L382) · **move nested fn to outer scope** (LoginPage `rememberedClinic` L64, `clinicLabel` L182).
- [ ] **Info/TODO** comments (migrations/001 L98, requests.js) — address or remove; no code change required.

> `errorHandler.js` L14 "useless empty object" — that's the `...(config.isProd ? {} : {debug})` spread. Fixing it is cosmetic; keep the prod/dev behavior identical.

---

## Suggested order
1. **Bucket B2** — one `eslint --fix` / stylelint pass, review the diff, commit. Clears most of the Low tier at once.
2. **Bucket B** (nested ternaries/templates, top-level await) — mechanical.
3. **Bucket D** (small, safe React fixes).
4. **Bucket C** by hand (real bugs + regex + signatures + `<dialog>` a11y + **the `await`-in-loop review** + CSS/contrast).
5. **Bucket A** structural: backend splits (unit-tested), then frontend pages, **RequestDetailPage L583 last and alone**.

This backlog now looks complete (High → Info). If `eslint --fix` is wired to your config, Bucket B2 is the single biggest time-saver — do it first.

## Verify after each file
- `npm test` in `backend/` fully green.
- Frontend pages have no unit tests — click them through manually: header links (signed-in), date dialog by mouse + arrows/Enter/Escape, reset-password loading/invalid/form, and RequestDetail every action/document/proposal/timeline state.
