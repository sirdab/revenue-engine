import { ChartNoAxesColumn } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n/i18n";

/**
 * The app's mark: a teal tile plus the signed-in user's workspace name (or
 * the product name before anyone has signed in). `iconOnly` is the
 * collapsed rail and the loading screen.
 */
export function BrandMark({
  iconOnly = false,
  className,
}: {
  iconOnly?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const name = user?.workspace?.name || t("brand.productName");
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2.5", className)}>
      <span
        aria-hidden={!iconOnly}
        aria-label={iconOnly ? name : undefined}
        role={iconOnly ? "img" : undefined}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white"
      >
        <ChartNoAxesColumn className="h-4.5 w-4.5" />
      </span>
      {!iconOnly && (
        <span
          dir="auto"
          title={name}
          className="truncate font-heading text-base font-semibold text-slate-900"
        >
          {name}
        </span>
      )}
    </span>
  );
}
