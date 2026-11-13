import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useServers } from "@/runtime/server/registry"
import { displayName } from "@opencode/ui/project-avatar"
import { sessionLabel } from "@/session/title"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import type { HomeController } from "../model"
import { homeSessionSearchKey, type HomeSessionRecord, type HomeSessionsController } from "./controller"
import {
  INITIAL_HOME_SESSION_SEARCH_STATE,
  selectSearchExact,
  selectSearchHighlighted,
  selectSearchLookingUp,
  selectSearchOpen,
  selectSearchQuery,
  selectSearchValue,
  transitionHomeSessionSearch,
  type HomeSessionSearchEffect,
  type HomeSessionSearchEvent,
} from "./search-machine"

type HomeSessionSearchSource = Pick<HomeSessionsController, "data" | "session">

type PendingLookup = { controller: AbortController; timer: ReturnType<typeof setTimeout> }

export function createHomeSessionSearchController(home: HomeController, sessions: HomeSessionSearchSource) {
  const command = useCommand()
  const language = useLanguage()
  const servers = useServers()

  const [searchState, setSearchState] = createSignal(INITIAL_HOME_SESSION_SEARCH_STATE)
  let lookup: PendingLookup | undefined
  let root: HTMLDivElement | undefined
  let input: HTMLInputElement | undefined
  let list: HTMLDivElement | undefined
  const query = createMemo(() => selectSearchQuery(searchState()))
  const highlighted = createMemo(() => selectSearchHighlighted(searchState()))

  const dispatch = (event: HomeSessionSearchEvent) =>
    untrack(() => {
      const previous = searchState()
      const next = transitionHomeSessionSearch(previous, event)

      if (next.state !== previous) setSearchState(next.state)
      next.effects.forEach(run)
    })

  function run(effect: HomeSessionSearchEffect) {
    clearTimeout(lookup?.timer)
    lookup?.controller.abort()
    lookup = undefined

    if (effect.type === "lookup.abort") return
    const controller = new AbortController()
    const attempt = effect.attempt
    const timer = setTimeout(() => dispatch({ type: "lookup.timed-out", attempt }), effect.timeoutMs)
    lookup = { controller, timer }
    void sessions.session.lookup(effect.sessionID, controller.signal).then(
      (record) => {
        clearTimeout(timer)
        dispatch({ type: "lookup.resolved", attempt, record })
      },
      () => {
        clearTimeout(timer)

        if (controller.signal.aborted) return
        dispatch({ type: "lookup.failed", attempt })
      },
    )
  }

  const results = createMemo(() => {
    const value = query().toLowerCase()

    if (!value) return []

    const records = sessions.data
      .searchRecords()
      .filter((record) => `${sessionLabel(record.session)} ${record.projectName}`.toLowerCase().includes(value))

    const exact = selectSearchExact(searchState())

    if (!exact || records.some((record) => record.session.id === exact.session.id)) return records

    return [exact, ...records]
  })

  const active = createMemo(() => {
    const records = results()

    if (records.some((record) => homeSessionSearchKey(record) === highlighted())) return highlighted()

    return records[0] ? homeSessionSearchKey(records[0]) : ""
  })

  const open = createMemo(() => selectSearchOpen(searchState()))

  const placeholder = createMemo(() => {
    const project = home.project.selected()

    if (project) return language.t("home.sessions.search.placeholder.scoped", { scope: displayName(project) })

    if (home.server.list().length > 1) {
      const conn = home.server.focused()

      if (conn) return language.t("home.sessions.search.placeholder.scoped", { scope: servers.label(conn) })
    }

    return language.t("home.sessions.search.placeholder")
  })

  // An exact match belongs to the server and project it was looked up in.
  createEffect(() => {
    const selection = home.selection.value()
    const scope = `${selection.server ?? ""}\0${selection.directory ?? ""}`
    const connected = home.server.focusedContext()?.sdk.connection.status() === "connected"
    dispatch({ type: "scope.changed", scope, connected })
  })

  onCleanup(
    makeEventListener(document, "pointerdown", (event) => {
      if (!open()) return
      const target = event.target

      if (!(target instanceof Node) || root?.contains(target)) return
      close()
    }),
  )
  onCleanup(() => dispatch({ type: "disposed" }))

  // Home's Find focuses its session search, so Settings > Shortcuts lists one Find and one Search sessions.
  command.register("home.search", () => [
    {
      id: "session.search",
      title: language.t("session.search.placeholder"),
      keybind: "mod+f",
      hidden: true,
      onSelect: focus,
    },
  ])

  function focus() {
    input?.focus()
    dispatch({ type: "focused" })
  }

  // Focus moving inside the search (to a result) keeps it open; the window losing focus keeps the input focused.
  function blur(next: EventTarget | null) {
    if ((next instanceof Node && root?.contains(next)) || document.activeElement === input) return
    dispatch({ type: "blurred" })
  }

  function close() {
    dispatch({ type: "closed" })
  }

  function select(record: HomeSessionRecord, options?: { background?: boolean }) {
    sessions.session.open(record.session, options)

    if (!options?.background) close()
  }

  return {
    query: {
      value: () => selectSearchValue(searchState()),
      placeholder,
      open,
      focus,
      blur,
      input: (value: string) => dispatch({ type: "input.changed", value }),
      close,
    },
    result: {
      loading: () => sessions.data.loading() || selectSearchLookingUp(searchState()),
      list: results,
      active,
      noResultsLabel: () => language.t("home.sessions.search.noResults", { query: query() }),
      highlight: (record: HomeSessionRecord) =>
        dispatch({ type: "highlight.changed", key: homeSessionSearchKey(record) }),
      move: (delta: number) => {
        const records = results()

        if (records.length === 0) return
        const index = records.findIndex((record) => homeSessionSearchKey(record) === active())
        const next = ((index === -1 ? 0 : index) + delta + records.length) % records.length
        dispatch({ type: "highlight.changed", key: homeSessionSearchKey(records[next]) })
        list?.querySelector<HTMLElement>(`[data-key="${highlighted()}"]`)?.scrollIntoView({ block: "nearest" })
      },
      select,
      selectActive: () => {
        const record = results().find((item) => homeSessionSearchKey(item) === active())

        if (record) select(record)
      },
    },
    element: {
      setRoot: (element: HTMLDivElement) => (root = element),
      setInput: (element: HTMLInputElement) => (input = element),
      setList: (element: HTMLDivElement) => (list = element),
    },
  }
}

export type HomeSessionSearchController = ReturnType<typeof createHomeSessionSearchController>
