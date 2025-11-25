import { createStore } from "solid-js/store"
import { createMemo } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { makePersisted } from "@solid-primitives/storage"
import { useGlobalSync } from "./global-sync"

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const globalSync = useGlobalSync()
    const [store, setStore] = makePersisted(
      createStore({
        projects: [] as { directory: string; expanded: boolean }[],
        sidebar: {
          opened: true,
          width: 280,
        },
        review: {
          state: "pane" as "pane" | "tab",
        },
      }),
      {
        name: "___default-layout",
      },
    )

    return {
      projects: {
        list: createMemo(() =>
          globalSync.data.defaultProject
            ? [{ directory: globalSync.data.defaultProject!.worktree, expanded: true }, ...store.projects]
            : store.projects,
        ),
        open(directory: string) {
          if (store.projects.find((x) => x.directory === directory)) return
          setStore("projects", (x) => [...x, { directory, expanded: true }])
        },
        close(directory: string) {
          setStore("projects", (x) => x.filter((x) => x.directory !== directory))
        },
        expand(directory: string) {
          setStore("projects", (x) => x.map((x) => (x.directory === directory ? { ...x, expanded: true } : x)))
        },
        collapse(directory: string) {
          setStore("projects", (x) => x.map((x) => (x.directory === directory ? { ...x, expanded: false } : x)))
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
      review: {
        state: createMemo(() => store.review?.state ?? "closed"),
        pane() {
          setStore("review", "state", "pane")
        },
        tab() {
          setStore("review", "state", "tab")
        },
      },
    }
  },
})
