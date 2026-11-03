import { cva, type VariantProps } from "class-variance-authority"

// A sheet's side is a LOGICAL edge, never a physical one. `end` is the far
// edge of the reading direction: the right of the screen in English, the
// left in Arabic. Position (`start-0` / `end-0`) and motion
// (`slide-in-from-start` / `slide-in-from-end`, which tw-animate-css resolves
// with `:dir()`) both follow the document's `dir`, so a caller never flips
// the side itself; doing so would cancel the flip that already happens here.
// `left` / `right` are kept as aliases of `start` / `end` for the callers
// written before the primitive went logical.
const START =
  "inset-y-0 start-0 h-full w-3/4 border-e data-[state=closed]:slide-out-to-start data-[state=open]:slide-in-from-start sm:max-w-sm"
const END =
  "inset-y-0 end-0 h-full w-3/4 border-s data-[state=closed]:slide-out-to-end data-[state=open]:slide-in-from-end sm:max-w-sm"

export const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-200 data-[state=open]:duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        start: START,
        end: END,
        left: START,
        right: END,
      },
    },
    defaultVariants: {
      side: "end",
    },
  }
)

export type SheetSide = NonNullable<VariantProps<typeof sheetVariants>["side"]>
