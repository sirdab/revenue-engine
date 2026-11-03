import * as React from "react"
import { Clock, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { getActiveLocale } from "@/lib/i18n/active-locale"
import { intlDateTag } from "@/lib/i18n/formatting"
import { useI18n } from "@/lib/i18n/i18n"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  HOURS,
  PERIODS,
  defaultWheelTime,
  formatHm,
  minuteOptions,
  parseHm,
  type Period,
  type WheelTime,
} from "@/components/ui/time-wheel-utils"

export interface TimePickerProps {
  /** `HH:MM` (24-hour), or `""` for no time. Drop-in for `<input type="time">`. */
  value: string
  /** Emits the new `HH:MM`, or `""` when cleared. */
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  "aria-label"?: string
  /** Render the wheels in place instead of portalling them. Required inside a
   *  modal Dialog: it blocks scrolling anywhere outside itself, which would
   *  freeze the wheels (same reason as DatePicker's prop). */
  disablePortal?: boolean
}

const ITEM_H = 36
const VISIBLE = 5
const PAD = ((VISIBLE - 1) / 2) * ITEM_H

/**
 * A time field picked from scrolling hour / minute / AM-PM wheels, like the
 * iPhone alarm, instead of typing digits. Scroll, drag, tap a row, or use the
 * arrow keys; every settle writes the value, and Done closes. An empty field
 * opens on the next whole hour but writes nothing until it is touched or Done
 * is pressed.
 */
export function TimePicker({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  "aria-label": ariaLabel,
  disablePortal = false,
}: TimePickerProps) {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const parsed = parseHm(value)
  const [draft, setDraft] = React.useState<WheelTime>(
    () => parsed ?? defaultWheelTime(new Date()),
  )

  // Re-seed the wheels each time the popover opens.
  React.useEffect(() => {
    if (open) setDraft(parseHm(value) ?? defaultWheelTime(new Date()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const update = (patch: Partial<WheelTime>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    onChange(formatHm(next))
  }

  const locale = intlDateTag(getActiveLocale())
  const display = parsed ? formatTime(parsed, locale) : ""
  const periodLabels = React.useMemo(() => dayPeriodLabels(locale), [locale])
  const minutes = minuteOptions(draft.minute)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        data-empty={parsed ? undefined : true}
        className={cn(
          "relative flex h-9 w-full items-center rounded-md border border-input bg-transparent text-sm shadow-sm data-[empty=true]:text-muted-foreground",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-3 text-start focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none"
          >
            <Clock className="size-4 shrink-0 opacity-70" />
            <span className="truncate">{display || placeholder || ariaLabel}</span>
          </button>
        </PopoverTrigger>
        {parsed && !disabled ? (
          <button
            type="button"
            aria-label={t("common.clear")}
            onClick={() => onChange("")}
            className="me-2 inline-flex size-4 shrink-0 items-center justify-center rounded-sm opacity-60 hover:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      <PopoverContent className="w-auto p-3" align="start" disablePortal={disablePortal}>
        {/* Always hour-minute-period left to right, as on a clock, even in
            Arabic. */}
        <div dir="ltr" className="relative flex gap-1">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 rounded-md bg-slate-100"
            style={{ top: PAD, height: ITEM_H }}
          />
          <Wheel
            items={HOURS}
            value={draft.hour}
            onChange={(hour) => update({ hour })}
            render={(h) => String(h)}
            label={t("activity.time.hour")}
          />
          <Wheel
            items={minutes}
            value={draft.minute}
            onChange={(minute) => update({ minute })}
            render={(m) => String(m).padStart(2, "0")}
            label={t("activity.time.minute")}
          />
          <Wheel
            items={PERIODS}
            value={draft.period}
            onChange={(period: Period) => update({ period })}
            render={(p) => periodLabels[p]}
            label={t("activity.time.period")}
          />
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => {
              onChange(formatHm(draft))
              setOpen(false)
            }}
            className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700"
          >
            {t("common.done")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** One scrolling column. Scroll-snap does the physics; a short debounce after
 *  the last scroll event reads which row settled in the middle band. */
function Wheel<T extends string | number>({
  items,
  value,
  onChange,
  render,
  label,
}: {
  items: T[]
  value: T
  onChange: (next: T) => void
  render: (item: T) => string
  label: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const settle = React.useRef<number | undefined>(undefined)
  const index = Math.max(0, items.indexOf(value))
  // Which row is in the band right now, mid-scroll, for the fade.
  const [live, setLive] = React.useState(index)

  // Put the selected row in the band on open and when the value changes from
  // outside (never while the user's own scroll is still settling).
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el || settle.current !== undefined) return
    el.scrollTop = index * ITEM_H
    setLive(index)
  }, [index])

  React.useEffect(() => () => window.clearTimeout(settle.current), [])

  const at = (top: number) =>
    Math.min(items.length - 1, Math.max(0, Math.round(top / ITEM_H)))

  const onScroll = () => {
    const el = ref.current
    if (!el) return
    setLive(at(el.scrollTop))
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => {
      settle.current = undefined
      const next = items[at(el.scrollTop)]
      if (next !== value) onChange(next)
    }, 120)
  }

  const go = (i: number) =>
    ref.current?.scrollTo({ top: i * ITEM_H, behavior: "smooth" })

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault()
          go(Math.min(items.length - 1, Math.max(0, live + (e.key === "ArrowDown" ? 1 : -1))))
        }
      }}
      className="relative w-14 snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ height: VISIBLE * ITEM_H, paddingBlock: PAD }}
    >
      {items.map((item, i) => {
        const distance = Math.abs(i - live)
        return (
          <div
            key={item}
            role="option"
            aria-selected={item === value}
            onClick={() => go(i)}
            className={cn(
              "flex cursor-pointer snap-center items-center justify-center text-base tabular-nums transition-opacity select-none",
              distance === 0 ? "font-semibold text-foreground" : "text-slate-500",
            )}
            style={{ height: ITEM_H, opacity: distance === 0 ? 1 : distance === 1 ? 0.6 : 0.3 }}
          >
            {render(item)}
          </div>
        )
      })}
    </div>
  )
}

function formatTime(time: WheelTime, locale: string): string {
  const [h, m] = formatHm(time).split(":").map(Number)
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(2000, 0, 1, h, m))
}

/** "AM"/"PM" in the active language (ص/م in Arabic), from Intl. */
function dayPeriodLabels(locale: string): Record<Period, string> {
  const label = (h: number) =>
    new Intl.DateTimeFormat(locale, { hour: "numeric", hour12: true })
      .formatToParts(new Date(2000, 0, 1, h))
      .find((p) => p.type === "dayPeriod")?.value ?? (h < 12 ? "AM" : "PM")
  return { am: label(9), pm: label(21) }
}
