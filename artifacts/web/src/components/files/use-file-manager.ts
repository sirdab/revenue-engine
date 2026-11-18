import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useEntityFiles, useDeleteFile, type FileTarget } from "@/lib/files-api";

/** Shared upload/list/delete wiring for a deal's documents. */
export function useFileManager(target: FileTarget) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const { data: files, isLoading } = useEntityFiles(target);
  const deleteFile = useDeleteFile(target);
  const { toast } = useToast();

  const handleDelete = async (id: number) => {
    try {
      await deleteFile.mutateAsync(id);
      toast({ title: "File deleted" });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Failed to delete file",
        variant: "destructive",
      });
    }
  };

  return {
    files: files ?? [],
    isLoading,
    handleDelete,
    deletingId: deleteFile.isPending ? deleteFile.variables : undefined,
    uploadOpen,
    setUploadOpen,
  };
}
