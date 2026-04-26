import AsyncStorage from "@react-native-async-storage/async-storage";
import uuid from "react-native-uuid";

export type BodyMapSeverity = "clear" | "mild" | "moderate" | "severe";
export type FollowUpSeverity = BodyMapSeverity | "resolved";

export type JournalInputs = {
  productsUsed: string;
  sleepHours: number;
  stressLevel: "low" | "medium" | "high";
  outdoorTime: "none" | "some" | "a lot";
  dietNotes: string;
};

export type BodyMapEntry = {
  id: string;
  zoneId: string;
  zoneLabel: string;
  condition: string;
  severity: BodyMapSeverity;
  date: string;
  photoPath: string;
  journal?: JournalInputs;
  treatmentsTried?: string[];
};

export type TreatmentLog = {
  entryId: string;
  treatment: string;
  appliedDate: string;
  followUpSeverity?: FollowUpSeverity;
  followUpDate?: string;
};

export type BodyView = "front" | "back";

export type BodyZone = {
  id: string;
  label: string;
  view: BodyView;
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
};

const STORAGE_KEY = "privatecare.bodymap.entries.v1";
const TREATMENT_LOGS_KEY = "privatecare.bodymap.treatments.v1";
const WARNING_DISMISSALS_KEY = "privatecare.bodymap.warning-dismissals.v1";

export const BODY_ZONES: BodyZone[] = [
  { id: "forehead", label: "Forehead", view: "front", x: 132, y: 26, width: 36, height: 18, cx: 150, cy: 35 },
  { id: "left_cheek", label: "Left cheek", view: "front", x: 112, y: 46, width: 26, height: 18, cx: 125, cy: 55 },
  { id: "right_cheek", label: "Right cheek", view: "front", x: 162, y: 46, width: 26, height: 18, cx: 175, cy: 55 },
  { id: "chin", label: "Chin", view: "front", x: 138, y: 64, width: 24, height: 12, cx: 150, cy: 70 },
  { id: "neck", label: "Neck", view: "front", x: 136, y: 78, width: 28, height: 18, cx: 150, cy: 87 },
  { id: "left_shoulder", label: "Left shoulder", view: "front", x: 92, y: 98, width: 40, height: 22, cx: 112, cy: 109 },
  { id: "right_shoulder", label: "Right shoulder", view: "front", x: 168, y: 98, width: 40, height: 22, cx: 188, cy: 109 },
  { id: "left_chest", label: "Left chest", view: "front", x: 112, y: 122, width: 36, height: 28, cx: 130, cy: 136 },
  { id: "right_chest", label: "Right chest", view: "front", x: 152, y: 122, width: 36, height: 28, cx: 170, cy: 136 },
  { id: "abdomen", label: "Abdomen", view: "front", x: 126, y: 152, width: 48, height: 40, cx: 150, cy: 172 },
  { id: "left_upper_arm", label: "Left upper arm", view: "front", x: 72, y: 122, width: 26, height: 42, cx: 85, cy: 143 },
  { id: "right_upper_arm", label: "Right upper arm", view: "front", x: 202, y: 122, width: 26, height: 42, cx: 215, cy: 143 },
  { id: "left_forearm", label: "Left forearm", view: "front", x: 68, y: 166, width: 24, height: 48, cx: 80, cy: 190 },
  { id: "right_forearm", label: "Right forearm", view: "front", x: 208, y: 166, width: 24, height: 48, cx: 220, cy: 190 },
  { id: "left_hand", label: "Left hand", view: "front", x: 66, y: 216, width: 28, height: 20, cx: 80, cy: 226 },
  { id: "right_hand", label: "Right hand", view: "front", x: 206, y: 216, width: 28, height: 20, cx: 220, cy: 226 },
  { id: "left_thigh", label: "Left thigh", view: "front", x: 126, y: 196, width: 24, height: 62, cx: 138, cy: 227 },
  { id: "right_thigh", label: "Right thigh", view: "front", x: 150, y: 196, width: 24, height: 62, cx: 162, cy: 227 },
  { id: "left_knee", label: "Left knee", view: "front", x: 126, y: 260, width: 24, height: 22, cx: 138, cy: 271 },
  { id: "right_knee", label: "Right knee", view: "front", x: 150, y: 260, width: 24, height: 22, cx: 162, cy: 271 },
  { id: "left_calf", label: "Left calf", view: "front", x: 126, y: 284, width: 24, height: 48, cx: 138, cy: 308 },
  { id: "right_calf", label: "Right calf", view: "front", x: 150, y: 284, width: 24, height: 48, cx: 162, cy: 308 },
  { id: "left_foot", label: "Left foot", view: "front", x: 120, y: 334, width: 34, height: 20, cx: 137, cy: 344 },
  { id: "right_foot", label: "Right foot", view: "front", x: 146, y: 334, width: 34, height: 20, cx: 163, cy: 344 },
  { id: "back_head", label: "Back of head", view: "back", x: 132, y: 26, width: 36, height: 18, cx: 150, cy: 35 },
  { id: "upper_back", label: "Upper back", view: "back", x: 112, y: 98, width: 76, height: 32, cx: 150, cy: 114 },
  { id: "mid_back", label: "Mid back", view: "back", x: 112, y: 132, width: 76, height: 30, cx: 150, cy: 147 },
  { id: "lower_back", label: "Lower back", view: "back", x: 118, y: 164, width: 64, height: 32, cx: 150, cy: 180 },
  { id: "left_back_shoulder", label: "Left back shoulder", view: "back", x: 92, y: 98, width: 20, height: 22, cx: 102, cy: 109 },
  { id: "right_back_shoulder", label: "Right back shoulder", view: "back", x: 188, y: 98, width: 20, height: 22, cx: 198, cy: 109 },
  { id: "left_back_upper_arm", label: "Left back upper arm", view: "back", x: 72, y: 122, width: 26, height: 42, cx: 85, cy: 143 },
  { id: "right_back_upper_arm", label: "Right back upper arm", view: "back", x: 202, y: 122, width: 26, height: 42, cx: 215, cy: 143 },
  { id: "left_back_forearm", label: "Left back forearm", view: "back", x: 68, y: 166, width: 24, height: 48, cx: 80, cy: 190 },
  { id: "right_back_forearm", label: "Right back forearm", view: "back", x: 208, y: 166, width: 24, height: 48, cx: 220, cy: 190 },
  { id: "left_back_hand", label: "Left back hand", view: "back", x: 66, y: 216, width: 28, height: 20, cx: 80, cy: 226 },
  { id: "right_back_hand", label: "Right back hand", view: "back", x: 206, y: 216, width: 28, height: 20, cx: 220, cy: 226 },
  { id: "left_glute", label: "Left glute", view: "back", x: 126, y: 196, width: 24, height: 32, cx: 138, cy: 212 },
  { id: "right_glute", label: "Right glute", view: "back", x: 150, y: 196, width: 24, height: 32, cx: 162, cy: 212 },
  { id: "left_back_thigh", label: "Left back thigh", view: "back", x: 126, y: 228, width: 24, height: 30, cx: 138, cy: 243 },
  { id: "right_back_thigh", label: "Right back thigh", view: "back", x: 150, y: 228, width: 24, height: 30, cx: 162, cy: 243 },
  { id: "left_back_knee", label: "Left back knee", view: "back", x: 126, y: 260, width: 24, height: 22, cx: 138, cy: 271 },
  { id: "right_back_knee", label: "Right back knee", view: "back", x: 150, y: 260, width: 24, height: 22, cx: 162, cy: 271 },
  { id: "left_back_calf", label: "Left back calf", view: "back", x: 126, y: 284, width: 24, height: 48, cx: 138, cy: 308 },
  { id: "right_back_calf", label: "Right back calf", view: "back", x: 150, y: 284, width: 24, height: 48, cx: 162, cy: 308 },
  { id: "left_back_foot", label: "Left back foot", view: "back", x: 120, y: 334, width: 34, height: 20, cx: 137, cy: 344 },
  { id: "right_back_foot", label: "Right back foot", view: "back", x: 146, y: 334, width: 34, height: 20, cx: 163, cy: 344 },
];

