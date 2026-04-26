import { BodyMapEntry, dismissWarningForZone, getBodyMapEntries, getWarningDismissals, severityColor } from "@/lib/bodyMap";
import { computeTrend, conditionSpreadAcrossZones, hasEscalatingThree, hasSeriousKeyword, severeFor14Days, severityScore } from "@/lib/progression";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export default function ProgressionScreen() {
  const router = useRouter();
  const { zoneId } = useLocalSearchParams<{ zoneId?: string }>();
  const [entries, setEntries] = useState<BodyMapEntry[]>([]);
  const [allEntries, setAllEntries] = useState<BodyMapEntry[]>([]);
  const [warningSuppressed, setWarningSuppressed] = useState(false);

  const load = useCallback(async () => {
    const all = await getBodyMapEntries();
    setAllEntries(all);
    const filtered = zoneId ? all.filter((entry) => entry.zoneId === zoneId) : [];
    setEntries(filtered.sort((a, b) => (a.date < b.date ? -1 : 1)));
    if (zoneId) {
      const dismissals = await getWarningDismissals();
      const dismissedAt = dismissals[zoneId];
      if (dismissedAt) {
        const days = (Date.now() - new Date(dismissedAt).getTime()) / (1000 * 60 * 60 * 24);
        setWarningSuppressed(days < 7);
      } else {
        setWarningSuppressed(false);
      }
    }
  }, [zoneId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const trend = useMemo(() => computeTrend(entries), [entries]);
  const daysSinceFirst = useMemo(() => {
    if (!entries.length) return 0;
    const first = new Date(entries[0].date).getTime();
    return Math.max(0, Math.floor((Date.now() - first) / (1000 * 60 * 60 * 24)));
  }, [entries]);

  const warningNeeded = useMemo(() => {
    if (!entries.length || warningSuppressed) return false;
    const latestCondition = entries[entries.length - 1].condition;
    return (
      severeFor14Days(entries) ||
      hasEscalatingThree(entries) ||
      conditionSpreadAcrossZones(allEntries, latestCondition) ||
      hasSeriousKeyword(latestCondition)
    );
  }, [entries, allEntries, warningSuppressed]);

  const latestJournal = useMemo(() => {
    const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1));
    return sorted.find((entry) => entry.journal)?.journal ?? null;
  }, [entries]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Pressable style={styles.iconBtn} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={20} color="#111827" />
          </Pressable>
          <Text style={styles.title}>Progression</Text>
          <View style={{ width: 36 }} />
        </View>
        {warningNeeded ? (
          <View style={styles.warnCard}>
            <Text style={styles.warnText}>
              This condition may need professional attention. Consider booking a dermatologist appointment.
            </Text>
            <Pressable
              onPress={async () => {
                if (!zoneId) return;
                await dismissWarningForZone(zoneId);
                setWarningSuppressed(true);
              }}>
              <Text style={styles.warnDismiss}>Dismiss for 7 days</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Severity timeline</Text>
          <Svg width={320} height={Math.max(80, entries.length * 34)}>
            {entries.map((entry, idx) => {
              const score = severityScore(entry.severity);
              const pct = score === 3 ? 1 : score === 2 ? 0.6 : 0.3;
              const width = 200 * pct;
              return (
                <Rect
                  key={entry.id}
                  x={110}
                  y={idx * 30 + 8}
                  width={width}
                  height={16}
                  rx={6}
                  fill={severityColor(entry.severity)}
                />
              );
            })}
          </Svg>
          {entries.map((entry) => (
            <Text key={`label-${entry.id}`} style={styles.timelineLabel}>
              {formatDate(entry.date)}  -  {entry.severity}
            </Text>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Summary</Text>
          <Text style={styles.textLine}>Total entries for zone: {entries.length}</Text>
          <Text style={styles.textLine}>Days since first logged: {daysSinceFirst}</Text>
          <Text style={styles.textLine}>Current trend: {trend}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Latest journal context</Text>
          {latestJournal ? (
            <>
              <Text style={styles.textLine}>Products: {latestJournal.productsUsed || "none"}</Text>
              <Text style={styles.textLine}>Sleep: {latestJournal.sleepHours}h</Text>
              <Text style={styles.textLine}>Stress: {latestJournal.stressLevel}</Text>
              <Text style={styles.textLine}>Outdoor: {latestJournal.outdoorTime}</Text>
              <Text style={styles.textLine}>Notes: {latestJournal.dietNotes || "none"}</Text>
            </>
          ) : (
            <Text style={styles.muted}>No journal data saved for this zone yet.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F3F4F6" },
  content: { padding: 16, gap: 10, paddingBottom: 30 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" },
  title: { fontSize: 24, fontWeight: "800", color: "#111827" },
  warnCard: { backgroundColor: "#FEF3C7", borderWidth: 1, borderColor: "#F59E0B", borderRadius: 12, padding: 12, gap: 8 },
  warnText: { color: "#92400E", fontWeight: "600" },
  warnDismiss: { color: "#7C2D12", fontWeight: "700" },
  card: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 12 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 8 },
  textLine: { color: "#374151", marginBottom: 4, textTransform: "capitalize" },
  timelineLabel: { fontSize: 12, color: "#4B5563", marginBottom: 2 },
  muted: { color: "#6B7280", marginTop: 6 },
});
