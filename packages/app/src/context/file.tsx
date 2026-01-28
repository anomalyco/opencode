import { createEffect, createMemo, createRoot, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { FileContent, FileNode } from "@opencode-ai/sdk/v2"
import { showToast } from "@opencode-ai/ui/toast"
import { useParams } from "@solidjs/router"
import { getFilename } from "@opencode-ai/util/path"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { useLanguage } from "@/context/language"
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

type DirectoryState = {
  expanded: boolean
  loaded?: boolean
  loading?: boolean
  error?: string
  children?: string[]
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

function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return new TextDecoder().decode(new Uint8Array(bytes))
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

const MAX_FILE_CONTENT_ENTRIES = 40
const MAX_FILE_CONTENT_BYTES = 20 * 1024 * 1024

const contentLru = new Map<string, number>()

function approxBytes(content: FileContent) {
  const patchBytes =
    content.patch?.hunks.reduce((total, hunk) => {
      return total + hunk.lines.reduce((sum, line) => sum + line.length, 0)
    }, 0) ?? 0

  return (content.content.length + (content.diff?.length ?? 0) + patchBytes) * 2
}

function touchContent(path: string, bytes?: number) {
  const prev = contentLru.get(path)
  if (prev === undefined && bytes === undefined) return
  const value = bytes ?? prev ?? 0
  contentLru.delete(path)
  contentLru.set(path, value)
}

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
    const language = useLanguage()

    const scope = createMemo(() => sdk.directory)

    const directory = createMemo(() => sync.data.path.directory)

    function normalize(input: string) {
      const root = directory()
      const prefix = root.endsWith("/") ? root : root + "/"

      let path = unquoteGitPath(stripQueryAndHash(stripFileProtocol(input)))

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
    const treeInflight = new Map<string, Promise<void>>()

    const search = (query: string, dirs: "true" | "false") =>
      sdk.client.find.files({ query, dirs }).then(
        (x) => (x.data ?? []).map(normalize),
        () => [],
      )

    const [store, setStore] = createStore<{
      file: Record<string, FileState>
    }>({
      file: {},
    })

    const [tree, setTree] = createStore<{
      node: Record<string, FileNode>
      dir: Record<string, DirectoryState>
    }>({
      node: {},
      dir: { "": { expanded: true } },
    })

    const evictContent = (keep?: Set<string>) => {
      const protectedSet = keep ?? new Set<string>()
      const total = () => {
        return Array.from(contentLru.values()).reduce((sum, bytes) => sum + bytes, 0)
      }

      while (contentLru.size > MAX_FILE_CONTENT_ENTRIES || total() > MAX_FILE_CONTENT_BYTES) {
        const path = contentLru.keys().next().value
        if (!path) return

        if (protectedSet.has(path)) {
          touchContent(path)
          if (contentLru.size <= protectedSet.size) return
          continue
        }

        contentLru.delete(path)
        if (!store.file[path]) continue
        setStore(
          "file",
          path,
          produce((draft) => {
            draft.content = undefined
            draft.loaded = false
          }),
        )
      }
    }

    createEffect(() => {
      scope()
      inflight.clear()
      treeInflight.clear()
      contentLru.clear()
      setStore("file", {})
      setTree("node", {})
      setTree("dir", { "": { expanded: true } })
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

      const directory = scope()
      const key = `${directory}\n${path}`
      const client = sdk.client

      ensure(path)

      const current = store.file[path]
      if (!options?.force && current?.loaded) return Promise.resolve()

      const pending = inflight.get(key)
      if (pending) return pending

      setStore(
        "file",
        path,
        produce((draft) => {
          draft.loading = true
          draft.error = undefined
        }),
      )

      const promise = client.file
        .read({ path })
        .then((x) => {
          if (scope() !== directory) return
          const content = x.data
          setStore(
            "file",
            path,
            produce((draft) => {
              draft.loaded = true
              draft.loading = false
              draft.content = content
            }),
          )

          if (!content) return
          touchContent(path, approxBytes(content))
          evictContent(new Set([path]))
        })
        .catch((e) => {
          if (scope() !== directory) return
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
            title: language.t("toast.file.loadFailed.title"),
            description: e.message,
          })
        })
        .finally(() => {
          inflight.delete(key)
        })

      inflight.set(key, promise)
      return promise
    }

    function normalizeDir(input: string) {
      return normalize(input).replace(/\/+$/, "")
    }

    function ensureDir(path: string) {
      if (tree.dir[path]) return
      setTree("dir", path, { expanded: false })
    }

    function listDir(input: string, options?: { force?: boolean }) {
      const dir = normalizeDir(input)
      ensureDir(dir)

      const current = tree.dir[dir]
      if (!options?.force && current?.loaded) return Promise.resolve()

      const pending = treeInflight.get(dir)
      if (pending) return pending

      setTree(
        "dir",
        dir,
        produce((draft) => {
          draft.loading = true
          draft.error = undefined
        }),
      )

      const directory = scope()

      const promise = sdk.client.file
        .list({ path: dir })
        .then((x) => {
          if (scope() !== directory) return
          const nodes = x.data ?? []
          const prevChildren = tree.dir[dir]?.children ?? []
          const nextChildren = nodes.map((node) => node.path)
          const nextSet = new Set(nextChildren)

          setTree(
            "node",
            produce((draft) => {
              const removedDirs: string[] = []

              for (const child of prevChildren) {
                if (nextSet.has(child)) continue
                const existing = draft[child]
                if (existing?.type === "directory") removedDirs.push(child)
                delete draft[child]
              }

              if (removedDirs.length > 0) {
                const keys = Object.keys(draft)
                for (const key of keys) {
                  for (const removed of removedDirs) {
                    if (!key.startsWith(removed + "/")) continue
                    delete draft[key]
                    break
                  }
                }
              }

              for (const node of nodes) {
                draft[node.path] = node
              }
            }),
          )

          setTree(
            "dir",
            dir,
            produce((draft) => {
              draft.loaded = true
              draft.loading = false
              draft.children = nextChildren
            }),
          )
        })
        .catch((e) => {
          if (scope() !== directory) return
          setTree(
            "dir",
            dir,
            produce((draft) => {
              draft.loading = false
              draft.error = e.message
            }),
          )
          showToast({
            variant: "error",
            title: language.t("toast.file.listFailed.title"),
            description: e.message,
          })
        })
        .finally(() => {
          treeInflight.delete(dir)
        })

      treeInflight.set(dir, promise)
      return promise
    }

    function expandDir(input: string) {
      const dir = normalizeDir(input)
      ensureDir(dir)
      setTree("dir", dir, "expanded", true)
      void listDir(dir)
    }

    function collapseDir(input: string) {
      const dir = normalizeDir(input)
      ensureDir(dir)
      setTree("dir", dir, "expanded", false)
    }

    function dirState(input: string) {
      const dir = normalizeDir(input)
      return tree.dir[dir]
    }

    function children(input: string) {
      const dir = normalizeDir(input)
      const ids = tree.dir[dir]?.children
      if (!ids) return []
      const out: FileNode[] = []
      for (const id of ids) {
        const node = tree.node[id]
        if (node) out.push(node)
      }
      return out
    }

    const stop = sdk.event.listen((e) => {
      const event = e.details
      if (event.type !== "file.watcher.updated") return
      const path = normalize(event.properties.file)
      if (!path) return
      if (path.startsWith(".git/")) return

      if (store.file[path]) {
        load(path, { force: true })
      }

      const kind = event.properties.event
      if (kind === "change") {
        const dir = (() => {
          if (path === "") return ""
          const node = tree.node[path]
          if (node?.type !== "directory") return
          return path
        })()
        if (dir === undefined) return
        if (!tree.dir[dir]?.loaded) return
        listDir(dir, { force: true })
        return
      }
      if (kind !== "add" && kind !== "unlink") return

      const parent = path.split("/").slice(0, -1).join("/")
      if (!tree.dir[parent]?.loaded) return

      listDir(parent, { force: true })
    })

    const get = (input: string) => {
      const path = normalize(input)
      const file = store.file[path]
      const content = file?.content
      if (!content) return file
      if (contentLru.has(path)) {
        touchContent(path)
        return file
      }
      touchContent(path, approxBytes(content))
      return file
    }

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
      tree: {
        list: listDir,
        refresh: (input: string) => listDir(input, { force: true }),
        state: dirState,
        children,
        expand: expandDir,
        collapse: collapseDir,
        toggle(input: string) {
          if (dirState(input)?.expanded) {
            collapseDir(input)
            return
          }
          expandDir(input)
        },
      },
      get,
      load,
      scrollTop,
      scrollLeft,
      setScrollTop,
      setScrollLeft,
      selectedLines,
      setSelectedLines,
      searchFiles: (query: string) => search(query, "false"),
      searchFilesAndDirectories: (query: string) => search(query, "true"),
    }
  },
})
