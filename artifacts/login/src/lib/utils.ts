// One's `cn`: tailwind-merge extended with One's own utilities (text-body,
// text-heading-*, shadow-raised, h-control, ...). A plain twMerge reads
// `text-body` as a text colour and would drop it next to
// `text-muted-foreground`, silently losing the font size.
export { cn } from "@sirdab/one/lib/utils";
