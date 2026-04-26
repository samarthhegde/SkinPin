import { BodyMapDiagram } from "@/components/body-map-diagram";
import { BodyMapEntry, BodyView, getBodyMapEntries, severityColor } from "@/lib/bodyMap";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function BodyMapScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<BodyMapEntry[]>([]);
  const [view, setView] = useState<BodyView>("front");
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    const all = await getBodyMapEntries();
    setEntries(all);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadEntries();
    }, [loadEntries])
  );

  const entriesForSelectedZone = useMemo(
    () =>
      selectedZoneId
        ? entries
            .filter((entry) => entry.zoneId === selectedZoneId)
            .sort((a, b) => (a.date < b.date ? 1 : -1))
        : [],
    [entries, selectedZoneId]
  );

  const recentEntries = useMemo(
    () => [...entries].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30),
    [entries]
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>Body Map</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable style={[styles.addBtn, { backgroundColor: "#4C1D95" }]} onPress={() => router.push("/insights")}>
            <Text style={styles.addBtnText}>Insights</Text>
          </Pressable>
          <Pressable
            style={styles.addBtn}
            onPress={() =>
              router.push({
                pathname: "/body-zone-picker",
                params: { condition: "Manual entry", severity: "mild", returnTo: "/body-map" },
              })
            }>
            <Text style={styles.addBtnText}>+ Add</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.toggleRow}>
        <Pressable style={[styles.toggleBtn, view === "front" && styles.toggleBtnActive]} onPress={() => setView("front")}>
          <Text style={[styles.toggleText, view === "front" && styles.toggleTextActive]}>Front</Text>
        </Pressable>
        <Pressable style={[styles.toggleBtn, view === "back" && styles.toggleBtnActive]} onPress={() => setView("back")}>
          <Text style={[styles.toggleText, view === "back" && styles.toggleTextActive]}>Back</Text>
        </Pressable>
      </View>

      <View style={styles.diagramWrap}>
        <BodyMapDiagram
          view={view}
          entries={entries}
          onDotPress={(zoneId) => {
            setSelectedZoneId(zoneId);
            router.push({ pathname: "/progression", params: { zoneId } });
          }}
        />
      </View>

      <View style={styles.legendRow}>
        <Text style={styles.legendItem}>● Mild</Text>
        <Text style={[styles.legendItem, { color: "#D97706" }]}>● Moderate</Text>
        <Text style={[styles.legendItem, { color: "#DC2626" }]}>● Severe</Text>
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        {recentEntries.map((entry) => (
          <View key={entry.id} style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.cardCondition}>{entry.condition}</Text>
              <View style={[styles.badge, { backgroundColor: severityColor(entry.severity) }]}>
                <Text style={styles.badgeText}>{entry.severity}</Text>
              </View>
            </View>
            <Text style={styles.cardMeta}>{entry.zoneLabel}</Text>
            <Text style={styles.cardMeta}>{formatDate(entry.date)}</Text>
            <Text style={styles.cardMeta}>Photo path: {entry.photoPath || "none"}</Text>
            <Pressable
              style={{ marginTop: 8, alignSelf: "flex-start", backgroundColor: "#111827", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
              onPress={() => router.push({ pathname: "/progression", params: { zoneId: entry.zoneId } })}>
              <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 12 }}>View progression</Text>
            </Pressable>
          </View>
        ))}
        {recentEntries.length === 0 ? <Text style={styles.emptyText}>No body map entries yet.</Text> : null}
      </ScrollView>

      <Modal visible={selectedZoneId !== null} transparent animationType="slide" onRequestClose={() => setSelectedZoneId(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Entries in this zone</Text>
            <ScrollView style={{ maxHeight: 240 }}>
              {entriesForSelectedZone.map((entry) => (
                <View key={entry.id} style={styles.modalCard}>
                  <Text style={styles.cardCondition}>{entry.condition}</Text>
                  <Text style={styles.cardMeta}>{entry.zoneLabel}</Text>
                  <Text style={styles.cardMeta}>{formatDate(entry.date)}</Text>
                </View>
              ))}
              {entriesForSelectedZone.length === 0 ? <Text style={styles.emptyText}>No entries in this zone.</Text> : null}
            </ScrollView>
            <Pressable style={styles.closeBtn} onPress={() => setSelectedZoneId(null)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F3F4F6", paddingHorizontal: 16, paddingTop: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  title: { fontSize: 24, fontWeight: "800", color: "#111827" },
  addBtn: { backgroundColor: "#111827", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  addBtnText: { color: "#FFFFFF", fontWeight: "700" },
  toggleRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  toggleBtn: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#FFFFFF", paddingVertical: 10, alignItems: "center" },
  toggleBtnActive: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  toggleText: { color: "#374151", fontWeight: "700" },
  toggleTextActive: { color: "#FFFFFF" },
  diagramWrap: { alignItems: "center" },
  legendRow: { flexDirection: "row", justifyContent: "center", gap: 14, marginTop: 6, marginBottom: 8 },
  legendItem: { color: "#16A34A", fontWeight: "700" },
  listContent: { paddingBottom: 22, gap: 10 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 12 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardCondition: { fontWeight: "800", color: "#111827" },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: "#FFFFFF", fontWeight: "700", fontSize: 12, textTransform: "capitalize" },
  cardMeta: { color: "#4B5563", fontSize: 12 },
  emptyText: { color: "#6B7280", textAlign: "center", padding: 12 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 8 },
  modalTitle: { fontSize: 18, fontWeight: "800", color: "#111827" },
  modalCard: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, padding: 10, marginBottom: 8 },
  closeBtn: { backgroundColor: "#111827", borderRadius: 10, alignItems: "center", paddingVertical: 12, marginTop: 8 },
  closeBtnText: { color: "#FFFFFF", fontWeight: "700" },
});
