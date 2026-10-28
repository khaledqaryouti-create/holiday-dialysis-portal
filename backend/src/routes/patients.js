// My Requests → Patients (clinic staff for their clinic, IT admins for any clinic).
import { Router } from 'express';
import { ah } from '../lib/errors.js';
import { requireRole } from '../middleware/auth.js';
import { ROLES } from '../domain/constants.js';
import * as patients from '../services/patients.js';
import * as engine from '../services/integrations/engine.js';
import { searchPatients } from '../services/reference.js';

export const patientsRouter = Router();
patientsRouter.use(requireRole(ROLES.CLINIC_STAFF, ROLES.IT_ADMIN));
patientsRouter.get('/', ah(async (req, res) => res.json(await patients.listPatients(req.user, req.query))));
patientsRouter.get('/clinics', ah(async (req, res) => res.json(await patients.patientClinics(req.user))));
// Live MRN lookup in the EMR (clinic staff, their clinic only)
patientsRouter.get('/emr-lookup', ah(async (req, res) => res.json(await engine.lookupMrn(req.user, String(req.query.mrn || '').replace(/\s+/g, '')))));
patientsRouter.post('/emr-import', ah(async (req, res) => {
  const mrn = String(req.body?.mrn || '').trim();
  const id = await engine.importFromLookup(req.user, req.body?.connectionId, mrn);
  const found = (await searchPatients(req.user, mrn)).find((p) => p.id === id);
  res.json(found || { id });
}));
patientsRouter.post('/', ah(async (req, res) => res.status(201).json(await patients.createPatient(req.user, req.body || {}, req.ip))));
patientsRouter.patch('/:id', ah(async (req, res) => res.json(await patients.updatePatient(req.user, req.params.id, req.body || {}, req.ip))));
