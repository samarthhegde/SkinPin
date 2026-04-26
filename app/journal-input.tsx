import { JournalInputs, saveBodyMapEntry } from "@/lib/bodyMap";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from "react-native";

export default function JournalInputScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    condition?: string;
    severity?: "mild" | "moderate" | "severe";
    photoPath?: string;
    zoneId?: string;
    zoneLabel?: string;
    returnTo?: string;
  }>();
  const [productsUsed, setProductsUsed] = useState("");
  const [sleepHours, setSleepHours] = useState(7);
  const [stressLevel, setStressLevel] = useState<JournalInputs["stressLevel"]>("medium");
  const [outdoorTime, setOutdoorTime] = useState<JournalInputs["outdoorTime"]>("some");
  const [dietNotes, setDietNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const safe = useMemo(
    () => ({
      condition: params.condition?.trim() || "Unspecified condition",
      severity: (params.severity === "mild" || params.severity === "moderate" || params.severity === "severe"
        ? params.severity
        : "mild") as "mild" | "moderate" | "severe",
      photoPath: params.photoPath?.trim() || "",
      zoneId: params.zoneId ?? "",
      zoneLabel: params.zoneLabel ?? "Unknown zone",
      returnTo: params.returnTo === "/body-map" ? "/body-map" : "/results",
    }),
    [params]
  );

  const persist = async (journal?: JournalInputs) => {
    if (!safe.zoneId) return;
    setIsSaving(true);
    await saveBodyMapEntry({
      condition: safe.condition,
      severity: safe.severity,
      photoPath: safe.photoPath,
      zoneId: safe.zoneId,
      zoneLabel: safe.zoneLabel,
      journal,
      treatmentsTried: [],
    });
    router.replace({ pathname: safe.returnTo, params: { tagged: "1", zoneLabel: safe.zoneLabel } });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.contentWrap}>
            <View style={styles.header}>
              <Pressable onPress={() => router.back()} style={styles.iconBtn}>
                <MaterialIcons name="arrow-back" size={20} color="#111827" />
              </Pressable>
              <Text style={styles.title}>Quick Journal</Text>
              <Pressable onPress={Keyboard.dismiss} style={styles.iconBtn}>
                <MaterialIcons name="keyboard-hide" size={20} color="#111827" />
              </Pressable>
            </View>
            <Text style={styles.subtitle}>Add context for better progression and trigger insights.</Text>
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              showsVerticalScrollIndicator={false}>
              <View style={styles.card}>
              <Text style={styles.label}>Any products used today?</Text>
              <TextInput value={productsUsed} onChangeText={setProductsUsed} style={styles.input} placeholder="e.g. benzoyl peroxide" returnKeyType="done" />

              <Text style={styles.label}>Sleep hours: {sleepHours}</Text>
              <View style={styles.row}>
                {[4, 6, 8, 10, 12].map((value) => (
                  <Pressable key={value} onPress={() => setSleepHours(value)} style={[styles.chip, sleepHours === value && styles.chipActive]}>
                    <Text style={[styles.chipText, sleepHours === value && styles.chipTextActive]}>{value}h</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Stress level</Text>
              <View style={styles.row}>
                {(["low", "medium", "high"] as const).map((value) => (
                  <Pressable key={value} onPress={() => setStressLevel(value)} style={[styles.chip, stressLevel === value && styles.chipActive]}>
                    <Text style={[styles.chipText, stressLevel === value && styles.chipTextActive]}>{value}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Outdoor time</Text>
              <View style={styles.row}>
                {(["none", "some", "a lot"] as const).map((value) => (
                  <Pressable key={value} onPress={() => setOutdoorTime(value)} style={[styles.chip, outdoorTime === value && styles.chipActive]}>
                    <Text style={[styles.chipText, outdoorTime === value && styles.chipTextActive]}>{value}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Diet or other notes (optional)</Text>
              <TextInput value={dietNotes} onChangeText={setDietNotes} style={[styles.input, { minHeight: 88 }]} multiline />
              </View>

            </ScrollView>

            <View style={styles.footer}>
              <Pressable style={styles.skipBtn} onPress={() => persist()} disabled={isSaving}>
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, isSaving && { opacity: 0.7 }]}
                onPress={() =>
                  persist({
                    productsUsed,
                    sleepHours,
                    stressLevel,
                    outdoorTime,
                    dietNotes,
                  })
                }
                disabled={isSaving}>
                <Text style={styles.saveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F3F4F6", paddingTop: 14, paddingBottom: 10 },
  contentWrap: { flex: 1, width: "90%", alignSelf: "center", maxWidth: 360 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" },
  title: { flex: 1, textAlign: "center", fontSize: 28, fontWeight: "800", color: "#111827", marginHorizontal: 8 },
  subtitle: { color: "#4B5563", fontSize: 15, lineHeight: 21, marginBottom: 10, paddingHorizontal: 4 },
  scrollContent: { paddingHorizontal: 4, paddingBottom: 12, gap: 12, flexGrow: 1 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, gap: 10 },
  label: { fontWeight: "700", color: "#111827", marginTop: 4, fontSize: 14 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#FFFFFF" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#FFFFFF" },
  chipActive: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  chipText: { color: "#374151", textTransform: "capitalize" },
  chipTextActive: { color: "#FFFFFF", fontWeight: "700" },
  footer: { flexDirection: "row", gap: 12, marginTop: 8, marginBottom: 6, paddingHorizontal: 4 },
  skipBtn: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 14, paddingVertical: 14, alignItems: "center", backgroundColor: "#FFFFFF" },
  skipText: { color: "#374151", fontWeight: "700", fontSize: 15 },
  saveBtn: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: "center", backgroundColor: "#111827" },
  saveText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
});
