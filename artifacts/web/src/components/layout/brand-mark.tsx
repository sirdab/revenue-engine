import logoMark from "@/assets/brand/sirdab-favicon.png";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n/i18n";
import { useWorkspaceLogo } from "@/lib/branding-api";

/**
 * The app's mark: the workspace's own logo if it uploaded one (Settings ›
 * Workspace), else the default tile, plus the signed-in user's workspace name
 * (or the product name before anyone has signed in). `iconOnly` is the
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
  const { data: customLogo } = useWorkspaceLogo(Boolean(user));
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2.5", className)}>
      <img
        src={customLogo || logoMark}
        alt={iconOnly ? name : ""}
        aria-hidden={!iconOnly}
        className="h-8 w-8 shrink-0 rounded-lg object-contain"
      />
      {!iconOnly && (
        <span
          dir="auto"
          title={name}
          className="truncate font-heading text-body-lg font-semibold text-foreground"
        >
          {name}
        </span>
      )}
    </span>
  );
}