export function urgencyToSeverity(urgency: string): BodyMapSeverity {
  if (urgency === "urgent") return "severe";
  if (urgency === "soon") return "moderate";
  if (urgency === "monitor") return "mild";
  return "clear"; // 'clear' = no condition found
}

export function severityColor(severity: BodyMapSeverity): string {
  if (severity === "severe") return "#DC2626";   // red
  if (severity === "moderate") return "#D97706"; // orange
  if (severity === "mild") return "#4ADE80";     // light green
  return "#22C55E";                              // clear = bright green (no issue)
}

export function zonesForView(view: BodyView): BodyZone[] {
  return BODY_ZONES.filter((z) => z.view === view);
}

export function getZoneById(zoneId: string): BodyZone | undefined {
  return BODY_ZONES.find((z) => z.id === zoneId);
}

export async function getBodyMapEntries(): Promise<BodyMapEntry[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as BodyMapEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveBodyMapEntry(
  input: Omit<BodyMapEntry, "id" | "date">
): Promise<BodyMapEntry> {
  const entries = await getBodyMapEntries();
  const entry: BodyMapEntry = {
    id: String(uuid.v4()),
    date: new Date().toISOString(),
    ...input,
  };
  const next = [entry, ...entries];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return entry;
}

export async function updateBodyMapEntry(
  entryId: string,
  patch: Partial<BodyMapEntry>
): Promise<BodyMapEntry | null> {
  const entries = await getBodyMapEntries();
  const index = entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return null;
  const updated: BodyMapEntry = { ...entries[index], ...patch };
  entries[index] = updated;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  return updated;
}

export async function getTreatmentLogs(): Promise<TreatmentLog[]> {
  const raw = await AsyncStorage.getItem(TREATMENT_LOGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as TreatmentLog[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveTreatmentLog(log: TreatmentLog): Promise<void> {
  const logs = await getTreatmentLogs();
  await AsyncStorage.setItem(TREATMENT_LOGS_KEY, JSON.stringify([log, ...logs]));
}

type WarningDismissals = Record<string, string>;

export async function getWarningDismissals(): Promise<WarningDismissals> {
  const raw = await AsyncStorage.getItem(WARNING_DISMISSALS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as WarningDismissals;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function dismissWarningForZone(zoneId: string): Promise<void> {
  const dismissals = await getWarningDismissals();
  dismissals[zoneId] = new Date().toISOString();
  await AsyncStorage.setItem(WARNING_DISMISSALS_KEY, JSON.stringify(dismissals));
}
