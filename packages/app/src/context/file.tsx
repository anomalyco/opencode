import { createEffect, createMemo, createRoot, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { FileContent } from "@opencode-ai/sdk/v2"
import { showToast } from "@opencode-ai/ui/toast"
import { useParams } from "@solidjs/router"
import { getFilename } from "@opencode-ai/util/path"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { Persist, persisted } from "@/utils/persist"

export type FileSelection = {
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

export type SelectedLineRange = {
  start: number
  end: number
  side?: "additions" | "deletions"
  endSide?: "additions" | "deletions"
}

export type FileViewState = {
  scrollTop?: number
  scrollLeft?: number
  selectedLines?: SelectedLineRange | null
}

export type FileState = {
  path: string
  name: string
  loaded?: boolean
  loading?: boolean
  error?: string
  content?: FileContent
}

function stripFileProtocol(input: string) {
  if (!input.startsWith("file://")) return input
  return input.slice("file://".length)
}

function stripQueryAndHash(input: string) {
  const hashIndex = input.indexOf("#")
  const queryIndex = input.indexOf("?")

  if (hashIndex !== -1 && queryIndex !== -1) {
    return input.slice(0, Math.min(hashIndex, queryIndex))
  }

  if (hashIndex !== -1) return input.slice(0, hashIndex)
  if (queryIndex !== -1) return input.slice(0, queryIndex)
  return input
}

export function selectionFromLines(range: SelectedLineRange): FileSelection {
  const startLine = Math.min(range.start, range.end)
  const endLine = Math.max(range.start, range.end)
  return {
    startLine,
    endLine,
    startChar: 0,
    endChar: 0,
  }
}

function normalizeSelectedLines(range: SelectedLineRange): SelectedLineRange {
  if (range.start <= range.end) return range

  const startSide = range.side
  const endSide = range.endSide ?? startSide

  return {
    ...range,
    start: range.end,
    end: range.start,
    side: endSide,
    endSide: startSide !== endSide ? startSide : undefined,
  }
}

const WORKSPACE_KEY = "__workspace__"
const MAX_FILE_VIEW_SESSIONS = 20
const MAX_VIEW_FILES = 500

type ViewSession = ReturnType<typeof createViewSession>

type ViewCacheEntry = {
  value: ViewSession
  dispose: VoidFunction
}

function createViewSession(dir: string, id: string | undefined) {
  const legacyViewKey = `${dir}/file${id ? "/" + id : ""}.v1`

  const [view, setView, _, ready] = persisted(
    Persist.scoped(dir, id, "file-view", [legacyViewKey]),
    createStore<{
      file: Record<string, FileViewState>
    }>({
      file: {},
    }),
  )

  const meta = { pruned: false }

  const pruneView = (keep?: string) => {
    const keys = Object.keys(view.file)
    if (keys.length <= MAX_VIEW_FILES) return

    const drop = keys.filter((key) => key !== keep).slice(0, keys.length - MAX_VIEW_FILES)
    if (drop.length === 0) return

    setView(
      produce((draft) => {
        for (const key of drop) {
          delete draft.file[key]
        }
      }),
    )
  }

  createEffect(() => {
    if (!ready()) return
    if (meta.pruned) return
    meta.pruned = true
    pruneView()
  })

  const scrollTop = (path: string) => view.file[path]?.scrollTop
  const scrollLeft = (path: string) => view.file[path]?.scrollLeft
  const selectedLines = (path: string) => view.file[path]?.selectedLines

  const setScrollTop = (path: string, top: number) => {
    setView("file", path, (current) => {
      if (current?.scrollTop === top) return current
      return {
        ...(current ?? {}),
        scrollTop: top,
      }
    })
    pruneView(path)
  }

  const setScrollLeft = (path: string, left: number) => {
    setView("file", path, (current) => {
      if (current?.scrollLeft === left) return current
      return {
        ...(current ?? {}),
        scrollLeft: left,
      }
    })
    pruneView(path)
  }

  const setSelectedLines = (path: string, range: SelectedLineRange | null) => {
    const next = range ? normalizeSelectedLines(range) : null
    setView("file", path, (current) => {
      if (current?.selectedLines === next) return current
      return {
        ...(current ?? {}),
        selectedLines: next,
      }
    })
    pruneView(path)
  }

  return {
    ready,
    scrollTop,
    scrollLeft,
    selectedLines,
    setScrollTop,
    setScrollLeft,
    setSelectedLines,
  }
}

export const { use: useFile, provider: FileProvider } = createSimpleContext({
  name: "File",
  gate: false,
  init: () => {
    const sdk = useSDK()
    const sync = useSync()
    const params = useParams()

    const directory = createMemo(() => sync.data.path.directory)

    function normalize(input: string) {
      const root = directory()
      const prefix = root.endsWith("/") ? root : root + "/"

      let path = stripQueryAndHash(stripFileProtocol(input))

      if (path.startsWith(prefix)) {
        path = path.slice(prefix.length)
      }

      if (path.startsWith(root)) {
        path = path.slice(root.length)
      }

      if (path.startsWith("./")) {
        path = path.slice(2)
      }

      if (path.startsWith("/")) {
        path = path.slice(1)
      }

      return path
    }

    function tab(input: string) {
      const path = normalize(input)
      return `file://${path}`
    }

    function pathFromTab(tabValue: string) {
      if (!tabValue.startsWith("file://")) return
      return normalize(tabValue)
    }

    const inflight = new Map<string, Promise<void>>()

    const [store, setStore] = createStore<{
      file: Record<string, FileState>
    }>({
      file: {},
    })

    const viewCache = new Map<string, ViewCacheEntry>()

    const disposeViews = () => {
      for (const entry of viewCache.values()) {
        entry.dispose()
      }
      viewCache.clear()
    }

    const pruneViews = () => {
      while (viewCache.size > MAX_FILE_VIEW_SESSIONS) {
        const first = viewCache.keys().next().value
        if (!first) return
        const entry = viewCache.get(first)
        entry?.dispose()
        viewCache.delete(first)
      }
    }

    const loadView = (dir: string, id: string | undefined) => {
      const key = `${dir}:${id ?? WORKSPACE_KEY}`
      const existing = viewCache.get(key)
      if (existing) {
        viewCache.delete(key)
        viewCache.set(key, existing)
        return existing.value
      }

      const entry = createRoot((dispose) => ({
        value: createViewSession(dir, id),
        dispose,
      }))

      viewCache.set(key, entry)
      pruneViews()
      return entry.value
    }

    const view = createMemo(() => loadView(params.dir!, params.id))

    function ensure(path: string) {
      if (!path) return
      if (store.file[path]) return
      setStore("file", path, { path, name: getFilename(path) })
    }

    function load(input: string, options?: { force?: boolean }) {
      const path = normalize(input)
      if (!path) return Promise.resolve()

      ensure(path)

      const current = store.file[path]
      if (!options?.force && current?.loaded) return Promise.resolve()

      const pending = inflight.get(path)
      if (pending) return pending

      setStore(
        "file",
        path,
        produce((draft) => {
          draft.loading = true
          draft.error = undefined
        }),
      )

      const promise = sdk.client.file
        .read({ path })
        .then((x) => {
          setStore(
            "file",
            path,
            produce((draft) => {
              draft.loaded = true
              draft.loading = false
              draft.content = x.data
            }),
          )
        })
        .catch((e) => {
          setStore(
            "file",
            path,
            produce((draft) => {
              draft.loading = false
              draft.error = e.message
            }),
          )
          showToast({
            variant: "error",
            title: "Failed to load file",
            description: e.message,
          })
        })
        .finally(() => {
          inflight.delete(path)
        })

      inflight.set(path, promise)
      return promise
    }

    const stop = sdk.event.listen((e) => {
      const event = e.details
      if (event.type !== "file.watcher.updated") return
      const path = normalize(event.properties.file)
      if (!path) return
      if (path.startsWith(".git/")) return
      if (!store.file[path]) return
      load(path, { force: true })
    })

    const get = (input: string) => store.file[normalize(input)]

    const scrollTop = (input: string) => view().scrollTop(normalize(input))
    const scrollLeft = (input: string) => view().scrollLeft(normalize(input))
    const selectedLines = (input: string) => view().selectedLines(normalize(input))

    const setScrollTop = (input: string, top: number) => {
      const path = normalize(input)
      view().setScrollTop(path, top)
    }

    const setScrollLeft = (input: string, left: number) => {
      const path = normalize(input)
      view().setScrollLeft(path, left)
    }

    const setSelectedLines = (input: string, range: SelectedLineRange | null) => {
      const path = normalize(input)
      view().setSelectedLines(path, range)
    }

    onCleanup(() => {
      stop()
      disposeViews()
    })

    return {
      ready: () => view().ready(),
      normalize,
      tab,
      pathFromTab,
      get,
      load,
      scrollTop,
      scrollLeft,
      setScrollTop,
      setScrollLeft,
      selectedLines,
      setSelectedLines,
      searchFiles: (query: string) =>
        sdk.client.find.files({ query, dirs: "false" }).then((x) => (x.data ?? []).map(normalize)),
      searchFilesAndDirectories: (query: string) =>
        sdk.client.find.files({ query, dirs: "true" }).then((x) => (x.data ?? []).map(normalize)),
    }
  },
})
