import { useCallback, useLayoutEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { useAuth } from '../auth';
import { COLORS } from '../config';
import StatusPill from '../components/StatusPill';

export default function RequestsScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get('/api/requests?status='); setData(r.rows || []); setError(''); }
    catch (e) { setError(e.message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <TouchableOpacity onPress={signOut}><Text style={{ color: '#fff', fontWeight: '700' }}>Sign out</Text></TouchableOpacity>,
    });
  }, [navigation, signOut]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const clinic = user?.clinics?.[0]?.name;

  if (!data && !error) return <View style={s.center}><ActivityIndicator color={COLORS.green} size="large" /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      {!!clinic && <Text style={s.clinic}>{clinic}</Text>}
      {!!error && <View style={s.err}><Text style={s.errTxt}>{error}</Text></View>}
      <FlatList
        data={data || []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 14, paddingTop: 6 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.green} />}
        ListEmptyComponent={!error && <Text style={s.empty}>No requests yet. Pull down to refresh.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.card} onPress={() => navigation.navigate('RequestDetail', { id: item.id, number: item.requestNumber })}>
            <View style={s.row}>
              <Text style={s.num}>{item.requestNumber}</Text>
              <StatusPill status={item.status} label={item.statusLabel} />
            </View>
            <Text style={s.patient}>{item.patientShort || '—'} · MRN {item.mrnMasked || '—'}</Text>
            <Text style={s.meta}>{item.facilityName || '—'}</Text>
            <Text style={s.meta}>{fmt(item.travelStart)} → {fmt(item.travelEnd)}{item.sessionsRequired ? ` · ${item.sessionsRequired} sessions` : ''}</Text>
            {item.overdue ? <Text style={s.overdue}>Overdue · {item.daysPending} days</Text> : null}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
const fmt = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg },
  clinic: { fontSize: 13, color: COLORS.muted, paddingHorizontal: 16, paddingTop: 12 },
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 },
  num: { fontSize: 15, fontWeight: '800', color: COLORS.text }, patient: { fontSize: 15, color: COLORS.text, marginBottom: 2 },
  meta: { fontSize: 13, color: COLORS.muted }, overdue: { fontSize: 12, color: COLORS.bad, fontWeight: '700', marginTop: 4 },
  empty: { textAlign: 'center', color: COLORS.muted, marginTop: 40 },
  err: { backgroundColor: '#fae3e0', margin: 14, borderRadius: 8, padding: 10 }, errTxt: { color: COLORS.bad },
});
