import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../api';
import { COLORS } from '../config';
import StatusPill from '../components/StatusPill';

const DOC_LABELS = { MOHApproval: 'MOH Approval', MODApproval: 'MOD Approval', MedicalReport: 'Medical Report', SerologyReport: 'Serology Report', IDCopy: 'ID Copy' };
const fmt = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

export default function RequestDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(async () => {
    try { setR(await api.get(`/api/requests/${id}`)); setError(''); } catch (e) { setError(e.message); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const can = (a) => r?.allowedActions?.includes(a);

  async function act(path, body, label) {
    setBusy(label); setError('');
    try { await api.post(`/api/requests/${id}/${path}`, { rowVersion: r.rowVersion, ...body }); await load(); }
    catch (e) { setError(e.message); Alert.alert('Could not complete', e.message); } finally { setBusy(''); }
  }

  function confirmApprove() {
    Alert.alert('Approve request', `Confirm the requested dates (${fmt(r.travelStart)} – ${fmt(r.travelEnd)}) for ${r.patientName}? To confirm different dates, use the web portal.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Approve', onPress: () => act('approve', { confirmedStart: r.travelStart, confirmedEnd: r.travelEnd }, 'approve') }]);
  }
  function confirmWithdraw() {
    Alert.alert('Withdraw request', 'This cancels the request. Continue?', [{ text: 'No', style: 'cancel' }, { text: 'Withdraw', style: 'destructive', onPress: () => act('withdraw', {}, 'withdraw') }]);
  }
  function confirmComplete() {
    Alert.alert('Mark completed', 'Mark this request as completed?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Complete', onPress: () => act('complete', {}, 'complete') }]);
  }
  async function submitReject() {
    if (reason.trim().length < 10) { Alert.alert('Reason too short', 'Please give a reason of at least 10 characters.'); return; }
    setRejecting(false); await act('reject', { reason: reason.trim() }, 'reject'); setReason('');
  }

  async function capture(docType) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Camera needed', 'Allow camera access to photograph the document.'); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: true });
    if (res.canceled) return;
    setBusy(`doc-${docType}`);
    try {
      const asset = res.assets[0];
      const form = new FormData();
      form.append('docType', docType);
      form.append('file', { uri: asset.uri, name: `${docType}.jpg`, type: 'image/jpeg' });
      await api.upload(`/api/requests/${id}/documents`, form);
      await load();
    } catch (e) { Alert.alert('Upload failed', e.message); } finally { setBusy(''); }
  }

  if (!r && !error) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.green} /></View>;
  if (error && !r) return <View style={s.center}><Text style={s.errTxt}>{error}</Text><TouchableOpacity onPress={load} style={s.retry}><Text style={{ color: COLORS.green, fontWeight: '700' }}>Retry</Text></TouchableOpacity></View>;

  const rows = [
    ['Patient', r.patientName], ['MRN', r.mrn], ['Home clinic', r.requestingFacilityName],
    ['Destination', [r.destinationCity, r.destinationCountryName].filter(Boolean).join(', ')],
    ['Receiving facility', r.selectedFacilityName || r.receivingFacilityName || r.freeTextFacility || '—'],
    ['Travel', `${fmt(r.travelStart)} – ${fmt(r.travelEnd)}`], ['Sessions', String(r.sessionsRequired ?? '—')],
  ];
  const canEdit = can('editDraft');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ padding: 16 }}>
      <View style={s.head}>
        <Text style={s.num}>{r.requestNumber}</Text>
        <StatusPill status={r.status} label={r.statusLabel} />
      </View>
      {!!r.waitingOn && <Text style={s.waiting}>{r.waitingOn}</Text>}
      {!!error && <View style={s.errBox}><Text style={s.errTxt}>{error}</Text></View>}

      <View style={s.card}>
        {rows.map(([k, v]) => (
          <View key={k} style={s.kv}><Text style={s.k}>{k}</Text><Text style={s.v}>{v || '—'}</Text></View>
        ))}
      </View>

      {Array.isArray(r.sessionPlan) && r.sessionPlan.length > 0 && (
        <View style={s.card}>
          <Text style={s.cardH}>Treatment days & shifts</Text>
          {r.sessionPlan.map((x) => <Text key={x.date} style={s.v}>{fmt(x.date)} — {x.shift}</Text>)}
        </View>
      )}

      <View style={s.card}>
        <Text style={s.cardH}>Documents</Text>
        {(r.documents || []).length === 0 && <Text style={s.muted}>None yet.</Text>}
        {(r.documents || []).map((d) => (
          <View key={d.id} style={s.docRow}><Text style={s.v}>{DOC_LABELS[d.type] || d.type}</Text><Text style={s.muted}>{d.fileName}</Text></View>
        ))}
        {canEdit && (
          <View style={s.capWrap}>
            {['MOHApproval', 'MedicalReport', 'IDCopy'].map((t) => (
              <TouchableOpacity key={t} style={s.capBtn} onPress={() => capture(t)} disabled={!!busy}>
                {busy === `doc-${t}` ? <ActivityIndicator color={COLORS.green} /> : <Text style={s.capTxt}>📷 {DOC_LABELS[t]}</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <View style={{ gap: 10, marginTop: 6 }}>
        {can('approve') && <Action label="Approve" color={COLORS.good} busy={busy === 'approve'} onPress={confirmApprove} />}
        {can('reject') && <Action label="Reject" color={COLORS.bad} busy={busy === 'reject'} onPress={() => setRejecting(true)} />}
        {can('complete') && <Action label="Mark completed" color={COLORS.green} busy={busy === 'complete'} onPress={confirmComplete} />}
        {can('withdraw') && <Action label="Withdraw" color={COLORS.muted} busy={busy === 'withdraw'} onPress={confirmWithdraw} />}
      </View>

      {(can('proposeDates') || can('acceptProposedDates') || can('sendToProvider') || can('recordProviderApproved')) && (
        <Text style={s.webNote}>Other actions for this request (propose other dates, record a provider reply, send to a provider) are available in the web portal.</Text>
      )}

      <Modal visible={rejecting} transparent animationType="slide" onRequestClose={() => setRejecting(false)}>
        <View style={s.modalWrap}>
          <View style={s.modal}>
            <Text style={s.cardH}>Reason for rejecting</Text>
            <TextInput style={s.reasonInput} value={reason} onChangeText={setReason} multiline placeholder="Explain why (at least 10 characters)" placeholderTextColor={COLORS.muted} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={[s.mBtn, { backgroundColor: COLORS.line }]} onPress={() => setRejecting(false)}><Text style={{ fontWeight: '700', color: COLORS.text }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[s.mBtn, { backgroundColor: COLORS.bad }]} onPress={submitReject}><Text style={{ fontWeight: '700', color: '#fff' }}>Reject request</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Action({ label, color, busy, onPress }) {
  return (
    <TouchableOpacity style={[s.act, { backgroundColor: color }]} onPress={onPress} disabled={busy}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.actTxt}>{label}</Text>}
    </TouchableOpacity>
  );
}
const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg, gap: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  num: { fontSize: 20, fontWeight: '800', color: COLORS.text }, waiting: { color: COLORS.muted, marginBottom: 10 },
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.line, marginBottom: 12 },
  cardH: { fontSize: 15, fontWeight: '800', color: COLORS.text, marginBottom: 8 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: 12 },
  k: { color: COLORS.muted, fontSize: 14 }, v: { color: COLORS.text, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  muted: { color: COLORS.muted, fontSize: 13 },
  docRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 10 },
  capWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  capBtn: { borderWidth: 1, borderColor: COLORS.green, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 }, capTxt: { color: COLORS.green, fontWeight: '700', fontSize: 13 },
  act: { borderRadius: 10, paddingVertical: 14, alignItems: 'center' }, actTxt: { color: '#fff', fontWeight: '800', fontSize: 16 },
  webNote: { color: COLORS.muted, fontSize: 13, marginTop: 14, lineHeight: 18 },
  errBox: { backgroundColor: '#fae3e0', borderRadius: 8, padding: 10, marginBottom: 10 }, errTxt: { color: COLORS.bad, textAlign: 'center' },
  retry: { padding: 10 },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' },
  modal: { backgroundColor: COLORS.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 18 },
  reasonInput: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 10, padding: 12, minHeight: 90, textAlignVertical: 'top', fontSize: 15, color: COLORS.text },
  mBtn: { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
});
