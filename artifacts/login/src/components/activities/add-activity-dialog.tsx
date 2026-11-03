import { useCallback, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ActivityComposer } from "@/components/activities/shared/activity-composer";
import { useDealActivitySource } from "@/components/activities/shared/activity-source";
import { useI18n } from "@/lib/i18n/i18n";

// Self-contained "new activity" dialog (owns its open state). Shared by the
// activities page and the home dashboard's quick-create; pass `trigger` to
// replace the default teal button. The form is the shared ActivityComposer
// with the deal and person pickers, since this dialog is opened
// away from any deal; it shows the logged strip + Done after a log and
// closes after a plan.
const NO_SCOPE = {};

export function AddActivityDialog({
  onCreated,
  trigger,
}: {
  onCreated: () => void;
  trigger?: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // Remounts the form on every open, so it starts blank each time.
  const [openCount, setOpenCount] = useState(0);
  const source = useDealActivitySource(() => onCreated());
  const close = useCallback(() => setOpen(false), []);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setOpenCount((n) => n + 1);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="me-2 h-4 w-4" /> {t("activity.add.button")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("activity.add.title")}</DialogTitle>
        </DialogHeader>
        <ActivityComposer
          key={openCount}
          variant="dialog"
          source={source}
          scope={NO_SCOPE}
          showLinks
          onClose={close}
        />
      </DialogContent>
    </Dialog>
  );
}
