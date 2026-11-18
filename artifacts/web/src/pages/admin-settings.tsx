import { useParams } from "wouter";
import { Settings2 } from "lucide-react";
import { EmptyState } from "@sirdab/one/components/empty-state";
import { useI18n } from "@/lib/i18n/i18n";
import {
  SettingsShell,
  SETTINGS_SECTIONS,
} from "@/components/settings/settings-shell";
import { CustomFieldsSettings } from "@/components/settings/custom-fields-settings";
import { WebhookSettings } from "@/components/settings/webhook-settings";
import { PipelineStageSettings } from "@/components/settings/pipeline-stage-settings";
import { LabelsSettings } from "@/components/settings/labels-settings";
import { TeamsSettings } from "@/components/settings/teams-settings";
import { AssignmentRulesSettings } from "@/components/settings/assignment-rules-settings";
import { AutomationsSettings } from "@/components/settings/automations-settings";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";
// The full import wizard, rendered inside Settings → Imports. Same component the
// standalone /import route uses, so the two can never drift.
import AdminImportPage from "@/pages/admin-import";

function Stub({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        icon={Settings2}
        title={label}
        caption="This settings section isn't available yet."
      />
    </div>
  );
}

export default function AdminSettingsPage() {
  const { t } = useI18n();
  const params = useParams<{ section?: string }>();
  const active = params.section ?? "workspace";
  const section = SETTINGS_SECTIONS.find((s) => s.slug === active);

  return (
    <SettingsShell active={active}>
        {active === "workspace" ? (
          <WorkspaceSettings />
        ) : active === "custom-fields" ? (
          <CustomFieldsSettings />
        ) : active === "pipelines" ? (
          <PipelineStageSettings />
        ) : active === "labels" ? (
          <LabelsSettings />
        ) : active === "teams" ? (
          <TeamsSettings />
        ) : active === "assignment-rules" ? (
          <AssignmentRulesSettings />
        ) : active === "automations" ? (
          <AutomationsSettings />
        ) : active === "integrations" ? (
          <WebhookSettings />
        ) : active === "imports" ? (
          <AdminImportPage />
        ) : (
          <Stub label={section ? t(section.labelKey) : t("common.settings")} />
        )}
    </SettingsShell>
  );
}
