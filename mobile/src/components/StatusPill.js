import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../config';

const TONE = {
  Draft: COLORS.muted, PendingClinicResponse: COLORS.pend, PendingProviderEmail: COLORS.pend,
  SentToProviderAwaitingResponse: COLORS.wait, AlternativeDatesProposed: COLORS.wait,
  Confirmed: COLORS.good, Completed: COLORS.good, Rejected: COLORS.bad, Withdrawn: COLORS.muted,
};
export default function StatusPill({ status, label }) {
  const c = TONE[status] || COLORS.muted;
  return (
    <View style={[s.pill, { backgroundColor: `${c}22`, borderColor: `${c}55` }]}>
      <View style={[s.dot, { backgroundColor: c }]} />
      <Text style={[s.txt, { color: c }]} numberOfLines={1}>{label || status}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, paddingVertical: 3, paddingHorizontal: 9, gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 }, txt: { fontSize: 12, fontWeight: '700' },
});
