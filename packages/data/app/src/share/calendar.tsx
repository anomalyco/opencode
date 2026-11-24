import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js"

const day = 86_400_000
const weekdays = ["M", "T", "W", "T", "F", "S", "S"]

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
    <div ref={element} data-component="share-calendar" role="dialog" aria-label="Choose a date">
      <div data-slot="calendar-head">
        <button
          type="button"
          aria-label="Previous month"
          disabled={month() <= monthOf(first())}
          onClick={() => step(-1)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
        <span aria-live="polite">
          {new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(month())}
        </span>
        <button type="button" aria-label="Next month" disabled={month() >= monthOf(last())} onClick={() => step(1)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
      </div>
      <div data-slot="calendar-grid" role="grid">
        <For each={weekdays}>{(name) => <span data-slot="weekday">{name}</span>}</For>
        <For each={cells()}>
          {(cell) => (
            <button
              type="button"
              data-slot="calendar-day"
              data-outside={cell.outside ? "" : undefined}
              data-range={cell.column >= 0 ? "" : undefined}
              aria-pressed={selected(cell.date)}
              aria-label={label(cell.date)}
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
        <span>Whole range</span>
        <small>{shareRangeLabel(props.starts, props.weekly)}</small>
      </button>
    </div>
  )
}

/** The chart's whole range as its button shows it, as in Sep 30 – Nov 23. */
export function shareRangeLabel(starts: string[], weekly: boolean) {
  const end = time(starts.at(-1) ?? "") + (weekly ? 6 * day : 0)
  return `${short(time(starts[0] ?? ""))} – ${short(end)}`
}

/** One column's date as its button shows it, with its year: a day with its month written out (November 23, 2026), a
 * week with it short, to fit the same button (Week of Nov 17, 2026). */
export function shareDayLabel(start: string, weekly: boolean) {
  const date = new Intl.DateTimeFormat("en", {
    month: weekly ? "short" : "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(time(start))
  return weekly ? `Week of ${date}` : date
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

function short(date: number) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(date)
}

function label(date: number) {
  return new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(date)
}
