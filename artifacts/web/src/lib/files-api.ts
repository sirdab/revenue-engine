import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getGetDealHistoryQueryKey } from "@workspace/api-client-react";
import { tStatic, type MessageKey } from "@/lib/i18n/static";

// Deal file attachments. Spec-less hand-written hooks — the
// generated client hard-codes JSON.stringify + application/json on
// mutations, so multipart can't ride through it. Same-origin fetch with the
// session cookie attached automatically.

export type FileCategory =
  | "contract"
  | "expansion_contract"
  | "sfda_contract"
  | "cr_certificate"
  | "vat_certificate"
  | "invoice"
  | "payment_proof"
  | "other";

/** `label` is a message key; render it with `t()` / `fileCategoryLabel()`. */
export const FILE_CATEGORY_OPTIONS: { value: FileCategory; label: MessageKey }[] = [
  { value: "contract", label: "files.category.contract" },
  { value: "expansion_contract", label: "files.category.expansion_contract" },
  { value: "sfda_contract", label: "files.category.sfda_contract" },
  { value: "cr_certificate", label: "files.category.cr_certificate" },
  { value: "vat_certificate", label: "files.category.vat_certificate" },
  { value: "invoice", label: "files.category.invoice" },
  { value: "payment_proof", label: "files.category.payment_proof" },
  { value: "other", label: "files.category.other" },
];

export function fileCategoryLabel(category: string): string {
  const option = FILE_CATEGORY_OPTIONS.find((o) => o.value === category);
  return option ? tStatic(option.label) : category;
}

// Mirrors INLINE_PREVIEWABLE_MIME_TYPES in api-server/src/lib/file-validation.ts.
const INLINE_PREVIEWABLE_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function isPreviewable(mimeType: string): boolean {
  return INLINE_PREVIEWABLE_MIME_TYPES.has(mimeType);
}

// Mirrors the keys of ALLOWED_TYPES in api-server/src/lib/file-validation.ts
// — that module is the server-side source of truth for accepted extensions;
// keep this list in sync with it by hand. This is the single frontend copy:
// both the file picker's `accept` attribute and its help text derive from it.
export const ACCEPTED_FILE_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "docx",
  "xlsx",
] as const;

/** `accept` attribute value for a file input, e.g. ".pdf,.png,...". */
export const ACCEPTED_FILE_ACCEPT_ATTR = ACCEPTED_FILE_EXTENSIONS.map(
  (ext) => `.${ext}`,
).join(",");

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface CrmFile {
  id: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: FileCategory;
  dealId: number | null;
  noteId: number | null;
  uploadedBy: number | null;
  addTime: string;
  updateTime: string;
}

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export type FileTarget = { dealId: number };

async function fetchFiles(target: FileTarget): Promise<CrmFile[]> {
  const res = await fetch(`/api/files?dealId=${target.dealId}`, {
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw new Error(`Failed to load files (${res.status})`);
  }
  return (await res.json()) as CrmFile[];
}

export function useEntityFiles(target: FileTarget, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["crm-files", target],
    queryFn: () => fetchFiles(target),
    enabled: options?.enabled ?? true,
  });
}

async function uploadFile(
  target: FileTarget,
  input: { file: File; category: FileCategory },
): Promise<CrmFile> {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("category", input.category);
  formData.append("dealId", String(target.dealId));

  const res = await fetch("/api/files", {
    method: "POST",
    credentials: "same-origin",
    body: formData,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as CrmFile;
}

// Upload/delete also write a change_events audit row (crm-files.ts), and the
// deal detail page's Timeline renders that same change_events feed
// (useGetDealHistory) -- without invalidating it here, the Timeline keeps
// showing its pre-mutation snapshot until something unrelated refetches it
// or the page reloads, even though the Documents list itself updates fine.
function invalidateFileQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  target: FileTarget,
): void {
  queryClient.invalidateQueries({ queryKey: ["crm-files", target] });
  queryClient.invalidateQueries({ queryKey: getGetDealHistoryQueryKey(target.dealId) });
}

export function useUploadFile(target: FileTarget) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { file: File; category: FileCategory }) =>
      uploadFile(target, input),
    onSuccess: () => {
      invalidateFileQueries(queryClient, target);
    },
  });
}

async function deleteFileRequest(id: number): Promise<void> {
  const res = await fetch(`/api/files/${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Delete failed (${res.status})`);
  }
}

export function useDeleteFile(target: FileTarget) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteFileRequest(id),
    onSuccess: () => {
      invalidateFileQueries(queryClient, target);
    },
  });
}

// --------------------------------------------------------------------------
// Comment attachments. A second upload path next to the fetch-based
// one above: comment uploads target a note (dealId + noteId) and need per-file
// PROGRESS + ABORT, which fetch can't give — so this path uses XMLHttpRequest.
// Kept here beside useUploadFile so the two don't drift.
// --------------------------------------------------------------------------

export interface XhrUpload {
  promise: Promise<CrmFile>;
  abort: () => void;
}

/** Upload a file as a comment attachment with progress + abort (R2). */
export function uploadNoteFileXHR(params: {
  dealId: number;
  noteId: number;
  file: File;
  category: FileCategory;
  onProgress?: (pct: number) => void;
}): XhrUpload {
  const { dealId, noteId, file, category, onProgress } = params;
  const xhr = new XMLHttpRequest();
  const promise = new Promise<CrmFile>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("category", category);
    form.append("dealId", String(dealId));
    form.append("noteId", String(noteId));
    xhr.open("POST", "/api/files");
    xhr.withCredentials = true;
    // A silent connection hang fires none of onload/onerror/onabort, which
    // would leave the tray chip stuck at "uploading" forever. A generous
    // ceiling (large files are allowed) turns a true hang into a retryable
    // error instead.
    xhr.timeout = 120_000;
    xhr.ontimeout = () => reject(new Error("Upload timed out."));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress?.(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as CrmFile);
        } catch {
          reject(new Error("Unexpected server response."));
        }
        return;
      }
      let message = `Upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        // keep the status-based message
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

/** All posted-comment attachments for a deal, in one call (never per-note). The
 *  timeline groups these by noteId to render download chips + inline images. */
export function useDealNoteAttachments(dealId: number) {
  return useQuery({
    queryKey: ["crm-files", "note-attachments", dealId],
    queryFn: async (): Promise<CrmFile[]> => {
      const res = await fetch(
        `/api/files?dealId=${dealId}&noteAttachments=true`,
        { headers: { accept: "application/json" }, credentials: "same-origin" },
      );
      if (!res.ok) throw new Error(`Failed to load attachments (${res.status})`);
      return (await res.json()) as CrmFile[];
    },
  });
}

/** Standalone delete (no query invalidation) for composer-managed attachments. */
export async function deleteCrmFile(id: number): Promise<void> {
  await deleteFileRequest(id);
}

/** URL that serves a file's bytes inline (used for inline comment images). */
export function fileContentUrl(id: number): string {
  return `/api/files/${id}/content`;
}

/** Opens the file in a new tab — the server sets `inline` disposition for
 *  previewable types, so the browser renders it directly. */
export function openFile(id: number): void {
  window.open(`/api/files/${id}/content`, "_blank", "noopener");
}

/** Fetches the file and triggers a save-as download. */
export async function downloadFile(id: number, fileName: string): Promise<void> {
  const res = await fetch(`/api/files/${id}/content`, {
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw new Error(`Failed to download file (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
