import { useState } from "react";
import { Loader2 } from "lucide-react";
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

// Settings › Workspace: the workspace's name, which every member sees at the
// top of the sidebar. The sidebar reads it from the current user, so a rename
// refreshes that query too.

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
        <h1 className="font-heading text-xl font-bold text-slate-900">
          {t("settings.workspace.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t("settings.workspace.subtitle")}</p>
      </header>
      <SectionCard
        title={t("settings.workspace.nameTitle")}
        description={t("settings.workspace.nameDescription")}
      >
        <div className="px-5 py-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
            </div>
          ) : isError ? (
            <p className="text-sm text-red-600">{t("settings.workspace.loadFailed")}</p>
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
                className="bg-teal-600 text-white hover:bg-teal-700"
              >
                {update.isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
                {t("common.save")}
              </Button>
            </form>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
