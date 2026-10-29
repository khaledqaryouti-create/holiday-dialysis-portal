# Treatment days & shifts — New Request, step 2

Replaces "Number of sessions needed" with a calendar of the trip:
- After choosing the **travel dates**, a calendar of that period appears. **Click each day** the patient needs dialysis. Days outside the trip, or in the past, are crossed out.
- Each chosen day is listed with its **shift** (Morning / Afternoon / Evening) and an **✕** to remove it. A new day takes the last shift used, and **Apply to all** sets one shift for every day.
- **Quick select:** *Sun · Tue · Thu* or *Mon · Wed · Sat* fills a 3-times-a-week schedule in one click. **Clear all** empties the list.
- The **number of sessions is counted automatically** from the days chosen.
- The days and shifts appear in **Review & Submit**, on the **request details** (seen by the receiving clinic / coordination team), on the **confirmation letter**, and in **EMR messages**:
  - JSON: `treatmentDays`
  - FHIR: a ServiceRequest note
  - HL7 v2: an NTE segment
  - CDA: a table row
- Changing the travel dates drops chosen days that fall outside the new dates. The server checks again on submit: at least one day, all within the trip, none in the past.
- The shift names can be renamed in **Admin Settings → Terminology** (group "Shifts"), as can the field name "Treatment days & shifts".

This update also fixes a problem in the **Terminology** update: when the portal loaded the wording, it could redraw the page and clear what someone had just typed. Now it only redraws after an admin saves the Terminology page (`frontend/src/terms.jsx`).

> Apply after the Terminology and Integrations updates. This one adds to both.

## Install
1. Run **`017_session_plan.sql`** on the database. It is safe to run twice.
2. Unzip into the project folder and paste the prompt below into Cursor.

## Paste this into the Cursor Agent

```
Apply the "Treatment days & shifts" update from the folder treatment-days-update (unzipped in the project root).
MERGE carefully — keep my layout, wording, MRN-first order, Form Fields, Validation Rules, Patients, Integrations,
Terminology and any changes I made; only overwrite files marked NEW.

1. NEW files (copy): backend/db/migrations/017_session_plan.sql, backend/src/domain/sessionPlan.js,
   backend/test/unit/sessionPlan.test.js, frontend/src/components/TreatmentDaysPicker.jsx
2. backend/src/domain/validation.js: import { normalizePlan, planError } from './sessionPlan.js'; in
   validateDestinationStep replace the "sessionsRequired" check with the sessionPlan check from the reference
   (error key: sessionPlan).
3. backend/src/services/requests.js (compare with the reference, change only these parts):
   - import { normalizePlan } from '../domain/sessionPlan.js'
   - REQ_COLS: add r.session_plan; mapRequest: add sessionPlan: normalizePlan(x.session_plan)
   - sanitizeDraft: out.sessionPlan = normalizePlan(body.sessionPlan); sessionsRequired = number of days (fallback to the old
     number only when no days are sent)
   - writeDraftFields: also set session_plan = <json>::jsonb
   - draftInputs: pass sessionPlan: r.sessionPlan
4. backend/src/services/letters.js: add the "Requested days & shifts" row (planText) after "Sessions requested".
5. backend/src/domain/terminology.js: add the 'field.treatmentDays' term and the "Shifts" group (from SHIFTS).
6. Integrations (if installed): engine.js snapshot adds r.session_plan → sessionPlan; json.js adds treatmentDays;
   hl7v2.js / fhir.js / cda.js add the "Treatment days" note/row using planText; payloads.js sample adds sessionPlan.
7. frontend/src/terms.jsx: use the reference version (first load happens before the app shows; only refresh() after
   saving the Terminology page re-draws the app).
8. frontend/src/pages/WizardPage.jsx: merge ONLY these parts from the reference:
   - imports of TreatmentDaysPicker / shortDay / shiftLabel / normalizePlan
   - sessionPlan: [] in the blank draft, loading it from the draft, sending sessionPlan in the payload
   - step 2: replace the "Number of sessions needed" input with <TreatmentDaysPicker …/> (label t('field.treatmentDays'))
   - travel dates onChange also drops chosen days outside the new dates
   - the step-2 Next check uses d.sessionPlan.length > 0
   - the Review row shows the list of days and shifts
   Keep everything else of mine.
9. frontend/src/pages/RequestDetailPage.jsx: add the "Treatment days & shifts" row after "Sessions requested".
10. backend/test/unit/validation.test.js and backend/test/api/flow.test.js: use sessionPlan instead of sessionsRequired (see reference).
11. frontend/src/styles.css: append the block starting "/* ---------- New Request: Treatment days & shifts".
12. Run migration 017 (safe to run again), then npm test and npm run build. Report anything that didn't apply cleanly.
```

## Check it
1. Open New Request and go to step 2.
2. Choose travel dates, then click two days on the calendar.
3. Set one of them to **Afternoon shift**, then click **Sun · Tue · Thu**.
4. Go Next to Review: the days and shifts are listed. Submit, and the request details show them too.
