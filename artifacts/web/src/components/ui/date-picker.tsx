import * as React from "react"
import { CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { getActiveLocale } from "@/lib/i18n/active-locale"
import { intlDateTag } from "@/lib/i18n/formatting"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover"
import {
  formatDmy,
  formatYmd,
  isOutOfBounds,
  maskDmyInput,
  parseDmy,
  parseYmd,
  ymdToDmy,
} from "@/components/ui/date-utils"
import { useI18n } from "@/lib/i18n/i18n"
import { getWeekStart } from "@/lib/format";

export interface DatePickerProps {
  /** `yyyy-mm-dd`, or `""` for empty. Drop-in for `<input type="date">`. */
  value: string
  /** Emits the new `yyyy-mm-dd` string, or `""` when cleared. */
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
  /** Inclusive lower bound, `yyyy-mm-dd`. Days before it can't be selected. */
  min?: string
  /** Inclusive upper bound, `yyyy-mm-dd`. Days after it can't be selected. */
  max?: string
  /** Show a clear affordance that emits `""`. Defaults to true. */
  clearable?: boolean
  id?: string
  className?: string
  /**
   * Render the calendar inline instead of portalling it to `document.body`. Set
   * this when the field lives inside a modal Radix `Dialog` so the popover stays
   * inside the dialog's scroll-allowlist (forwarded to `PopoverContent`).
   */
  disablePortal?: boolean
}

/**
 * A date field you can either type (day-first `dd/mm/yyyy`) or pick from a
 * calendar. The calendar always portals to `document.body` so it is never
 * clipped by an `overflow` ancestor (e.g. a scrollable dialog body) — Radix's
 * collision handling keeps it on-screen instead.
 */
const DatePicker = React.forwardRef<HTMLInputElement, DatePickerProps>(
  (
    {
      value,
      onChange,
      placeholder = "dd/mm/yyyy",
      disabled,
      min,
      max,
      clearable = true,
      id,
      className,
      disablePortal = false,
    },
    ref,
  ) => {
    const { t } = useI18n();
    const [open, setOpen] = React.useState(false)
    const [text, setText] = React.useState(() => ymdToDmy(value))
    const [focused, setFocused] = React.useState(false)

    const selected = parseYmd(value)

    // Selectable year range for the month/year grid picker: now −5 … +10,
    // widened so any min/max bound is always reachable. Lets users jump straight
    // to a month/year instead of paging one month at a time.
    const thisYear = new Date().getFullYear()
    const startYear = Math.min(thisYear - 5, parseYmd(min)?.getFullYear() ?? thisYear)
    const endYear = Math.max(thisYear + 10, parseYmd(max)?.getFullYear() ?? thisYear)

    // Mirror external value changes into the field — but not while the user is
    // mid-edit, so we never fight their caret. Our own commits normalize below.
    React.useEffect(() => {
      if (!focused) setText(ymdToDmy(value))
    }, [value, focused])

    // Resolve typed text to a real, in-bounds date, or null.
    const resolve = (raw: string): { ymd: string; date: Date } | null => {
      const ymd = parseDmy(raw)
      if (!ymd) return null
      const date = parseYmd(ymd)
      if (!date || isOutOfBounds(date, min, max)) return null
      return { ymd, date }
    }

    const handleType = (raw: string, deleting: boolean) => {
      // Mask to `dd/mm/yyyy` as they type: digits only, `/` auto-inserted. When
      // deleting, drop a trailing auto-`/` so backspace can cross a separator
      // instead of the mask instantly re-adding it.
      let masked = maskDmyInput(raw)
      if (deleting && masked.endsWith("/")) masked = masked.slice(0, -1)
      setText(masked)
      if (masked === "") {
        if (clearable && value !== "") onChange("")
        return
      }
      // Only a complete, real, in-bounds date commits; a partial mask stays in
      // the field without disturbing the value.
      const resolved = resolve(masked)
      if (resolved) onChange(resolved.ymd)
    }

    // On blur/Enter: normalize a valid entry to canonical `dd/mm/yyyy`, or snap
    // back to the last committed value so the field never shows garbage.
    const commit = (raw: string) => {
      const trimmed = raw.trim()
      if (trimmed === "") {
        if (clearable) onChange("")
        setText("")
        return
      }
      const resolved = resolve(trimmed)
      if (resolved) {
        onChange(resolved.ymd)
        setText(formatDmy(resolved.date))
      } else {
        setText(ymdToDmy(value))
      }
    }

    const handleSelect = (date: Date | undefined) => {
      if (!date) return
      onChange(formatYmd(date))
      setText(formatDmy(date))
      setOpen(false)
    }

    const handleClear = (event: React.MouseEvent) => {
      // Don't let the clear button toggle the popover.
      event.stopPropagation()
      event.preventDefault()
      onChange("")
      setText("")
    }

    const showClear = clearable && !disabled && text !== ""

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div
            data-empty={selected ? undefined : true}
            className={cn(
              // One field chrome: hairline input border, a rung darker on hover, the ring on focus.
              "flex h-control-lg w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-body-quiet text-foreground transition-colors hover:border-input-border-hover focus-within:outline-none focus-within:border-ring focus-within:ring-input-focus data-[empty=true]:text-muted-foreground",
              disabled && "cursor-not-allowed opacity-50",
              className,
            )}
          >
            <button
              type="button"
              aria-label={t("common.openCalendar")}
              tabIndex={-1}
              disabled={disabled}
              onClick={() => setOpen((prev) => !prev)}
              className="inline-flex size-4 shrink-0 items-center justify-center opacity-70 hover:opacity-100 disabled:pointer-events-none"
            >
              <CalendarIcon className="size-4" />
            </button>
            <input
              ref={ref}
              id={id}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={10}
              disabled={disabled}
              value={text}
              placeholder={placeholder}
              onChange={(event) => {
                const inputType = (event.nativeEvent as InputEvent).inputType
                const deleting =
                  typeof inputType === "string" && inputType.startsWith("delete")
                handleType(event.target.value, deleting)
              }}
              onFocus={() => setFocused(true)}
              onBlur={(event) => {
                setFocused(false)
                commit(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commit(event.currentTarget.value)
                  setOpen(false)
                } else if (event.key === "Escape" && open) {
                  event.preventDefault()
                  setOpen(false)
                }
              }}
              className="min-w-0 flex-1 bg-transparent p-0 text-start text-inherit [font:inherit] placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
            />
            {showClear ? (
              <button
                type="button"
                aria-label={t("common.clearDate")}
                tabIndex={-1}
                onClick={handleClear}
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm opacity-60 hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </PopoverAnchor>
        <PopoverContent className="w-auto p-0" align="start" disablePortal={disablePortal}>
          <CalendarPicker
            selected={selected}
            onSelect={handleSelect}
            min={min}
            max={max}
            startYear={startYear}
            endYear={endYear}
          />
        </PopoverContent>
      </Popover>
    )
  },
)
DatePicker.displayName = "DatePicker"

/** The twelve month names in the active language, from Intl rather than a
 *  table, so the picker reads in Arabic without a second table to keep in
 *  step. Gregorian, like every other date in the app. */
function monthNames(style: "short" | "long"): string[] {
  const format = new Intl.DateTimeFormat(intlDateTag(getActiveLocale()), {
    month: style,
    timeZone: "UTC",
  })
  return Array.from({ length: 12 }, (_, m) =>
    format.format(new Date(Date.UTC(2024, m, 1))),
  )
}
const YEARS_PER_PAGE = 12

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

interface CalendarPickerProps {
  selected: Date | undefined
  onSelect: (date: Date | undefined) => void
  min?: string
  max?: string
  startYear: number
  endYear: number
}

/**
 * Calendar with a grid-based month/year picker. Clicking the month or year in
 * the header swaps the day grid for a tappable 3-column grid of months or years
 * (paged with the ‹ › arrows), so a user can jump straight to e.g. Nov 2028
 * instead of stepping one month at a time. The day view reuses the shared
 * `Calendar` (its own caption/nav hidden — this header drives navigation).
 */
function CalendarPicker({
  selected,
  onSelect,
  min,
  max,
  startYear,
  endYear,
}: CalendarPickerProps) {
  const { t } = useI18n();
  const MONTHS_SHORT = monthNames("short")
  const MONTHS_LONG = monthNames("long")
  const minDate = parseYmd(min)
  const maxDate = parseYmd(max)

  const initialYear = clamp(
    (selected ?? new Date()).getFullYear(),
    startYear,
    endYear,
  )
  const initialMonth = selected ?? new Date(initialYear, new Date().getMonth(), 1)

  const [view, setView] = React.useState<"day" | "month" | "year">("day")
  const [month, setMonth] = React.useState<Date>(initialMonth)

  const alignYearStart = (year: number) =>
    startYear +
    Math.floor((clamp(year, startYear, endYear) - startYear) / YEARS_PER_PAGE) *
      YEARS_PER_PAGE
  const [yearStart, setYearStart] = React.useState<number>(() =>
    alignYearStart(initialMonth.getFullYear()),
  )

  const displayYear = month.getFullYear()
  const displayMonth = month.getMonth()

  // Keep the displayed month inside the selectable range.
  const setMonthClamped = (year: number, monthIndex: number) =>
    setMonth(new Date(clamp(year, startYear, endYear), monthIndex, 1))

  const goPrev = () => {
    if (view === "day") setMonthClamped(displayYear, displayMonth - 1)
    else if (view === "month") setMonthClamped(displayYear - 1, displayMonth)
    else setYearStart((s) => Math.max(startYear, s - YEARS_PER_PAGE))
  }
  const goNext = () => {
    if (view === "day") setMonthClamped(displayYear, displayMonth + 1)
    else if (view === "month") setMonthClamped(displayYear + 1, displayMonth)
    else setYearStart((s) => (s + YEARS_PER_PAGE <= endYear ? s + YEARS_PER_PAGE : s))
  }

  const monthOutOfRange = (year: number, monthIndex: number) => {
    const first = new Date(year, monthIndex, 1)
    const last = new Date(year, monthIndex + 1, 0)
    return (!!maxDate && first > maxDate) || (!!minDate && last < minDate)
  }
  const yearOutOfRange = (year: number) =>
    (!!minDate && year < minDate.getFullYear()) ||
    (!!maxDate && year > maxDate.getFullYear())

  const prevDisabled =
    view === "day"
      ? displayYear === startYear && displayMonth === 0
      : view === "month"
        ? displayYear <= startYear
        : yearStart <= startYear
  const nextDisabled =
    view === "day"
      ? displayYear === endYear && displayMonth === 11
      : view === "month"
        ? displayYear >= endYear
        : yearStart + YEARS_PER_PAGE > endYear

  const cellBase =
    "rounded-md py-2 text-body font-normal transition-colors hover:bg-btn-ghost-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
  const cellSelected =
    "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"

  const navButton =
    "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-btn-ghost-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"

  return (
    <div className="w-[19rem] p-3">
      <div className="mb-2 flex items-center justify-between gap-1">
        <button
          type="button"
          aria-label={t("common.previous")}
          onClick={goPrev}
          disabled={prevDisabled}
          className={navButton}
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="flex items-center gap-1 text-body font-medium">
          {view === "day" && (
            <button
              type="button"
              onClick={() => setView("month")}
              className="rounded-md px-2 py-1 hover:bg-btn-ghost-surface-hover"
            >
              {MONTHS_LONG[displayMonth]}
            </button>
          )}
          {view !== "year" && (
            <button
              type="button"
              onClick={() => {
                setYearStart(alignYearStart(displayYear))
                setView("year")
              }}
              className="rounded-md px-2 py-1 hover:bg-btn-ghost-surface-hover"
            >
              {displayYear}
            </button>
          )}
          {view === "year" && (
            <span className="px-2 py-1">
              {yearStart}&ndash;{Math.min(yearStart + YEARS_PER_PAGE - 1, endYear)}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label={t("common.next")}
          onClick={goNext}
          disabled={nextDisabled}
          className={navButton}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {view === "day" && (
        <Calendar
          mode="single"
          weekStartsOn={getWeekStart()}
          selected={selected}
          onSelect={onSelect}
          month={month}
          onMonthChange={setMonth}
          startMonth={new Date(startYear, 0)}
          endMonth={new Date(endYear, 11)}
          autoFocus
          // Strip the Calendar's own card: the popover is the only card, and this
          // header + wrapper own the padding (avoids a card-in-a-card look).
          className="bg-transparent p-0 shadow-none"
          classNames={{ month_caption: "hidden", nav: "hidden" }}
          disabled={
            min || max ? (date: Date) => isOutOfBounds(date, min, max) : undefined
          }
        />
      )}

      {view === "month" && (
        <div className="grid grid-cols-3 gap-1">
          {MONTHS_SHORT.map((label, m) => {
            const isSelected =
              !!selected &&
              selected.getFullYear() === displayYear &&
              selected.getMonth() === m
            return (
              <button
                key={label}
                type="button"
                disabled={monthOutOfRange(displayYear, m)}
                onClick={() => {
                  setMonth(new Date(displayYear, m, 1))
                  setView("day")
                }}
                className={cn(cellBase, isSelected && cellSelected)}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {view === "year" && (
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearStart + i)
            .filter((year) => year <= endYear)
            .map((year) => {
              const isSelected = !!selected && selected.getFullYear() === year
              return (
                <button
                  key={year}
                  type="button"
                  disabled={yearOutOfRange(year)}
                  onClick={() => {
                    setMonth(new Date(year, displayMonth, 1))
                    setView("day")
                  }}
                  className={cn(cellBase, isSelected && cellSelected)}
                >
                  {year}
                </button>
              )
            })}
        </div>
      )}
    </div>
  )
}

export { DatePicker }
