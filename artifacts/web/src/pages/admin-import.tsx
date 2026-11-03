import { useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import {
  useImportOrganizations,
  useImportPersons,
  useImportDeals,
  useListUsers,
  useListPipelines,
  useListStages,
  getListOrganizationsQueryKey,
  getListPersonsQueryKey,
  getListStagesQueryKey,
  type ImportResult,
} from "@workspace/api-client-react";
import { invalidateDealCollections } from "@/lib/deal-collections";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AsyncSelect,
  type AsyncOption,
} from "@/components/ui/async-select";
import {
  loadOrganizationOptions,
  loadPersonOptions,
} from "@/lib/contacts-search-api";
import { cn } from "@/lib/utils";
import {
  ENTITY_SPECS,
  IMPORT_BATCH_SIZE,
  autoMapHeaders,
  downloadTemplate,
  validateRows,
  unsatisfiedRequiredFields,
  toOrganizationRows,
  toPersonRows,
  toDealRows,
  type EntityKey,
  type ImportDefaults,
  type ValidatedRow,
} from "@/lib/import-spec";
import {
  Building2,
  Users,
  Briefcase,
  Download,
  UploadCloud,
  FileSpreadsheet,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  FileWarning,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Enterprise CSV importer — a guided wizard for Organizations, People and
// Deals. Steps: pick entity (+ template) → upload → map columns & bulk-select
// defaults → review (errors flagged, valid rows accepted) → import → result.
// All field knowledge lives in `import-spec.ts`; this file is the flow + UI.
// ---------------------------------------------------------------------------

const STEPS = ["entity", "upload", "map", "review", "done"] as const;
type StepId = (typeof STEPS)[number];
const STEP_LABELS: Record<StepId, string> = {
  entity: "Type",
  upload: "Upload",
  map: "Map & defaults",
  review: "Review",
  done: "Done",
};

const ENTITY_CARDS: { key: EntityKey; icon: typeof Building2 }[] = [
  { key: "organizations", icon: Building2 },
  { key: "persons", icon: Users },
  { key: "deals", icon: Briefcase },
];

const NONE = "__none__"; // Select sentinel for "no mapping / no default".

export default function AdminImportPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [step, setStep] = useState<StepId>("entity");
  const [entity, setEntity] = useState<EntityKey | null>(null);
  const [fileName, setFileName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaults, setDefaults] = useState<ImportDefaults>({});
  const [orgLabel, setOrgLabel] = useState<string | null>(null);
  const [personLabel, setPersonLabel] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  // CSV indices of the rows we sent, so server-side row numbers map back to
  // the original file lines in the result view.
  const submittedIndices = useRef<number[]>([]);

  // Reference data for the bulk-select pickers (small lists).
  const { data: users = [] } = useListUsers();
  const { data: pipelines = [] } = useListPipelines();
  const { data: stages = [] } = useListStages(
    { pipelineId: defaults.pipelineId },
    {
      query: {
        queryKey: getListStagesQueryKey({ pipelineId: defaults.pipelineId }),
        enabled: defaults.pipelineId != null,
      },
    },
  );

  const importOrgs = useImportOrganizations();
  const importPersons = useImportPersons();
  const importDeals = useImportDeals();
  const importing =
    importOrgs.isPending || importPersons.isPending || importDeals.isPending;

  const validated = useMemo<ValidatedRow[]>(
    () => (entity ? validateRows(entity, rows, mapping, defaults) : []),
    [entity, rows, mapping, defaults],
  );
  const validRows = useMemo(
    () => validated.filter((r) => r.errors.length === 0),
    [validated],
  );
  const errorCount = validated.length - validRows.length;
  const unsatisfied = useMemo(
    () =>
      entity ? unsatisfiedRequiredFields(entity, mapping, defaults) : [],
    [entity, mapping, defaults],
  );

  const reset = () => {
    setEntity(null);
    setFileName("");
    setPasteText("");
    setHeaders([]);
    setRows([]);
    setMapping({});
    setDefaults({});
    setOrgLabel(null);
    setPersonLabel(null);
    setResult(null);
    submittedIndices.current = [];
    setStep("entity");
  };

  const chooseEntity = (key: EntityKey) => {
    setEntity(key);
    setStep("upload");
  };

  const parseCsv = (text: string, name: string) => {
    if (!entity) return;
    Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const hdrs = (res.meta.fields ?? []).filter(Boolean) as string[];
        const data = (res.data as Record<string, string>[]).filter((r) =>
          Object.values(r).some((v) => (v ?? "").toString().trim() !== ""),
        );
        if (!hdrs.length || !data.length) {
          toast({
            title: "Nothing to import",
            description: "The file has no header row or no data rows.",
            variant: "destructive",
          });
          return;
        }
        setHeaders(hdrs);
        setRows(data);
        setMapping(autoMapHeaders(entity, hdrs));
        setFileName(name);
        setStep("map");
      },
      error: (e: Error) =>
        toast({
          title: "Could not parse CSV",
          description: e.message,
          variant: "destructive",
        }),
    });
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => parseCsv(String(ev.target?.result ?? ""), file.name);
    reader.onerror = () =>
      toast({ title: "Could not read file", variant: "destructive" });
    reader.readAsText(file);
  };

  // Splits into IMPORT_BATCH_SIZE-row chunks and submits them sequentially —
  // the server rejects any single request over that cap. Each batch's errors
  // report a row number local to that batch, so it's offset by the rows
  // already sent before merging into one result the row-lookup below can use.
  const runImport = async () => {
    if (!entity || validRows.length === 0) return;
    submittedIndices.current = validRows.map((r) => r.index);

    let submitBatch: (batch: ValidatedRow[]) => Promise<ImportResult>;
    let invalidate: () => void;
    if (entity === "organizations") {
      submitBatch = (batch) =>
        importOrgs.mutateAsync({ data: { rows: toOrganizationRows(batch) } });
      invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ["organizations"] });
        queryClient.invalidateQueries({
          queryKey: getListOrganizationsQueryKey(),
        });
      };
    } else if (entity === "persons") {
      submitBatch = (batch) =>
        importPersons.mutateAsync({ data: { rows: toPersonRows(batch) } });
      invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ["persons"] });
        queryClient.invalidateQueries({ queryKey: getListPersonsQueryKey() });
      };
    } else {
      submitBatch = (batch) =>
        importDeals.mutateAsync({ data: { rows: toDealRows(batch) } });
      invalidate = () => {
        invalidateDealCollections(queryClient);
      };
    }

    const aggregate: ImportResult = { created: 0, failed: 0, errors: [] };
    let rowOffset = 0;
    let failure: unknown = null;

    for (let i = 0; i < validRows.length; i += IMPORT_BATCH_SIZE) {
      const batch = validRows.slice(i, i + IMPORT_BATCH_SIZE);
      try {
        const res = await submitBatch(batch);
        aggregate.created += res.created;
        aggregate.failed += res.failed;
        aggregate.errors.push(
          ...res.errors.map((e) => ({ ...e, row: e.row + rowOffset })),
        );
      } catch (err) {
        failure = err;
        break;
      }
      rowOffset += batch.length;
    }

    if (aggregate.created > 0) invalidate();

    if (failure) {
      const reason = errorMessage(failure);
      toast({
        title: "Import failed",
        description:
          aggregate.created > 0
            ? `${aggregate.created} row(s) were imported before this batch failed. ${reason}`
            : reason,
        variant: "destructive",
      });
      // Show whatever succeeded before the failure rather than hiding it.
      if (aggregate.created > 0 || aggregate.errors.length > 0) {
        setResult(aggregate);
        setStep("done");
      }
      return;
    }

    setResult(aggregate);
    setStep("done");
  };

  const spec = entity ? ENTITY_SPECS[entity] : null;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col">
      <div className="mb-5">
        <h1 className="font-heading text-xl font-bold tracking-tight text-slate-900">
          Import data
        </h1>
        <p className="text-sm text-slate-500">
          Bring organizations, people and deals in from a CSV, with a template,
          validation and a preview before anything is created.
        </p>
      </div>

      <Stepper current={step} />

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        {step === "entity" && <EntityStep onChoose={chooseEntity} />}

        {step === "upload" && spec && (
          <UploadStep
            spec={spec}
            fileName={fileName}
            pasteText={pasteText}
            onPaste={setPasteText}
            onFile={onFile}
            onParsePaste={() => parseCsv(pasteText, "pasted.csv")}
            onBack={() => setStep("entity")}
          />
        )}

        {step === "map" && spec && (
          <MapStep
            spec={spec}
            headers={headers}
            rowCount={rows.length}
            mapping={mapping}
            setMapping={setMapping}
            defaults={defaults}
            setDefaults={setDefaults}
            orgLabel={orgLabel}
            setOrgLabel={setOrgLabel}
            personLabel={personLabel}
            setPersonLabel={setPersonLabel}
            users={users}
            pipelines={pipelines}
            stages={stages}
            validCount={validRows.length}
            errorCount={errorCount}
            unsatisfied={unsatisfied}
            onBack={() => setStep("upload")}
            onContinue={() => setStep("review")}
          />
        )}

        {step === "review" && spec && (
          <ReviewStep
            spec={spec}
            validated={validated}
            validCount={validRows.length}
            errorCount={errorCount}
            importing={importing}
            onBack={() => setStep("map")}
            onImport={runImport}
          />
        )}

        {step === "done" && spec && result && (
          <ResultStep
            spec={spec}
            result={result}
            submittedIndices={submittedIndices.current}
            onImportMore={reset}
            onView={() =>
              navigate(spec.key === "deals" ? "/deals" : "/contacts")
            }
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stepper header
// ---------------------------------------------------------------------------
function Stepper({ current }: { current: StepId }) {
  const currentIdx = STEPS.indexOf(current);
  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                active && "bg-teal-600 text-white",
                done && "bg-teal-100 text-teal-700",
                !active && !done && "bg-slate-100 text-slate-400",
              )}
            >
              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "font-medium",
                active ? "text-slate-900" : "text-slate-400",
              )}
            >
              {STEP_LABELS[s]}
            </span>
            {i < STEPS.length - 1 && (
              <span className="mx-1 h-px w-6 bg-slate-200" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function RequiredBadge({ required }: { required: boolean }) {
  return required ? (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
      Required
    </Badge>
  ) : (
    <Badge variant="outline" className="text-slate-400">
      Optional
    </Badge>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-card p-5 shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — choose entity + download template
// ---------------------------------------------------------------------------
function EntityStep({ onChoose }: { onChoose: (k: EntityKey) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {ENTITY_CARDS.map(({ key, icon: Icon }) => {
        const spec = ENTITY_SPECS[key];
        return (
          <div
            key={key}
            className="group flex flex-col rounded-xl border border-slate-200 bg-card p-5 text-start shadow-sm transition-all hover:border-teal-300 hover:shadow-md"
          >
            {/* Two sibling buttons, not one inside the other: a nested button
                is invalid HTML and reads as one control to a screen reader. */}
            <button
              type="button"
              onClick={() => onChoose(key)}
              className="flex flex-1 flex-col text-start"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                <Icon className="h-5 w-5" />
              </div>
              <div className="text-base font-semibold text-slate-900">
                {spec.label}
              </div>
              <p className="mb-3 text-sm text-slate-500">{spec.description}</p>
              <div className="mt-auto flex items-center gap-1 text-sm font-medium text-teal-700">
                Import {spec.label}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </div>
            </button>
            <button
              type="button"
              onClick={() => downloadTemplate(key)}
              className="mt-3 inline-flex w-fit items-center gap-1.5 text-xs text-slate-500 hover:text-teal-700"
            >
              <Download className="h-3.5 w-3.5" /> Download template
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — upload / paste
// ---------------------------------------------------------------------------
function UploadStep({
  spec,
  fileName,
  pasteText,
  onPaste,
  onFile,
  onParsePaste,
  onBack,
}: {
  spec: (typeof ENTITY_SPECS)[EntityKey];
  fileName: string;
  pasteText: string;
  onPaste: (v: string) => void;
  onFile: (f: File) => void;
  onParsePaste: () => void;
  onBack: () => void;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">
            Fields for {spec.label}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadTemplate(spec.key)}
          >
            <Download className="me-1.5 h-3.5 w-3.5" /> Template
          </Button>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {spec.fields.map((f) => (
            <div key={f.key} className="flex items-center gap-2 text-sm">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                {f.key}
              </code>
              <RequiredBadge required={f.required} />
              {f.help && (
                <span className="truncate text-xs text-slate-400">{f.help}</span>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const file = e.dataTransfer.files?.[0];
            if (file) onFile(file);
          }}
          className={cn(
            "flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
            drag ? "border-teal-400 bg-teal-50" : "border-slate-200 bg-slate-50",
          )}
        >
          <UploadCloud className="mb-2 h-8 w-8 text-slate-400" />
          <p className="text-sm font-medium text-slate-700">
            Drag a .csv file here, or
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => inputRef.current?.click()}
          >
            Choose file
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = "";
            }}
          />
          {fileName && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-500">
              <FileSpreadsheet className="h-3.5 w-3.5" /> {fileName}
            </p>
          )}
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-600">
            Or paste CSV text
          </summary>
          <Textarea
            value={pasteText}
            onChange={(e) => onPaste(e.target.value)}
            placeholder="Paste CSV including the header row…"
            className="mt-2 min-h-[140px] font-mono text-xs"
          />
          <Button
            size="sm"
            className="mt-2 bg-teal-600 text-white hover:bg-teal-700"
            disabled={!pasteText.trim()}
            onClick={onParsePaste}
          >
            Parse pasted text
          </Button>
        </details>
      </Card>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="me-1.5 h-4 w-4" /> Back
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — map columns + bulk-select defaults
// ---------------------------------------------------------------------------
function MapStep({
  spec,
  headers,
  rowCount,
  mapping,
  setMapping,
  defaults,
  setDefaults,
  orgLabel,
  setOrgLabel,
  personLabel,
  setPersonLabel,
  users,
  pipelines,
  stages,
  validCount,
  errorCount,
  unsatisfied,
  onBack,
  onContinue,
}: {
  spec: (typeof ENTITY_SPECS)[EntityKey];
  headers: string[];
  rowCount: number;
  mapping: Record<string, string>;
  setMapping: (m: Record<string, string>) => void;
  defaults: ImportDefaults;
  setDefaults: (updater: (d: ImportDefaults) => ImportDefaults) => void;
  orgLabel: string | null;
  setOrgLabel: (v: string | null) => void;
  personLabel: string | null;
  setPersonLabel: (v: string | null) => void;
  users: { id: number; name: string }[];
  pipelines: { id: number; name: string }[];
  stages: { id: number; name: string }[];
  validCount: number;
  errorCount: number;
  unsatisfied: { key: string; label: string }[];
  onBack: () => void;
  onContinue: () => void;
}) {
  const isDeals = spec.key === "deals";
  const hasOrg = spec.key === "persons" || spec.key === "deals";

  const setMap = (fieldKey: string, header: string) => {
    const next = { ...mapping };
    if (header === NONE) delete next[fieldKey];
    else next[fieldKey] = header;
    setMapping(next);
  };

  return (
    <div className="space-y-4">
      {/* Bulk-select defaults — the answer to "a key detail isn't there". */}
      <Card>
        <h2 className="font-semibold text-slate-900">Defaults for every row</h2>
        <p className="mb-3 text-sm text-slate-500">
          Applied to any row that leaves the matching column blank. Use these
          when your file doesn’t carry IDs.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {isDeals && (
            <>
              <Field label="Pipeline" required>
                <Select
                  value={defaults.pipelineId ? String(defaults.pipelineId) : NONE}
                  onValueChange={(v) =>
                    setDefaults((d) => ({
                      ...d,
                      pipelineId: v === NONE ? undefined : Number(v),
                      // Stage must belong to the pipeline — reset on change.
                      stageId: undefined,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select pipeline…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No default</SelectItem>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Stage" required>
                <Select
                  value={defaults.stageId ? String(defaults.stageId) : NONE}
                  onValueChange={(v) =>
                    setDefaults((d) => ({
                      ...d,
                      stageId: v === NONE ? undefined : Number(v),
                    }))
                  }
                  disabled={defaults.pipelineId == null}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        defaults.pipelineId == null
                          ? "Pick a pipeline first"
                          : "Select stage…"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No default</SelectItem>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          )}

          <Field label="Owner">
            <Combobox
              items={users.map((u) => ({ value: String(u.id), label: u.name }))}
              value={defaults.ownerId ? String(defaults.ownerId) : NONE}
              onChange={(v) =>
                setDefaults((d) => ({
                  ...d,
                  ownerId: v === NONE ? undefined : Number(v),
                }))
              }
              allValue={NONE}
              allLabel="Importer (you)"
              placeholder="Search users…"
              triggerClassName="w-full"
            />
          </Field>

          {hasOrg && (
            <Field label="Organization">
              <AsyncSelect
                value={defaults.organizationId ? String(defaults.organizationId) : null}
                valueLabel={orgLabel}
                placeholder="Search organizations…"
                allValue={NONE}
                allLabel="No default"
                loadOptions={loadOrganizationOptions}
                onChange={(v: string | null, label: string | null) => {
                  setDefaults((d) => ({
                    ...d,
                    organizationId: v && v !== NONE ? Number(v) : undefined,
                  }));
                  setOrgLabel(label);
                }}
                triggerClassName="w-full"
              />
            </Field>
          )}

          {isDeals && (
            <>
              <Field label="Person">
                <AsyncSelect
                  value={defaults.personId ? String(defaults.personId) : null}
                  valueLabel={personLabel}
                  placeholder="Search people…"
                  allValue={NONE}
                  allLabel="No default"
                  loadOptions={loadPersonOptions}
                  onChange={(v: string | null, label: string | null) => {
                    setDefaults((d) => ({
                      ...d,
                      personId: v && v !== NONE ? Number(v) : undefined,
                    }));
                    setPersonLabel(label);
                  }}
                  triggerClassName="w-full"
                />
              </Field>
              <Field label="Currency">
                <Input
                  value={defaults.currency ?? ""}
                  maxLength={3}
                  placeholder="e.g. USD"
                  onChange={(e) =>
                    setDefaults((d) => ({
                      ...d,
                      currency: e.target.value.toUpperCase() || undefined,
                    }))
                  }
                />
              </Field>
            </>
          )}
        </div>
      </Card>

      {/* Column mapping */}
      <Card>
        <h2 className="mb-3 font-semibold text-slate-900">
          Map columns{" "}
          <span className="font-normal text-slate-400">
            ({rowCount} rows detected)
          </span>
        </h2>
        <div className="space-y-1.5">
          {spec.fields.map((f) => (
            <div
              key={f.key}
              className="grid grid-cols-[1fr_auto_1.2fr] items-center gap-3 rounded-md px-1 py-1"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-800">
                  {f.label}
                </span>
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-500">
                  {f.key}
                </code>
              </div>
              <RequiredBadge required={f.required} />
              <Select
                value={mapping[f.key] ?? NONE}
                onValueChange={(v) => setMap(f.key, v)}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Not mapped" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>- Not mapped -</SelectItem>
                  {headers.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </Card>

      {unsatisfied.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Pick a default to continue</AlertTitle>
          <AlertDescription>
            {unsatisfied.map((f) => f.label).join(", ")}{" "}
            {unsatisfied.length === 1 ? "is" : "are"} required but not in your
            file. Bulk-select{" "}
            {unsatisfied.length === 1 ? "a value" : "values"} above to apply to
            every row.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="me-1.5 h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">
            <span className="font-semibold text-teal-700">{validCount}</span>{" "}
            ready
            {errorCount > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-red-600">{errorCount}</span>{" "}
                with errors
              </>
            )}
          </span>
          <Button
            className="bg-teal-600 text-white hover:bg-teal-700"
            disabled={unsatisfied.length > 0}
            onClick={onContinue}
          >
            Review <ArrowRight className="ms-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-500">
        {label}
        {required && <span className="ms-1 text-amber-600">*</span>}
      </label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — review (errors flagged) + import
// ---------------------------------------------------------------------------
const MAX_PREVIEW = 300;

function primarySummary(entityKey: EntityKey, data: Record<string, unknown>): string {
  if (entityKey === "deals") return String(data.title ?? "—");
  const name = String(data.name ?? "—");
  return data.email ? `${name} · ${data.email}` : name;
}

function ReviewStep({
  spec,
  validated,
  validCount,
  errorCount,
  importing,
  onBack,
  onImport,
}: {
  spec: (typeof ENTITY_SPECS)[EntityKey];
  validated: ValidatedRow[];
  validCount: number;
  errorCount: number;
  importing: boolean;
  onBack: () => void;
  onImport: () => void;
}) {
  const [onlyErrors, setOnlyErrors] = useState(false);
  const visible = (onlyErrors
    ? validated.filter((r) => r.errors.length > 0)
    : validated
  ).slice(0, MAX_PREVIEW);
  const hiddenCount =
    (onlyErrors ? errorCount : validated.length) - visible.length;

  const downloadErrors = () => {
    const rows = validated
      .filter((r) => r.errors.length > 0)
      .map((r) => ({
        row: r.index + 2, // +1 header, +1 to 1-base
        summary: primarySummary(spec.key, r.data),
        errors: r.errors.map((e) => e.message).join(" "),
      }));
    const blob = new Blob([Papa.unparse(rows)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec.key}-import-errors.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge className="border-teal-200 bg-teal-50 text-teal-700">
          <CheckCircle2 className="me-1 h-3.5 w-3.5" /> {validCount} ready to
          import
        </Badge>
        {errorCount > 0 && (
          <Badge variant="outline" className="border-red-200 bg-red-50 text-red-600">
            <AlertCircle className="me-1 h-3.5 w-3.5" /> {errorCount} will be
            skipped
          </Badge>
        )}
        <div className="ms-auto flex items-center gap-2">
          {errorCount > 0 && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setOnlyErrors((v) => !v)}>
                {onlyErrors ? "Show all" : "Show only errors"}
              </Button>
              <Button variant="outline" size="sm" onClick={downloadErrors}>
                <FileWarning className="me-1.5 h-3.5 w-3.5" /> Download errors
              </Button>
            </>
          )}
        </div>
      </div>

      <Card className="p-0">
        <div className="max-h-[52vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-start text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-16 px-3 py-2 font-semibold">Row</th>
                <th className="w-24 px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">{spec.singular}</th>
                <th className="px-3 py-2 font-semibold">Issues</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const ok = r.errors.length === 0;
                return (
                  <tr key={r.index} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-400">{r.index + 2}</td>
                    <td className="px-3 py-2">
                      {ok ? (
                        <span className="inline-flex items-center gap-1 text-teal-700">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600">
                          <AlertCircle className="h-3.5 w-3.5" /> Error
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {primarySummary(spec.key, r.data)}
                    </td>
                    <td className="px-3 py-2 text-xs text-red-600">
                      {r.errors.map((e) => e.message).join(" ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hiddenCount > 0 && (
          <div className="border-t border-slate-100 px-3 py-2 text-center text-xs text-slate-400">
            +{hiddenCount} more rows not shown
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} disabled={importing}>
          <ArrowLeft className="me-1.5 h-4 w-4" /> Back
        </Button>
        <Button
          className="bg-teal-600 text-white hover:bg-teal-700"
          disabled={validCount === 0 || importing}
          onClick={onImport}
        >
          {importing ? (
            <>
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> Importing…
            </>
          ) : (
            <>
              <UploadCloud className="me-1.5 h-4 w-4" /> Import {validCount}{" "}
              {validCount === 1 ? spec.singular : spec.label.toLowerCase()}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — result
// ---------------------------------------------------------------------------
function ResultStep({
  spec,
  result,
  submittedIndices,
  onImportMore,
  onView,
}: {
  spec: (typeof ENTITY_SPECS)[EntityKey];
  result: ImportResult;
  submittedIndices: number[];
  onImportMore: () => void;
  onView: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card className="flex flex-col items-center py-8 text-center">
        {result.failed === 0 ? (
          <CheckCircle2 className="mb-3 h-12 w-12 text-teal-500" />
        ) : (
          <AlertCircle className="mb-3 h-12 w-12 text-amber-500" />
        )}
        <h2 className="text-lg font-semibold text-slate-900">
          Imported {result.created}{" "}
          {result.created === 1 ? spec.singular : spec.label.toLowerCase()}
        </h2>
        {result.failed > 0 && (
          <p className="text-sm text-slate-500">
            {result.failed} row{result.failed === 1 ? "" : "s"} were rejected by
            the server.
          </p>
        )}
      </Card>

      {result.errors.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            Server-rejected rows
          </h3>
          <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
            {result.errors.map((e, i) => {
              const csvIndex = submittedIndices[e.row - 1];
              const line = csvIndex != null ? csvIndex + 2 : e.row;
              return (
                <li key={i} className="flex gap-2 text-red-600">
                  <span className="shrink-0 text-slate-400">Row {line}:</span>
                  {e.message}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onImportMore}>
          Import another file
        </Button>
        <Button className="bg-teal-600 text-white hover:bg-teal-700" onClick={onView}>
          View {spec.label}
        </Button>
      </div>
    </div>
  );
}
