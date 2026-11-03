import { Link } from "wouter";
import { cn } from "@/lib/utils";

// A "stretched link": a real anchor whose ::after pseudo-element (the
// `after:absolute after:inset-0` utilities) expands to fill the nearest
// positioned ancestor, turning a whole card into one click target. This is
// Bootstrap's `.stretched-link` idiom. Because it stays a real <a>, it
// preserves middle-click / cmd-click open-in-new-tab and keyboard focus +
// Enter — a plain `onClick={navigate}` would lose all of those.
//
// Host requirements:
//   - The element that should become clickable MUST be `position: relative`
//     (Tailwind `relative`); the ::after fills the nearest positioned ancestor.
//   - Genuinely interactive siblings (buttons, menus) must sit above the
//     overlay with `relative z-10`, or the stretched link swallows their clicks.
//
// Drag-and-drop note: this deliberately does NOT stop pointer/click
// propagation, so `pointerdown` still bubbles to a dnd-kit drag container. A
// dnd-kit PointerSensor `activationConstraint.distance` is what separates a
// stationary click (navigates) from a drag (reorders). `draggable={false}`
// disables the native HTML link drag so it can't fight pointer dragging.

type StretchedLinkProps = {
  href: string;
  children: React.ReactNode;
  className?: string;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">;

export function StretchedLink({
  href,
  children,
  className,
  ...props
}: StretchedLinkProps) {
  return (
    <Link
      href={href}
      draggable={false}
      className={cn(
        "after:absolute after:inset-0 after:rounded-[inherit]",
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
