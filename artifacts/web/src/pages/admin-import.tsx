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
  useI18n,
  type MessageKey,
  type PluralKey,
  type Translate,
} from "@/lib/i18n/i18n";
import { LOCALE_INFO } from "@/lib/i18n/locales";
import {
  ENTITY_SPECS,
  IMPORT_BATCH_SIZE,
  autoMapHeaders,
  isPipedriveExport,
  downloadTemplate,
  validateRows,
  unsatisfiedRequiredFields,
  toOrganizationRows,
  toPersonRows,
  toDealRows,
  type EntityKey,
  type FieldSpec,
  type CellError,
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
  Info,
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
// Message keys, resolved at render through t(). The same goes for the entity
// and field tables below: `import-spec.ts` keeps its English labels because
// header auto-mapping matches on them, so only the display is translated here.
const STEP_LABELS: Record<StepId, MessageKey> = {
  entity: "settings.import.step.entity",
  upload: "settings.import.step.upload",
  map: "settings.import.step.map",
  review: "settings.import.step.review",
  done: "settings.import.step.done",
};

interface EntityText {
  label: MessageKey;
  singular: MessageKey;
  description: MessageKey;
  cta: MessageKey;
  fieldsTitle: MessageKey;
  view: MessageKey;
  importCount: PluralKey;
  imported: PluralKey;
}

const ENTITY_TEXT: Record<EntityKey, EntityText> = {
  organizations: {
    label: "settings.import.entity.organizations.label",
    singular: "common.organization",
    description: "settings.import.entity.organizations.description",
    cta: "settings.import.entity.organizations.cta",
    fieldsTitle: "settings.import.entity.organizations.fieldsTitle",
    view: "settings.import.entity.organizations.view",
    importCount: "settings.import.entity.organizations.importCount",
    imported: "settings.import.entity.organizations.imported",
  },
  persons: {
    label: "settings.import.entity.persons.label",
    singular: "common.person",
    description: "settings.import.entity.persons.description",
    cta: "settings.import.entity.persons.cta",
    fieldsTitle: "settings.import.entity.persons.fieldsTitle",
    view: "settings.import.entity.persons.view",
    importCount: "settings.import.entity.persons.importCount",
    imported: "settings.import.entity.persons.imported",
  },
  deals: {
    label: "settings.import.entity.deals.label",
    singular: "common.deal",
    description: "settings.import.entity.deals.description",
    cta: "settings.import.entity.deals.cta",
    fieldsTitle: "settings.import.entity.deals.fieldsTitle",
    view: "settings.import.entity.deals.view",
    importCount: "settings.import.entity.deals.importCount",
    imported: "settings.import.entity.deals.imported",
  },
};

// Display labels by field key. The key itself (and the CSV template header)
// is a data format and stays as it is.
const FIELD_LABELS: Record<string, MessageKey> = {
  name: "settings.import.field.name",
  address: "settings.import.field.address",
  ownerId: "settings.import.field.ownerId",
  email: "settings.import.field.email",
  phone: "settings.import.field.phone",
  jobTitle: "settings.import.field.jobTitle",
  organizationId: "settings.import.field.organizationId",
  title: "settings.import.field.title",
  value: "settings.import.field.value",
  currency: "settings.import.field.currency",
  pipelineId: "settings.import.field.pipelineId",
  stageId: "settings.import.field.stageId",
  personId: "settings.import.field.personId",
  personPhone: "settings.import.field.personPhone",
  personName: "settings.import.field.personName",
  personEmail: "settings.import.field.personEmail",
  expectedCloseDate: "settings.import.field.expectedCloseDate",
  labels: "settings.import.field.labels",
};

const FIELD_HELP: Record<string, MessageKey> = {
  ownerId: "settings.import.help.id",
  organizationId: "settings.import.help.id",
  personId: "settings.import.help.id",
  pipelineId: "settings.import.help.pipelineId",
  stageId: "settings.import.help.stageId",
  personPhone: "settings.import.help.personPhone",
  personName: "settings.import.help.personName",
  personEmail: "settings.import.help.personEmail",
  expectedCloseDate: "settings.import.help.expectedCloseDate",
  labels: "settings.import.help.labels",
};

function fieldLabel(t: Translate, field: Pick<FieldSpec, "key" | "label">): string {
  const key = FIELD_LABELS[field.key];
  return key ? t(key) : field.label;
}

function fieldHelp(t: Translate, field: FieldSpec): string | undefined {
  if (!field.help) return undefined;
  const key = FIELD_HELP[field.key];
  return key ? t(key) : field.help;
}

// validateRows() words its messages in English from the field label; rebuild
// them here from the field and the kind of failure so they read in the UI's
// language. A required-field miss is the only message that ends "is required.";
// any other is the parse failure for that field's type.
function cellErrorText(
  t: Translate,
  fields: FieldSpec[],
  err: CellError,
): string {
  const field = fields.find((f) => f.key === err.field);
  if (!field) return err.message;
  const name = fieldLabel(t, field);
  if (err.message === `${err.label} is required.`) {
    return t("settings.import.error.required", { field: name });
  }
  switch (field.type) {
    case "integer":
      return t("settings.import.error.integer", { field: name });
    case "number":
      return t("settings.import.error.number", { field: name });
    case "date":
      return t("settings.import.error.date", { field: name });
    default:
      return err.message;
  }
}

const ENTITY_CARDS: { key: EntityKey; icon: typeof Building2 }[] = [
  { key: "organizations", icon: Building2 },
  { key: "persons", icon: Users },
  { key: "deals", icon: Briefcase },
];

const NONE = "__none__"; // Select sentinel for "no mapping / no default".

export default function AdminImportPage() {
  const { t, tPlural, formatNumber } = useI18n();
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
            title: t("settings.import.toast.nothingTitle"),
            description: t("settings.import.toast.nothingDescription"),
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
          title: t("settings.import.toast.parseFailed"),
          description: e.message,
          variant: "destructive",
        }),
    });
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => parseCsv(String(ev.target?.result ?? ""), file.name);
    reader.onerror = () =>
      toast({ title: t("settings.import.toast.readFailed"), variant: "destructive" });
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
        title: t("settings.import.toast.importFailed"),
        description:
          aggregate.created > 0
            ? tPlural("settings.import.toast.partial", aggregate.created, {
                count: formatNumber(aggregate.created),
                reason,
              })
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
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col">
      <header className="mb-5">
        <h1 className="text-heading-sm text-foreground">
          {t("settings.import.title")}
        </h1>
        <p className="mt-1 text-body-quiet text-muted-foreground">
          {t("settings.import.subtitle")}
        </p>
      </header>

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
  const { t, formatNumber } = useI18n();
  const currentIdx = STEPS.indexOf(current);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-body-quiet">
      {STEPS.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-caption font-semibold",
                active && "bg-primary text-primary-foreground",
                done && "bg-brand-subtle text-brand",
                !active && !done && "bg-muted text-subtle",
              )}
            >
              {done ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                formatNumber(i + 1)
              )}
            </span>
            <span
              className={cn(
                "font-medium",
                active ? "text-foreground" : "text-subtle",
              )}
            >
              {t(STEP_LABELS[s])}
            </span>
            {i < STEPS.length - 1 && (
              <span className="mx-1 h-px w-6 bg-gray-200" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function RequiredBadge({ required }: { required: boolean }) {
  const { t } = useI18n();
  return required ? (
    <Badge variant="outline" className="border-warning/30 bg-warning-subtle text-warning">
      {t("settings.import.required")}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-subtle">
      {t("common.optional")}
    </Badge>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-card p-5 shadow-card",
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
  const { t } = useI18n();
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {ENTITY_CARDS.map(({ key, icon: Icon }) => {
        const text = ENTITY_TEXT[key];
        return (
          <div
            key={key}
            className="group flex flex-col rounded-2xl bg-card p-5 text-start shadow-card transition-all hover:shadow-card-hover"
          >
            {/* Two sibling buttons, not one inside the other: a nested button
                is invalid HTML and reads as one control to a screen reader. */}
            <button
              type="button"
              onClick={() => onChoose(key)}
              className="flex flex-1 flex-col text-start"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-subtle text-brand">
                <Icon className="h-5 w-5" />
              </div>
              <div className="text-body-lg font-semibold text-foreground">
                {t(text.label)}
              </div>
              <p className="mb-3 text-body-quiet text-muted-foreground">
                {t(text.description)}
              </p>
              <div className="mt-auto flex items-center gap-1 text-body text-brand">
                {t(text.cta)}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </div>
            </button>
            <button
              type="button"
              onClick={() => downloadTemplate(key)}
              className="mt-3 inline-flex w-fit items-center gap-1.5 text-caption-quiet text-muted-foreground hover:text-brand"
            >
              <Download className="h-3.5 w-3.5" /> {t("settings.import.downloadTemplate")}
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
  const { t } = useI18n();
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-foreground">
            {t(ENTITY_TEXT[spec.key].fieldsTitle)}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadTemplate(spec.key)}
          >
            <Download className="me-1.5 h-3.5 w-3.5" /> {t("settings.import.template")}
          </Button>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {spec.fields.map((f) => (
            <div key={f.key} className="flex items-center gap-2 text-body-quiet">
              <code
                dir="ltr"
                className="rounded-sm bg-muted px-1.5 py-0.5 text-caption-quiet text-foreground"
              >
                {f.key}
              </code>
              <RequiredBadge required={f.required} />
              {f.help && (
                <span
                  className="truncate text-caption-quiet text-subtle"
                  title={fieldHelp(t, f)}
                >
                  {fieldHelp(t, f)}
                </span>
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
            drag ? "border-gray-alpha-400 bg-gray-alpha-100" : "border-border bg-surface-whisper",
          )}
        >
          <UploadCloud className="mb-2 h-8 w-8 text-subtle" />
          <p className="text-body text-foreground">
            {t("settings.import.upload.drop")}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => inputRef.current?.click()}
          >
            {t("settings.import.upload.choose")}
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
            <p className="mt-3 inline-flex items-center gap-1.5 text-caption-quiet text-muted-foreground">
              <FileSpreadsheet className="h-3.5 w-3.5" />{" "}
              <span dir="auto">{fileName}</span>
            </p>
          )}
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-body text-muted-foreground">
            {t("settings.import.upload.pasteToggle")}
          </summary>
          <Textarea
            value={pasteText}
            onChange={(e) => onPaste(e.target.value)}
            placeholder={t("settings.import.upload.pastePlaceholder")}
            dir="auto"
            className="mt-2 min-h-[140px] font-mono text-caption-quiet"
          />
          <Button
            size="sm"
            className="mt-2 bg-primary text-primary-foreground hover:bg-primary-hover"
            disabled={!pasteText.trim()}
            onClick={onParsePaste}
          >
            {t("settings.import.upload.parse")}
          </Button>
        </details>
      </Card>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="me-1.5 h-4 w-4" />{" "}
          {t("settings.import.back")}
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
  const { t, tPlural, formatNumber, locale } = useI18n();
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
      {isPipedriveExport(headers) && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>{t("settings.import.pipedrive.title")}</AlertTitle>
          <AlertDescription>
            {isDeals
              ? t("settings.import.pipedrive.deals")
              : t("settings.import.pipedrive.other")}
          </AlertDescription>
        </Alert>
      )}

      {/* Bulk-select defaults — the answer to "a key detail isn't there". */}
      <Card>
        <h2 className="font-semibold text-foreground">
          {t("settings.import.defaults.title")}
        </h2>
        <p className="mb-3 text-body-quiet text-muted-foreground">
          {t("settings.import.defaults.description")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {isDeals && (
            <>
              <Field label={t("common.pipeline")} required>
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
                    <SelectValue placeholder={t("settings.import.defaults.selectPipeline")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("settings.import.defaults.none")}</SelectItem>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("common.stage")} required>
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
                          ? t("settings.import.defaults.pickPipelineFirst")
                          : t("settings.import.defaults.selectStage")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("settings.import.defaults.none")}</SelectItem>
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

          <Field label={t("common.owner")}>
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
              allLabel={t("settings.import.defaults.importer")}
              placeholder={t("settings.import.defaults.searchUsers")}
              triggerClassName="w-full"
            />
          </Field>

          {hasOrg && (
            <Field label={t("common.organization")}>
              <AsyncSelect
                value={defaults.organizationId ? String(defaults.organizationId) : null}
                valueLabel={orgLabel}
                placeholder={t("common.searchOrganizations")}
                allValue={NONE}
                allLabel={t("settings.import.defaults.none")}
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
              <Field label={t("common.person")}>
                <AsyncSelect
                  value={defaults.personId ? String(defaults.personId) : null}
                  valueLabel={personLabel}
                  placeholder={t("common.searchPeople")}
                  allValue={NONE}
                  allLabel={t("settings.import.defaults.none")}
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
              <Field label={t("common.currency")}>
                <Input
                  value={defaults.currency ?? ""}
                  maxLength={3}
                  placeholder={t("settings.import.defaults.currencyPlaceholder")}
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
        <h2 className="mb-3 font-semibold text-foreground">
          {t("settings.import.map.title")}{" "}
          <span className="font-normal text-subtle">
            {tPlural("settings.import.map.rowsDetected", rowCount, { count: formatNumber(rowCount) })}
          </span>
        </h2>
        <div className="space-y-1.5">
          {spec.fields.map((f) => (
            <div
              key={f.key}
              className="grid grid-cols-[1fr_auto_1.2fr] items-center gap-3 rounded-md px-1 py-1"
            >
              <div className="flex items-center gap-2">
                <span className="text-body text-foreground">
                  {fieldLabel(t, f)}
                </span>
                <code
                  dir="ltr"
                  className="rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
                >
                  {f.key}
                </code>
              </div>
              <RequiredBadge required={f.required} />
              <Select
                value={mapping[f.key] ?? NONE}
                onValueChange={(v) => setMap(f.key, v)}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={t("settings.import.map.notMapped")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t("settings.import.map.notMappedOption")}
                  </SelectItem>
                  {headers.map((h) => (
                    <SelectItem key={h} value={h}>
                      <span dir="auto">{h}</span>
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
          <AlertTitle>{t("settings.import.unsatisfied.title")}</AlertTitle>
          <AlertDescription>
            {tPlural("settings.import.unsatisfied.body", unsatisfied.length, {
              fields: new Intl.ListFormat(LOCALE_INFO[locale].tag, {
                type: "conjunction",
              }).format(unsatisfied.map((f) => fieldLabel(t, f))),
            })}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="me-1.5 h-4 w-4" />{" "}
          {t("settings.import.back")}
        </Button>
        <div className="flex items-center gap-3">
          <span className="text-body-quiet text-muted-foreground">
            <span className="font-semibold text-brand">
              {tPlural("settings.import.map.ready", validCount, { count: formatNumber(validCount) })}
            </span>
            {errorCount > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-destructive">
                  {tPlural("settings.import.map.withErrors", errorCount, { count: formatNumber(errorCount) })}
                </span>
              </>
            )}
          </span>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary-hover"
            disabled={unsatisfied.length > 0}
            onClick={onContinue}
          >
            {t("settings.import.step.review")}{" "}
            <ArrowRight className="ms-1.5 h-4 w-4" />
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
      <label className="text-caption text-muted-foreground">
        {label}
        {required && <span className="ms-1 text-warning">*</span>}
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
  const { t, tPlural, formatNumber } = useI18n();
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
        errors: r.errors
          .map((e) => cellErrorText(t, spec.fields, e))
          .join(" "),
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
        <Badge className="border-transparent bg-brand-subtle text-brand-subtle-foreground">
          <CheckCircle2 className="me-1 h-3.5 w-3.5" />{" "}
          {tPlural("settings.import.review.ready", validCount, { count: formatNumber(validCount) })}
        </Badge>
        {errorCount > 0 && (
          <Badge variant="outline" className="border-destructive/30 bg-destructive-subtle text-destructive">
            <AlertCircle className="me-1 h-3.5 w-3.5" />{" "}
            {tPlural("settings.import.review.skipped", errorCount, { count: formatNumber(errorCount) })}
          </Badge>
        )}
        <div className="ms-auto flex items-center gap-2">
          {errorCount > 0 && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setOnlyErrors((v) => !v)}>
                {onlyErrors
                  ? t("settings.import.review.showAll")
                  : t("settings.import.review.showErrors")}
              </Button>
              <Button variant="outline" size="sm" onClick={downloadErrors}>
                <FileWarning className="me-1.5 h-3.5 w-3.5" />{" "}
                {t("settings.import.review.downloadErrors")}
              </Button>
            </>
          )}
        </div>
      </div>

      <Card className="p-0">
        <div className="max-h-[52vh] overflow-auto">
          <table className="w-full text-body-quiet">
            <thead className="sticky top-0 bg-surface-whisper text-start text-caption text-muted-foreground">
              <tr>
                <th className="w-16 px-3 py-2 text-start font-semibold">
                  {t("settings.import.review.row")}
                </th>
                <th className="w-24 px-3 py-2 text-start font-semibold">
                  {t("common.status")}
                </th>
                <th className="px-3 py-2 text-start font-semibold">
                  {t(ENTITY_TEXT[spec.key].singular)}
                </th>
                <th className="px-3 py-2 text-start font-semibold">
                  {t("settings.import.review.issues")}
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const ok = r.errors.length === 0;
                return (
                  <tr key={r.index} className="border-t border-border">
                    <td className="px-3 py-2 tabular-nums text-subtle">
                      {formatNumber(r.index + 2)}
                    </td>
                    <td className="px-3 py-2">
                      {ok ? (
                        <span className="inline-flex items-center gap-1 text-brand">
                          <CheckCircle2 className="h-3.5 w-3.5" />{" "}
                          {t("settings.import.review.statusReady")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <AlertCircle className="h-3.5 w-3.5" />{" "}
                          {t("settings.import.review.statusError")}
                        </span>
                      )}
                    </td>
                    <td dir="auto" className="px-3 py-2 text-start text-foreground">
                      {primarySummary(spec.key, r.data)}
                    </td>
                    <td className="px-3 py-2 text-caption-quiet text-destructive">
                      {r.errors
                        .map((e) => cellErrorText(t, spec.fields, e))
                        .join(" ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hiddenCount > 0 && (
          <div className="border-t border-border px-3 py-2 text-center text-caption-quiet text-subtle">
            {tPlural("settings.import.review.moreRows", hiddenCount, { count: formatNumber(hiddenCount) })}
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} disabled={importing}>
          <ArrowLeft className="me-1.5 h-4 w-4" />{" "}
          {t("settings.import.back")}
        </Button>
        <Button
          className="bg-primary text-primary-foreground hover:bg-primary-hover"
          disabled={validCount === 0 || importing}
          onClick={onImport}
        >
          {importing ? (
            <>
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" />{" "}
              {t("settings.import.review.importing")}
            </>
          ) : (
            <>
              <UploadCloud className="me-1.5 h-4 w-4" />{" "}
              {tPlural(ENTITY_TEXT[spec.key].importCount, validCount, { count: formatNumber(validCount) })}
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
  const { t, tPlural, formatNumber } = useI18n();
  const text = ENTITY_TEXT[spec.key];
  return (
    <div className="space-y-4">
      <Card className="flex flex-col items-center py-8 text-center">
        {result.failed === 0 ? (
          <CheckCircle2 className="mb-3 h-12 w-12 text-brand" />
        ) : (
          <AlertCircle className="mb-3 h-12 w-12 text-warning-glyph" />
        )}
        <h2 className="text-heading-xs text-foreground">
          {tPlural(text.imported, result.created, { count: formatNumber(result.created) })}
        </h2>
        {result.failed > 0 && (
          <p className="text-body-quiet text-muted-foreground">
            {tPlural("settings.import.result.rejected", result.failed, { count: formatNumber(result.failed) })}
          </p>
        )}
      </Card>

      {result.errors.length > 0 && (
        <Card>
          <h3 className="mb-2 text-body font-semibold text-foreground">
            {t("settings.import.result.rejectedTitle")}
          </h3>
          <ul className="max-h-56 space-y-1 overflow-y-auto text-body-quiet">
            {result.errors.map((e, i) => {
              const csvIndex = submittedIndices[e.row - 1];
              const line = csvIndex != null ? csvIndex + 2 : e.row;
              return (
                <li key={i} className="flex gap-2 text-destructive">
                  <span className="shrink-0 text-subtle">
                    {t("settings.import.result.rowLine", { line: formatNumber(line) })}
                  </span>
                  <span dir="auto">{e.message}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onImportMore}>
          {t("settings.import.result.another")}
        </Button>
        <Button className="bg-primary text-primary-foreground hover:bg-primary-hover" onClick={onView}>
          {t(text.view)}
        </Button>
      </div>
    </div>
  );
}
