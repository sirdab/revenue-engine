import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
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
  ACCEPTED_FILE_ACCEPT_ATTR,
  type FileCategory,
  type FileTarget,
} from "@/lib/files-api";
import { useI18n } from "@/lib/i18n/i18n";

const ACCEPTED_EXTENSIONS_LABEL = ACCEPTED_FILE_EXTENSIONS.map((ext) =>
  ext.toUpperCase(),
).join(", ");

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
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadFile(target);
  const { toast } = useToast();

  const reset = () => {
    setFile(null);
    setCategory("contract");
    if (inputRef.current) inputRef.current.value = "";
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
          <DialogTitle className="font-heading">{t("files.uploadTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="file-upload-input">{t("files.file")}</Label>
            <input
              id="file-upload-input"
              ref={inputRef}
              type="file"
              accept={ACCEPTED_FILE_ACCEPT_ATTR}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted-foreground file:me-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-gray-alpha-150"
            />
            <p className="text-[11px] text-subtle">
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
            className="bg-primary text-primary-foreground hover:bg-primary-hover"
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
