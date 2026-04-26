import { BodyMapEntry, BodyMapSeverity, FollowUpSeverity, TreatmentLog } from "@/lib/bodyMap";

export function severityScore(severity: BodyMapSeverity): number {
  if (severity === "severe") return 3;
  if (severity === "moderate") return 2;
  return 1;
}

export function followUpScore(severity: FollowUpSeverity): number {
  if (severity === "resolved") return 0;
  return severityScore(severity);
}

export function computeTrend(entries: BodyMapEntry[]): "Improving" | "Worsening" | "Stable" {
  const recent = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-3);
  if (recent.length < 2) return "Stable";
  const first = severityScore(recent[0].severity);
  const last = severityScore(recent[recent.length - 1].severity);
  if (last < first) return "Improving";
  if (last > first) return "Worsening";
  return "Stable";
}

export function hasEscalatingThree(entries: BodyMapEntry[]): boolean {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (sorted.length < 3) return false;
  for (let i = 0; i <= sorted.length - 3; i += 1) {
    const a = severityScore(sorted[i].severity);
    const b = severityScore(sorted[i + 1].severity);
    const c = severityScore(sorted[i + 2].severity);
    if (a < b && b < c) return true;
  }
  return false;
}

export function severeFor14Days(entries: BodyMapEntry[]): boolean {
  const severeEntries = [...entries]
    .filter((entry) => entry.severity === "severe")
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!severeEntries.length) return false;
  const first = new Date(severeEntries[0].date).getTime();
  const last = new Date(severeEntries[severeEntries.length - 1].date).getTime();
  const days = (last - first) / (1000 * 60 * 60 * 24);
  return days >= 14;
}

export function conditionSpreadAcrossZones(
  allEntries: BodyMapEntry[],
  conditionName: string
): boolean {
  const zones = new Set(
    allEntries
      .filter((entry) => entry.condition.toLowerCase() === conditionName.toLowerCase())
      .map((entry) => entry.zoneId)
  );
  return zones.size >= 3;
}

export function hasSeriousKeyword(condition: string): boolean {
  return /(melanoma|carcinoma|lesion|ulcer|bleeding)/i.test(condition);
}

export type TreatmentScore = {
  treatment: string;
  count: number;
  improvedCount: number;
  successRate: number;
};

export function computeTreatmentEffectiveness(logs: TreatmentLog[]): TreatmentScore[] {
  const groups = new Map<string, TreatmentLog[]>();
  for (const log of logs) {
    const key = log.treatment.trim().toLowerCase();
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), log]);
  }

  const output: TreatmentScore[] = [];
  for (const [treatment, list] of groups.entries()) {
    if (list.length < 3) continue;
    let improvedCount = 0;
    for (const log of list) {
      if (!log.followUpSeverity) continue;
      if (log.followUpSeverity === "resolved") {
        improvedCount += 1;
      } else {
        // Consider moderate/mild follow up an improvement for now.
        const score = followUpScore(log.followUpSeverity);
        if (score <= 2) improvedCount += 1;
      }
    }
    output.push({
      treatment,
      count: list.length,
      improvedCount,
      successRate: list.length ? Math.round((improvedCount / list.length) * 100) : 0,
    });
  }
  return output.sort((a, b) => b.successRate - a.successRate);
}
