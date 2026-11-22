import { KanbanSquare, List, BarChart3, Filter } from "lucide-react";
import { Segmented, SegmentedItem } from "@sirdab/one/components/segmented";
import type { DealsView } from "./use-deals-url-state";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

const TABS: { value: DealsView; labelKey: MessageKey; icon: typeof List }[] = [
  { value: "pipeline", labelKey: "deals.view.pipeline", icon: KanbanSquare },
  { value: "list", labelKey: "deals.view.list", icon: List },
  { value: "forecast", labelKey: "deals.view.forecast", icon: BarChart3 },
  { value: "funnel", labelKey: "deals.view.funnel", icon: Filter },
];

export function ViewSwitcher({
  value,
  onChange,
}: {
  value: DealsView;
  onChange: (view: DealsView) => void;
}) {
  const { t } = useI18n();
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
            label={t(tab.labelKey)}
            icon={<Icon />}
          />
        );
      })}
    </Segmented>
  );
}
