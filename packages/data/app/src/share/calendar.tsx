import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js"
import { useI18n } from "../context/i18n"
import { useLanguage } from "../context/language"
import { translate } from "../i18n"
import { tag, type Locale } from "../lib/language"

const day = 86_400_000

/**
 * The editor's date picker: a month of days over the chart's columns, opening above its button. A day the chart has
 * picks that day (on a weekly chart, its week); Whole range goes back to every column. Only days the chart covers
 * can be chosen.
 */
export function ShareCalendar(props: {
  starts: string[]
  weekly: boolean
  day: number | undefined
  onPick: (day: number | undefined) => void
  onClose: () => void
}) {
  const i18n = useI18n()
  const language = useLanguage()
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(tag(language.locale()), { ...options, timeZone: "UTC" })
  // Monday first, as the data's weeks start; January 5, 2026 was a Monday.
  const weekdays = () =>
    Array.from({ length: 7 }, (_, index) => format({ weekday: "narrow" }).format(Date.UTC(2026, 0, 5 + index)))
  let element: HTMLDivElement | undefined
  const first = () => time(props.starts[0] ?? "")
  const last = () => time(props.starts.at(-1) ?? "") + (props.weekly ? 6 * day : 0)
  const shown = () => time(props.starts[props.day ?? props.starts.length - 1] ?? "")
  const [month, setMonth] = createSignal(monthOf(shown()))
  const column = (date: number) =>
    props.starts.findIndex((start) => {
      const from = time(start)
      return date >= from && date < from + (props.weekly ? 7 : 1) * day
    })
  // Monday-first weeks covering the month.
  const cells = createMemo(() => {
    const start = month()
    const offset = (new Date(start).getUTCDay() + 6) % 7
    const length = new Date(Date.UTC(year(start), monthIndex(start) + 1, 0)).getUTCDate()
    return Array.from({ length: Math.ceil((offset + length) / 7) * 7 }, (_, index) => {
      const date = start + (index - offset) * day
      return { date, outside: index < offset || index >= offset + length, column: column(date) }
    })
  })
  const selected = (date: number) => props.day !== undefined && column(date) === props.day
  const step = (direction: 1 | -1) => setMonth(Date.UTC(year(month()), monthIndex(month()) + direction, 1))

  // A press anywhere else closes it; Escape is the dialog's (share.tsx).
  onMount(() => {
    const away = (event: PointerEvent) => {
      if (
        element &&
        !element.contains(event.target as Node) &&
        !(event.target as Element).closest("[data-slot=date-tool]")
      )
        props.onClose()
    }
    document.addEventListener("pointerdown", away, true)
    onCleanup(() => document.removeEventListener("pointerdown", away, true))
  })

  return (
    <div ref={element} data-component="share-calendar" role="dialog" aria-label={i18n.t("share.calendar.label")}>
      <div data-slot="calendar-head">
        <button
          type="button"
          aria-label={i18n.t("share.calendar.previous")}
          disabled={month() <= monthOf(first())}
          onClick={() => step(-1)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" data-mirror>
            <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
        <span aria-live="polite">{format({ month: "long", year: "numeric" }).format(month())}</span>
        <button
          type="button"
          aria-label={i18n.t("share.calendar.next")}
          disabled={month() >= monthOf(last())}
          onClick={() => step(1)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" data-mirror>
            <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
      </div>
      <div data-slot="calendar-grid" role="grid">
        <For each={weekdays()}>{(name) => <span data-slot="weekday">{name}</span>}</For>
        <For each={cells()}>
          {(cell) => (
            <button
              type="button"
              data-slot="calendar-day"
              data-outside={cell.outside ? "" : undefined}
              data-range={cell.column >= 0 ? "" : undefined}
              aria-pressed={selected(cell.date)}
              aria-label={format({ weekday: "long", month: "long", day: "numeric" }).format(cell.date)}
              disabled={cell.column < 0}
              onClick={() => {
                props.onPick(cell.column)
                props.onClose()
              }}
            >
              {new Date(cell.date).getUTCDate()}
            </button>
          )}
        </For>
      </div>
      <button
        type="button"
        data-slot="calendar-range"
        aria-pressed={props.day === undefined}
        onClick={() => {
          props.onPick(undefined)
          props.onClose()
        }}
      >
        <span>{i18n.t("share.calendar.wholeRange")}</span>
        <small>{shareRangeLabel(language.locale(), props.starts, props.weekly)}</small>
      </button>
    </div>
  )
}

/** The chart's whole range as its button shows it, as in Sep 30 – Nov 23. */
export function shareRangeLabel(locale: Locale, starts: string[], weekly: boolean) {
  const end = time(starts.at(-1) ?? "") + (weekly ? 6 * day : 0)
  return new Intl.DateTimeFormat(tag(locale), { month: "short", day: "numeric", timeZone: "UTC" }).formatRange(
    time(starts[0] ?? ""),
    end,
  )
}

/** One column's date as its button shows it, with its year: a day with its month written out (November 23, 2026), a
 * week with it short, to fit the same button (Week of Nov 17, 2026). */
export function shareDayLabel(locale: Locale, start: string, weekly: boolean) {
  const date = new Intl.DateTimeFormat(tag(locale), {
    month: weekly ? "short" : "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(time(start))
  return weekly ? translate(locale, "share.range.weekOf", { date }) : date
}

function time(date: string) {
  return Date.parse(`${date}T00:00:00Z`)
}

function monthOf(date: number) {
  return Date.UTC(year(date), monthIndex(date), 1)
}

function year(date: number) {
  return new Date(date).getUTCFullYear()
}

function monthIndex(date: number) {
  return new Date(date).getUTCMonth()
}
