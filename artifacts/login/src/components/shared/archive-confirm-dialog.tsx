import { Archive, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/i18n";

// Pipedrive-style archive confirmation, shared by every archivable record
// type. Spells out exactly what archiving does before the user commits.

const CONSEQUENCES = [
  "archive.consequence.readOnly",
  "archive.consequence.hidden",
  "archive.consequence.findable",
  "archive.consequence.reporting",
  "archive.consequence.restorable",
] as const;

export function ArchiveConfirmDialog({
  open,
  onOpenChange,
  recordLabel,
  recordName,
  onConfirm,
  confirming = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Record type, lowercase — e.g. "deal", "account". */
  recordLabel: string;
  /** Display name of the specific record being archived. */
  recordName?: string | null;
  onConfirm: () => void | Promise<void>;
  confirming?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-muted-foreground" />
            {t("archive.title", { record: recordLabel })}
          </DialogTitle>
          <DialogDescription>
            {recordName
              ? t("archive.descriptionNamed", { name: recordName, record: recordLabel })
              : t("archive.description", { record: recordLabel })}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5 py-1 text-sm text-muted-foreground">
          {CONSEQUENCES.map((c) => (
            <li key={c} className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-gray-400" />
              {t(c)}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={confirming}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void onConfirm()}
            disabled={confirming}
            className="gap-2 bg-gray-700 text-white hover:bg-primary-hover"
          >
            {confirming && <Loader2 className="h-4 w-4 animate-spin" />}
            <Archive className="h-4 w-4" />
            {t("common.archive")} {recordLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
