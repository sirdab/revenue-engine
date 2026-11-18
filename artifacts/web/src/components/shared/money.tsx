import { SaudiRiyal } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDefaultCurrency } from "@/lib/format";

// Monetary display: "CODE + amount", as lib/format.ts renders it, in the
// record's currency or else the user's default. The Saudi riyal is the one
// currency drawn with its symbol (SAMA, 2025), shipped as an icon rather than
// the U+20C0 character because font coverage for the codepoint is still
// inconsistent across platforms.

export function Money({
  value,
  currency,
  className,
}: {
  value: number | null | undefined;
  currency?: string | null;
  className?: string;
}) {
  const amount = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value ?? 0);
  const code = (currency ?? getDefaultCurrency()).toUpperCase();

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
