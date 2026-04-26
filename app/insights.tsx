import { getBodyMapEntries, getTreatmentLogs } from "@/lib/bodyMap";
import { computeTreatmentEffectiveness } from "@/lib/progression";
import { analyzeTriggers } from "@/lib/triggerAnalyzer";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";

export default function InsightsScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof getBodyMapEntries>>>([]);
  const [logs, setLogs] = useState<Awaited<ReturnType<typeof getTreatmentLogs>>>([]);

  useFocusEffect(
    useCallback(() => {
      getBodyMapEntries().then(setEntries);
      getTreatmentLogs().then(setLogs);
    }, [])
  );

  const report = useMemo(() => analyzeTriggers(entries), [entries]);
  const treatmentScores = useMemo(() => computeTreatmentEffectiveness(logs), [logs]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Pressable style={styles.iconBtn} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={20} color="#111827" />
          </Pressable>
          <Text style={styles.title}>Insights</Text>
          <View style={{ width: 36 }} />
        </View>
        <Text style={styles.note}>Based on your logged history — not a medical diagnosis.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Potential triggers</Text>
          {report.triggers.map((trigger) => (
            <View key={`${trigger.factor}-${trigger.detail}`} style={styles.item}>
              <View style={styles.row}>
                <Text style={styles.itemTitle}>{trigger.factor}</Text>
                <Text style={[styles.badge, trigger.confidence === "likely" ? styles.badgeHigh : styles.badgeMid]}>
                  {trigger.confidence}
                </Text>
              </View>
              <Text style={styles.itemDetail}>{trigger.detail}</Text>
            </View>
          ))}
          {!report.triggers.length ? <Text style={styles.muted}>Not enough signal yet. Add more journal entries.</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recurring patterns</Text>
          {report.recurringPatterns.map((pattern) => (
            <View key={`${pattern.zoneLabel}-${pattern.condition}`} style={styles.item}>
              <Text style={styles.itemTitle}>{pattern.zoneLabel} - {pattern.condition}</Text>
              <Text style={styles.itemDetail}>{pattern.detail}</Text>
            </View>
          ))}
          {!report.recurringPatterns.length ? <Text style={styles.muted}>No recurring interval patterns found yet.</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Treatment effectiveness</Text>
          {treatmentScores.map((score) => (
            <View key={score.treatment} style={{ marginBottom: 10 }}>
              <Text style={styles.itemTitle}>{score.treatment}</Text>
              <Text style={styles.itemDetail}>{score.successRate}% success over {score.count} logs</Text>
              <Svg width={260} height={14}>
                <Rect x={0} y={0} width={260} height={12} rx={6} fill="#E5E7EB" />
                <Rect x={0} y={0} width={(260 * score.successRate) / 100} height={12} rx={6} fill="#2563EB" />
              </Svg>
            </View>
          ))}
          {!treatmentScores.length ? <Text style={styles.muted}>Need at least 3 records per treatment.</Text> : null}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F3F4F6" },
  content: { padding: 16, gap: 10, paddingBottom: 24 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" },
  title: { fontSize: 24, fontWeight: "800", color: "#111827" },
  note: { color: "#4B5563" },
  card: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 12, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  item: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, padding: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  itemTitle: { color: "#111827", fontWeight: "700", textTransform: "capitalize" },
  itemDetail: { color: "#4B5563", marginTop: 4 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, color: "#FFFFFF", overflow: "hidden", textTransform: "capitalize" },
  badgeMid: { backgroundColor: "#F59E0B" },
  badgeHigh: { backgroundColor: "#DC2626" },
  muted: { color: "#6B7280" },
});
