import { Fragment, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  Pencil,
  Trash2,
  Archive,
  ArchiveRestore,
  Star,
  Loader2,
  GripVertical,
  MoreHorizontal,
  ChevronRight,
  Clock,
  ListChecks,
  Check,
  Lock,
  Trophy,
  X,
  Search as SearchIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";
import { fieldInPipeline, useDealFieldRegistry } from "@/lib/deal-fields-api";
import {
  useAdminPipelines,
  useAdminStages,
  createPipeline,
  updatePipeline,
  setDefaultPipeline,
  deletePipeline,
  reorderPipelines,
  createStage,
  updateStage,
  reorderStages,
  deleteStage,
  invalidatePipelineData,
  ApiError,
  type AdminPipelineRow,
  type AdminStageRow,
} from "@/lib/pipelines-admin-api";

function IconBtn({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-7 w-7 text-subtle disabled:opacity-30",
        danger ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {children}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Shared required-fields picker (stage dialog + pipeline won-requirements
// dialog). Every active registry field is requirable — core deal columns,
// imported (Pipedrive) data fields, and user-created custom fields alike.
// ---------------------------------------------------------------------------

function RequiredFieldsPicker({
  value,
  onChange,
  locked,
  pipelineId,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Offer only fields that belong to this pipeline (plus any already picked). */
  pipelineId: number;
  /** Keys already required by an earlier stage (key → that stage's name).
   *  Shown selected with a lock — they apply here no matter what, so the only
   *  way to drop them is to edit the stage they come from. */
  locked?: Map<string, string>;
}) {
  const { t } = useI18n();
  const { data: registry } = useDealFieldRegistry();
  const fieldOptions = useMemo(
    () =>
      (registry?.fields ?? []).filter(
        (f) =>
          f.active &&
          (fieldInPipeline(f.config?.pipelineIds, pipelineId) || value.includes(f.key)),
      ),
    [registry, pipelineId, value],
  );
  const [fieldSearch, setFieldSearch] = useState("");

  const fieldGroups = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase();
    const matches = (f: (typeof fieldOptions)[number]) =>
      !q || f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q);
    const byStorage: Record<string, typeof fieldOptions> = { column: [], data: [], custom: [] };
    for (const f of fieldOptions) (byStorage[f.storage] ?? byStorage.custom!).push(f);
    return [
      { title: t("settings.pipelines.picker.dealFields"), items: byStorage.column!.filter(matches) },
      { title: t("settings.pipelines.picker.importedFields"), items: byStorage.data!.filter(matches) },
      { title: t("settings.pipelines.picker.customFields"), items: byStorage.custom!.filter(matches) },
    ].filter((g) => g.items.length > 0);
  }, [fieldOptions, fieldSearch, t]);

  // Keys still required whose field was since deactivated or deleted —
  // surface them so they can be removed (the server rejects saves that keep
  // them).
  const staleRequired = useMemo(
    () => value.filter((k) => !fieldOptions.some((f) => f.key === k)),
    [value, fieldOptions],
  );

  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);

  // The stale-key section below must render even with zero active fields —
  // it's the only way to drop keys the server would reject on save.
  return (
    <>
      {fieldOptions.length === 0 ? (
        <p className="text-caption-quiet text-subtle">
          {t("settings.pipelines.picker.noFields")}
        </p>
      ) : (
      <div className="rounded-md border border-border">
        <div className="border-b border-border p-1.5">
          <Input
            value={fieldSearch}
            onChange={(e) => setFieldSearch(e.target.value)}
            placeholder={t("settings.pipelines.picker.search")}
            className="h-7 text-caption-quiet"
          />
        </div>
        <div className="max-h-48 space-y-2.5 overflow-y-auto p-2">
          {fieldGroups.length === 0 && (
            <p className="py-2 text-center text-caption-quiet text-subtle">
              {t("settings.pipelines.picker.noMatch", { query: fieldSearch.trim() })}
            </p>
          )}
          {fieldGroups.map((g) => (
            <div key={g.title}>
              <p className="mb-1 text-caption text-subtle">
                {g.title}
              </p>
              <div className="flex flex-wrap gap-1">
                {g.items.map((f) => {
                  const own = value.includes(f.key);
                  const inheritedFrom = locked?.get(f.key);
                  // A key can be BOTH own and inherited (configs from before
                  // requirements became cumulative duplicated keys per stage).
                  // Own selections always stay toggleable — locking applies
                  // only to purely-inherited keys, so the own copy is never
                  // hidden or stuck.
                  const lockedBy = own ? undefined : inheritedFrom;
                  const on = own || lockedBy != null;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      disabled={lockedBy != null}
                      title={
                        lockedBy != null
                          ? t("settings.pipelines.picker.lockedBy", { stage: lockedBy })
                          : own && inheritedFrom
                            ? t("settings.pipelines.picker.alsoRequired", { stage: inheritedFrom })
                            : `${f.key} · ${f.fieldType}`
                      }
                      onClick={() => toggle(f.key)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-caption-quiet transition-colors",
                        lockedBy != null
                          ? "cursor-default border-gray-alpha-300 bg-gray-alpha-100 text-foreground"
                          : on
                            ? "border-gray-alpha-300 bg-gray-alpha-50 text-foreground"
                            : "border-border text-muted-foreground hover:border-input",
                      )}
                    >
                      {lockedBy != null ? (
                        <Lock className="h-3 w-3" />
                      ) : (
                        on && <Check className="h-3 w-3" />
                      )}
                      <span dir="auto">{f.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
      {staleRequired.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-caption-quiet text-warning">
            {t("settings.pipelines.picker.stale")}
          </p>
          <div className="flex flex-wrap gap-1">
            {staleRequired.map((k) => (
              <button
                key={k}
                type="button"
                title={t("settings.pipelines.picker.clickToRemove")}
                onClick={() => toggle(k)}
                className="inline-flex items-center gap-1 rounded-sm border border-warning/30 bg-warning-subtle px-2 py-0.5 text-caption-quiet text-warning"
              >
                <span dir="ltr">{k}</span> <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Stage create/edit dialog
// ---------------------------------------------------------------------------

function StageDialog({
  open,
  onOpenChange,
  pipelineId,
  editing,
  siblings,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pipelineId: number;
  editing: AdminStageRow | null;
  /** Active stages of the pipeline in funnel order — used to compute which
   *  required fields this stage inherits from earlier stages. */
  siblings: AdminStageRow[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const { t, formatNumber } = useI18n();
  const { data: registry } = useDealFieldRegistry();
  const [name, setName] = useState("");
  const [probability, setProbability] = useState("100");
  const [rotting, setRotting] = useState("");
  const [required, setRequired] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setProbability(String(editing?.probability ?? 100));
    setRotting(editing?.rottingDays == null ? "" : String(editing.rottingDays));
    setRequired(editing?.requiredFields ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  // Requirements are cumulative down the funnel: everything required by an
  // earlier stage is automatically required here too (a new stage is appended
  // last, so it inherits from every existing stage). Key → first stage name.
  // Filtered to active fields — the server gate only enforces those, so a key
  // whose field was since deactivated must not display as inherited.
  const inherited = useMemo(() => {
    const activeKeys = new Set(
      (registry?.fields ?? []).filter((f) => f.active).map((f) => f.key),
    );
    const idx = editing ? siblings.findIndex((s) => s.id === editing.id) : siblings.length;
    const earlier = idx >= 0 ? siblings.slice(0, idx) : siblings;
    const map = new Map<string, string>();
    for (const s of earlier) {
      for (const k of s.requiredFields) {
        if (activeKeys.has(k) && !map.has(k)) map.set(k, s.name);
      }
    }
    return map;
  }, [siblings, editing, registry]);

  const probNumber = Number(probability);
  const sliderValue = Number.isFinite(probNumber)
    ? Math.min(100, Math.max(0, probNumber))
    : 100;

  const save = async () => {
    // Enter reaches here too, and the button's disabled state doesn't stop it.
    if (saving) return;
    if (!name.trim()) {
      toast({ title: t("settings.pipelines.error.nameRequired"), variant: "destructive" });
      return;
    }
    const prob = Number(probability);
    if (!Number.isInteger(prob) || prob < 0 || prob > 100) {
      toast({ title: t("settings.pipelines.error.probabilityRange"), variant: "destructive" });
      return;
    }
    const rottingDays = rotting.trim() === "" ? null : Number(rotting);
    if (rottingDays !== null && (!Number.isInteger(rottingDays) || rottingDays <= 0)) {
      toast({ title: t("settings.pipelines.error.rottingPositive"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        probability: prob,
        rottingDays,
        requiredFields: required,
      };
      if (editing) await updateStage(editing.id, payload);
      else await createStage({ pipelineId, ...payload });
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast({ title: t("settings.pipelines.error.saveStage"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t("settings.pipelines.editStage") : t("settings.pipelines.newStage")}</DialogTitle>
          <DialogDescription>
            {t("settings.pipelines.stageDialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block text-body-quiet">
            <span className="mb-1 block font-medium text-muted-foreground">{t("common.name")}</span>
            <Input
              autoFocus
              dir="auto"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("settings.pipelines.stageNamePlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </label>
          <div className="text-body-quiet">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium text-muted-foreground">{t("settings.pipelines.winProbability")}</span>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={probability}
                  onChange={(e) => setProbability(e.target.value)}
                  dir="ltr"
                  aria-label={t("settings.pipelines.winProbability")}
                  className="h-7 w-16 text-end tabular-nums"
                />
                <span className="text-subtle">%</span>
              </div>
            </div>
            <Slider
              value={[sliderValue]}
              onValueChange={([v]) => setProbability(String(v))}
              max={100}
              step={5}
              aria-label={t("settings.pipelines.winProbability")}
            />
          </div>
          <label className="block text-body-quiet">
            <span className="mb-1 block font-medium text-muted-foreground">{t("settings.pipelines.rottingDays")}</span>
            <Input
              type="number"
              min="1"
              value={rotting}
              onChange={(e) => setRotting(e.target.value)}
              placeholder={t("settings.pipelines.rottingNever")}
            />
            <span className="mt-1 block text-caption-quiet text-subtle">
              {t("settings.pipelines.rottingHint")}
            </span>
          </label>
          <div className="text-body-quiet">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium text-muted-foreground">{t("deals.requiredFields.title")}</span>
              {required.length > 0 && (
                <button
                  type="button"
                  onClick={() => setRequired([])}
                  className="text-caption-quiet text-subtle hover:text-muted-foreground"
                >
                  {t("settings.pipelines.clearCount", { count: formatNumber(required.length) })}
                </button>
              )}
            </div>
            <p className="mb-2 text-caption-quiet text-subtle">
              {t("settings.pipelines.stageRequiredHint")}
            </p>
            <RequiredFieldsPicker
              value={required}
              onChange={setRequired}
              locked={inherited}
              pipelineId={pipelineId}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? t("common.save") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Pipeline won-requirements dialog — fields a deal in this pipeline must have
// filled before it can be marked as won.
// ---------------------------------------------------------------------------

function WonRequiredFieldsDialog({
  pipeline,
  onClose,
  onDone,
}: {
  pipeline: AdminPipelineRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const { t, tNode, formatNumber } = useI18n();
  const [selectedKeys, setSelectedKeys] = useState<string[]>(
    pipeline.wonRequiredFields ?? [],
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updatePipeline(pipeline.id, { wonRequiredFields: selectedKeys });
      onDone();
      onClose();
    } catch (e) {
      toast({
        title: t("settings.pipelines.error.saveWon"),
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-warning-glyph" />
            {t("settings.pipelines.wonDialogTitle")}
          </DialogTitle>
          <DialogDescription>
            {tNode("settings.pipelines.wonDialogDescription", {
              name: <bdi dir="auto">{pipeline.name}</bdi>,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="text-body-quiet">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium text-muted-foreground">{t("deals.requiredFields.title")}</span>
            {selectedKeys.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedKeys([])}
                className="text-caption-quiet text-subtle hover:text-muted-foreground"
              >
                {t("settings.pipelines.clearCount", { count: formatNumber(selectedKeys.length) })}
              </button>
            )}
          </div>
          <RequiredFieldsPicker
            value={selectedKeys}
            onChange={setSelectedKeys}
            pipelineId={pipeline.id}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reassign-before-delete dialog (stage with deals)
// ---------------------------------------------------------------------------

function ReassignDialog({
  stage,
  siblings,
  onClose,
  onConfirm,
}: {
  stage: AdminStageRow;
  siblings: AdminStageRow[];
  onClose: () => void;
  onConfirm: (targetId: number) => void;
}) {
  const { t, tPlural, formatNumber } = useI18n();
  const [target, setTarget] = useState<string>("");
  const options = siblings.filter((s) => s.id !== stage.id && !s.archived);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings.pipelines.reassignTitle")}</DialogTitle>
          <DialogDescription>
            {tPlural("settings.pipelines.reassignDescription", stage.activeDealCount, {
              name: stage.name,
              count: formatNumber(stage.activeDealCount),
            })}
          </DialogDescription>
        </DialogHeader>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger><SelectValue placeholder={t("settings.pipelines.chooseStage")} /></SelectTrigger>
          <SelectContent>
            {options.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}><span dir="auto">{s.name}</span></SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            disabled={!target}
            onClick={() => onConfirm(Number(target))}
            className="bg-destructive hover:bg-destructive"
          >
            {t("settings.pipelines.moveAndDelete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Generic destructive-action confirmation
// ---------------------------------------------------------------------------

interface ConfirmState {
  title: string;
  description: string;
  confirmLabel: string;
  action: () => void;
}

function ConfirmDialog({ confirm, onClose }: { confirm: ConfirmState | null; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <AlertDialog open={!!confirm} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive hover:bg-destructive"
            onClick={() => {
              confirm?.action();
              onClose();
            }}
          >
            {confirm?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Sortable pipeline list item
// ---------------------------------------------------------------------------

function SortablePipelineItem({
  pipeline,
  selected,
  dragDisabled = false,
  onSelect,
  onSetDefault,
  onRename,
  onArchive,
  onDelete,
}: {
  pipeline: AdminPipelineRow;
  selected: boolean;
  /** Reordering a filtered subset is ambiguous — dragging is disabled while
   *  the pipeline search has a query. */
  dragDisabled?: boolean;
  onSelect: () => void;
  onSetDefault: () => void;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { t, tPlural, formatNumber } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: pipeline.id, disabled: dragDisabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-1 rounded-md border bg-card px-1.5 py-1.5",
        selected ? "border-gray-alpha-300 bg-gray-alpha-100" : "border-border hover:bg-gray-alpha-50",
        isDragging && "z-10 shadow-raised",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...(dragDisabled ? {} : listeners)}
        disabled={dragDisabled}
        aria-label={t("settings.pipelines.reorderAria", { name: pipeline.name })}
        title={dragDisabled ? t("settings.pipelines.clearSearchToReorder") : undefined}
        className={cn(
          "touch-none rounded-sm p-0.5 text-subtle",
          dragDisabled
            ? "cursor-default opacity-40"
            : "cursor-grab hover:text-muted-foreground active:cursor-grabbing",
        )}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button type="button" className="min-w-0 flex-1 text-start" onClick={onSelect}>
        <div className="flex items-center gap-1.5">
          <span dir="auto" className="truncate text-body text-foreground">{pipeline.name}</span>
          {pipeline.isDefault && (
            <Badge variant="outline" className="shrink-0 border-warning/30 bg-warning-subtle text-[10px] text-warning">
              {t("settings.pipelines.default")}
            </Badge>
          )}
        </div>
        <span className="block text-[10px] text-subtle">
          {tPlural("settings.pipelines.activeDeals", pipeline.activeDealCount, {
            count: formatNumber(pipeline.activeDealCount),
          })}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-subtle hover:text-foreground"
            aria-label={t("settings.pipelines.actionsFor", { name: pipeline.name })}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!pipeline.isDefault && (
            <DropdownMenuItem onClick={onSetDefault}>
              <Star className="me-2 h-3.5 w-3.5" /> {t("settings.pipelines.setDefault")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="me-2 h-3.5 w-3.5" /> {t("common.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onArchive}>
            <Archive className="me-2 h-3.5 w-3.5" /> {t("common.archive")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
            <Trash2 className="me-2 h-3.5 w-3.5" /> {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable stage row
// ---------------------------------------------------------------------------

function SortableStageRow({
  stage,
  inheritedRequired,
  fieldLabel,
  onEdit,
  onArchive,
  onDelete,
}: {
  stage: AdminStageRow;
  /** Keys required by earlier stages that this stage inherits (not in its own
   *  requiredFields). */
  inheritedRequired: string[];
  fieldLabel: (key: string) => string;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { t, tPlural, formatNumber } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stage.id });
  const requiredCount = stage.requiredFields.length + inheritedRequired.length;
  const listSep = t("settings.pipelines.listSeparator");
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 border-t border-border bg-card px-2 py-2",
        isDragging && "z-10 shadow-raised",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t("settings.pipelines.reorderAria", { name: stage.name })}
        className="cursor-grab touch-none rounded-sm p-0.5 text-subtle hover:text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span dir="auto" className="truncate text-body text-foreground">{stage.name}</span>
          {requiredCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  aria-label={tPlural("settings.pipelines.requiredCountAria", requiredCount, {
                    count: formatNumber(requiredCount),
                  })}
                  className="inline-flex items-center gap-0.5 rounded-sm border border-border bg-surface-whisper px-1 py-px text-[10px] text-muted-foreground"
                >
                  <ListChecks className="h-3 w-3" />{" "}
                  {formatNumber(requiredCount)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                {stage.requiredFields.length > 0 && (
                  <p>
                    {t("settings.pipelines.requiredHere", {
                      fields: stage.requiredFields.map(fieldLabel).join(listSep),
                    })}
                  </p>
                )}
                {inheritedRequired.length > 0 && (
                  <p>
                    {t("settings.pipelines.inheritedRequired", {
                      fields: inheritedRequired.map(fieldLabel).join(listSep),
                    })}
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="flex w-28 shrink-0 items-center gap-1.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${stage.probability}%` }} />
        </div>
        <span className="w-9 text-end text-caption-quiet tabular-nums text-muted-foreground">
          {formatNumber(stage.probability / 100, { style: "percent" })}
        </span>
      </div>
      <div className="w-16 shrink-0 text-end">
        {stage.rottingDays != null ? (
          <span className="inline-flex items-center gap-1 text-caption-quiet tabular-nums text-muted-foreground">
            <Clock className="h-3 w-3 text-warning-glyph" />{" "}
            {tPlural("settings.pipelines.rottingDaysShort", stage.rottingDays, {
              count: formatNumber(stage.rottingDays),
            })}
          </span>
        ) : (
          <span className="text-caption-quiet text-subtle">—</span>
        )}
      </div>
      <div className="w-12 shrink-0 text-end text-caption-quiet tabular-nums text-muted-foreground">
        {formatNumber(stage.activeDealCount)}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconBtn title={t("common.edit")} onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </IconBtn>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-subtle hover:text-foreground"
              aria-label={t("settings.pipelines.moreActionsFor", { name: stage.name })}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onArchive}>
              <Archive className="me-2 h-3.5 w-3.5" /> {t("common.archive")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="me-2 h-3.5 w-3.5" /> {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline flow preview — the funnel at a glance
// ---------------------------------------------------------------------------

function PipelineFlowPreview({ stages }: { stages: AdminStageRow[] }) {
  const { t, tPlural, formatNumber } = useI18n();
  if (stages.length === 0) return null;
  return (
    // Cards flex to fill the panel width (with a readable floor); very long
    // funnels scroll horizontally instead of shrinking into unreadability.
    <div className="mb-4 flex items-stretch overflow-x-auto pb-1">
      {stages.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && (
            <div className="flex shrink-0 items-center px-1">
              <ChevronRight
                aria-label={t("settings.pipelines.flowNext")}
                className="h-4 w-4 text-subtle"
              />
            </div>
          )}
          <div className="min-w-[150px] flex-1 overflow-hidden rounded-lg bg-card shadow-card transition-shadow hover:shadow-card-hover">
            <div className="px-3 pb-2 pt-2.5">
              <div className="flex items-center gap-1.5">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                  {formatNumber(i + 1)}
                </span>
                <span
                  dir="auto"
                  title={s.name}
                  className="truncate text-label font-semibold text-foreground"
                >
                  {s.name}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] tabular-nums">
                <span className="font-semibold text-brand">
                  {formatNumber(s.probability / 100, { style: "percent" })}
                </span>
                <span className="text-subtle">·</span>
                <span
                  className={
                    s.activeDealCount > 0
                      ? "font-medium text-muted-foreground"
                      : "text-subtle"
                  }
                >
                  {tPlural("settings.pipelines.stageDeals", s.activeDealCount, {
                    count: formatNumber(s.activeDealCount),
                  })}
                </span>
              </div>
            </div>
            <div className="h-1 bg-muted">
              <div
                className="h-full rounded-e-full bg-gradient-to-r from-brand-400 to-brand-600 rtl:bg-gradient-to-l"
                style={{ width: `${s.probability}%` }}
              />
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function PipelineStageSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t, tPlural, tNode, formatNumber } = useI18n();
  const [savingReassign, setSavingReassign] = useState(false);
  const { data: pipelines, isLoading } = useAdminPipelines();
  const [selected, setSelected] = useState<number | null>(null);
  const { data: stages } = useAdminStages(selected);
  const { data: registry } = useDealFieldRegistry();

  const [pipelineDialog, setPipelineDialog] = useState<{ editing: AdminPipelineRow | null } | null>(null);
  const [pipelineName, setPipelineName] = useState("");
  const [savingPipeline, setSavingPipeline] = useState(false);
  const [stageDialog, setStageDialog] = useState<{ editing: AdminStageRow | null } | null>(null);
  const [wonDialog, setWonDialog] = useState<AdminPipelineRow | null>(null);
  const [reassign, setReassign] = useState<AdminStageRow | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [pipelineQuery, setPipelineQuery] = useState("");
  const [showAllPipelines, setShowAllPipelines] = useState(false);

  const activePipelines = useMemo(() => (pipelines ?? []).filter((p) => !p.archived), [pipelines]);
  const archivedPipelines = useMemo(() => (pipelines ?? []).filter((p) => p.archived), [pipelines]);
  const activeStages = useMemo(() => (stages ?? []).filter((s) => !s.archived), [stages]);
  const archivedStages = useMemo(() => (stages ?? []).filter((s) => s.archived), [stages]);

  // Long pipeline lists stay manageable: filter by name, and cap the visible
  // rows behind "Show all" so the panel never dominates the page. Reordering
  // by id works on the full list, so dragging within a capped view is safe;
  // it's only disabled while a search filter would make positions ambiguous.
  const PIPELINES_CAP = 10;
  const pipelineFilter = pipelineQuery.trim().toLowerCase();
  const matchingPipelines = useMemo(
    () =>
      pipelineFilter
        ? activePipelines.filter((p) => p.name.toLowerCase().includes(pipelineFilter))
        : activePipelines,
    [activePipelines, pipelineFilter],
  );
  const visiblePipelines =
    pipelineFilter || showAllPipelines
      ? matchingPipelines
      : matchingPipelines.slice(0, PIPELINES_CAP);
  const hiddenPipelineCount = matchingPipelines.length - visiblePipelines.length;
  const pipelineDragDisabled = pipelineFilter !== "";

  const fieldLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of registry?.fields ?? []) map.set(f.key, f.label);
    return map;
  }, [registry]);
  const fieldLabel = (key: string) => fieldLabels.get(key) ?? key;

  // Requirements cascade down the funnel: per stage, the keys required by
  // earlier active stages that aren't already in its own list. Filtered to
  // active fields — the server gate only enforces those, so badges must not
  // count keys whose field was since deactivated.
  const inheritedByStage = useMemo(() => {
    const activeKeys = new Set(
      (registry?.fields ?? []).filter((f) => f.active).map((f) => f.key),
    );
    const map = new Map<number, string[]>();
    const seen = new Set<string>();
    for (const s of activeStages) {
      map.set(s.id, [...seen].filter((k) => !s.requiredFields.includes(k)));
      for (const k of s.requiredFields) if (activeKeys.has(k)) seen.add(k);
    }
    return map;
  }, [activeStages, registry]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Keep the selection valid: pick the first active pipeline when nothing is
  // selected or the selected one was archived/deleted.
  useEffect(() => {
    if (!pipelines) return;
    if (selected == null || !activePipelines.some((p) => p.id === selected)) {
      setSelected(activePipelines[0]?.id ?? null);
    }
  }, [pipelines, activePipelines, selected]);

  const run = async (fn: () => Promise<unknown>, errTitle: string) => {
    try {
      await fn();
      invalidatePipelineData(qc);
    } catch (e) {
      toast({ title: errTitle, description: (e as Error).message, variant: "destructive" });
    }
  };

  const savePipelineName = async () => {
    const name = pipelineName.trim();
    // Pipeline names aren't unique, so a double click or Enter + click while
    // the first create is in flight would make two.
    if (!name || !pipelineDialog || savingPipeline) return;
    setSavingPipeline(true);
    try {
      if (pipelineDialog.editing) {
        await updatePipeline(pipelineDialog.editing.id, { name });
      } else {
        const created = await createPipeline(name);
        setSelected(created.id);
      }
      invalidatePipelineData(qc);
      setPipelineDialog(null);
    } catch (e) {
      toast({ title: t("settings.pipelines.error.savePipeline"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingPipeline(false);
    }
  };

  // Optimistic reorder: reflect the new order immediately, then persist.
  // On failure, roll back by refetching.
  const onPipelineDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = activePipelines.findIndex((p) => p.id === active.id);
    const to = activePipelines.findIndex((p) => p.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(activePipelines, from, to);
    qc.setQueryData<AdminPipelineRow[]>(["admin-pipelines"], [...next, ...archivedPipelines]);
    reorderPipelines(next.map((p) => p.id))
      .then(() => invalidatePipelineData(qc))
      .catch((err) => {
        toast({ title: t("settings.pipelines.error.reorderPipelines"), description: (err as Error).message, variant: "destructive" });
        invalidatePipelineData(qc);
      });
  };

  const onStageDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || selected == null) return;
    const from = activeStages.findIndex((s) => s.id === active.id);
    const to = activeStages.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(activeStages, from, to);
    qc.setQueryData<AdminStageRow[]>(["admin-stages", selected], [...next, ...archivedStages]);
    reorderStages(selected, next.map((s) => s.id))
      .then(() => invalidatePipelineData(qc))
      .catch((err) => {
        toast({ title: t("settings.pipelines.error.reorderStages"), description: (err as Error).message, variant: "destructive" });
        invalidatePipelineData(qc);
      });
  };

  const confirmDeletePipeline = (p: AdminPipelineRow) =>
    setConfirm({
      title: t("settings.pipelines.deletePipelineTitle", { name: p.name }),
      description:
        p.activeDealCount > 0
          ? tPlural("settings.pipelines.deletePipelineWithDeals", p.activeDealCount, {
              count: formatNumber(p.activeDealCount),
            })
          : t("settings.pipelines.deletePipelineNoDeals"),
      confirmLabel: t("settings.pipelines.deletePipelineConfirm"),
      action: () => void run(() => deletePipeline(p.id), t("settings.pipelines.error.deletePipeline")),
    });

  // Delete a stage; if the server says it needs reassignment, open that dialog.
  const tryDeleteStage = async (s: AdminStageRow, reassignTo?: number) => {
    try {
      await deleteStage(s.id, reassignTo);
      invalidatePipelineData(qc);
      setReassign(null);
    } catch (e) {
      if (e instanceof ApiError && e.body?.needsReassign) {
        setReassign(s);
        return;
      }
      toast({ title: t("settings.pipelines.error.deleteStage"), description: (e as Error).message, variant: "destructive" });
    }
  };

  const confirmDeleteStage = (s: AdminStageRow) => {
    // With active deals the server will demand a reassignment anyway — skip
    // straight to that dialog instead of a confirm that can't succeed.
    if (s.activeDealCount > 0) {
      setReassign(s);
      return;
    }
    setConfirm({
      title: t("settings.pipelines.deleteStageTitle", { name: s.name }),
      description: t("settings.pipelines.deleteStageDescription"),
      confirmLabel: t("settings.pipelines.deleteStageConfirm"),
      action: () => void tryDeleteStage(s),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-body-quiet text-muted-foreground">
        <Loader2 className="me-2 h-4 w-4 animate-spin" /> {t("settings.pipelines.loading")}
      </div>
    );
  }

  const selectedPipeline = activePipelines.find((p) => p.id === selected) ?? null;

  return (
    <div className="mx-auto min-w-0 max-w-5xl p-4 md:p-6">
      <div className="mb-5">
        <h1 className="text-heading-sm text-foreground">{t("settings.nav.pipelines")}</h1>
        <p className="text-body-quiet text-muted-foreground">
          {t("settings.pipelines.subtitle")}
        </p>
      </div>

      {activePipelines.length === 0 && archivedPipelines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="mb-3 text-body-quiet text-muted-foreground">{t("settings.pipelines.empty")}</p>
          <Button onClick={() => { setPipelineName(""); setPipelineDialog({ editing: null }); }} className="gap-1">
            <Plus className="h-4 w-4" /> {t("settings.pipelines.createFirst")}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* Pipelines */}
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-body font-semibold text-foreground">
                <span>{t("settings.pipelines.heading")}</span>
                <span
                  aria-label={tPlural("settings.pipelines.countAria", activePipelines.length, {
                    count: formatNumber(activePipelines.length),
                  })}
                  className="rounded-full bg-muted px-2 py-0.5 text-caption font-normal tabular-nums text-muted-foreground"
                >
                  {formatNumber(activePipelines.length)}
                </span>
              </h2>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-caption-quiet"
                aria-label={t("settings.pipelines.newPipelineAria")}
                onClick={() => { setPipelineName(""); setPipelineDialog({ editing: null }); }}
              >
                <Plus className="h-3 w-3" /> {t("settings.pipelines.new")}
              </Button>
            </div>
            {activePipelines.length > 6 && (
              <div className="relative mb-2">
                <SearchIcon className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
                <Input
                  value={pipelineQuery}
                  onChange={(e) => setPipelineQuery(e.target.value)}
                  placeholder={t("settings.pipelines.search")}
                  className="h-8 ps-7 text-body-quiet"
                />
              </div>
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onPipelineDragEnd}>
              <SortableContext items={visiblePipelines.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                <div className="max-h-[60vh] space-y-1 overflow-y-auto pe-0.5">
                  {visiblePipelines.map((p) => (
                    <SortablePipelineItem
                      key={p.id}
                      pipeline={p}
                      selected={selected === p.id}
                      dragDisabled={pipelineDragDisabled}
                      onSelect={() => setSelected(p.id)}
                      onSetDefault={() => run(() => setDefaultPipeline(p.id), t("settings.pipelines.error.setDefault"))}
                      onRename={() => { setPipelineName(p.name); setPipelineDialog({ editing: p }); }}
                      onArchive={() => run(() => updatePipeline(p.id, { archived: true }), t("settings.pipelines.error.archive"))}
                      onDelete={() => confirmDeletePipeline(p)}
                    />
                  ))}
                  {matchingPipelines.length === 0 && (
                    <p className="py-4 text-center text-caption-quiet text-subtle">
                      {t("settings.pipelines.noMatch", { query: pipelineQuery.trim() })}
                    </p>
                  )}
                </div>
              </SortableContext>
            </DndContext>
            {hiddenPipelineCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllPipelines(true)}
                className="mt-1.5 w-full rounded-md border border-dashed border-border py-1.5 text-caption text-muted-foreground hover:border-input hover:text-foreground"
              >
                {tPlural("settings.pipelines.showAll", matchingPipelines.length, {
                  count: formatNumber(matchingPipelines.length),
                })}
              </button>
            )}
            {showAllPipelines && !pipelineFilter && matchingPipelines.length > PIPELINES_CAP && (
              <button
                type="button"
                onClick={() => setShowAllPipelines(false)}
                className="mt-1.5 w-full rounded-md py-1 text-caption-quiet text-subtle hover:text-muted-foreground"
              >
                {t("settings.pipelines.showFewer")}
              </button>
            )}
            {archivedPipelines.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-caption text-subtle">{t("settings.pipelines.archivedHeading")}</p>
                {archivedPipelines.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-md px-2 py-1 text-body-quiet text-muted-foreground">
                    <span dir="auto" className="truncate">{p.name}</span>
                    <IconBtn title={t("common.restore")} onClick={() => run(() => updatePipeline(p.id, { archived: false }), t("settings.pipelines.error.restore"))}>
                      <ArchiveRestore className="h-3.5 w-3.5" />
                    </IconBtn>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stages */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="min-w-0 truncate text-body font-semibold text-foreground">
                {selectedPipeline
                  ? tNode("settings.pipelines.stagesHeadingFor", {
                      pipeline: <bdi dir="auto">{selectedPipeline.name}</bdi>,
                    })
                  : t("settings.pipelines.stagesHeading")}
              </h2>
              {selectedPipeline != null && (
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-caption-quiet"
                    onClick={() => setWonDialog(selectedPipeline)}
                  >
                    <Trophy className="h-3 w-3" />{" "}
                    {(selectedPipeline.wonRequiredFields?.length ?? 0) > 0
                      ? t("settings.pipelines.wonRequirementsCount", {
                          count: formatNumber(selectedPipeline.wonRequiredFields.length),
                        })
                      : t("settings.pipelines.wonRequirements")}
                  </Button>
                  <Button size="sm" className="h-7 gap-1 text-caption-quiet" onClick={() => setStageDialog({ editing: null })}>
                    <Plus className="h-3 w-3" /> {t("settings.pipelines.newStage")}
                  </Button>
                </div>
              )}
            </div>
            {selected == null ? (
              <p className="py-8 text-center text-body-quiet text-subtle">{t("settings.pipelines.selectPipeline")}</p>
            ) : (
              <>
                {selectedPipeline != null && (
                  <label className="mb-3 flex items-start justify-between gap-4 rounded-md border border-border px-3 py-2.5 text-body-quiet">
                    <span>
                      <span className="block font-medium text-foreground">
                        {t("settings.pipelines.adminOnlyReassign")}
                      </span>
                      <span className="block text-caption-quiet text-muted-foreground">
                        {t("settings.pipelines.adminOnlyReassignHint")}
                      </span>
                    </span>
                    <Switch
                      checked={selectedPipeline.adminOnlyReassign}
                      disabled={savingReassign}
                      onCheckedChange={(adminOnlyReassign) => {
                        setSavingReassign(true);
                        void run(
                          () => updatePipeline(selectedPipeline.id, { adminOnlyReassign }),
                          t("settings.pipelines.adminOnlyReassignFailed"),
                        ).finally(() => setSavingReassign(false));
                      }}
                      aria-label={t("settings.pipelines.adminOnlyReassign")}
                    />
                  </label>
                )}
                <PipelineFlowPreview stages={activeStages} />
                {/* Fixed metric columns never fit tiny viewports — the card
                    scrolls horizontally instead of pushing off-screen. */}
                <div className="overflow-x-auto rounded-2xl bg-card shadow-card">
                  <div className="min-w-[560px]">
                    <div className="flex items-center gap-2 bg-surface-whisper px-2 py-2 text-caption text-muted-foreground">
                      <span className="w-4 shrink-0" />
                      <span className="min-w-0 flex-1 text-start">{t("common.stage")}</span>
                      <span className="w-28 shrink-0 text-end">{t("deals.summary.probability")}</span>
                      <span className="w-16 shrink-0 text-end">{t("settings.pipelines.col.rotting")}</span>
                      <span className="w-12 shrink-0 text-end">{t("common.deals")}</span>
                      <span className="w-[3.75rem] shrink-0" />
                    </div>
                    {activeStages.length === 0 && (
                      <p className="border-t border-border px-3 py-8 text-center text-body-quiet text-subtle">
                        {t("settings.pipelines.noStages")}
                      </p>
                    )}
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onStageDragEnd}>
                      <SortableContext items={activeStages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                        {activeStages.map((s) => (
                          <SortableStageRow
                            key={s.id}
                            stage={s}
                            inheritedRequired={inheritedByStage.get(s.id) ?? []}
                            fieldLabel={fieldLabel}
                            onEdit={() => setStageDialog({ editing: s })}
                            onArchive={() => run(() => updateStage(s.id, { archived: true }), t("settings.pipelines.error.archive"))}
                            onDelete={() => confirmDeleteStage(s)}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                    {archivedStages.length > 0 && (
                      <div className="border-t border-border bg-surface-whisper/50 px-3 py-2">
                        <p className="mb-1 text-caption text-subtle">{t("settings.pipelines.archivedStages")}</p>
                        {archivedStages.map((s) => (
                          <div key={s.id} className="flex items-center justify-between py-0.5 text-caption-quiet text-muted-foreground">
                            <span dir="auto">{s.name}</span>
                            <IconBtn title={t("common.restore")} onClick={() => run(() => updateStage(s.id, { archived: false }), t("settings.pipelines.error.restore"))}>
                              <ArchiveRestore className="h-3.5 w-3.5" />
                            </IconBtn>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Pipeline name dialog */}
      <Dialog open={!!pipelineDialog} onOpenChange={(o) => !o && setPipelineDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{pipelineDialog?.editing ? t("settings.pipelines.renamePipeline") : t("settings.pipelines.newPipeline")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={pipelineName}
            onChange={(e) => setPipelineName(e.target.value)}
            dir="auto"
            placeholder={t("settings.pipelines.pipelineNamePlaceholder")}
            onKeyDown={(e) => e.key === "Enter" && savePipelineName()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPipelineDialog(null)} disabled={savingPipeline}>{t("common.cancel")}</Button>
            <Button onClick={savePipelineName} disabled={savingPipeline} className="gap-2">
              {savingPipeline && <Loader2 className="h-4 w-4 animate-spin" />}
              {pipelineDialog?.editing ? t("common.save") : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stage dialog */}
      {stageDialog && selected != null && (
        <StageDialog
          open
          onOpenChange={(o) => !o && setStageDialog(null)}
          pipelineId={selected}
          editing={stageDialog.editing}
          siblings={activeStages}
          onDone={() => invalidatePipelineData(qc)}
        />
      )}

      {/* Pipeline won-requirements dialog */}
      {wonDialog && (
        <WonRequiredFieldsDialog
          pipeline={wonDialog}
          onClose={() => setWonDialog(null)}
          onDone={() => invalidatePipelineData(qc)}
        />
      )}

      {/* Reassign dialog */}
      {reassign && (
        <ReassignDialog
          stage={reassign}
          siblings={activeStages}
          onClose={() => setReassign(null)}
          onConfirm={(targetId) => tryDeleteStage(reassign, targetId)}
        />
      )}

      {/* Destructive-action confirmation */}
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
