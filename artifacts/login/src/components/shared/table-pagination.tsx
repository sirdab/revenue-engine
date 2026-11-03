import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePreference } from "@/hooks/use-user-preferences";
import { useI18n } from "@/lib/i18n/i18n";

export const PAGE_SIZE_OPTIONS = [30, 50, 80] as const;
export const DEFAULT_PAGE_SIZE = 30;

export interface ClientPagination {
  page: number;
  pageSize: number;
  pageCount: number;
  startIndex: number;
  endIndex: number;
  start: number;
  end: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

// Client-side pagination state for in-memory tables. Persists the chosen page
// size (server-backed, at `tables.<preferenceKey>.pageSize`) so it sticks
// per table across devices/sessions, falling back to `defaultPageSize` when
// nothing is saved yet or the saved value isn't one of the offered options.
export function useClientPagination(
  total: number,
  opts: { preferenceKey: string; defaultPageSize?: number },
): ClientPagination {
  const defaultPageSize = opts.defaultPageSize ?? DEFAULT_PAGE_SIZE;

  const [storedPageSize, setStoredPageSize] = usePreference<number | null>(
    `tables.${opts.preferenceKey}.pageSize`,
    null,
  );
  const pageSize =
    storedPageSize != null &&
    (PAGE_SIZE_OPTIONS as readonly number[]).includes(storedPageSize)
      ? storedPageSize
      : defaultPageSize;
  const [page, setPage] = useState(1);

  const setPageSize = useCallback(
    (n: number) => {
      setStoredPageSize(n);
      setPage(1);
    },
    [setStoredPageSize],
  );

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);

  // Keep the stored page in range when the row count shrinks.
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, total);

  return {
    page: currentPage,
    pageSize,
    pageCount,
    startIndex,
    endIndex,
    start: total === 0 ? 0 : startIndex + 1,
    end: endIndex,
    setPage,
    setPageSize,
  };
}

// Shared pagination footer: row range on the left, a page-size selector plus
// Prev / Next controls on the right. Used by every data table in the app so the
// look and behaviour stay consistent (client- or server-side paginated).
export function TablePagination({
  page,
  pageCount,
  total,
  start,
  end,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}: {
  page: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: readonly number[];
}) {
  const { t, formatNumber } = useI18n();
  const options = pageSizeOptions.includes(pageSize)
    ? pageSizeOptions
    : [pageSize, ...pageSizeOptions].sort((a, b) => a - b);

  return (
    // Wraps rather than squeezes: at 360px the row used to force the "1-2 of
    // 2" count into one character per line and still spill 12px past the
    // screen. The controls drop under the count instead.
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
      <span className="whitespace-nowrap tabular-nums">
        {t("pagination.range", {
          start: formatNumber(start),
          end: formatNumber(end),
          total: formatNumber(total),
        })}
      </span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("pagination.rows")}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => onPageSizeChange(Number(v))}
          >
            <SelectTrigger className="h-8 w-[72px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt} value={String(opt)}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="me-1 h-4 w-4" />
            {t("pagination.prev")}
          </Button>
          <span className="px-1 text-xs text-muted-foreground">
            {t("common.pageOf", { page, total: pageCount })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            {t("common.next")}
            <ChevronRight className="ms-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
