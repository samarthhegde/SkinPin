import { BodyMapEntry } from "@/lib/bodyMap";

type TriggerConfidence = "possible" | "likely";

export type TriggerReport = {
  triggers: {
    factor: string;
    confidence: TriggerConfidence;
    detail: string;
  }[];
  recurringPatterns: {
    zoneLabel: string;
    condition: string;
    avgIntervalDays: number;
    detail: string;
  }[];
};

function sev(entry: BodyMapEntry): number {
  if (entry.severity === "severe") return 3;
  if (entry.severity === "moderate") return 2;
  return 1;
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stddev(nums: number[]): number {
  const mean = avg(nums);
  const variance = avg(nums.map((n) => (n - mean) ** 2));
  return Math.sqrt(variance);
}

function confidenceFromPct(pct: number): TriggerConfidence {
  return pct >= 75 ? "likely" : "possible";
}

export function analyzeTriggers(entries: BodyMapEntry[]): TriggerReport {
  const journalEntries = entries.filter((entry) => entry.journal);
  if (journalEntries.length < 5) {
    return { triggers: [], recurringPatterns: [] };
  }

  const triggers: TriggerReport["triggers"] = [];

  const highStress = journalEntries.filter((entry) => entry.journal?.stressLevel === "high");
  if (highStress.length >= 5) {
    const stressedAndWorse = highStress.filter(
      (entry) => entry.severity === "moderate" || entry.severity === "severe"
    );
    const pct = Math.round((stressedAndWorse.length / highStress.length) * 100);
    if (pct > 60) {
      triggers.push({
        factor: "High stress",
        confidence: confidenceFromPct(pct),
        detail: `Appears in ${stressedAndWorse.length} of ${highStress.length} high-stress entries (${pct}%).`,
      });
    }
  }

  const sunny = journalEntries.filter((entry) => entry.journal?.outdoorTime === "a lot");
  if (sunny.length >= 5) {
    const sunnyAndWorse = sunny.filter(
      (entry) => entry.severity === "moderate" || entry.severity === "severe"
    );
    const pct = Math.round((sunnyAndWorse.length / sunny.length) * 100);
    if (pct > 60) {
      triggers.push({
        factor: "Sun exposure",
        confidence: confidenceFromPct(pct),
        detail: `Moderate/severe in ${sunnyAndWorse.length} of ${sunny.length} high outdoor-time entries (${pct}%).`,
      });
    }
  }

  const lowSleep = journalEntries.filter((entry) => (entry.journal?.sleepHours ?? 0) < 6);
  const normalSleep = journalEntries.filter((entry) => (entry.journal?.sleepHours ?? 0) >= 6);
  if (lowSleep.length >= 5 && normalSleep.length >= 5) {
    const lowAvg = avg(lowSleep.map(sev));
    const normalAvg = avg(normalSleep.map(sev));
    if (lowAvg - normalAvg >= 0.4) {
      triggers.push({
        factor: "Low sleep",
        confidence: lowAvg - normalAvg > 0.9 ? "likely" : "possible",
        detail: `Average severity ${lowAvg.toFixed(2)} with <6h sleep vs ${normalAvg.toFixed(
          2
        )} with >=6h sleep.`,
      });
    }
  }

  const recurringPatterns: TriggerReport["recurringPatterns"] = [];
  const groups = new Map<string, BodyMapEntry[]>();
  for (const entry of journalEntries) {
    const key = `${entry.zoneId}__${entry.condition.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (sorted.length < 3) continue;
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = new Date(sorted[i - 1].date).getTime();
      const curr = new Date(sorted[i].date).getTime();
      gaps.push((curr - prev) / (1000 * 60 * 60 * 24));
    }
    const gapStd = stddev(gaps);
    const gapAvg = avg(gaps);
    if (gapStd <= 4) {
      recurringPatterns.push({
        zoneLabel: sorted[0].zoneLabel,
        condition: sorted[0].condition,
        avgIntervalDays: Number(gapAvg.toFixed(1)),
        detail: `Recurring roughly every ${gapAvg.toFixed(1)} days (low variance pattern).`,
      });
    }
  }

  return { triggers, recurringPatterns };
}
