import { useCommand } from "@/context/command"
import { loadHomeSessionSearch } from "@/context/global-sync/home-session-index"
import { useLanguage } from "@/context/language"
import { serverName } from "@/context/server"
import { displayName } from "@/pages/layout/helpers"
import { makeEventListener } from "@solid-primitives/event-listener"
import { debounce } from "@solid-primitives/scheduled"
import { useQuery } from "@tanstack/solid-query"
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import {
  findHomeSessionSearchResult,
  isHomeSessionSearchResultCurrent,
  mergeHomeSessionSearchResults,
  settledHomeSessionSearchResult,
} from "../home-session-search"
import type { HomeController } from "./home-controller"
import { homeSessionSearchKey, type HomeSessionRecord, type HomeSessionsController } from "./home-sessions-controller"

type HomeSessionSearchSource = Pick<HomeSessionsController, "data" | "session">

export function createHomeSessionSearchController(home: HomeController, sessions: HomeSessionSearchSource) {
  const command = useCommand()
  const language = useLanguage()
  const [state, setState] = createStore({ value: "", focused: false, highlighted: "" })
  let root: HTMLDivElement | undefined
  let input: HTMLInputElement | undefined
  let list: HTMLDivElement | undefined
  const query = createMemo(() => state.value.trim())
  const [serverSearch, setServerSearch] = createSignal("")
  const scheduleServerSearch = debounce(setServerSearch, 150)
  createEffect(
    on(query, (value) => {
      if (value) {
        scheduleServerSearch(value)
        return
      }
      scheduleServerSearch.clear()
      setServerSearch("")
    }),
  )
  const sessionSearchLoad = useQuery(() => ({
    queryKey: [
      "home",
      "session-search",
      home.selection.value().server,
      home.selection.value().directory,
      home.project.selected()?.id,
      serverSearch(),
    ],
    enabled: !!home.server.focusedContext() && serverSearch().length > 0,
    queryFn: async ({ signal }) => {
      const value = serverSearch()
      const server = home.selection.value().server
      const scope = home.selection.value().directory ?? ""
      const ctx = home.server.focusedContext()
      if (!ctx) return { sessions: [], snippets: {}, query: value, server, scope }
      const project = home.project.selected()
      const result = await loadHomeSessionSearch(
        (input, options) => ctx.sdk.client.v2.session.list(input, options),
        value,
        {
          project: project?.id,
          directories: project ? [project.worktree, ...(project.sandboxes ?? [])] : undefined,
        },
        signal,
      )
      return { ...result, query: value, server, scope }
    },
    placeholderData: (previous) => previous,
    retry: false,
  }))
  const results = createMemo(() => {
    const current = {
      query: query(),
      server: home.selection.value().server,
      scope: home.selection.value().directory ?? "",
    }
    if (!current.query) return []
    const local = sessions.data
      .searchRecords()
      .filter((record) =>
        `${record.session.title} ${record.projectName}`.toLowerCase().includes(current.query.toLowerCase()),
      )
    const result = settledHomeSessionSearchResult(sessionSearchLoad)
    const resultCurrent = result ? isHomeSessionSearchResultCurrent(result, current) : false
    const remote =
      result?.server === current.server
        ? sessions.data.searchResultRecords({
            sessions: result.sessions,
            snippets: result.snippets,
            stale: !resultCurrent,
          })
        : undefined
    const merged =
      remote && !resultCurrent
        ? mergeHomeSessionSearchResults({ local: remote, remote: local, key: homeSessionSearchKey })
        : mergeHomeSessionSearchResults({ local, remote, key: homeSessionSearchKey })
    return merged.sort(
      (a, b) => (b.session.time.updated ?? b.session.time.created) - (a.session.time.updated ?? a.session.time.created),
    )
  })
  const loading = createMemo(
    () =>
      sessions.data.loading() ||
      (query().length > 0 &&
        results().length === 0 &&
        (serverSearch() !== query() || sessionSearchLoad.isFetching)),
  )
  const active = createMemo(() => {
    const records = results().filter((record) => !record.stale)
    if (records.some((record) => homeSessionSearchKey(record) === state.highlighted)) return state.highlighted
    return records[0] ? homeSessionSearchKey(records[0]) : ""
  })
  const open = createMemo(() => state.focused && query().length > 0)
  const placeholder = createMemo(() => {
    const project = home.project.selected()
    if (project) return language.t("home.sessions.search.placeholder.scoped", { scope: displayName(project) })
    if (home.server.list().length > 1) {
      const conn = home.server.focused()
      if (conn) return language.t("home.sessions.search.placeholder.scoped", { scope: serverName(conn) })
    }
    return language.t("home.sessions.search.placeholder")
  })

  onCleanup(
    makeEventListener(document, "pointerdown", (event) => {
      if (!open()) return
      const target = event.target
      if (!(target instanceof Node) || root?.contains(target)) return
      close()
    }),
  )

  command.register("home.search", () => [
    {
      id: "home.sessions.search.focus",
      title: placeholder(),
      keybind: "mod+f",
      hidden: true,
      onSelect: focus,
    },
  ])

  function focus() {
    input?.focus()
    setState("focused", true)
  }

  function close() {
    setState({ value: "", focused: false })
  }

  function select(record: HomeSessionRecord, options?: { background?: boolean }) {
    sessions.session.open(record.session, options)
    if (!options?.background) close()
  }

  return {
    query: {
      value: () => state.value,
      search: query,
      placeholder,
      open,
      focus,
      input: (value: string) => setState({ value, highlighted: "" }),
      close,
    },
    result: {
      loading,
      list: results,
      active,
      noResultsLabel: () => language.t("home.sessions.search.noResults", { query: query() }),
      highlight: (record: HomeSessionRecord) => {
        if (!record.stale) setState("highlighted", homeSessionSearchKey(record))
      },
      move: (delta: number) => {
        const records = results().filter((record) => !record.stale)
        if (records.length === 0) return
        const index = records.findIndex((record) => homeSessionSearchKey(record) === active())
        const next = ((index === -1 ? 0 : index) + delta + records.length) % records.length
        setState("highlighted", homeSessionSearchKey(records[next]))
        findHomeSessionSearchResult(list, state.highlighted)?.scrollIntoView({ block: "nearest" })
      },
      select,
      selectActive: () => {
        const record = results().find((item) => !item.stale && homeSessionSearchKey(item) === active())
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
