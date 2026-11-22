import { useRef, useState } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import logoMark from "@/assets/brand/sirdab-favicon.png";
import { prepareLogo, useSetWorkspaceLogo, useWorkspaceLogo } from "@/lib/branding-api";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCurrentUserQueryKey,
  getGetWorkspaceQueryKey,
  useGetWorkspace,
  useUpdateWorkspace,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api-error";
import { useI18n } from "@/lib/i18n/i18n";
import { SectionCard } from "./section-card";

// Settings › Workspace: the workspace's name and logo, which every member sees
// at the top of the sidebar. The sidebar reads the name from the current user,
// so a rename refreshes that query too.

export function WorkspaceSettings() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: workspace, isLoading, isError } = useGetWorkspace();
  const update = useUpdateWorkspace();
  // null = untouched, so the field shows the saved name until edited.
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? workspace?.name ?? "";
  const trimmed = name.trim();
  const dirty = draft !== null && trimmed !== "" && trimmed !== workspace?.name;

  const save = async () => {
    if (!dirty) return;
    try {
      const saved = await update.mutateAsync({ data: { name: trimmed } });
      queryClient.setQueryData(getGetWorkspaceQueryKey(), saved);
      void queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      setDraft(null);
      toast({ title: t("settings.workspace.saved") });
    } catch (err) {
      toast({
        title: t("settings.workspace.saveFailed"),
        description: errorMessage(err),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <header className="mb-5">
        <h1 className="text-heading-sm text-foreground">
          {t("settings.workspace.title")}
        </h1>
        <p className="mt-1 text-body-quiet text-muted-foreground">{t("settings.workspace.subtitle")}</p>
      </header>
      <SectionCard
        title={t("settings.workspace.nameTitle")}
        description={t("settings.workspace.nameDescription")}
      >
        <div className="px-5 py-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-body-quiet text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
            </div>
          ) : isError ? (
            <p className="text-body text-destructive">{t("settings.workspace.loadFailed")}</p>
          ) : (
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="workspace-name">{t("settings.workspace.nameLabel")}</Label>
                <Input
                  id="workspace-name"
                  value={name}
                  maxLength={120}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={!dirty || update.isPending}
              >
                {update.isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
                {t("common.save")}
              </Button>
            </form>
          )}
        </div>
      </SectionCard>

      <div className="mt-5">
        <LogoCard />
      </div>
    </div>
  );
}

function LogoCard() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { data: logo, isLoading } = useWorkspaceLogo(true);
  const setLogo = useSetWorkspaceLogo();
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await prepareLogo(file);
      await setLogo.mutateAsync(dataUrl);
      toast({ title: t("settings.workspace.logoSaved") });
    } catch (err) {
      toast({
        title: t("settings.workspace.logoFailed"),
        description: err instanceof Error && err.message !== "unreadable" ? err.message : t("settings.workspace.logoUnreadable"),
        variant: "destructive",
      });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async () => {
    try {
      await setLogo.mutateAsync(null);
      toast({ title: t("settings.workspace.logoRemoved") });
    } catch (err) {
      toast({ title: t("settings.workspace.logoFailed"), description: errorMessage(err), variant: "destructive" });
    }
  };

  return (
    <SectionCard title={t("settings.workspace.logoTitle")} description={t("settings.workspace.logoDescription")}>
      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-surface-whisper ring-1 ring-border">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-subtle" />
          ) : (
            <img src={logo || logoMark} alt="" className="h-11 w-11 rounded-lg object-contain" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-body text-foreground">
            {logo ? t("settings.workspace.logoCustom") : t("settings.workspace.logoDefault")}
          </p>
          <p className="text-caption-quiet text-muted-foreground">{t("settings.workspace.logoHint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          <Button type="button" size="sm" onClick={() => fileRef.current?.click()} disabled={setLogo.isPending}>
            {setLogo.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : <ImageUp className="me-1.5 h-4 w-4" />}
            {logo ? t("settings.workspace.logoReplace") : t("settings.workspace.logoUpload")}
          </Button>
          {logo && (
            <Button type="button" size="sm" variant="outline" onClick={() => void remove()} disabled={setLogo.isPending}>
              <Trash2 className="me-1.5 h-4 w-4" />
              {t("settings.workspace.logoRemove")}
            </Button>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
