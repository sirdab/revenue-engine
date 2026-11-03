import { SaudiRiyal } from "lucide-react";
import { cn } from "@/lib/utils";

// Monetary display with the official Saudi riyal symbol (SAMA, 2025). The
// symbol ships as an icon rather than the U+20C0 character because font
// coverage for the codepoint is still inconsistent across platforms; an inline
// SVG renders identically everywhere. Non-SAR currencies fall back to the
// legacy "CODE + amount" rendering from lib/format.ts.

export function Money({
  value,
  currency = "SAR",
  className,
}: {
  value: number | null | undefined;
  currency?: string | null;
  className?: string;
}) {
  const amount = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value ?? 0);
  const code = (currency ?? "SAR").toUpperCase();

  if (code !== "SAR") {
    return (
      <span className={cn("whitespace-nowrap tabular-nums", className)}>
        {code}
        {amount}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-px whitespace-nowrap tabular-nums",
        className,
      )}
      title={`SAR ${amount}`}
    >
      <SaudiRiyal aria-label="SAR" className="h-[1em] w-[1em] shrink-0" />
      {amount}
    </span>
  );
}
