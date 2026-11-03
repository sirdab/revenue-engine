import { useEffect, useState } from "react";
import type { InsightsDashboard } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/lib/i18n/i18n";

// ---------------------------------------------------------------------------
// The dashboard-management dialogs (new / rename / share / delete), owning
// their own input state. The page holds only `dialog` (which one is open) and
// the mutation callbacks — extracted so the page stays composition-only.
// ---------------------------------------------------------------------------

export type DashboardDialogKind = "new" | "rename" | "share" | "delete" | null;

export interface DashboardDialogsProps {
  dialog: DashboardDialogKind;
  onClose: () => void;
  dashboard: InsightsDashboard | undefined;
  /** Teammates offered in the share list (current user filtered out here). */
  owners: { id: number; name: string }[];
  currentUserId: number | undefined;
  saving?: boolean;
  onCreate: (name: string) => void;
  onRename: (name: string) => void;
  onShare: (userIds: number[]) => void;
  onDelete: () => void;
}

export function DashboardDialogs({
  dialog,
  onClose,
  dashboard,
  owners,
  currentUserId,
  saving,
  onCreate,
  onRename,
  onShare,
  onDelete,
}: DashboardDialogsProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [shareIds, setShareIds] = useState<number[]>([]);

  useEffect(() => {
    if (dialog === "new") setName("");
    if (dialog === "rename") setName(dashboard?.name ?? "");
    if (dialog === "share") setShareIds(dashboard?.sharedUserIds ?? []);
    // Re-seed only when a dialog opens; `dashboard` is stable while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);

  const toggleShare = (id: number) =>
    setShareIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );

  const submitName = (handler: (name: string) => void) => {
    if (!name.trim()) return;
    handler(name.trim());
    onClose();
  };

  return (
    <>
      {/* New dashboard */}
      <Dialog open={dialog === "new"} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("insights.newDashboard")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder={t("insights.dashboardNamePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitName(onCreate)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button disabled={!name.trim() || saving} onClick={() => submitName(onCreate)}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dashboard */}
      <Dialog open={dialog === "rename"} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("insights.renameDashboard")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitName(onRename)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button disabled={!name.trim() || saving} onClick={() => submitName(onRename)}>
              {t("common.rename")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share dashboard (internal, view-only) */}
      <Dialog open={dialog === "share"} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("insights.shareTitle", { name: dashboard?.name ?? "" })}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("insights.shareBody")}
          </p>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {owners
              .filter((o) => currentUserId === undefined || o.id !== currentUserId)
              .map((o) => (
                <Label
                  key={o.id}
                  className="flex cursor-pointer items-center gap-2 text-sm font-normal"
                >
                  <Checkbox
                    checked={shareIds.includes(o.id)}
                    onCheckedChange={() => toggleShare(o.id)}
                  />
                  {o.name}
                </Label>
              ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={saving}
              onClick={() => {
                onShare(shareIds);
                onClose();
              }}
            >
              {t("insights.saveSharing")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dashboard */}
      <AlertDialog open={dialog === "delete"} onOpenChange={(o) => !o && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("insights.deleteTitle", { name: dashboard?.name ?? "" })}?</AlertDialogTitle>
            <AlertDialogDescription>
              {t("insights.deleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive"
              onClick={() => {
                onDelete();
                onClose();
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
