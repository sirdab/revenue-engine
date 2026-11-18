// Where clicking a notification goes. Shared by the topbar bell and the home
// Notifications card so the two surfaces — which render the same store — can
// never route the same row to different places.

export function notificationPath(
  entityType: string | null | undefined,
  entityId: number | null | undefined,
): string | null {
  if (!entityType || entityId == null) return null;
  switch (entityType) {
    case "deal":
      return `/deal/${entityId}`;
    case "person":
      return `/person/${entityId}`;
    case "organization":
      return `/organization/${entityId}`;
    default:
      return null;
  }
}
