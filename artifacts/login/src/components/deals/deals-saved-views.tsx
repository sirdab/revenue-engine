import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDealViews,
  useCreateDealView,
  useDeleteDealView,
  getListDealViewsQueryKey,
} from "@workspace/api-client-react";
import type { DealView, DealViewDefinition } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Bookmark, Trash2, Plus, Check, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePreference } from "@/hooks/use-user-preferences";
import type { DealsView, DealsUrlState } from "./use-deals-url-state";
import { useI18n } from "@/lib/i18n/i18n";

export function DealsSavedViews({
  state,
  update,
}: {
  state: DealsUrlState;
  update: (partial: Partial<DealsUrlState>) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: views } = useListDealViews();
  const create = useCreateDealView();
  const del = useDeleteDealView();
  const { toast } = useToast();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [defaultViewId, setDefaultViewId] = usePreference<number | null>(
    "deals.defaultViewId",
    null,
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListDealViewsQueryKey() });

  const applyView = (v: DealView) => {
    const d = v.definition;
    update({
      view: (d.view as DealsView | undefined) ?? "list",
      pipelineId: d.pipelineId ?? undefined,
      ownerId: d.ownerId ?? undefined,
      status: d.status ?? undefined,
      sort: d.sort ?? undefined,
      filters: d.filters ?? undefined,
    });
  };

  const saveCurrent = async () => {
    const trimmed = name.trim();
    // Enter bypasses the button's disabled state; don't create twice.
    if (!trimmed || create.isPending) return;
    const definition: DealViewDefinition = {
      view: state.view,
      pipelineId: state.pipelineId ?? null,
      ownerId: state.ownerId ?? null,
      status: state.status ?? null,
      sort: state.sort ?? null,
      filters: state.filters ?? null,
    };
    try {
      await create.mutateAsync({ data: { name: trimmed, definition } });
      invalidate();
      toast({ title: t("deals.views.saved", { name: trimmed }) });
      setSaveOpen(false);
      setName("");
    } catch {
      toast({ title: t("deals.views.saveFailed"), variant: "destructive" });
    }
  };

  const deleteView = async (v: DealView) => {
    try {
      await del.mutateAsync({ id: v.id });
      invalidate();
      if (defaultViewId === v.id) setDefaultViewId(null);
      toast({ title: t("deals.views.deleted", { name: v.name }) });
    } catch {
      toast({ title: t("deals.views.deleteFailed"), variant: "destructive" });
    }
  };

  const toggleDefault = (v: DealView) => {
    const next = defaultViewId === v.id ? null : v.id;
    setDefaultViewId(next);
    toast({
      title:
        next != null
          ? t("deals.views.setAsDefault", { name: v.name })
          : t("deals.views.unsetDefault", { name: v.name }),
    });
  };

  const list = views ?? [];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Bookmark className="me-1.5 h-4 w-4" />
            {t("views.title")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>{t("views.saved")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {list.length === 0 ? (
            <p className="px-2 py-3 text-xs text-slate-400">
              {t("deals.views.empty")}
            </p>
          ) : (
            list.map((v) => (
              <div key={v.id} className="group relative">
                <DropdownMenuItem
                  onSelect={() => applyView(v)}
                  className="pe-14"
                >
                  <span className="truncate">{v.name}</span>
                </DropdownMenuItem>
                <button
                  type="button"
                  className={cn(
                    "absolute end-7 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-teal-600",
                    defaultViewId === v.id
                      ? "block text-teal-500"
                      : "hidden group-hover:block",
                  )}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleDefault(v);
                  }}
                  title={
                    defaultViewId === v.id
                      ? t("deals.views.defaultTitle")
                      : t("deals.views.setDefault")
                  }
                  aria-label={
                    defaultViewId === v.id
                      ? t("deals.views.unsetAria", { name: v.name })
                      : t("deals.views.setAria", { name: v.name })
                  }
                >
                  <Star
                    className={cn(
                      "h-3.5 w-3.5",
                      defaultViewId === v.id && "fill-current",
                    )}
                  />
                </button>
                <button
                  type="button"
                  className="absolute end-1 top-1/2 hidden -translate-y-1/2 rounded p-1 text-slate-400 hover:text-red-600 group-hover:block"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void deleteView(v);
                  }}
                  aria-label={t("deals.views.deleteAria", { name: v.name })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaveOpen(true)}>
            <Plus className="me-2 h-4 w-4" />
            {t("deals.views.saveCurrent")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("deals.views.save")}</DialogTitle>
            <DialogDescription>
              {t("deals.views.saveBody")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="view-name">{t("deals.views.name")}</Label>
            <Input
              id="view-name"
              value={name}
              autoFocus
              placeholder={t("deals.views.namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveCurrent();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              disabled={!name.trim() || create.isPending}
              onClick={() => void saveCurrent()}
            >
              <Check className="me-1.5 h-4 w-4" />
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
