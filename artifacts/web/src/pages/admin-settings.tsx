import { useParams } from "wouter";
import { Settings2 } from "lucide-react";
import { EmptyState } from "@sirdab/one/components/empty-state";
import { useI18n } from "@/lib/i18n/i18n";
import {
  SettingsShell,
  SETTINGS_SECTIONS,
} from "@/components/settings/settings-shell";
import { CustomFieldsSettings } from "@/components/settings/custom-fields-settings";
import { IntegrationsPage } from "@/components/settings/integrations/integrations-page";
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
  const { t } = useI18n();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        icon={Settings2}
        title={label}
        caption={t("settings.stub.caption")}
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
          <IntegrationsPage />
        ) : active === "imports" ? (
          // The wizard brings no page padding of its own (the standalone
          // /import route wraps it in <Padded>), so give it the same gutters
          // as the other settings panels here.
          <div className="mx-auto h-full w-full max-w-5xl px-4 py-6 md:px-6">
            <AdminImportPage />
          </div>
        ) : (
          <Stub label={section ? t(section.labelKey) : t("common.settings")} />
        )}
    </SettingsShell>
  );
}
