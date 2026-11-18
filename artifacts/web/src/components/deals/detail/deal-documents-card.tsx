import { FolderOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FileList, FileListSkeleton } from "@/components/files/file-list";
import { UploadFileDialog } from "@/components/files/upload-file-dialog";
import { useFileManager } from "@/components/files/use-file-manager";
import { DealSectionCard } from "./deal-section-card";
import { useI18n } from "@/lib/i18n/i18n";

export function DealDocumentsCard({
  dealId,
  archived,
}: {
  dealId: number;
  archived: boolean;
}) {
  const { t } = useI18n();
  const target = { dealId };
  const { files, isLoading, handleDelete, deletingId, uploadOpen, setUploadOpen } =
    useFileManager(target);

  return (
    <DealSectionCard
      title={files.length ? t("deals.documents.titleCount", { count: files.length }) : t("common.documents")}
      icon={<FolderOpen className="h-3.5 w-3.5" />}
      collapsible
      defaultOpen
      action={
        archived ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled
                    className="h-7 gap-1 px-2 text-caption text-brand hover:text-brand"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("common.upload")}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("deals.documents.restoreToUpload")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-caption text-brand hover:text-brand"
            onClick={() => setUploadOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("common.upload")}
          </Button>
        )
      }
    >
      {isLoading ? (
        <FileListSkeleton />
      ) : (
        <FileList
          files={files}
          onDelete={handleDelete}
          deletingId={deletingId}
          emptyMessage={t("deals.documents.empty")}
        />
      )}
      {!archived && (
        <UploadFileDialog open={uploadOpen} onOpenChange={setUploadOpen} target={target} />
      )}
    </DealSectionCard>
  );
}
