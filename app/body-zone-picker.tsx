import { BodyMapDiagram } from "@/components/body-map-diagram";
import { BodyView, urgencyToSeverity } from "@/lib/bodyMap";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
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

  useEffect(() => {
    if (photoPath) return;
    Alert.alert(
      "Scan required",
      "Please scan the body area first, then tag the zone from your results screen.",
      [{ text: "Go to scanner", onPress: () => router.replace("/(tabs)") }]
    );
  }, [photoPath, router]);

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
      <View style={styles.contentWrap}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn}>
            <MaterialIcons name="arrow-back" size={20} color="#111827" />
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

        <View style={styles.diagramCard}>
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
        </View>

        <View style={styles.metaCard}>
          <Text style={styles.metaLabel}>Condition: {condition}</Text>
          <Text style={styles.metaLabel}>Severity: {severity}</Text>
          <Text style={styles.metaLabel}>Selected zone: {selectedZoneLabel ?? "none"}</Text>
        </View>

        <Pressable style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveBtnText}>Continue to Journal</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F3F4F6", paddingTop: 12, paddingBottom: 18 },
  contentWrap: { flex: 1, width: "90%", alignSelf: "center", maxWidth: 360, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 20, fontWeight: "800", color: "#111827", marginHorizontal: 8 },
  toggleRow: { flexDirection: "row", gap: 12 },
  toggleBtn: { flex: 1, borderRadius: 14, borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#FFFFFF", paddingVertical: 13, alignItems: "center" },
  toggleBtnActive: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  toggleText: { color: "#374151", fontWeight: "700", fontSize: 16 },
  toggleTextActive: { color: "#FFFFFF" },
  diagramCard: { backgroundColor: "#FFFFFF", borderRadius: 18, paddingVertical: 14, paddingHorizontal: 6 },
  diagramWrap: { alignItems: "center", justifyContent: "center" },
  metaCard: { backgroundColor: "#FFFFFF", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14, gap: 7, alignItems: "center" },
  metaLabel: { color: "#374151", fontSize: 15, textAlign: "center", lineHeight: 20 },
  saveBtn: { backgroundColor: "#111827", borderRadius: 14, paddingVertical: 16, paddingHorizontal: 14, alignItems: "center", marginTop: "auto" },
  saveBtnText: { color: "#FFFFFF", fontWeight: "800", fontSize: 17 },
});
