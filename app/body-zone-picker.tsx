import { BodyMapDiagram } from "@/components/body-map-diagram";
import { BodyView, urgencyToSeverity } from "@/lib/bodyMap";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function BodyZonePickerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    condition?: string;
    severity?: "mild" | "moderate" | "severe";
    urgency?: "monitor" | "soon" | "urgent";
    photoPath?: string;
    returnTo?: string;
  }>();
  const [view, setView] = useState<BodyView>("front");
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedZoneLabel, setSelectedZoneLabel] = useState<string | null>(null);

  const severity = useMemo(() => {
    if (params.severity === "mild" || params.severity === "moderate" || params.severity === "severe") {
      return params.severity;
    }
    return urgencyToSeverity(params.urgency ?? "monitor");
  }, [params.severity, params.urgency]);

  const condition = params.condition?.trim() || "Unspecified condition";
  const photoPath = params.photoPath?.trim() || "";

  const handleSave = async () => {
    if (!selectedZoneId || !selectedZoneLabel) {
      Alert.alert("Select a zone", "Please choose a body zone before saving.");
      return;
    }
    const returnTo = params.returnTo === "/body-map" ? "/body-map" : "/results";
    router.push({
      pathname: "/journal-input",
      params: {
        zoneId: selectedZoneId,
        zoneLabel: selectedZoneLabel,
        condition,
        severity,
        photoPath,
        returnTo,
      },
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.headerBack}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Body Zone Picker</Text>
        <View style={{ width: 40 }} />
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
          selectedZoneId={selectedZoneId}
          onZonePress={(zone) => {
            setSelectedZoneId(zone.id);
            setSelectedZoneLabel(zone.label);
          }}
        />
      </View>

      <View style={styles.metaCard}>
        <Text style={styles.metaLabel}>Condition: {condition}</Text>
        <Text style={styles.metaLabel}>Severity: {severity}</Text>
        <Text style={styles.metaLabel}>Selected zone: {selectedZoneLabel ?? "none"}</Text>
      </View>

      <Pressable style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveBtnText}>Continue to Journal</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F3F4F6", padding: 16, alignItems: "stretch" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  headerBack: { color: "#1F2937", fontWeight: "700" },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#111827" },
  toggleRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  toggleBtn: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#FFFFFF", paddingVertical: 10, alignItems: "center" },
  toggleBtnActive: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  toggleText: { color: "#374151", fontWeight: "700" },
  toggleTextActive: { color: "#FFFFFF" },
  diagramWrap: { flex: 1, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  metaCard: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 12, gap: 4, marginBottom: 12, alignItems: "center" },
  metaLabel: { color: "#374151", fontSize: 13, textAlign: "center" },
  saveBtn: { backgroundColor: "#111827", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnText: { color: "#FFFFFF", fontWeight: "800" },
});
