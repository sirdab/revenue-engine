import type { Activity } from "@workspace/api-client-react";
import { DealActivitySection } from "@/components/activities/deal-activity-section";

export function OrganizationActivities({
  activities,
  loading,
}: {
  activities: Activity[];
  loading?: boolean;
}) {
  return (
    <DealActivitySection
      activities={activities}
      loading={loading}
      emptyHint="contacts.organizationActivitiesHint"
    />
  );
}
