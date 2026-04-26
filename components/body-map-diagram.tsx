import { BodyMapEntry, BodyView, BodyZone, getZoneById, severityColor, zonesForView } from "@/lib/bodyMap";
import Svg, { Circle, Ellipse, Rect } from "react-native-svg";

type Props = {
  view: BodyView;
  selectedZoneId?: string | null;
  entries?: BodyMapEntry[];
  onZonePress?: (zone: BodyZone) => void;
  onDotPress?: (zoneId: string) => void;
};

export function BodyMapDiagram({ view, selectedZoneId, entries, onZonePress, onDotPress }: Props) {
  const zones = zonesForView(view);
  const relevantEntries = (entries ?? []).filter((entry) => getZoneById(entry.zoneId)?.view === view);

  return (
    <Svg width={300} height={380}>
      <Rect x={0} y={0} width={300} height={380} rx={18} fill="#F8FAFC" />
      <Ellipse cx={150} cy={52} rx={28} ry={30} fill={view === "front" ? "#E2E8F0" : "#CBD5E1"} />
      <Rect x={116} y={84} width={68} height={112} rx={24} fill={view === "front" ? "#E2E8F0" : "#CBD5E1"} />
      <Rect x={80} y={104} width={28} height={128} rx={14} fill={view === "front" ? "#E2E8F0" : "#CBD5E1"} />
      <Rect x={192} y={104} width={28} height={128} rx={14} fill={view === "front" ? "#E2E8F0" : "#CBD5E1"} />
      <Rect x={126} y={196} width={24} height={154} rx={12} fill={view === "front" ? "#E2E8F0" : "#CBD5E1"} />
      <Rect x={150} y={196} width={24} height={154} rx={12} fill={view === "front" ? "#E2E8F0" : "#CBD5E1"} />

      {zones.map((zone) => (
        <Rect
          key={zone.id}
          x={zone.x}
          y={zone.y}
          width={zone.width}
          height={zone.height}
          rx={6}
          fill={selectedZoneId === zone.id ? "#8B5CF6" : "#A78BFA"}
          fillOpacity={selectedZoneId === zone.id ? 0.55 : 0.22}
          stroke={selectedZoneId === zone.id ? "#6D28D9" : "#7C3AED"}
          strokeWidth={selectedZoneId === zone.id ? 2 : 1}
          onPress={() => onZonePress?.(zone)}
        />
      ))}

      {relevantEntries.map((entry) => {
        const zone = getZoneById(entry.zoneId);
        if (!zone) return null;
        return (
          <Circle
            key={entry.id}
            cx={zone.cx}
            cy={zone.cy}
            r={7}
            fill={severityColor(entry.severity)}
            stroke="#111827"
            strokeWidth={1}
            onPress={() => onDotPress?.(entry.zoneId)}
          />
        );
      })}
    </Svg>
  );
}
