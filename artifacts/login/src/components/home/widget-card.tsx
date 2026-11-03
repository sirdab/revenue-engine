import type { ReactNode } from "react";
import { Link } from "wouter";
import { RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/i18n";

// Shared shell for home-dashboard widgets: consistent header + the three
// non-content states (loading / error / empty) handled once.
export function WidgetCard({
  title,
  action,
  isLoading,
  isError,
  onRetry,
  isEmpty,
  emptyText,
  children,
}: {
  title: ReactNode;
  action?: { label: string; href: string };
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyText?: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between gap-3 px-5 pt-4 max-sm:px-4">
        <CardTitle className="text-label text-foreground">
          {title}
        </CardTitle>
        {action && (
          <Link
            href={action.href}
            className="text-caption text-muted-foreground transition-colors hover:text-foreground"
          >
            {action.label}
          </Link>
        )}
      </CardHeader>
      <CardContent className="px-5 pb-5 max-sm:px-4 [[data-slot=card-header]+&]:pt-3">
        {isLoading ? (
          <div className="space-y-2 py-1">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        ) : isError ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-whisper px-3 py-4 text-body-quiet text-muted-foreground">
            <span>{t("home.widget.loadFailed")}</span>
            {onRetry && (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                <RotateCcw className="me-1.5 h-3.5 w-3.5" />
                {t("common.retry")}
              </Button>
            )}
          </div>
        ) : isEmpty ? (
          <p className="rounded-lg bg-surface-whisper px-3 py-6 text-center text-body-quiet text-muted-foreground">
            {emptyText ?? t("common.nothingYet")}
          </p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
