import {
  getListUserOptionsQueryKey,
  useListUserOptions,
} from "@workspace/api-client-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { FileText, Image as ImageIcon, File as FileIcon, Download, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatDate } from "@/lib/format";
import {
  formatFileSize,
  isPreviewable,
  openFile,
  downloadFile,
  fileCategoryLabel,
  type CrmFile,
} from "@/lib/files-api";
import { useI18n } from "@/lib/i18n/i18n";

export function FileListSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-2/3" />
    </div>
  );
}

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === "application/pdf") {
    return <FileText className="h-4 w-4 text-destructive" />;
  }
  if (mimeType.startsWith("image/")) {
    return <ImageIcon className="h-4 w-4 text-muted-foreground" />;
  }
  return <FileIcon className="h-4 w-4 text-subtle" />;
}

/**
 * A filename that stays on one line. When it is too long for the row it is
 * truncated with an ellipsis; hovering (or focusing) slides the name sideways so
 * the rest of it can be read. Long names scroll for longer, so the speed stays
 * constant no matter how much is hidden. Leaving snaps straight back to the start,
 * so the next hover always reads from the beginning of the name.
 */
function FileNameButton({
  fileName,
  actionLabel,
  onActivate,
}: {
  fileName: string;
  actionLabel: string;
  onActivate: () => void;
}) {
  const boxRef = useRef<HTMLButtonElement>(null);
  const [shift, setShift] = useState(0);

  const reveal = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    const hidden = box.scrollWidth - box.clientWidth;
    if (hidden <= 1) return;
    setShift(hidden);
  }, []);

  const reset = useCallback(() => setShift(0), []);

  const sliding = shift > 0;

  return (
    <button
      ref={boxRef}
      type="button"
      className="block w-full overflow-hidden whitespace-nowrap text-start text-body font-medium text-foreground hover:text-foreground"
      style={{ textOverflow: sliding ? "clip" : "ellipsis" }}
      title={fileName}
      aria-label={`${actionLabel} ${fileName}`}
      onMouseEnter={reveal}
      onMouseLeave={reset}
      onFocus={reveal}
      onBlur={reset}
      onClick={onActivate}
    >
      <span
        className="inline-block hover:underline"
        style={{
          transform: `translateX(-${shift}px)`,
          transitionProperty: "transform",
          transitionTimingFunction: "linear",
          // Sliding out is paced; coming back is instant.
          transitionDuration: sliding ? `${Math.min(4, Math.max(0.25, shift / 90))}s` : "0s",
        }}
      >
        {fileName}
      </span>
    </button>
  );
}

function FileRow({
  file,
  uploaderName,
  onDelete,
  deleting,
}: {
  file: CrmFile;
  uploaderName: string | undefined;
  onDelete: (id: number) => void;
  deleting: boolean;
}) {
  const { t } = useI18n();
  const previewable = isPreviewable(file.mimeType);

  return (
    <div className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
      <FileTypeIcon mimeType={file.mimeType} />
      <div className="min-w-0 flex-1">
        <FileNameButton
          fileName={file.fileName}
          actionLabel={previewable ? t("common.preview") : t("common.download")}
          onActivate={() =>
            previewable ? openFile(file.id) : downloadFile(file.id, file.fileName)
          }
        />
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-caption text-subtle">
          <Badge variant="outline" className="px-1.5 py-0 text-caption">
            {fileCategoryLabel(file.category)}
          </Badge>
          <span>{formatFileSize(file.sizeBytes)}</span>
          <span>·</span>
          <span>{uploaderName ?? t("common.unknown")}</span>
          <span>·</span>
          <span>{formatDate(file.addTime)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-subtle hover:text-foreground"
          title={t("common.download")}
          onClick={() => downloadFile(file.id, file.fileName)}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-subtle hover:text-destructive"
                title={t("common.delete")}
                disabled={deleting}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("files.deleteTitle", { name: file.fileName })}</AlertDialogTitle>
                <AlertDialogDescription>{t("files.deleteBody")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive hover:bg-destructive"
                  onClick={() => onDelete(file.id)}
                >
                  {t("common.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
      </div>
    </div>
  );
}

export function FileList({
  files,
  onDelete,
  deletingId,
  emptyMessage,
}: {
  files: CrmFile[];
  onDelete: (id: number) => void;
  deletingId?: number;
  emptyMessage?: string;
}) {
  const { t } = useI18n();
  const { data: users } = useListUserOptions({
    query: { queryKey: getListUserOptionsQueryKey(), staleTime: 5 * 60_000 },
  });
  const userNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const u of users ?? []) {
      map.set(u.id, u.name);
    }
    return map;
  }, [users]);

  if (files.length === 0) {
    return <p className="text-body text-subtle">{emptyMessage ?? t("files.empty")}</p>;
  }

  return (
    <div className="divide-y divide-border">
      {files.map((file) => (
        <FileRow
          key={file.id}
          file={file}
          uploaderName={
            file.uploadedBy != null ? userNameById.get(file.uploadedBy) : undefined
          }
          onDelete={onDelete}
          deleting={deletingId === file.id}
        />
      ))}
    </div>
  );
}
