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
    selectedCurrentCount == null
      ? null
      : selectedCurrentCount + openDealsCount;

  const formatDealCount = (count: number | undefined) =>
    count == null ? "..." : `${count} open`;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reassign deals before deactivating</DialogTitle>
          <DialogDescription>
            {user.name} owns {openDealsCount} open deal
            {openDealsCount === 1 ? "" : "s"}. Choose who to reassign them to
            before deactivating this account.
          </DialogDescription>
        </DialogHeader>
        <Combobox
          items={options.map((u) => ({
            value: String(u.id),
            label: `${u.name} - ${formatDealCount(openDealCounts.get(u.id))} to ${formatDealCount(
              openDealCounts.get(u.id) == null
                ? undefined
                : openDealCounts.get(u.id)! + openDealsCount,
            )}`,
          }))}
          value={target}
          onChange={setTarget}
          placeholder="Choose a user…"
          inModal
          triggerClassName="w-full"
        />
        {selectedUser && (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <span className="font-medium text-slate-800">{selectedUser.name}</span>
            {selectedAfterCount == null ? (
              <span> is loading current deal count.</span>
            ) : (
              <span>
                {" "}
                currently owns {selectedCurrentCount} open deal
                {selectedCurrentCount === 1 ? "" : "s"} and will own{" "}
                {selectedAfterCount} after reassignment.
              </span>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={confirming}>
            Cancel
          </Button>
          <Button
            disabled={!target || confirming}
            onClick={() => onConfirm(Number(target))}
            className="bg-red-600 hover:bg-red-700"
          >
            {confirming && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            Reassign &amp; deactivate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
