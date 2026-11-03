import { useEffect, useMemo, useState } from "react";
import {
  useCreateDeal,
  useListPipelines,
  useListStages,
  useListUserOptions,
} from "@workspace/api-client-react";
import type { Person, Organization } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateDealCollections } from "@/lib/deal-collections";
import { useToast } from "@/hooks/use-toast";
import { AsyncSelect } from "@/components/ui/async-select";
import { PersonFormDialog } from "@/components/contacts/person-form-dialog";
import { OrgFormDialog } from "@/components/contacts/org-form-dialog";
import {
  loadPersonOptions,
  loadOrganizationOptions,
} from "@/lib/contacts-search-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n";

export function CreateDealDialog({
  open,
  onOpenChange,
  defaultPipelineId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPipelineId?: number;
}) {
  const { t } = useI18n();
  const { data: pipelines } = useListPipelines();
  const { data: stages } = useListStages();
  const { data: users } = useListUserOptions();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createDeal = useCreateDeal();

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [pipelineId, setPipelineId] = useState<number | undefined>(
    defaultPipelineId,
  );
  const [stageId, setStageId] = useState<number | undefined>(undefined);
  const [ownerId, setOwnerId] = useState<string>("");
  const [personId, setPersonId] = useState<string | null>(null);
  const [personLabel, setPersonLabel] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationLabel, setOrganizationLabel] = useState<string | null>(
    null,
  );
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  // Inline full-form creation: the picker's "New …" row opens these dialogs
  // (seeded with any typed text) instead of creating a name-only record.
  const [personFormOpen, setPersonFormOpen] = useState(false);
  const [personInitialName, setPersonInitialName] = useState("");
  const [organizationFormOpen, setOrganizationFormOpen] = useState(false);
  const [organizationInitialName, setOrganizationInitialName] = useState("");

  const stagesForPipeline = useMemo(
    () =>
      (stages ?? [])
        .filter((s) => s.pipelineId === pipelineId)
        .sort((a, b) => a.orderIndex - b.orderIndex),
    [stages, pipelineId],
  );

  // Default the pipeline once data arrives, and keep the stage valid for the
  // currently selected pipeline.
  useEffect(() => {
    if (pipelineId == null && pipelines && pipelines.length > 0) {
      setPipelineId(defaultPipelineId ?? pipelines[0].id);
    }
  }, [pipelines, pipelineId, defaultPipelineId]);

  // The dialog stays mounted, so the pipeline seeded on first mount would
  // outlive a switch on the board: re-seed it from the board's pipeline each
  // time the dialog opens. The stage effect below then picks a valid stage.
  useEffect(() => {
    if (open && defaultPipelineId != null) setPipelineId(defaultPipelineId);
  }, [open, defaultPipelineId]);

  useEffect(() => {
    if (
      stagesForPipeline.length > 0 &&
      !stagesForPipeline.some((s) => s.id === stageId)
    ) {
      setStageId(stagesForPipeline[0].id);
    }
  }, [stagesForPipeline, stageId]);

  const reset = () => {
    setTitle("");
    setValue("");
    setOwnerId("");
    setPersonId(null);
    setPersonLabel(null);
    setOrganizationId(null);
    setOrganizationLabel(null);
    setExpectedCloseDate("");
    setPersonFormOpen(false);
    setPersonInitialName("");
    setOrganizationFormOpen(false);
    setOrganizationInitialName("");
  };

  // A negative value is refused rather than quietly sent as 0: the server
  // rejects it too, and silently changing what someone typed hides the typo.
  const valueInvalid = value.trim() !== "" && !(Number(value) >= 0);
  const canSubmit =
    title.trim().length > 0 &&
    pipelineId != null &&
    stageId != null &&
    !valueInvalid;

  const handleSubmit = async () => {
    if (!canSubmit || pipelineId == null || stageId == null) return;
    const parsedValue = Number(value);
    try {
      await createDeal.mutateAsync({
        data: {
          title: title.trim(),
          value: Number.isFinite(parsedValue) ? parsedValue : 0,
          pipelineId,
          stageId,
          ownerId: ownerId ? Number(ownerId) : undefined,
          personId: personId ? Number(personId) : undefined,
          organizationId: organizationId ? Number(organizationId) : undefined,
          expectedCloseDate: expectedCloseDate || undefined,
        },
      });
      invalidateDealCollections(queryClient);
      toast({ title: t("deals.create.done") });
      reset();
      onOpenChange(false);
    } catch {
      toast({ title: t("deals.create.failed"), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">{t("deals.create.title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="deal-title">{t("common.title")}</Label>
            <Input
              id="deal-title"
              value={title}
              dir="auto"
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("deals.create.titlePlaceholder")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="deal-value">{t("deals.valueSar")}</Label>
              <Input
                id="deal-value"
                type="number"
                inputMode="numeric"
                min={0}
                aria-invalid={valueInvalid || undefined}
                className={valueInvalid ? "border-destructive focus-visible:ring-destructive" : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deal-close">{t("deals.expectedClose")}</Label>
              <DatePicker
                id="deal-close"
                value={expectedCloseDate}
                onChange={(next) => setExpectedCloseDate(next)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("common.pipeline")}</Label>
            <Select
              value={pipelineId?.toString() ?? ""}
              onValueChange={(v) => setPipelineId(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("deals.selectPipeline")} />
              </SelectTrigger>
              <SelectContent>
                {(pipelines ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("common.stage")}</Label>
            <Select
              value={stageId?.toString() ?? ""}
              onValueChange={(v) => setStageId(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("deals.selectStage")} />
              </SelectTrigger>
              <SelectContent>
                {stagesForPipeline.map((s) => (
                  <SelectItem key={s.id} value={s.id.toString()}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("common.owner")}</Label>
            <Combobox
              items={(users ?? []).map((u) => ({
                value: u.id.toString(),
                label: u.name,
              }))}
              value={ownerId || "me"}
              onChange={(v) => setOwnerId(v === "me" ? "" : v)}
              allValue="me"
              allLabel={t("deals.create.meDefault")}
              placeholder={t("activity.row.searchUsers")}
              inModal
              triggerClassName="w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("common.person")}</Label>
              <AsyncSelect
                value={personId}
                valueLabel={personLabel}
                onChange={(v, label) => {
                  setPersonId(v);
                  setPersonLabel(label);
                }}
                loadOptions={loadPersonOptions}
                minChars={1}
                inModal
                onCreate={(name) => {
                  setPersonInitialName(name);
                  setPersonFormOpen(true);
                }}
                createLabel={(q) => t("deals.create.createPerson", { query: q })}
                createLabelEmpty={t("deals.create.newPerson")}
                placeholder={t("common.searchPeople")}
                emptyLabel={t("deals.create.noPeople")}
                allValue=""
                allLabel={t("activity.add.noPerson")}
                triggerClassName="w-full"
                contentClassName="w-[var(--radix-popover-trigger-width)]"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("common.organization")}</Label>
              <AsyncSelect
                value={organizationId}
                valueLabel={organizationLabel}
                onChange={(v, label) => {
                  setOrganizationId(v);
                  setOrganizationLabel(label);
                }}
                loadOptions={loadOrganizationOptions}
                minChars={1}
                inModal
                onCreate={(name) => {
                  setOrganizationInitialName(name);
                  setOrganizationFormOpen(true);
                }}
                createLabel={(q) => t("deals.create.createOrg", { query: q })}
                createLabelEmpty={t("deals.create.newOrg")}
                placeholder={t("common.searchOrganizations")}
                emptyLabel={t("deals.create.noOrgs")}
                allValue=""
                allLabel={t("deals.create.noOrg")}
                triggerClassName="w-full"
                contentClassName="w-[var(--radix-popover-trigger-width)]"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || createDeal.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary-hover"
          >
            {createDeal.isPending && (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            )}
            {t("deals.create.submit")}
          </Button>
        </DialogFooter>

        {/* Nested full-form creation opened from the pickers' "New …" rows.
            On success the record is auto-selected into the deal and this
            dialog stays open with all other in-progress fields intact. */}
        <PersonFormDialog
          open={personFormOpen}
          onOpenChange={setPersonFormOpen}
          initialName={personInitialName}
          onCreated={(p: Person) => {
            setPersonId(String(p.id));
            setPersonLabel(p.name);
          }}
        />
        <OrgFormDialog
          open={organizationFormOpen}
          onOpenChange={setOrganizationFormOpen}
          initialName={organizationInitialName}
          onCreated={(o: Organization) => {
            setOrganizationId(String(o.id));
            setOrganizationLabel(o.name);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
