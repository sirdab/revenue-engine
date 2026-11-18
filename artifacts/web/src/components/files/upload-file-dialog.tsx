import { useState } from "react";
import { FileUp, Loader2, Upload } from "lucide-react";
import { Dropzone, type FileRejection } from "@sirdab/one/components/dropzone";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  useUploadFile,
  FILE_CATEGORY_OPTIONS,
  ACCEPTED_FILE_EXTENSIONS,
  type FileCategory,
  type FileTarget,
} from "@/lib/files-api";
import { useI18n } from "@/lib/i18n/i18n";

const ACCEPTED_EXTENSIONS_LABEL = ACCEPTED_FILE_EXTENSIONS.map((ext) =>
  ext.toUpperCase(),
).join(", ");

// The file picker filters by these types; the server validates again.
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const ACCEPT: Record<string, string[]> = {};
for (const ext of ACCEPTED_FILE_EXTENSIONS) {
  const mime = MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
  (ACCEPT[mime] ??= []).push(`.${ext}`);
}

/** A browser can report an empty or odd MIME type for a valid file; trust
 *  the extension then, the way the old `<input accept>` did. */
function hasAcceptedExtension(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return (ACCEPTED_FILE_EXTENSIONS as readonly string[]).includes(ext);
}

export function UploadFileDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: FileTarget;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<FileCategory>("contract");
  const upload = useUploadFile(target);
  const { toast } = useToast();

  const reset = () => {
    setFile(null);
    setCategory("contract");
  };

  const handleSubmit = async () => {
    if (!file) return;
    try {
      await upload.mutateAsync({ file, category });
      toast({ title: t("files.uploaded") });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : t("files.uploadFailed"),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("files.uploadTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{t("files.file")}</Label>
            <Dropzone
              accept={ACCEPT}
              multiple={false}
              label={t("files.file")}
              onDrop={(accepted: File[], rejected: FileRejection[]) => {
                const next =
                  accepted[0] ??
                  rejected.find((r) => hasAcceptedExtension(r.file.name))?.file;
                if (next) setFile(next);
              }}
            >
              <FileUp className="h-5 w-5 text-muted-foreground" />
              <span className="text-body text-foreground">
                {file ? file.name : t("files.dropzone")}
              </span>
            </Dropzone>
            <p className="text-caption text-subtle">
              {t("files.acceptedTypes", { types: ACCEPTED_EXTENSIONS_LABEL })}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>{t("common.category")}</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as FileCategory)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("files.selectCategory")} />
              </SelectTrigger>
              <SelectContent>
                {FILE_CATEGORY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {t(opt.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!file || upload.isPending}
          >
            {upload.isPending ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="me-2 h-4 w-4" />
            )}
            {t("common.upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
