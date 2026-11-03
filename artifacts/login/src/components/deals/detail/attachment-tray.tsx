import { FileText, Image as ImageIcon, X, RotateCw } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { formatFileSize } from "@/lib/files-api";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";

// One pending/attached comment file in the composer tray (R2, R3). Inline
// images move out of the tray into the editor body on success; non-images and
// any still-uploading / errored files stay here.
export interface ComposerAttachment {
  key: string;
  name: string;
  size: number;
  isImage: boolean;
  status: "uploading" | "done" | "error";
  progress: number;
  error?: string;
  fileId?: number;
}

export function AttachmentTray({
  items,
  onRemove,
  onRetry,
}: {
  items: ComposerAttachment[];
  onRemove: (item: ComposerAttachment) => void;
  onRetry: (item: ComposerAttachment) => void;
}) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => (
        <div
          key={item.key}
          className={cn(
            "flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm",
            item.status === "error"
              ? "border-destructive/30 bg-destructive-subtle"
              : "border-border bg-surface-whisper",
          )}
        >
          <span className="shrink-0 text-subtle">
            {item.isImage ? (
              <ImageIcon className="h-4 w-4" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-foreground">{item.name}</span>
              <span className="shrink-0 text-[11px] text-subtle">
                {formatFileSize(item.size)}
              </span>
            </div>
            {item.status === "uploading" && (
              <Progress value={item.progress} className="mt-1 h-1" />
            )}
            {item.status === "error" && (
              <div className="mt-0.5 text-[11px] text-destructive">
                {item.error ?? t("deals.attach.uploadFailed")}
              </div>
            )}
          </div>
          {item.status === "error" && (
            <button
              type="button"
              title={t("common.retry")}
              onClick={() => onRetry(item)}
              className="shrink-0 text-subtle transition-colors hover:text-foreground"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            title={item.status === "uploading" ? t("common.cancel") : t("common.remove")}
            onClick={() => onRemove(item)}
            className="shrink-0 text-subtle transition-colors hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
