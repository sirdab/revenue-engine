import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";
import type { ActivityTypeOption } from "./activity-source";

// The activity type control: the same chips on every surface,
// each as wide as its name — fixed-width tiles cut the longer names off
// ("Follo…", "Business…") inside a narrow dialog. They wrap onto another
// line when there are more than fit.

export function TypeField({
  options,
  value,
  onChange,
  disabled,
  className,
}: {
  options: ActivityTypeOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors",
              selected
                ? "border-brand-500 bg-brand-subtle text-brand"
                : "border-border bg-card text-muted-foreground hover:border-input",
            )}
          >
            <o.icon className={cn("h-4 w-4", selected ? "text-brand" : "text-subtle")} />
            {t(o.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
