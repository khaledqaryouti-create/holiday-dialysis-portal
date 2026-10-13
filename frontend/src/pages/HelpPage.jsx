import { StatusPill } from '../components/ui.jsx';
import { hasContact } from '@domain/branding.js';
import { useBranding } from '../branding.jsx';
import { ContactList } from '../components/Brand.jsx';
import { STATUS_ORDER } from '@domain/constants.js';

const MEANING = {
  Draft: 'Saved but not submitted. Only the creator can see it.',
  PendingClinicResponse: 'Internal request waiting for the receiving clinic.',
  PendingProviderEmail: 'External request waiting for the coordination team to email the provider.',
  SentToProviderAwaitingResponse: 'Emailed to the provider; waiting for their reply.',
  Confirmed: 'Sessions confirmed. Confirmation letter available.',
  Completed: 'Travel finished and the request is closed.',
  Rejected: 'Not accepted by the clinic or provider.',
  Withdrawn: 'Cancelled by the requesting clinic.',
};

export default function HelpPage() {
  const brand = useBranding();
  return (
    <>
      <div className="page-head"><div><h1>Help & Support</h1><p>How requests move through the portal, and who does what.</p></div></div>
      <div className="help-grid">
        {brand.enabled && hasContact(brand.contact) && (
          <div className="card pad"><h3>Contact {brand.companyName}</h3>
            {brand.clinicName && <p className="muted small" style={{ marginTop: 2 }}>{brand.clinicName}</p>}
            <div style={{ marginTop: 12 }}><ContactList c={brand.contact} /></div></div>
        )}
        <div className="card pad"><h3>Creating a request</h3><ul>
          <li>Get MOH approval (and MOD approval if it applies) before you start.</li>
          <li>Use <b>New Request</b> and complete the four steps. Save as draft at any time.</li>
          <li>Files: PDF, JPG or PNG up to 10 MB. Approvals can also be EML.</li>
          <li>Drafts are visible only to you until submitted.</li></ul></div>
        <div className="card pad"><h3>Where a request goes</h3><ul>
          <li><b>Internal:</b> straight to the receiving network clinic, which approves or rejects in the portal.</li>
          <li><b>External KSA / International:</b> to the Coordination Team – International, who email the provider and record the reply on the same request.</li>
          <li>External providers, MOH and MOD have no portal accounts.</li></ul></div>
        <div className="card pad"><h3>After a decision</h3><ul>
          <li>Confirmed requests get a confirmation letter you can download.</li>
          <li>The coordination team marks the request completed after travel ends.</li>
          <li>You can withdraw a request any time before it is confirmed.</li>
          <li>If a request is rejected, submit a new one to rebook.</li></ul></div>
      </div>
      <div className="card pad" style={{ marginTop: 16 }}><h3 style={{ marginBottom: 14 }}>Status meanings</h3>
        <div className="status-defs">{STATUS_ORDER.map((s) => <Row key={s} s={s} />)}</div></div>
    </>
  );
}
const Row = ({ s }) => <><StatusPill status={s} /><span>{MEANING[s]}</span></>;
