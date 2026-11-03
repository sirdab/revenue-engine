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
  SaudiRiyal,
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

// Settings → Labels: one place to curate the shared taxonomy — colored labels
// for deals / people / organizations, the managed lost-reason list, and the
// workspace currency. Registry mutations rewrite the denormalized values on
// records server-side, so renames/merges/deletes here propagate everywhere.

const ENTITY_TABS: Array<{ value: LabelEntity; label: string; noun: string }> =
  [
    { value: "deal", label: "Deals", noun: "deal" },
    { value: "person", label: "People", noun: "person" },
    { value: "organization", label: "Organizations", noun: "organization" },
  ];

function usageText(count: number, noun: string): string {
  if (count === 0) return "Not in use";
  const plural =
    noun === "person" ? "people" : noun === "deal" ? "deals" : "organizations";
  return `${count.toLocaleString()} ${count === 1 ? noun : plural}`;
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
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Change color"
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
              aria-label={token}
              title={token}
              onClick={() => {
                onPick(token);
                setOpen(false);
              }}
              className={cn(
                "h-6 w-6 rounded-full transition-transform hover:scale-110",
                labelColorClasses(token).swatch,
                token === color &&
                  "ring-2 ring-slate-500 ring-offset-1 ring-offset-white",
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
  noun,
  onRename,
  onRecolor,
  onDelete,
  busy,
}: {
  label: Label;
  noun: string;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <li className="group flex items-center gap-3 px-5 py-2.5">
      <ColorPicker color={label.color} onPick={onRecolor} disabled={busy} />
      <div className="min-w-0 flex-1">
        <EditableText
          value={label.name}
          onCommit={(next) => next.trim() && onRename(next.trim())}
          className="-ms-1 text-sm font-medium text-slate-800"
        />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-slate-400">
        {usageText(label.usageCount, noun)}
      </span>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={`Delete ${label.name}`}
            className="h-7 w-7 shrink-0 text-slate-300 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{label.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {label.usageCount > 0
                ? `The label will be removed from ${usageText(label.usageCount, noun)}. This cannot be undone.`
                : "The label isn't on any record; it will simply disappear from the pickers."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete label
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function LabelsPanel({
  entity,
  noun,
  adding,
  setAdding,
}: {
  entity: LabelEntity;
  noun: string;
  adding: boolean;
  setAdding: (next: boolean) => void;
}) {
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
            title: `Label deleted, removed from ${result.removedFrom.toLocaleString()} record${result.removedFrom === 1 ? "" : "s"}.`,
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
      <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading labels…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="px-5 py-10 text-center text-sm text-red-600">
        Failed to load labels.
      </div>
    );
  }

  return (
    <div>
      {adding && (
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
          <ColorPicker color={draftColor} onPick={setDraftColor} />
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitDraft();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="Label name…"
            className="h-8 max-w-xs"
            maxLength={60}
          />
          <Button
            size="sm"
            onClick={submitDraft}
            disabled={!draft.trim() || busy}
            className="h-8 bg-teal-600 text-white hover:bg-teal-700"
          >
            Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAdding(false)}
            className="h-8"
          >
            Cancel
          </Button>
        </div>
      )}

      {data.labels.length === 0 && data.unregistered.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <Tag className="mx-auto mb-2 h-6 w-6 text-slate-300" />
          <p className="text-sm text-slate-500">No labels yet.</p>
          <p className="mt-1 text-xs text-slate-400">
            Create one here, or add labels directly on records; they'll show
            up here so you can add them to your list.
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {data.labels.map((label) => (
              <LabelRow
                key={label.id}
                label={label}
                noun={noun}
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
            <div className="border-t border-slate-100 bg-slate-50/40">
              <p className="px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                In use, not in your list
              </p>
              <ul className="divide-y divide-slate-100">
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
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                      {u.name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-400">
                      {usageText(u.usageCount, noun)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        create.mutate({ data: { entity, name: u.name } })
                      }
                      className="h-7 px-2.5 text-xs"
                    >
                      <Plus className="me-1 h-3 w-3" /> Add to list
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <p className="border-t border-slate-100 px-5 py-3 text-[11px] leading-relaxed text-slate-400">
        Renaming a label updates every record carrying it; renaming it to an
        existing label's name merges the two. Deleting strips it from all
        records.
      </p>
    </div>
  );
}

function LabelsSection() {
  const [entity, setEntity] = useState<LabelEntity>("deal");
  const [adding, setAdding] = useState(false);
  const tab = ENTITY_TABS.find((t) => t.value === entity)!;

  return (
    <SectionCard
      title="Labels"
      description="Colored tags shared across the workspace. One set per record type; reps pick from it everywhere labels appear."
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
              {ENTITY_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="text-xs">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button
            size="sm"
            onClick={() => setAdding(true)}
            className="h-8 bg-teal-600 text-white hover:bg-teal-700"
          >
            <Plus className="me-1 h-3.5 w-3.5" /> New label
          </Button>
        </div>
      }
    >
      {/* Keyed per entity so drafts don't leak across tabs. */}
      <LabelsPanel
        key={entity}
        entity={entity}
        noun={tab.noun}
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
          className="-ms-1 text-sm font-medium text-slate-800"
        />
      </div>
      {!reason.active && (
        <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Archived
        </span>
      )}
      <span className="shrink-0 text-xs tabular-nums text-slate-400">
        {reason.usageCount === 0
          ? "No deals"
          : `${reason.usageCount.toLocaleString()} ${reason.usageCount === 1 ? "deal" : "deals"}`}
      </span>
      <Button
        variant="ghost"
        size="icon"
        disabled={busy}
        onClick={onToggle}
        aria-label={reason.active ? "Archive reason" : "Restore reason"}
        title={reason.active ? "Archive (hide from picker)" : "Restore"}
        className="h-7 w-7 shrink-0 text-slate-300 opacity-0 transition-opacity hover:text-slate-600 group-hover:opacity-100"
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
            aria-label={`Delete ${reason.name}`}
            className="h-7 w-7 shrink-0 text-slate-300 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{reason.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Deals that were lost with this reason keep it; only the managed
              list changes. If it's still on lost deals it will reappear below
              under “Found on lost deals”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete reason
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function LostReasonsSection() {
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
      title="Lost reasons"
      description="The list reps pick from when marking a deal lost. They can still type a one-off custom reason; recurring ones surface below so you can promote them."
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Add a reason, e.g. “Price too high”…"
          className="h-8 max-w-sm"
          maxLength={120}
        />
        <Button
          size="sm"
          onClick={submit}
          disabled={!draft.trim() || busy}
          className="h-8 bg-teal-600 text-white hover:bg-teal-700"
        >
          <Plus className="me-1 h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading reasons…
        </div>
      ) : isError || !data ? (
        <div className="px-5 py-10 text-center text-sm text-red-600">
          Failed to load lost reasons.
        </div>
      ) : (
        <>
          {data.reasons.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">
              No managed reasons yet. Add your first above.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
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
            <div className="border-t border-slate-100 bg-slate-50/40">
              <p className="px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Found on lost deals
              </p>
              <ul className="divide-y divide-slate-100">
                {data.unmanaged.map((u: UnmanagedLostReason) => (
                  <li
                    key={u.name.toLowerCase()}
                    className="flex items-center gap-3 px-5 py-2"
                  >
                    <span
                      className="min-w-0 flex-1 truncate text-sm text-slate-700"
                      title={u.name}
                    >
                      {u.name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-400">
                      {u.usageCount.toLocaleString()}{" "}
                      {u.usageCount === 1 ? "deal" : "deals"}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => create.mutate({ data: { name: u.name } })}
                      className="h-7 px-2.5 text-xs"
                    >
                      <Plus className="me-1 h-3 w-3" /> Add to list
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="border-t border-slate-100 px-5 py-3 text-[11px] leading-relaxed text-slate-400">
            Renaming a reason updates every deal that carries it. Archiving
            hides it from the picker without touching history.
          </p>
        </>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

function CurrencySection() {
  return (
    <SectionCard
      title="Currency"
      description="The workspace default used for deal values, forecasts and totals."
    >
      <div className="flex items-center gap-4 px-5 py-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-teal-200 bg-teal-50 text-teal-700">
          <SaudiRiyal className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">
              Saudi Riyal
            </span>
            <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
              Default
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            SAR: amounts across the app render with the official riyal symbol
            introduced by SAMA.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------

export function LabelsSettings() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <header className="mb-5">
        <h1 className="font-heading text-xl font-bold text-slate-900">
          Labels &amp; lost reasons
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Curate the shared vocabulary your team uses to classify deals,
          contacts and losses.
        </p>
      </header>
      <div className="flex flex-col gap-4">
        <LabelsSection />
        <LostReasonsSection />
        <CurrencySection />
      </div>
    </div>
  );
}
