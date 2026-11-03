import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, ChevronDown, Upload } from "lucide-react";
import { CreateDealDialog } from "./create-deal-dialog";
import { useI18n } from "@/lib/i18n/i18n";

// The primary "+ Deal" action. Self-contained (owns the create dialog state) so
// it can sit in the page header top-right, consistent with the other tabs.
export function CreateDealMenu({
  defaultPipelineId,
}: {
  defaultPipelineId?: number;
}) {
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <Plus />
            {t("common.deal")}
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus className="me-2 h-4 w-4" />
            {t("deals.create.title")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/import">
              <Upload className="me-2 h-4 w-4" />
              {t("deals.importDeals")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateDealDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultPipelineId={defaultPipelineId}
      />
    </>
  );
}
