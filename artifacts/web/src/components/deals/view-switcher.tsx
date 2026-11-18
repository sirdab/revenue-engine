import { KanbanSquare, List, BarChart3, Filter } from "lucide-react";
import { Segmented, SegmentedItem } from "@sirdab/one/components/segmented";
import type { DealsView } from "./use-deals-url-state";

const TABS: { value: DealsView; label: string; icon: typeof List }[] = [
  { value: "pipeline", label: "Pipeline", icon: KanbanSquare },
  { value: "list", label: "List", icon: List },
  { value: "forecast", label: "Forecast", icon: BarChart3 },
  { value: "funnel", label: "Funnel", icon: Filter },
];

export function ViewSwitcher({
  value,
  onChange,
}: {
  value: DealsView;
  onChange: (view: DealsView) => void;
}) {
  return (
    <Segmented
      animated={false}
      value={value}
      onValueChange={(next) => onChange(next as DealsView)}
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        return (
          <SegmentedItem
            key={tab.value}
            value={tab.value}
            label={tab.label}
            icon={<Icon />}
          />
        );
      })}
    </Segmented>
  );
}
