import { KanbanSquare, List, BarChart3, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
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
    <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const active = value === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-card text-teal-700 shadow-sm"
                : "text-slate-600 hover:text-slate-900",
            )}
            aria-pressed={active}
            aria-label={tab.label}
            title={tab.label}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
