/**
 * One's ghost icon button, as used in the header: 36px, muted at rest,
 * the ghost wash on hover and while its menu is open. Shared by every
 * topbar control (notifications, recent changes, language, theme) so they
 * line up exactly.
 */
export const TOPBAR_ICON_BUTTON =
  "relative flex size-9 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-btn-ghost-surface-hover hover:text-foreground data-[state=open]:bg-btn-ghost-surface-active data-[state=open]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5";
