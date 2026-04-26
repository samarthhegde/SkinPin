import { BodyMapEntry, dismissWarningForZone, getBodyMapEntries, getTreatmentLogs, getWarningDismissals, saveTreatmentLog, severityColor } from "@/lib/bodyMap";
import { computeTreatmentEffectiveness, computeTrend, conditionSpreadAcrossZones, hasEscalatingThree, hasSeriousKeyword, severeFor14Days, severityScore } from "@/lib/progression";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Rect } from "react-native-svg";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export default function ProgressionScreen() {
  const { zoneId } = useLocalSearchParams<{ zoneId?: string }>();
  const [entries, setEntries] = useState<BodyMapEntry[]>([]);
  const [allEntries, setAllEntries] = useState<BodyMapEntry[]>([]);
  const [warningSuppressed, setWarningSuppressed] = useState(false);
  const [treatment, setTreatment] = useState("");

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

  const [logs, setLogs] = useState<Awaited<ReturnType<typeof getTreatmentLogs>>>([]);
  useFocusEffect(
    useCallback(() => {
      getTreatmentLogs().then(setLogs);
    }, [])
  );
  const scores = useMemo(() => computeTreatmentEffectiveness(logs), [logs]);

  const saveTreatment = async () => {
    const trimmed = treatment.trim();
    if (!trimmed || !entries.length) return;
    const latest = entries[entries.length - 1];
    await saveTreatmentLog({
      entryId: latest.id,
      treatment: trimmed,
      appliedDate: new Date().toISOString(),
      followUpSeverity: latest.severity,
      followUpDate: new Date().toISOString(),
    });
    setTreatment("");
    setLogs(await getTreatmentLogs());
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Progression</Text>
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
          <Text style={styles.cardTitle}>Treatments tried</Text>
          <View style={styles.treatRow}>
            <TextInput value={treatment} onChangeText={setTreatment} style={styles.input} placeholder="e.g. hydrocortisone" />
            <Pressable style={styles.addBtn} onPress={saveTreatment}>
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          </View>
          {scores.map((score) => (
            <View key={score.treatment} style={{ marginTop: 10 }}>
              <Text style={styles.textLine}>
                {score.treatment} ({score.count}) - {score.successRate}% success
              </Text>
              <Svg width={260} height={14}>
                <Rect x={0} y={0} width={260} height={12} rx={6} fill="#E5E7EB" />
                <Rect x={0} y={0} width={(260 * score.successRate) / 100} height={12} rx={6} fill="#2563EB" />
              </Svg>
            </View>
          ))}
          {!scores.length ? <Text style={styles.muted}>Need at least 3 logs per treatment for scoring.</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F3F4F6" },
  content: { padding: 16, gap: 10, paddingBottom: 30 },
  title: { fontSize: 24, fontWeight: "800", color: "#111827" },
  warnCard: { backgroundColor: "#FEF3C7", borderWidth: 1, borderColor: "#F59E0B", borderRadius: 12, padding: 12, gap: 8 },
  warnText: { color: "#92400E", fontWeight: "600" },
  warnDismiss: { color: "#7C2D12", fontWeight: "700" },
  card: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 12 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 8 },
  textLine: { color: "#374151", marginBottom: 4, textTransform: "capitalize" },
  timelineLabel: { fontSize: 12, color: "#4B5563", marginBottom: 2 },
  treatRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "#FFF" },
  addBtn: { backgroundColor: "#111827", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  addText: { color: "#FFFFFF", fontWeight: "700" },
  muted: { color: "#6B7280", marginTop: 6 },
});
