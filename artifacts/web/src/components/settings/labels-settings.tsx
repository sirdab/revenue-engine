import { useState } from "react";
import {
  useAdminListLabels,
  getAdminListLabelsQueryKey,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
  getListLabelsQueryKey,
  useAdminListLostReasons,
  getAdminListLostReasonsQueryKey,
  useCreateLostReason,
  useUpdateLostReason,
  useDeleteLostReason,
  getListLostReasonsQueryKey,
} from "@workspace/api-client-react";
import type {
  Label,
  LostReason,
  UnmanagedLostReason,
  UnregisteredLabel,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Loader2,
  Plus,
  Tag,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { EditableText } from "@/components/deals/inline-edit";
import { SectionCard } from "@/components/settings/section-card";
import { errorMessage } from "@/lib/api-error";
import {
  LABEL_COLOR_TOKENS,
  labelColorClasses,
} from "@/lib/label-colors";
import type { LabelEntity } from "@/components/shared/labels-editor";
import {
  useI18n,
  type MessageKey,
  type PluralKey,
  type Translate,
  type TranslatePlural,
} from "@/lib/i18n/i18n";

// Settings → Labels: one place to curate the shared taxonomy — colored labels
// for deals / people / organizations and the managed lost-reason list. Registry mutations rewrite the denormalized values on
// records server-side, so renames/merges/deletes here propagate everywhere.

// Message keys, not words: this table is module-level, so the labels are
// resolved at render through t().
const ENTITY_TABS: Array<{ value: LabelEntity; labelKey: MessageKey }> = [
  { value: "deal", labelKey: "settings.labels.tab.deal" },
  { value: "person", labelKey: "settings.labels.tab.person" },
  { value: "organization", labelKey: "settings.labels.tab.organization" },
];

const USAGE_KEYS: Record<LabelEntity, PluralKey> = {
  deal: "settings.labels.usage.deal",
  person: "settings.labels.usage.person",
  organization: "settings.labels.usage.organization",
};

const DELETE_USED_KEYS: Record<LabelEntity, PluralKey> = {
  deal: "settings.labels.deleteUsed.deal",
  person: "settings.labels.deleteUsed.person",
  organization: "settings.labels.deleteUsed.organization",
};

const COLOR_KEYS: Record<string, MessageKey> = {
  slate: "settings.labels.color.slate",
  red: "settings.labels.color.red",
  orange: "settings.labels.color.orange",
  amber: "settings.labels.color.amber",
  green: "settings.labels.color.green",
  teal: "settings.labels.color.teal",
  blue: "settings.labels.color.blue",
  indigo: "settings.labels.color.indigo",
  purple: "settings.labels.color.purple",
  pink: "settings.labels.color.pink",
};

function usageText(
  count: number,
  entity: LabelEntity,
  t: Translate,
  tPlural: TranslatePlural,
): string {
  if (count === 0) return t("settings.labels.notInUse");
  return tPlural(USAGE_KEYS[entity], count);
}

// Swatch that opens the palette; picking commits immediately.
function ColorPicker({
  color,
  onPick,
  disabled,
}: {
  color: string;
  onPick: (token: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={t("settings.labels.changeColor")}
          className={cn(
            "h-5 w-5 shrink-0 rounded-full transition-transform hover:scale-110 disabled:opacity-50",
            labelColorClasses(color).swatch,
          )}
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="grid grid-cols-5 gap-1.5">
          {LABEL_COLOR_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              aria-label={COLOR_KEYS[token] ? t(COLOR_KEYS[token]) : token}
              title={COLOR_KEYS[token] ? t(COLOR_KEYS[token]) : token}
              onClick={() => {
                onPick(token);
                setOpen(false);
              }}
              className={cn(
                "h-6 w-6 rounded-full transition-transform hover:scale-110",
                labelColorClasses(token).swatch,
                token === color &&
                  "ring-2 ring-ring ring-offset-1 ring-offset-background",
              )}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function LabelRow({
  label,
  entity,
  onRename,
  onRecolor,
  onDelete,
  busy,
}: {
  label: Label;
  entity: LabelEntity;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { t, tPlural } = useI18n();
  return (
    <li className="group flex items-center gap-3 px-5 py-2.5">
      <ColorPicker color={label.color} onPick={onRecolor} disabled={busy} />
      <div className="min-w-0 flex-1">
        <EditableText
          value={label.name}
          onCommit={(next) => next.trim() && onRename(next.trim())}
          className="-ms-1 text-body text-foreground"
        />
      </div>
      <span className="shrink-0 text-caption-quiet tabular-nums text-subtle">
        {usageText(label.usageCount, entity, t, tPlural)}
      </span>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={t("settings.labels.deleteAria", { name: label.name })}
            className="h-7 w-7 shrink-0 text-subtle opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.labels.deleteTitle", { name: label.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {label.usageCount > 0
                ? tPlural(DELETE_USED_KEYS[entity], label.usageCount)
                : t("settings.labels.deleteUnused")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-white hover:bg-destructive"
            >
              {t("settings.labels.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function LabelsPanel({
  entity,
  adding,
  setAdding,
}: {
  entity: LabelEntity;
  adding: boolean;
  setAdding: (next: boolean) => void;
}) {
  const { t, tPlural } = useI18n();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [draftColor, setDraftColor] = useState("teal");

  const { data, isLoading, isError } = useAdminListLabels(
    { entity },
    { query: { queryKey: getAdminListLabelsQueryKey({ entity }) } },
  );

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: getAdminListLabelsQueryKey({ entity }),
    });
    queryClient.invalidateQueries({
      queryKey: getListLabelsQueryKey({ entity }),
    });
  };
  const onError = (err: unknown) =>
    toast({ title: errorMessage(err), variant: "destructive" });

  const create = useCreateLabel({
    mutation: { onSuccess: invalidate, onError },
  });
  const update = useUpdateLabel({
    mutation: { onSuccess: invalidate, onError },
  });
  const remove = useDeleteLabel({
    mutation: {
      onSuccess: (result) => {
        invalidate();
        if (result.removedFrom > 0) {
          toast({
            title: tPlural("settings.labels.deleted", result.removedFrom),
          });
        }
      },
      onError,
    },
  });
  const busy = create.isPending || update.isPending || remove.isPending;

  const submitDraft = () => {
    const name = draft.trim();
    if (!name) return;
    create.mutate(
      { data: { entity, name, color: draftColor } },
      {
        onSuccess: () => {
          setDraft("");
          setAdding(false);
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 px-5 py-10 text-body-quiet text-subtle">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("settings.labels.loading")}
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="px-5 py-10 text-center text-body-quiet text-destructive">
        {t("settings.labels.loadFailed")}
      </div>
    );
  }

  return (
    <div>
      {adding && (
        <div className="flex items-center gap-3 border-b border-border bg-surface-whisper/60 px-5 py-3">
          <ColorPicker color={draftColor} onPick={setDraftColor} />
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitDraft();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder={t("settings.labels.namePlaceholder")}
            dir="auto"
            className="h-8 max-w-xs"
            maxLength={60}
          />
          <Button
            size="sm"
            onClick={submitDraft}
            disabled={!draft.trim() || busy}
            className="h-8 bg-primary text-primary-foreground hover:bg-primary-hover"
          >
            {t("common.add")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAdding(false)}
            className="h-8"
          >
            {t("common.cancel")}
          </Button>
        </div>
      )}

      {data.labels.length === 0 && data.unregistered.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <Tag className="mx-auto mb-2 h-6 w-6 text-subtle" />
          <p className="text-body-quiet text-muted-foreground">
            {t("settings.labels.empty")}
          </p>
          <p className="mt-1 text-caption-quiet text-subtle">
            {t("settings.labels.emptyHint")}
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {data.labels.map((label) => (
              <LabelRow
                key={label.id}
                label={label}
                entity={entity}
                busy={busy}
                onRename={(name) =>
                  update.mutate({ id: label.id, data: { name } })
                }
                onRecolor={(color) =>
                  update.mutate({ id: label.id, data: { color } })
                }
                onDelete={() => remove.mutate({ id: label.id })}
              />
            ))}
          </ul>

          {data.unregistered.length > 0 && (
            <div className="border-t border-border bg-surface-whisper/40">
              <p className="px-5 pb-1 pt-3 text-caption text-subtle">
                {t("settings.labels.unregistered")}
              </p>
              <ul className="divide-y divide-border">
                {data.unregistered.map((u: UnregisteredLabel) => (
                  <li
                    key={u.name.toLowerCase()}
                    className="flex items-center gap-3 px-5 py-2"
                  >
                    <span
                      className={cn(
                        "h-5 w-5 shrink-0 rounded-full",
                        labelColorClasses("slate").swatch,
                      )}
                    />
                    <span
                      dir="auto"
                      className="min-w-0 flex-1 truncate text-body-quiet text-foreground"
                    >
                      {u.name}
                    </span>
                    <span className="shrink-0 text-caption-quiet tabular-nums text-subtle">
                      {usageText(u.usageCount, entity, t, tPlural)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        create.mutate({ data: { entity, name: u.name } })
                      }
                      className="h-7 px-2.5 text-caption-quiet"
                    >
                      <Plus className="me-1 h-3 w-3" /> {t("settings.labels.addToList")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <p className="border-t border-border px-5 py-3 text-[11px] leading-relaxed text-subtle">
        {t("settings.labels.footnote")}
      </p>
    </div>
  );
}

function LabelsSection() {
  const { t } = useI18n();
  const [entity, setEntity] = useState<LabelEntity>("deal");
  const [adding, setAdding] = useState(false);

  return (
    <SectionCard
      title={t("settings.labels.labelsTitle")}
      description={t("settings.labels.labelsDescription")}
      actions={
        <div className="flex items-center gap-2">
          <Tabs
            value={entity}
            onValueChange={(v) => {
              setEntity(v as LabelEntity);
              setAdding(false);
            }}
          >
            <TabsList className="h-8">
              {ENTITY_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="text-caption-quiet">
                  {t(tab.labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button
            size="sm"
            onClick={() => setAdding(true)}
            className="h-8 bg-primary text-primary-foreground hover:bg-primary-hover"
          >
            <Plus className="me-1 h-3.5 w-3.5" /> {t("settings.labels.new")}
          </Button>
        </div>
      }
    >
      {/* Keyed per entity so drafts don't leak across tabs. */}
      <LabelsPanel
        key={entity}
        entity={entity}
        adding={adding}
        setAdding={setAdding}
      />
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Lost reasons
// ---------------------------------------------------------------------------

function LostReasonRow({
  reason,
  onRename,
  onToggle,
  onDelete,
  busy,
}: {
  reason: LostReason;
  onRename: (name: string) => void;
  onToggle: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { t, tPlural } = useI18n();
  return (
    <li
      className={cn(
        "group flex items-center gap-3 px-5 py-2.5",
        !reason.active && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <EditableText
          value={reason.name}
          onCommit={(next) => next.trim() && onRename(next.trim())}
          className="-ms-1 text-body text-foreground"
        />
      </div>
      {!reason.active && (
        <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-caption font-medium text-muted-foreground">
          {t("common.archived")}
        </span>
      )}
      <span className="shrink-0 text-caption-quiet tabular-nums text-subtle">
        {reason.usageCount === 0
          ? t("settings.labels.noDeals")
          : tPlural("settings.labels.usage.deal", reason.usageCount)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        disabled={busy}
        onClick={onToggle}
        aria-label={
          reason.active
            ? t("settings.labels.reasons.archive")
            : t("settings.labels.reasons.restore")
        }
        title={
          reason.active
            ? t("settings.labels.reasons.archiveHint")
            : t("common.restore")
        }
        className="h-7 w-7 shrink-0 text-subtle opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100"
      >
        {reason.active ? (
          <Archive className="h-3.5 w-3.5" />
        ) : (
          <ArchiveRestore className="h-3.5 w-3.5" />
        )}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={t("settings.labels.deleteAria", { name: reason.name })}
            className="h-7 w-7 shrink-0 text-subtle opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.labels.deleteTitle", { name: reason.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.labels.reasons.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-white hover:bg-destructive"
            >
              {t("settings.labels.reasons.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function LostReasonsSection() {
  const { t, tPlural } = useI18n();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");

  const { data, isLoading, isError } = useAdminListLostReasons({
    query: { queryKey: getAdminListLostReasonsQueryKey() },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: getAdminListLostReasonsQueryKey(),
    });
    queryClient.invalidateQueries({ queryKey: getListLostReasonsQueryKey() });
  };
  const onError = (err: unknown) =>
    toast({ title: errorMessage(err), variant: "destructive" });

  const create = useCreateLostReason({
    mutation: { onSuccess: invalidate, onError },
  });
  const update = useUpdateLostReason({
    mutation: { onSuccess: invalidate, onError },
  });
  const remove = useDeleteLostReason({
    mutation: { onSuccess: invalidate, onError },
  });
  const busy = create.isPending || update.isPending || remove.isPending;

  const submit = () => {
    const name = draft.trim();
    if (!name) return;
    create.mutate({ data: { name } }, { onSuccess: () => setDraft("") });
  };

  return (
    <SectionCard
      title={t("settings.labels.reasons.title")}
      description={t("settings.labels.reasons.description")}
    >
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={t("settings.labels.reasons.addPlaceholder")}
          dir="auto"
          className="h-8 max-w-sm"
          maxLength={120}
        />
        <Button
          size="sm"
          onClick={submit}
          disabled={!draft.trim() || busy}
          className="h-8 bg-primary text-primary-foreground hover:bg-primary-hover"
        >
          <Plus className="me-1 h-3.5 w-3.5" /> {t("common.add")}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 px-5 py-10 text-body-quiet text-subtle">
          <Loader2 className="h-4 w-4 animate-spin" />{" "}
          {t("settings.labels.reasons.loading")}
        </div>
      ) : isError || !data ? (
        <div className="px-5 py-10 text-center text-body-quiet text-destructive">
          {t("settings.labels.reasons.loadFailed")}
        </div>
      ) : (
        <>
          {data.reasons.length === 0 ? (
            <div className="px-5 py-8 text-center text-body-quiet text-muted-foreground">
              {t("settings.labels.reasons.empty")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {data.reasons.map((reason) => (
                <LostReasonRow
                  key={reason.id}
                  reason={reason}
                  busy={busy}
                  onRename={(name) =>
                    update.mutate({ id: reason.id, data: { name } })
                  }
                  onToggle={() =>
                    update.mutate({
                      id: reason.id,
                      data: { active: !reason.active },
                    })
                  }
                  onDelete={() => remove.mutate({ id: reason.id })}
                />
              ))}
            </ul>
          )}

          {data.unmanaged.length > 0 && (
            <div className="border-t border-border bg-surface-whisper/40">
              <p className="px-5 pb-1 pt-3 text-caption text-subtle">
                {t("settings.labels.reasons.unmanaged")}
              </p>
              <ul className="divide-y divide-border">
                {data.unmanaged.map((u: UnmanagedLostReason) => (
                  <li
                    key={u.name.toLowerCase()}
                    className="flex items-center gap-3 px-5 py-2"
                  >
                    <span
                      dir="auto"
                      className="min-w-0 flex-1 truncate text-body-quiet text-foreground"
                      title={u.name}
                    >
                      {u.name}
                    </span>
                    <span className="shrink-0 text-caption-quiet tabular-nums text-subtle">
                      {tPlural("settings.labels.usage.deal", u.usageCount)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => create.mutate({ data: { name: u.name } })}
                      className="h-7 px-2.5 text-caption-quiet"
                    >
                      <Plus className="me-1 h-3 w-3" /> {t("settings.labels.addToList")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="border-t border-border px-5 py-3 text-[11px] leading-relaxed text-subtle">
            {t("settings.labels.reasons.footnote")}
          </p>
        </>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------

export function LabelsSettings() {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <header className="mb-5">
        <h1 className="text-heading-sm text-foreground">
          {t("settings.labels.title")}
        </h1>
        <p className="mt-1 text-body-quiet text-muted-foreground">
          {t("settings.labels.subtitle")}
        </p>
      </header>
      <div className="flex flex-col gap-4">
        <LabelsSection />
        <LostReasonsSection />
      </div>
    </div>
  );
}
