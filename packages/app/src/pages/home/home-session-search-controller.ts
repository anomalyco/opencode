import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { serverName } from "@/context/server"
import { displayName } from "@/pages/layout/helpers"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { HomeController } from "./home-controller"
import { homeSessionSearchKey, type HomeSessionRecord, type HomeSessionsController } from "./home-sessions-controller"

type HomeSessionSearchSource = Pick<HomeSessionsController, "data" | "session">

export function createHomeSessionSearchController(home: HomeController, sessions: HomeSessionSearchSource) {
  const command = useCommand()
  const language = useLanguage()
  const [state, setState] = createStore({ value: "", focused: false, active: "" })
  let root: HTMLDivElement | undefined
  let input: HTMLInputElement | undefined
  let list: HTMLDivElement | undefined
  const query = createMemo(() => state.value.trim())
  const results = createMemo(() => {
    const value = query().toLowerCase()
    if (!value) return []
    return sessions.data
      .searchRecords()
      .filter((record) => `${record.session.title} ${record.projectName}`.toLowerCase().includes(value))
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

  createEffect(() => syncActive(results()))
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

  function syncActive(records: HomeSessionRecord[]) {
    if (records.length === 0) {
      setState("active", "")
      return
    }
    if (!records.some((record) => homeSessionSearchKey(record) === state.active)) {
      setState("active", homeSessionSearchKey(records[0]))
    }
  }

  function focus() {
    input?.focus()
    setState("focused", true)
  }

  function close() {
    setState({ value: "", focused: false })
  }

  function move(delta: number) {
    const records = results()
    if (records.length === 0) return
    const index = records.findIndex((record) => homeSessionSearchKey(record) === state.active)
    const next = ((index === -1 ? 0 : index) + delta + records.length) % records.length
    setState("active", homeSessionSearchKey(records[next]))
    list?.querySelector<HTMLElement>(`[data-key="${state.active}"]`)?.scrollIntoView({ block: "nearest" })
  }

  function select(record: HomeSessionRecord, options?: { background?: boolean }) {
    sessions.session.open(record.session, options)
    if (!options?.background) close()
  }

  return {
    query: {
      value: () => state.value,
      placeholder,
      open,
      focus,
      input: (value: string) => setState("value", value),
      close,
    },
    result: {
      loading: sessions.data.loading,
      list: results,
      active: () => state.active,
      noResultsLabel: () => language.t("home.sessions.search.noResults", { query: query() }),
      highlight: (record: HomeSessionRecord) => setState("active", homeSessionSearchKey(record)),
      move,
      select,
      selectActive: () => {
        const record = results().find((item) => homeSessionSearchKey(item) === state.active)
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
