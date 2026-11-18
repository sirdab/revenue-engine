// Sirdab One popover, plus one app extension: `disablePortal`.
import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import {
  Popover,
  PopoverAnchor,
  PopoverContent as OnePopoverContent,
  PopoverTrigger,
} from "@sirdab/one/components/popover";
import {
  overlayPanelChrome,
  overlayPanelMotion,
} from "@sirdab/one/components/overlay";
import { cn } from "@/lib/utils";

type PopoverContentProps = React.ComponentProps<typeof OnePopoverContent> & {
  /**
   * Render inline instead of in a portal. Needed when the popover opens
   * inside a Dialog or Sheet: those scroll-lock everything outside their
   * content, so a portalled popover could not be wheel- or touch-scrolled.
   * Rendering inline keeps it a DOM descendant of the dialog content.
   */
  disablePortal?: boolean;
};

function PopoverContent({
  disablePortal = false,
  className,
  align = "start",
  sideOffset = 4,
  collisionPadding = 16,
  kind = "panel",
  scheme,
  ...props
}: PopoverContentProps) {
  if (!disablePortal) {
    return (
      <OnePopoverContent
        className={className}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        kind={kind}
        scheme={scheme}
        {...props}
      />
    );
  }
  return (
    <PopoverPrimitive.Content
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        overlayPanelChrome,
        kind === "dialog" && "rounded-popover before:rounded-popover p-4",
        scheme === "dark" && "dark text-foreground",
        "z-popover outline-hidden",
        overlayPanelMotion,
        className,
      )}
      {...props}
    />
  );
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
