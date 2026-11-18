import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { api } from '../api';
import { useAuth } from '../auth';
import { COLORS } from '../config';

export default function LoginScreen() {
  const { signIn, options } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clinics, setClinics] = useState([]);
  const [clinicId, setClinicId] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.get('/api/auth/clinics').then((r) => setClinics(r.clinics || [])).catch(() => {}); }, []);

  async function submit() {
    setError(''); setBusy(true);
    try { await signIn(username.trim(), password, clinicId); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.green }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <Text style={s.brand}>Holiday Dialysis</Text>
        <Text style={s.sub}>Coordination Portal</Text>
        <View style={s.card}>
          <Text style={s.h}>Sign in</Text>
          {!!error && <View style={s.err}><Text style={s.errTxt}>{error}</Text></View>}
          <Text style={s.label}>Work email</Text>
          <TextInput style={s.input} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false}
            keyboardType="email-address" placeholder="name@company.com" placeholderTextColor={COLORS.muted} />
          <Text style={s.label}>Password</Text>
          <View style={s.pwRow}>
            <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} value={password} onChangeText={setPassword} secureTextEntry={!show} placeholder="••••••••" placeholderTextColor={COLORS.muted} />
            <TouchableOpacity onPress={() => setShow(!show)} style={s.showBtn}><Text style={{ color: COLORS.green, fontWeight: '700' }}>{show ? 'Hide' : 'Show'}</Text></TouchableOpacity>
          </View>
          {clinics.length > 0 && (
            <>
              <Text style={s.label}>Clinic</Text>
              <View style={s.clinicWrap}>
                {clinics.map((c) => (
                  <TouchableOpacity key={c.id} style={[s.clinic, clinicId === c.id && s.clinicOn]} onPress={() => setClinicId(clinicId === c.id ? '' : c.id)}>
                    <Text style={[s.clinicTxt, clinicId === c.id && { color: '#fff' }]}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={s.hint}>Choose the clinic you are working at. Coordination staff can leave this unset.</Text>
            </>
          )}
          <TouchableOpacity style={[s.btn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnTxt}>Sign in</Text>}
          </TouchableOpacity>
        </View>
        <Text style={s.foot}>Every sign-in is recorded.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const s = StyleSheet.create({
  wrap: { padding: 22, paddingTop: 80, minHeight: '100%' },
  brand: { color: '#fff', fontSize: 28, fontWeight: '800' }, sub: { color: '#cfe0d6', fontSize: 15, marginBottom: 26 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20 },
  h: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: COLORS.text, marginBottom: 14, backgroundColor: '#fff' },
  pwRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }, showBtn: { paddingHorizontal: 10, paddingVertical: 10 },
  clinicWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  clinic: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
  clinicOn: { backgroundColor: COLORS.green, borderColor: COLORS.green }, clinicTxt: { color: COLORS.text, fontWeight: '600', fontSize: 13 },
  hint: { fontSize: 12, color: COLORS.muted, marginBottom: 8 },
  btn: { backgroundColor: COLORS.orange, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10 }, btnTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  err: { backgroundColor: '#fae3e0', borderRadius: 8, padding: 10, marginBottom: 12 }, errTxt: { color: COLORS.bad, fontSize: 14 },
  foot: { color: '#9fb6a8', fontSize: 12, textAlign: 'center', marginTop: 18 },
});
