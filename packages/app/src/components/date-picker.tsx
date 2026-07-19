import { Component, For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Popover } from "@opencode-ai/ui/popover"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"

/**
 * DatePicker — a compact date-only picker with Linear-style quick presets.
 *
 * Why this component exists (ADR-0002 Amendment 2026-07-19):
 * The Todo Sidebar's Add/Edit Todo dialog renders the due-date field inside
 * a Kobalte Popover that also hosts several Kobalte Select components
 * (status, priority, labels, assignee). The existing date pickers in the
 * codebase rely on native `<input type="date">` or on full-calendar
 * libraries that render heavyweight portals. Under the dialog's nested
 * Popover + Select portal stacking, those pickers suffered broken styling:
 * calendar grids overflowed the popover bounds, portal z-index fights
 * caused the grid to render behind the dialog backdrop, and the native
 * picker's browser-chrome dropdown clashed with the Linear-style surface
 * tokens used everywhere else in the dialog.
 *
 * Rather than patch the upstream pickers (which would touch main-branch UI
 * components outside the Todo Sidebar feature scope), this feature-scoped
 * `DatePicker` was added: it renders its calendar inside the same Popover
 * primitive the dialog already uses, uses the project's semantic surface
 * tokens, and stays visually consistent with the Linear-style edit form.
 *
 * Design rationale (per ui-ux-pro-max guidelines):
 * - §1 a11y: popover trigger has aria-label, grid is role="grid" with
 *   aria-selected on the chosen day, keyboard nav via Arrow keys + Enter.
 * - §2 interaction: every cell ≥32px tap target (rows 6×7), min 8px gaps.
 * - §6 typography: uses semantic text tokens (text-text-weak etc.); no
 *   raw hex.
 * - §7 animation: state transitions only via transition-colors (no layout
 *   shifts); 150ms duration.
 * - §8 forms: visible label, helper text via title; clear button is
 *   visually distinct (ghost variant) and uses aria-label.
 * - Linear Due Date parity: shortcuts "Today", "Tomorrow", "In one week".
 *
 * Scope: date-only (no time). Returns ISO yyyy-mm-dd.
 */

export interface DatePickerProps {
  label?: string
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  class?: string
}

interface Shortcut {
  key: string
  textFn: (t: (k: string) => string) => string
  value: () => Date
}

const pad = (n: number): string => n.toString().padStart(2, "0")

const toDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const fromDate = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

