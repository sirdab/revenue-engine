import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Archive,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  useDealFieldRegistry,
  createDealField,
  updateDealField,
  deleteDealField,
  reorderDealFields,
  discoverDealFields,
  type DealFieldRow,
  type DealFieldOptionRow,
  type DealFieldConfig,
} from "@/lib/deal-fields-api";
import { useAdminPipelines, type AdminPipelineRow } from "@/lib/pipelines-admin-api";

const FIELD_TYPES = [
  "varchar",
  "text",
  "double",
  "monetary",
  "date",
  "daterange",
  "boolean",
  "enum",
  "set",
] as const;

const TYPE_LABEL: Record<string, string> = {
  varchar: "Text (short)",
  text: "Text (long)",
  double: "Number",
  monetary: "Money",
  date: "Date",
  daterange: "Date range",
  boolean: "Yes / No",
  enum: "Single select",
  set: "Multi select",
};

const hasOptions = (t: string) => t === "enum" || t === "set";

function SourceBadge({ storage }: { storage: string }) {
  const map: Record<string, string> = {
    custom: "border-transparent bg-brand-subtle text-brand-subtle-foreground",
    data: "border-attention/30 bg-attention-subtle text-attention",
    column: "border-border bg-surface-whisper text-muted-foreground",
  };
  const label =
    storage === "custom" ? "Custom" : storage === "column" ? "Column" : "Dataset";
  return (
    <Badge variant="outline" className={cn("text-[11px] font-medium", map[storage])}>
      {label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Create / edit dialog.
// ---------------------------------------------------------------------------

interface OptionDraft {
  value: string;
  label: string;
}

function FieldDialog({
  open,
  onOpenChange,
  editing,
  editingOptions,
  onSaved,
  pipelines,
  allFields,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: DealFieldRow | null;
  editingOptions: DealFieldOptionRow[];
  onSaved: () => void;
  pipelines: AdminPipelineRow[];
  allFields: DealFieldRow[];
}) {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<string>("varchar");
  const [config, setConfig] = useState<DealFieldConfig>({});
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [applyToGroup, setApplyToGroup] = useState(false);

  // Re-seed every time the dialog opens (or the edited field changes), loading
  // the field's existing options so a save reflects the full set — never wipes.
  useEffect(() => {
    if (!open) return;
    setLabel(editing?.label ?? "");
    setFieldType(editing?.fieldType ?? "varchar");
    setConfig(editing?.config ?? {});
    setOptions(editingOptions.map((o) => ({ value: o.value, label: o.label })));
    setApplyToGroup(false);
    // editingOptions intentionally excluded: seed once per open, not on refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  const flag = (key: keyof DealFieldConfig) => Boolean(config[key]);
  const setFlag = (key: keyof DealFieldConfig, v: boolean) =>
    setConfig((c) => ({ ...c, [key]: v }));

  const pipelineIds = config.pipelineIds ?? [];
  const togglePipeline = (id: number, on: boolean) =>
    setConfig((c) => {
      const cur = c.pipelineIds ?? [];
      return { ...c, pipelineIds: on ? [...cur, id] : cur.filter((x) => x !== id) };
    });
  const group = (config.group ?? "").trim();
  // Other fields sharing this group, so one edit can scope a whole section.
  const groupSiblings = group
    ? allFields.filter(
        (f) => f.id !== editing?.id && (f.config?.group ?? "").trim() === group,
      )
    : [];

  const save = async () => {
    if (!label.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const cleanOptions = options
        .filter((o) => o.value.trim() !== "")
        .map((o) => ({ value: o.value.trim(), label: (o.label || o.value).trim() }));
      if (editing) {
        await updateDealField(editing.id, {
          label: label.trim(),
          config,
          // Send the full option set (loaded + edited) so the reconcile mirrors
          // the dialog exactly instead of archiving untouched options.
          ...(hasOptions(editing.fieldType) ? { options: cleanOptions } : {}),
        });
      } else {
        await createDealField({
          label: label.trim(),
          fieldType,
          config,
          ...(hasOptions(fieldType) ? { options: cleanOptions } : {}),
        });
      }
      if (applyToGroup && groupSiblings.length > 0) {
        await Promise.all(
          groupSiblings.map((f) => updateDealField(f.id, { config: { pipelineIds } })),
        );
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Couldn't save",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const showOptions = hasOptions(editing?.fieldType ?? fieldType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit field" : "New custom field"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Type and key are locked. Change the label, flags, or options."
              : "Stored in the deal's custom fields. The key is generated."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block text-body-quiet">
            <span className="mb-1 block font-medium text-muted-foreground">Name</span>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Contract value" />
          </label>

          <label className="block text-body-quiet">
            <span className="mb-1 block font-medium text-muted-foreground">Type</span>
            <Select
              value={editing?.fieldType ?? fieldType}
              onValueChange={setFieldType}
              disabled={!!editing}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {showOptions && (
            <div className="text-body-quiet">
              <span className="mb-1 block font-medium text-muted-foreground">Options</span>
              <div className="space-y-1.5">
                {options.map((o, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      className="h-8"
                      placeholder="Option label"
                      value={o.label}
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((x, idx) =>
                            idx === i
                              ? { value: x.value || e.target.value, label: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-subtle hover:text-destructive"
                      onClick={() => setOptions((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-caption-quiet"
                  onClick={() => setOptions((prev) => [...prev, { value: "", label: "" }])}
                >
                  <Plus className="h-3 w-3" /> Add option
                </Button>
                {editing && hasOptions(editing.fieldType) && (
                  <p className="text-[11px] text-subtle">
                    Adding options here upserts them. Existing options not listed are archived.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-whisper/50 p-3">
            <FlagToggle label="Required" checked={flag("required")} onChange={(v) => setFlag("required", v)} />
            <FlagToggle label="Filterable" checked={flag("filterable")} onChange={(v) => setFlag("filterable", v)} />
            <FlagToggle label="Sortable" checked={flag("sortable")} onChange={(v) => setFlag("sortable", v)} />
            <FlagToggle label="Show in detail" checked={flag("detailVisible")} onChange={(v) => setFlag("detailVisible", v)} />
          </div>

          <label className="block text-body-quiet">
            <span className="mb-1 block font-medium text-muted-foreground">Group (optional)</span>
            <Input
              value={config.group ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, group: e.target.value }))}
              placeholder="e.g. Financials"
            />
          </label>

          {pipelines.length > 0 && (
            <div className="text-body-quiet">
              <span className="mb-1 block font-medium text-muted-foreground">Pipelines</span>
              <p className="mb-2 text-caption-quiet text-subtle">
                Show this field only on deals in the pipelines you tick. Leave all unticked
                to show it everywhere. A deal that already has a value keeps showing it.
              </p>
              <div className="space-y-1.5 rounded-lg border border-border bg-surface-whisper/50 p-3">
                {pipelines.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-muted-foreground">
                    <Checkbox
                      checked={pipelineIds.includes(p.id)}
                      onCheckedChange={(v) => togglePipeline(p.id, v === true)}
                    />
                    <span>{p.name}</span>
                  </label>
                ))}
              </div>
              {groupSiblings.length > 0 && (
                <label className="mt-2 flex items-center gap-2 text-caption-quiet text-muted-foreground">
                  <Checkbox
                    checked={applyToGroup}
                    onCheckedChange={(v) => setApplyToGroup(v === true)}
                  />
                  <span>
                    Also apply to the {groupSiblings.length} other field
                    {groupSiblings.length === 1 ? "" : "s"} in "{group}"
                  </span>
                </label>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FlagToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-body-quiet text-muted-foreground">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Screen.
// ---------------------------------------------------------------------------

export function CustomFieldsSettings() {
  const { data, isLoading } = useDealFieldRegistry();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DealFieldRow | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const { data: pipelineRows } = useAdminPipelines();
  const pipelines = useMemo(
    () => (pipelineRows ?? []).filter((p) => !p.archived),
    [pipelineRows],
  );
  const pipelineName = useMemo(
    () => new Map((pipelineRows ?? []).map((p) => [p.id, p.name])),
    [pipelineRows],
  );

  const fields = useMemo(() => data?.fields ?? [], [data]);
  const active = useMemo(
    () => fields.filter((f) => f.active).sort((a, b) => a.orderIndex - b.orderIndex),
    [fields],
  );
  const discovered = useMemo(
    () => fields.filter((f) => f.system && !f.active),
    [fields],
  );
  const archived = useMemo(
    () => fields.filter((f) => !f.active && !f.system),
    [fields],
  );
  const optionsByField = useMemo(() => {
    const m = new Map<number, DealFieldOptionRow[]>();
    for (const o of data?.options ?? []) {
      const arr = m.get(o.fieldId) ?? [];
      arr.push(o);
      m.set(o.fieldId, arr);
    }
    return m;
  }, [data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["deal-field-registry"] });

  const mutate = async (fn: () => Promise<unknown>, errTitle: string) => {
    try {
      await fn();
      refresh();
    } catch (e) {
      toast({ title: errTitle, description: (e as Error).message, variant: "destructive" });
    }
  };

  const discover = async () => {
    setDiscovering(true);
    try {
      const r = await discoverDealFields();
      refresh();
      toast({
        title: "Discovery complete",
        description: `${r.created} new field${r.created === 1 ? "" : "s"} found (${r.scanned} keys scanned).`,
      });
    } catch (e) {
      toast({ title: "Discovery failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDiscovering(false);
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = [...active];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j]!, next[index]!];
    void mutate(() => reorderDealFields(next.map((f) => f.id)), "Couldn't reorder");
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-heading-sm text-foreground">Custom Fields</h1>
          <p className="text-body-quiet text-muted-foreground">
            Fields shown on deals, decoded from your dataset or created here. Limit a field to certain pipelines from its edit dialog.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={discover} disabled={discovering} className="gap-1.5">
            {discovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Discover from dataset
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }} className="gap-1.5">
            <Plus className="h-4 w-4" /> New field
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-body-quiet text-muted-foreground">
          <Loader2 className="me-2 h-4 w-4 animate-spin" /> Loading fields…
        </div>
      ) : (
        <>
          {/* Active fields */}
          <section className="mb-6 overflow-hidden rounded-2xl bg-card shadow-card">
            <table className="w-full text-body-quiet">
              <thead className="bg-surface-whisper text-caption-quiet text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">Name</th>
                  <th className="px-3 py-2 text-start font-medium">Type</th>
                  <th className="px-3 py-2 text-start font-medium">Source</th>
                  <th className="px-3 py-2 text-start font-medium">Pipelines</th>
                  <th className="px-3 py-2 text-center font-medium">Detail</th>
                  <th className="px-3 py-2 text-center font-medium">Req</th>
                  <th className="px-3 py-2 text-center font-medium">Filter</th>
                  <th className="px-3 py-2 text-end font-medium">Usage</th>
                  <th className="px-3 py-2 text-end font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {active.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-body-quiet text-subtle">
                      No active fields yet. Discover from your dataset or create one.
                    </td>
                  </tr>
                )}
                {active.map((f, i) => (
                  <tr key={f.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="font-medium text-foreground">{f.label}</div>
                      <div className="font-mono text-[10px] text-subtle">{f.key}</div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{TYPE_LABEL[f.fieldType] ?? f.fieldType}</td>
                    <td className="px-3 py-2"><SourceBadge storage={f.storage} /></td>
                    <td className="px-3 py-2 text-caption-quiet text-muted-foreground">
                      {f.config?.pipelineIds?.length
                        ? f.config.pipelineIds
                            .map((id) => pipelineName.get(id) ?? `#${id}`)
                            .join(", ")
                        : "All"}
                    </td>
                    <td className="px-3 py-2 text-center">{f.config?.detailVisible ? "✓" : "—"}</td>
                    <td className="px-3 py-2 text-center">{f.config?.required ? "✓" : "—"}</td>
                    <td className="px-3 py-2 text-center">{f.config?.filterable ? "✓" : "—"}</td>
                    <td className="px-3 py-2 text-end tabular-nums text-muted-foreground">{f.usage ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <IconBtn title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </IconBtn>
                        <IconBtn title="Move down" disabled={i === active.length - 1} onClick={() => move(i, 1)}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </IconBtn>
                        <IconBtn title="Edit" onClick={() => { setEditing(f); setDialogOpen(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconBtn>
                        <IconBtn
                          title="Archive"
                          onClick={() => mutate(() => deleteDealField(f.id), "Couldn't archive")}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Discovered from dataset */}
          {discovered.length > 0 && (
            <section>
              <h2 className="mb-2 text-body font-semibold text-foreground">
                Discovered from dataset{" "}
                <span className="ms-1 rounded-full bg-attention-subtle px-2 py-0.5 text-caption text-attention">
                  {discovered.length}
                </span>
              </h2>
              <p className="mb-3 text-caption-quiet text-muted-foreground">
                Keys found in your data. Activate the ones you want on the deal; computed
                metrics as read-only.
              </p>
              <div className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-card">
                {discovered.map((f) => (
                  <DiscoveredRow
                    key={f.id}
                    field={f}
                    optionCount={(optionsByField.get(f.id) ?? []).length}
                    onActivate={(editable) =>
                      mutate(
                        () => updateDealField(f.id, { active: true, editable }),
                        "Couldn't activate",
                      )
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {/* Archived */}
          {archived.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-body font-semibold text-foreground">
                Archived{" "}
                <span className="ms-1 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                  {archived.length}
                </span>
              </h2>
              <div className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-card">
                {archived.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-muted-foreground">{f.label}</div>
                      <div className="font-mono text-[10px] text-subtle">{f.key}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => mutate(() => updateDealField(f.id, { active: true }), "Couldn't restore")}
                    >
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <FieldDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        editingOptions={
          editing ? (optionsByField.get(editing.id) ?? []).filter((o) => o.active) : []
        }
        onSaved={refresh}
        pipelines={pipelines}
        allFields={fields}
      />
    </div>
  );
}

function IconBtn({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
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
      className="h-7 w-7 text-subtle hover:text-foreground disabled:opacity-30"
    >
      {children}
    </Button>
  );
}

function DiscoveredRow({
  field,
  optionCount,
  onActivate,
}: {
  field: DealFieldRow;
  optionCount: number;
  onActivate: (editable: boolean) => void;
}) {
  const [editable, setEditable] = useState(true);
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">{field.label}</span>
          <Badge variant="outline" className="text-[11px] text-muted-foreground">
            {TYPE_LABEL[field.fieldType] ?? field.fieldType}
          </Badge>
          {optionCount > 0 && (
            <span className="text-[11px] text-subtle">{optionCount} options</span>
          )}
        </div>
        <div className="font-mono text-[10px] text-subtle">{field.sourceKey}</div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <label className="flex items-center gap-1.5 text-caption-quiet text-muted-foreground">
          Editable
          <Switch checked={editable} onCheckedChange={setEditable} />
        </label>
        <Button size="sm" variant="outline" onClick={() => onActivate(editable)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add to deal
        </Button>
      </div>
    </div>
  );
}
