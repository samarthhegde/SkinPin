import { BodyMapEntry, getBodyMapEntries, getTreatmentLogs, getZoneById, severityColor } from "@/lib/bodyMap";
import { computeTreatmentEffectiveness, computeTrend } from "@/lib/progression";
import { analyzeTriggers } from "@/lib/triggerAnalyzer";
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from "expo-router";
import * as FileSystem from "expo-file-system";
import { captureRef } from "react-native-view-shot";
import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, Share, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Ellipse, Rect } from "react-native-svg";

function BodySnapshot({
  entries,
  view,
}: {
  entries: BodyMapEntry[];
  view: "front" | "back";
}) {
  const latestByZone = new Map<string, BodyMapEntry>();
  for (const entry of [...entries].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (!latestByZone.has(entry.zoneId)) latestByZone.set(entry.zoneId, entry);
  }
  return (
    <Svg width={220} height={260}>
      <Rect x={0} y={0} width={220} height={260} rx={12} fill="#F8FAFC" />
      <Ellipse cx={110} cy={36} rx={20} ry={22} fill="#CBD5E1" />
      <Rect x={84} y={58} width={52} height={82} rx={20} fill="#CBD5E1" />
      <Rect x={56} y={70} width={20} height={90} rx={10} fill="#CBD5E1" />
      <Rect x={144} y={70} width={20} height={90} rx={10} fill="#CBD5E1" />
      <Rect x={92} y={138} width={18} height={98} rx={9} fill="#CBD5E1" />
      <Rect x={110} y={138} width={18} height={98} rx={9} fill="#CBD5E1" />
      {[...latestByZone.values()]
        .filter((entry) => getZoneById(entry.zoneId)?.view === view)
        .map((entry) => {
          const zone = getZoneById(entry.zoneId);
          if (!zone) return null;
          return <Circle key={entry.id} cx={(zone.cx / 300) * 220} cy={(zone.cy / 380) * 260} r={4} fill={severityColor(entry.severity)} />;
        })}
    </Svg>
  );
}