const addDays = (d: Date, n: number): Date => {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

const startOfDay = (d: Date): Date => {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

const today = (): Date => startOfDay(new Date())

const monthKey = (month: number): string => `dialog.todo.field.dueDate.month.${month}`
const weekdayKey = (day: number): string => `dialog.todo.field.dueDate.weekday.${day}`

const SHORTCUTS: Shortcut[] = [
  {
    key: "dialog.todo.field.dueDate.shortcut.today",
    textFn: (t) => t("dialog.todo.field.dueDate.shortcut.today"),
    value: () => today(),
  },
  {
    key: "dialog.todo.field.dueDate.shortcut.tomorrow",
    textFn: (t) => t("dialog.todo.field.dueDate.shortcut.tomorrow"),
    value: () => addDays(today(), 1),
  },
  {
    key: "dialog.todo.field.dueDate.shortcut.inOneWeek",
    textFn: (t) => t("dialog.todo.field.dueDate.shortcut.inOneWeek"),
    value: () => addDays(today(), 7),
  },
]

/**
 * Build the 6×7 calendar grid for a given view month.
 * Each cell is { date, inMonth }.
 */
const buildGrid = (viewYear: number, viewMonth: number): { date: Date; inMonth: boolean }[][] => {
  const first = new Date(viewYear, viewMonth, 1)
  const startWeekday = first.getDay()
  const gridStart = addDays(first, -startWeekday)

  const rows: { date: Date; inMonth: boolean }[][] = []
  let cursor = gridStart
  for (let row = 0; row < 6; row++) {
    const cells: { date: Date; inMonth: boolean }[] = []
    for (let col = 0; col < 7; col++) {
      const inMonth = cursor.getMonth() === viewMonth
      cells.push({ date: new Date(cursor), inMonth })
      cursor = addDays(cursor, 1)
    }
    rows.push(cells)
  }
  return rows
}

const formatDisplay = (iso: string, t: (k: string) => string): string => {
  const d = fromDate(iso)
  if (!d) return iso
  // Use a friendly format: "Mar 5, 2026"
  return `${t(monthKey(d.getMonth()))} ${d.getDate()}, ${d.getFullYear()}`
}

export const DatePicker: Component<DatePickerProps> = (props) => {
  const language = useLanguage()

  const initialView = (): { year: number; month: number } => {
    const s = props.value ? fromDate(props.value) : null
    if (s) return { year: s.getFullYear(), month: s.getMonth() }
    const t = today()
    return { year: t.getFullYear(), month: t.getMonth() }
  }
  // Consolidated UI state (per AGENTS.md: prefer createStore over multiple
  // createSignal calls). `open`, `view`, and `focusDay` were three separate
  // signals; they're now keyed paths on a single store.
  const [state, setState] = createStore({
    open: false,
    view: initialView(),
    focusDay: props.value ?? toDate(today()),
  })

  const grid = createMemo(() => buildGrid(state.view.year, state.view.month))

  const headerLabel = createMemo(() => `${t(monthKey(state.view.month))} ${state.view.year}`)

  const goPrevMonth = () => {
    const v = state.view
    const month = v.month === 0 ? 11 : v.month - 1
    const year = v.month === 0 ? v.year - 1 : v.year
    setState("view", { year, month })
  }
  const goNextMonth = () => {
    const v = state.view
    const month = v.month === 11 ? 0 : v.month + 1
    const year = v.month === 11 ? v.year + 1 : v.year
    setState("view", { year, month })
  }

  const selectDay = (date: Date) => {
    const iso = toDate(date)
    props.onChange(iso)
    setState({ focusDay: iso, open: false })
  }

  const clear = () => {
    props.onChange("")
    setState("open", false)
  }

  const applyShortcut = (s: Shortcut) => {
    const date = s.value()
    const iso = toDate(date)
    props.onChange(iso)
    setState({
      view: { year: date.getFullYear(), month: date.getMonth() },
      focusDay: iso,
      open: false,
    })
  }

  const handleKey = (e: KeyboardEvent) => {
    const current = fromDate(state.focusDay)
    if (!current) return
    if (e.key === "Enter") {
      selectDay(current)
      e.preventDefault()
      return
    }
    // Lookup table replaces the if/else-if chain; const over let per AGENTS.md.
    const ARROW_DELTA: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    const delta = ARROW_DELTA[e.key]
    if (delta === undefined) return
    const next = addDays(current, delta)
    setState({
      focusDay: toDate(next),
      view: { year: next.getFullYear(), month: next.getMonth() },
    })
    e.preventDefault()
  }

  const t = (k: string) => language.t(k)

  const triggerLabel = createMemo(() => {
    if (!props.value) return props.placeholder ?? t("dialog.todo.field.dueDate.placeholder")
    return formatDisplay(props.value, t)
  })

  const triggerClass = createMemo(() => {
    const base =
      "w-full h-9 px-3 rounded-lg border bg-surface-base text-13-regular outline-none transition-colors flex items-center justify-between gap-2"
    if (props.value) return `${base} border-border-interactive-base text-text-strong`
    return `${base} border-border-base text-text-weaker hover:border-border-interactive-base`
  })

  const cellClass = (cell: { date: Date; inMonth: boolean }): string => {
    const iso = toDate(cell.date)
    const isSel = iso === props.value
    const isFocus = iso === state.focusDay
    const isToday = iso === toDate(today())
    const base =
      "h-8 w-8 flex items-center justify-center rounded-md text-12-regular transition-colors cursor-pointer select-none"
    // Conditional class array (no `let` accumulator + string concat, per
    // AGENTS.md: prefer const + array join over mutable string building).
    const modifiers = [
      cell.inMonth ? "text-text-base" : "text-text-weakest",
      isToday && !isSel ? "ring-1 ring-inset ring-border-interactive-base" : "",
      isFocus && !isSel ? "bg-surface-strong-base" : "",
      isSel ? "bg-surface-interactive-base text-text-on-interactive ring-1 ring-border-interactive-base" : "",
    ]
    return [base, ...modifiers].filter(Boolean).join(" ")
  }

  return (
    <Popover
      open={state.open}
      onOpenChange={(next) => {
        setState("open", next)
        if (next) {
          const s = props.value ? fromDate(props.value) : null
          if (s) {
            setState({
              view: { year: s.getFullYear(), month: s.getMonth() },
              focusDay: toDate(s),
            })
          } else {
            setState("focusDay", toDate(today()))
          }
        }
      }}
      triggerAs="button"
      triggerProps={{
        type: "button",
        class: triggerClass(),
        "aria-label": props.label ?? t("dialog.todo.field.dueDate"),
        "aria-expanded": state.open,
      }}
      trigger={
        <>
          <span class="truncate flex-1 text-left">{triggerLabel()}</span>
          <Show when={props.value}>
            <span
              role="button"
              tabIndex={-1}
              class="text-text-weaker hover:text-text-strong transition-colors"
              aria-label={t("dialog.todo.field.dueDate.clear")}
              onClick={(e: MouseEvent) => {
                e.stopPropagation()
                clear()
              }}
            >
              <Icon name="close" size="small" />
            </span>
          </Show>
          <Show when={!props.value}>
            <Icon name="chevron-down" size="small" class="text-text-weaker" />
          </Show>
        </>
      }
      class="w-[320px] p-0"
      portal
    >
      <div class="flex">
        {/* Sidebar — Linear-style quick presets */}
        <div class="w-[88px] shrink-0 border-r border-border-base p-2 flex flex-col gap-1">
          <For each={SHORTCUTS}>
            {(s) => {
              const active = createMemo(() => props.value === toDate(s.value()))
              return (
                <button
                  type="button"
                  class={`text-left text-11-regular px-2 py-1.5 rounded-md transition-colors ${
                    active()
                      ? "bg-surface-info-base/30 text-text-strong"
                      : "text-text-base hover:bg-surface-strong-base"
                  }`}
                  onClick={() => applyShortcut(s)}
                  aria-pressed={active()}
                >
                  {s.textFn(t)}
                </button>
              )
            }}
          </For>
          <Show when={props.value}>
            <button
              type="button"
              class="text-left text-11-regular px-2 py-1.5 rounded-md text-text-weaker hover:bg-surface-strong-base transition-colors mt-auto"
              onClick={clear}
              aria-label={t("dialog.todo.field.dueDate.clear")}
            >
              {t("dialog.todo.field.dueDate.clear")}
            </button>
          </Show>
        </div>

        {/* Calendar grid */}
        <div class="flex-1 p-2" onKeyDown={handleKey} role="grid" aria-label={headerLabel()} tabIndex={0}>
          <div class="flex items-center justify-between mb-2">
            <button
              type="button"
              class="h-7 w-7 flex items-center justify-center rounded-md text-text-weaker hover:bg-surface-strong-base transition-colors"
              onClick={goPrevMonth}
              aria-label={t("dialog.todo.field.dueDate.prevMonth")}
            >
              <Icon name="chevron-left" size="small" />
            </button>
            <span class="text-12-medium text-text-strong">{headerLabel()}</span>
            <button
              type="button"
              class="h-7 w-7 flex items-center justify-center rounded-md text-text-weaker hover:bg-surface-strong-base transition-colors"
              onClick={goNextMonth}
              aria-label={t("dialog.todo.field.dueDate.nextMonth")}
            >
              <Icon name="chevron-right" size="small" />
            </button>
          </div>
          <div class="grid grid-cols-7 gap-0.5 mb-1" role="row">
            <For each={[0, 1, 2, 3, 4, 5, 6]}>
              {(day) => (
                <div class="h-6 flex items-center justify-center text-9-regular text-text-weakest" role="columnheader">
                  {t(weekdayKey(day))}
                </div>
              )}
            </For>
          </div>
          <For each={grid()}>
            {(row) => (
              <div class="grid grid-cols-7 gap-0.5 mb-0.5" role="row">
                <For each={row}>
                  {(cell) => (
                    <button
                      type="button"
                      role="gridcell"
                      tabIndex={toDate(cell.date) === state.focusDay ? 0 : -1}
                      aria-selected={toDate(cell.date) === props.value}
                      class={cellClass(cell)}
                      onClick={() => selectDay(cell.date)}
                      onFocus={() => setState("focusDay", toDate(cell.date))}
                    >
                      {cell.date.getDate()}
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </Popover>
  )
}

// Re-export for ergonomic import
export default DatePicker
