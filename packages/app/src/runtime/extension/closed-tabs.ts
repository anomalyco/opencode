import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createEventListener } from "@solid-primitives/event-listener"
import type { Panel, PanelProps, SessionRef } from "@opencode/gui-extensions/sdk"
import { adjacentTabKey } from "@/shell/titlebar/tab-order"

/** The most closed tabs a session keeps. */
export const CLOSED_TABS_LIMIT = 30

/** A side tab the user closed, as the new tab view lists it and ⌘⇧T brings it back. */
export type ClosedSideTab = {
  /** `${extension}:${tab id}`. */
  readonly key: string
  readonly title: string
  /** An icon name; stored, so check it before drawing. */
  readonly icon?: string
  /** The workspace file the tab showed, if any. */
  readonly file?: string
  /** A muted detail after the title. */
  readonly detail?: string
  /** What the panel's `restore` needs. */
  readonly data?: string
  /** When it closed, in milliseconds since the epoch. */
  readonly closed: number
}

/** Where a session's closed tabs live, newest first. */
export type ClosedTabsStore = {
  list(session: SessionRef): readonly ClosedSideTab[]
  write(session: SessionRef, entries: readonly ClosedSideTab[]): void
}

/** Each session's closed side tabs, newest first, up to `CLOSED_TABS_LIMIT`. In memory unless given a store. */
export function createClosedTabs(store: ClosedTabsStore = memoryStore()) {
  return {
    /** Reactive. */
    list: store.list,
    push(session: SessionRef, entry: Omit<ClosedSideTab, "closed">) {
      store.write(
        session,
        [{ ...entry, closed: Date.now() }, ...store.list(session).filter((item) => item.key !== entry.key)].slice(
          0,
          CLOSED_TABS_LIMIT,
        ),
      )
    },
    /** Removes and returns the entry under `key`, or the newest one. */
    take(session: SessionRef, key?: string) {
      const entries = store.list(session)
      const entry = key === undefined ? entries[0] : entries.find((item) => item.key === key)

      if (entry)
        store.write(
          session,
          entries.filter((item) => item !== entry),
        )

      return entry
    },
  }
}

export type ClosedTabs = ReturnType<typeof createClosedTabs>

/** How a closing tab lists, or nothing when its panel says it cannot come back. Transient tabs list only when asked. */
export function closedEntry(key: string, panel: Panel, input: PanelProps): Omit<ClosedSideTab, "closed"> | undefined {
  const info = panel.closed?.(input)

  if (info === false) return

  if (!info && (panel.transient || input.tab.transient)) return

  return {
    key,
    title: info?.title ?? input.tab.title,
    icon: info?.icon ?? panel.mobile?.icon,
    file: input.tab.file,
    detail: info?.detail,
    data: info?.data,
  }
}

function memoryStore(): ClosedTabsStore {
  const [entries, setEntries] = createStore<Record<string, readonly ClosedSideTab[]>>({})

  return {
    list: (session) => entries[session.key] ?? [],
    write: (session, next) => setEntries(session.key, next),
  }
}

export type ClosedTabsModifier = "alt" | "shift" | "ctrl" | "meta"

/**
 * Dev builds only, while the design is evaluated: the held key that turns the side panel's "+" into a "Recently closed"
 * menu, from `localStorage["opencode.dev.closedTabsModifier"]`. Off unless set.
 */
export function closedTabsModifier(): ClosedTabsModifier | undefined {
  if (!import.meta.env.DEV) return
  const value = localStorage.getItem("opencode.dev.closedTabsModifier")

  return value === "alt" || value === "shift" || value === "ctrl" || value === "meta" ? value : undefined
}

/** Whether the swap waits for the pointer to rest on "+", or shows whenever the key is down. Hover unless the dev flag says "global". */
export function closedTabsSwap(): "hover" | "global" {
  return import.meta.env.DEV && localStorage.getItem("opencode.dev.closedTabsSwap") === "global" ? "global" : "hover"
}

/** Whether an input event carries the modifier. */
export function hasModifier(event: KeyboardEvent | MouseEvent, modifier: ClosedTabsModifier) {
  if (modifier === "shift") return event.shiftKey

  if (modifier === "ctrl") return event.ctrlKey

  if (modifier === "meta") return event.metaKey

  return event.altKey
}

/**
 * Whether the modifier is held, from every key and pointer event's modifier state rather than counting presses, so key
 * repeat, a press made while another window had focus, and a release made elsewhere all settle. Leaving the window
 * releases it, since its keyup goes to another window.
 */
export function createModifierHeld(modifier: ClosedTabsModifier) {
  const [held, setHeld] = createSignal(false)
  const update = (event: KeyboardEvent | MouseEvent) => setHeld(hasModifier(event, modifier))

  createEventListener(window, ["keydown", "keyup"], update, { capture: true })
  createEventListener(window, ["pointermove", "pointerdown"], update, { capture: true, passive: true })
  createEventListener(window, "blur", () => setHeld(false))
  createEventListener(document, "visibilitychange", () => document.hidden && setHeld(false))

  return held
}

/**
 * Whether a key event belongs to the side panel: its target is in it, or, when the target is the body because closing
 * the focused tab dropped focus, the user's last focus, click or key was. `focused` reads that last answer.
 */
export function createSideFocus() {
  const [last, setLast] = createSignal(false)
  createEventListener(document, ["focusin", "pointerdown", "keydown"], (event) => setLast(inSide(event, last())), {
    capture: true,
  })

  return Object.assign((event: Event) => inSide(event, last()), { focused: last })
}

/** As in a browser: inside the side panel, ⌘1–8 select that side tab, ⌘9 the last one, and ⇧⌘[ and ⇧⌘] the previous and next. */
export function sideTabShortcuts(input: {
  keys: () => readonly string[]
  active: () => string | undefined
  select: (key: string) => void
  when: (event: KeyboardEvent) => boolean
}) {
  const shortcut = (id: string, keybind: string, target: () => string | undefined) => ({
    id,
    title: "",
    keybind,
    hidden: true,
    when: input.when,
    onSelect: () => {
      const key = target()

      if (key) input.select(key)
    },
  })

  return [
    ...Array.from({ length: 9 }, (_, index) =>
      shortcut(`file.tab.${index + 1}`, `mod+${index + 1}`, () =>
        index === 8 ? input.keys().at(-1) : input.keys()[index],
      ),
    ),
    shortcut("file.tab.left", "mod+shift+[", () => adjacentTabKey([...input.keys()], input.active(), -1)),
    shortcut("file.tab.right", "mod+shift+]", () => adjacentTabKey([...input.keys()], input.active(), 1)),
  ]
}

function inSide(event: Event, fallback: boolean) {
  const target = event.target

  const placed =
    target instanceof Element && target !== document.body && target !== document.documentElement && target.isConnected

  return placed ? !!target.closest("#review-panel") : fallback
}