export default function ReportExportScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [frontRef, setFrontRef] = useState<View | null>(null);
  const [backRef, setBackRef] = useState<View | null>(null);
  const [entries, setEntries] = useState<BodyMapEntry[]>([]);
  const [logs, setLogs] = useState<Awaited<ReturnType<typeof getTreatmentLogs>>>([]);
  const [htmlToPdfAvailable, setHtmlToPdfAvailable] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const maybe = require("react-native-html-to-pdf");
      setHtmlToPdfAvailable(Boolean(maybe?.default || maybe));
    } catch {
      setHtmlToPdfAvailable(false);
    }
  }, []);

  useEffect(() => {
    getBodyMapEntries().then(setEntries);
    getTreatmentLogs().then(setLogs);
  }, []);

  const generate = async () => {
    if (!frontRef || !backRef || !htmlToPdfAvailable) return;
    setBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfModule = require("react-native-html-to-pdf");
      const RNHTMLtoPDF = (pdfModule?.default ?? pdfModule) as {
        convert: (opts: { html: string; fileName: string; base64?: boolean }) => Promise<{ filePath?: string }>;
      };
      const triggers = analyzeTriggers(entries);
      const treatmentScores = computeTreatmentEffectiveness(logs);
      const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
      const first = sorted[0]?.date;
      const last = sorted[sorted.length - 1]?.date;
      const zones = new Set(entries.map((e) => e.zoneId));
      const topZones = [...entries.reduce((acc, entry) => {
        acc.set(entry.zoneLabel, (acc.get(entry.zoneLabel) ?? 0) + 1);
        return acc;
      }, new Map<string, number>())]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      const frontBase64 = await captureRef(frontRef, { format: "png", result: "base64", quality: 1 });
      const backBase64 = await captureRef(backRef, { format: "png", result: "base64", quality: 1 });

      const byZone = new Map<string, BodyMapEntry[]>();
      for (const entry of sorted) {
        byZone.set(entry.zoneId, [...(byZone.get(entry.zoneId) ?? []), entry]);
      }

      const zoneBreakdown = [...byZone.entries()].map(([zoneId, list]) => {
        const latest = list[list.length - 1];
        const trend = computeTrend(list);
        const treatmentList = logs
          .filter((log) => list.some((entry) => entry.id === log.entryId))
          .map((log) => log.treatment);
        return `<tr><td>${latest.zoneLabel}</td><td>${latest.condition}</td><td>${new Date(
          list[0].date
        ).toLocaleDateString()}</td><td>${latest.severity}</td><td>${trend}</td><td>${[
          ...new Set(treatmentList),
        ].join(", ") || "None"}</td></tr>`;
      });

      const triggerLines = [
        ...triggers.triggers.map((t) => `<li>${t.factor} (${t.confidence}): ${t.detail}</li>`),
        ...triggers.recurringPatterns.map((p) => `<li>${p.zoneLabel} / ${p.condition}: ${p.detail}</li>`),
      ].join("");

      const treatmentRows = treatmentScores
        .map((t) => `<tr><td>${t.treatment}</td><td>${t.count}</td><td>${t.successRate}%</td></tr>`)
        .join("");

      const html = `
        <h1>PrivateCare - Local Skin Tracking Report</h1>
        <p>Generated: ${new Date().toLocaleString()}</p>
        <p>This report was generated entirely on your device. No data was transmitted.</p>
        <h2>Summary</h2>
        <p>Total conditions logged: ${entries.length}</p>
        <p>Total zones affected: ${zones.size}</p>
        <p>Date range: ${first ? new Date(first).toLocaleDateString() : "-"} to ${
        last ? new Date(last).toLocaleDateString() : "-"
      }</p>
        <p>Top zones: ${topZones.map((z) => `${z[0]} (${z[1]})`).join(", ") || "None"}</p>
        <h2>Body Map</h2>
        <img src="data:image/png;base64,${frontBase64}" width="240" />
        <img src="data:image/png;base64,${backBase64}" width="240" />
        <h2>Per-zone breakdown</h2>
        <table border="1" cellspacing="0" cellpadding="6">
          <tr><th>Zone</th><th>Condition</th><th>First logged</th><th>Latest severity</th><th>Trend</th><th>Treatments</th></tr>
          ${zoneBreakdown.join("")}
        </table>
        <h2>Trigger insights</h2>
        <ul>${triggerLines || "<li>No strong trigger patterns yet.</li>"}</ul>
        <h2>Treatment effectiveness</h2>
        <table border="1" cellspacing="0" cellpadding="6">
          <tr><th>Treatment</th><th>Logs</th><th>Success rate</th></tr>
          ${treatmentRows || "<tr><td colspan='3'>No treatment scores yet.</td></tr>"}
        </table>
        <p style="margin-top:16px;font-size:12px;">Generated by PrivateCare · All data stored locally on your device · Not a substitute for professional medical advice</p>
      `;

      const pdf = await RNHTMLtoPDF.convert({
        html,
        fileName: `privatecare-report-${Date.now()}`,
        base64: false,
      });
      if (pdf.filePath) {
        await Share.share({ url: `file://${pdf.filePath}`, message: "PrivateCare report" });
        try {
          await FileSystem.deleteAsync(pdf.filePath, { idempotent: true });
        } catch {
          // best effort cleanup only
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.headerRow}>
        <Pressable style={styles.iconBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={20} color="#111827" />
        </Pressable>
        <Text style={styles.title}>Doctor Report Export</Text>
        <View style={{ width: 36 }} />
      </View>
      <Text style={styles.subtitle}>Generate a local PDF and share via native share sheet.</Text>
      <View ref={setFrontRef} collapsable={false} style={styles.hidden}>
        <BodySnapshot entries={entries} view="front" />
      </View>
      <View ref={setBackRef} collapsable={false} style={styles.hidden}>
        <BodySnapshot entries={entries} view="back" />
      </View>
      <Pressable style={[styles.button, busy && { opacity: 0.7 }]} onPress={generate} disabled={busy}>
        <Text style={styles.buttonText}>
          {!htmlToPdfAvailable ? "PDF export unavailable in Expo Go" : busy ? "Generating..." : "Generate Report"}
        </Text>
      </Pressable>
      <Text style={styles.foot}>
        Native PDF export requires a dev build (not Expo Go).
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F3F4F6", padding: 16, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" },
  title: { fontSize: 24, fontWeight: "800", color: "#111827" },
  subtitle: { color: "#4B5563" },
  button: { marginTop: 12, backgroundColor: "#111827", borderRadius: 12, alignItems: "center", paddingVertical: 14 },
  buttonText: { color: "#FFFFFF", fontWeight: "800" },
  foot: { marginTop: 10, color: "#6B7280", fontSize: 12 },
  hidden: { position: "absolute", left: -1000, top: -1000 },
});
