import { createStore } from "solid-js/store"
import { createMemo, onMount } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { makePersisted } from "@solid-primitives/storage"
import { useGlobalSync } from "./global-sync"
import { useGlobalSDK } from "./global-sdk"
import { Project } from "@opencode-ai/sdk/v2"

const PASTEL_COLORS = [
  "#FCEAFD", // pastel pink
  "#FFDFBA", // pastel peach
  "#FFFFBA", // pastel yellow
  "#BAFFC9", // pastel green
  "#EAF6FD", // pastel blue
  "#EFEAFD", // pastel lavender
  "#FEC8D8", // pastel rose
  "#D4F0F0", // pastel cyan
  "#FDF0EA", // pastel coral
  "#C1E1C1", // pastel mint
]

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const globalSdk = useGlobalSDK()
    const globalSync = useGlobalSync()
    const [store, setStore] = makePersisted(
      createStore({
        projects: [] as { worktree: string; expanded: boolean }[],
        sidebar: {
          opened: false,
          width: 280,
        },
        terminal: {
          opened: false,
          height: 280,
        },
        review: {
          state: "pane" as "pane" | "tab",
        },
      }),
      {
        name: "default-layout.v7",
      },
    )
    const [ephemeral, setEphemeral] = createStore({
      dialog: {
        open: undefined as undefined | "provider" | "model",
      },
    })

    function pickAvailableColor() {
      const available = PASTEL_COLORS.filter((c) => !colors().has(c))
      if (available.length === 0) return PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)]
      return available[Math.floor(Math.random() * available.length)]
    }

    function enrich(project: { worktree: string; expanded: boolean }) {
      const metadata = globalSync.data.project.find((x) => x.worktree === project.worktree)
      if (!metadata) return []
      return [
        {
          ...project,
          ...metadata,
        },
      ]
    }

    function colorize(project: Project & { expanded: boolean }) {
      if (project.icon?.color) return project
      const color = pickAvailableColor()
      project.icon = { ...project.icon, color }
      globalSdk.client.project.update({ projectID: project.id, icon: { color } })
      return project
    }

    const enriched = createMemo(() => store.projects.flatMap(enrich))
    const list = createMemo(() => enriched().flatMap(colorize))
    const colors = createMemo(
      () =>
        new Set(
          list()
            .map((p) => p.icon?.color)
            .filter(Boolean),
        ),
    )

    async function loadProjectSessions(directory: string) {
      const [, setStore] = globalSync.child(directory)
      globalSdk.client.session.list({ directory }).then((x) => {
        const sessions = (x.data ?? [])
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, 5)
        setStore("session", sessions)
      })
    }

    onMount(() => {
      Promise.all(
        store.projects.map((project) => {
          return loadProjectSessions(project.worktree)
        }),
      )
    })

    return {
      projects: {
        list,
        open(directory: string) {
          if (store.projects.find((x) => x.worktree === directory)) return
          loadProjectSessions(directory)
          setStore("projects", (x) => [{ worktree: directory, expanded: true }, ...x])
        },
        close(directory: string) {
          setStore("projects", (x) => x.filter((x) => x.worktree !== directory))
        },
        expand(directory: string) {
          setStore("projects", (x) => x.map((x) => (x.worktree === directory ? { ...x, expanded: true } : x)))
        },
        collapse(directory: string) {
          setStore("projects", (x) => x.map((x) => (x.worktree === directory ? { ...x, expanded: false } : x)))
        },
        move(directory: string, toIndex: number) {
          setStore("projects", (projects) => {
            const fromIndex = projects.findIndex((x) => x.worktree === directory)
            if (fromIndex === -1 || fromIndex === toIndex) return projects
            const result = [...projects]
            const [item] = result.splice(fromIndex, 1)
            result.splice(toIndex, 0, item)
            return result
          })
        },
      },
      sidebar: {
        opened: createMemo(() => store.sidebar.opened),
        open() {
          setStore("sidebar", "opened", true)
        },
        close() {
          setStore("sidebar", "opened", false)
        },
        toggle() {
          setStore("sidebar", "opened", (x) => !x)
        },
        width: createMemo(() => store.sidebar.width),
        resize(width: number) {
          setStore("sidebar", "width", width)
        },
      },
      terminal: {
        opened: createMemo(() => store.terminal.opened),
        open() {
          setStore("terminal", "opened", true)
        },
        close() {
          setStore("terminal", "opened", false)
        },
        toggle() {
          setStore("terminal", "opened", (x) => !x)
        },
        height: createMemo(() => store.terminal.height),
        resize(height: number) {
          setStore("terminal", "height", height)
        },
      },
      review: {
        state: createMemo(() => store.review?.state ?? "closed"),
        pane() {
          setStore("review", "state", "pane")
        },
        tab() {
          setStore("review", "state", "tab")
        },
      },
      dialog: {
        opened: createMemo(() => ephemeral.dialog?.open),
        open(dialog: "provider" | "model") {
          setEphemeral("dialog", "open", dialog)
        },
        close(dialog: "provider" | "model") {
          if (ephemeral.dialog?.open === dialog) {
            setEphemeral("dialog", "open", undefined)
          }
        },
      },
    }
  },
})
