import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  getCountDealsQueryOptions,
  useListUsers,
} from "@workspace/api-client-react";
import type { User } from "@workspace/api-client-react";
import { useQueries } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Combobox } from "@/components/ui/combobox";
import { useI18n } from "@/lib/i18n/i18n";

interface ReassignDealsDialogProps {
  user: User;
  openDealsCount: number;
  onClose: () => void;
  onConfirm: (reassignOwnerId: number) => void | Promise<void>;
  confirming: boolean;
}

export function ReassignDealsDialog({
  user,
  openDealsCount,
  onClose,
  onConfirm,
  confirming,
}: ReassignDealsDialogProps) {
  const { t, tNode, tPlural, formatNumber } = useI18n();
  const { data: users } = useListUsers();
  const [target, setTarget] = useState("");

  const options = useMemo(
    () => (users ?? []).filter((u) => u.activeFlag && u.id !== user.id),
    [users, user.id],
  );
  const countQueries = useQueries({
    queries: options.flatMap((u) => [
      getCountDealsQueryOptions({
        ownerId: u.id,
        status: "open",
      }),
      getCountDealsQueryOptions({
        ownerId: u.id,
        status: "open",
        archived: true,
      }),
    ]),
  });

  const openDealCounts = new Map<number, number>();
  options.forEach((u, index) => {
    const visible = countQueries[index * 2]?.data?.count;
    const archived = countQueries[index * 2 + 1]?.data?.count;
    if (visible != null || archived != null) {
      openDealCounts.set(u.id, (visible ?? 0) + (archived ?? 0));
    }
  });

  const selectedUser = options.find((u) => String(u.id) === target) ?? null;
  const selectedCurrentCount =
    selectedUser == null ? null : openDealCounts.get(selectedUser.id);
  const selectedAfterCount =
    selectedCurrentCount == null ? null : selectedCurrentCount + openDealsCount;

  const selectedName = selectedUser ? (
    <bdi className="font-medium text-foreground">{selectedUser.name}</bdi>
  ) : null;

  const formatDealCount = (count: number | undefined) =>
    count == null
      ? "…"
      : tPlural("admin.users.reassign.openShort", count, {
          count: formatNumber(count),
        });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("admin.users.reassign.title")}</DialogTitle>
          <DialogDescription>
            {tNode("admin.users.reassign.description", {
              name: <bdi>{user.name}</bdi>,
              deals: tPlural("admin.users.reassign.openDeals", openDealsCount, {
                count: formatNumber(openDealsCount),
              }),
            })}
          </DialogDescription>
        </DialogHeader>
        <Combobox
          items={options.map((u) => ({
            value: String(u.id),
            label: t("admin.users.reassign.optionLabel", {
              // FSI…PDI isolates the name so an Arabic or English name
              // cannot reorder the counts around it in a plain-text label.
              name: `\u2068${u.name}\u2069`,
              current: formatDealCount(openDealCounts.get(u.id)),
              after: formatDealCount(
                openDealCounts.get(u.id) == null
                  ? undefined
                  : openDealCounts.get(u.id)! + openDealsCount,
              ),
            }),
          }))}
          value={target}
          onChange={setTarget}
          placeholder={t("admin.users.reassign.placeholder")}
          inModal
          triggerClassName="w-full"
        />
        {selectedUser && (
          <div className="rounded-md border border-border bg-surface-whisper px-3 py-2 text-body-quiet text-muted-foreground">
            {selectedAfterCount == null || selectedCurrentCount == null
              ? tNode("admin.users.reassign.loadingCount", {
                  name: selectedName,
                })
              : tNode("admin.users.reassign.summary", {
                  name: selectedName,
                  deals: tPlural(
                    "admin.users.reassign.openDeals",
                    selectedCurrentCount,
                    { count: formatNumber(selectedCurrentCount) },
                  ),
                  after: formatNumber(selectedAfterCount),
                })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={confirming}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!target || confirming}
            onClick={() => onConfirm(Number(target))}
            className="bg-destructive hover:bg-destructive"
          >
            {confirming && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {t("admin.users.reassign.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
