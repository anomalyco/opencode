import { batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { useParams } from "@solidjs/router"
import { base64FromBytes } from "@opencode-ai/util/encode"
import { getFilename } from "@opencode-ai/util/path"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import type { FileContent, FileNode } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { isUniverOfficePath, officeMimeType } from "@/lib/office-path"
import { listSlotPathsForScope, pullSlot, pushSlot, type SheetUnitSlot } from "@/lib/spreadsheet-unit-persist"
import { listPersistedUniverUnits } from "@/lib/veritly-univer-host-api"
import { univerBackendOrigin } from "@/lib/univer-backend-origin"
import { createPathHelpers } from "./file/path"
import {
  approxBytes,
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  hasFileContent,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
} from "./file/content-cache"
import { createFileViewCache } from "./file/view-cache"
import { createFileTreeStore } from "./file/tree-store"
import { invalidateFromWatcher } from "./file/watcher"
import {
  selectionFromLines,
  type FileState,
  type FileSelection,
  type FileViewState,
  type SelectedLineRange,
} from "./file/types"

export type { FileSelection, SelectedLineRange, FileViewState, FileState }
export { selectionFromLines }
export {
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
}

export const { use: useFile, provider: FileProvider } = createSimpleContext({
  name: "File",
  gate: false,
  init: () => {
    const sdk = useSDK()
    useSync()
    const params = useParams()
    const language = useLanguage()
    const layout = useLayout()

    const scope = createMemo(() => sdk.directory)
    const path = createPathHelpers(scope)
    const tabs = layout.tabs(() => `${params.dir}${params.id ? "/" + params.id : ""}`)

    const inflight = new Map<string, Promise<void>>()
    /** In-session office files shown in the tree (no `/v1/files` listing server). */
    const virtualOfficeFiles = new Map<string, FileNode>()
    const [store, setStore] = createStore<{
      file: Record<string, FileState>
    }>({
      file: {},
    })

    const tree = createFileTreeStore({
      scope,
      normalizeDir: path.normalizeDir,
      list: async (dir) => {
        const d = path.normalizeDir(dir)
        const out: FileNode[] = []
        for (const node of virtualOfficeFiles.values()) {
          if (path.dirname(node.path) === d) out.push(node)
        }
        out.sort((a, b) => a.name.localeCompare(b.name))
        return out
      },
      onError: (message) => {
        showToast({
          variant: "error",
          title: language.t("toast.file.listFailed.title"),
          description: message,
        })
      },
    })

    const evictContent = (keep?: Set<string>) => {
      evictContentLru(keep, (target) => {
        if (!store.file[target]) return
        setStore(
          "file",
          target,
          produce((draft) => {
            draft.content = undefined
            draft.loaded = false
          }),
        )
      })
    }

    createEffect(() => {
      scope()
      inflight.clear()
      resetFileContentLru()
      virtualOfficeFiles.clear()
      batch(() => {
        setStore("file", reconcile({}))
        tree.reset()
      })
    })

    const viewCache = createFileViewCache()
    const view = createMemo(() => viewCache.load(scope(), params.id))

    const ensure = (file: string) => {
      if (!file) return
      if (store.file[file]) return
      setStore("file", file, { path: file, name: getFilename(file) })
    }

    const setLoading = (file: string) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loading = true
          draft.error = undefined
        }),
      )
    }

    const setLoaded = (file: string, content: FileState["content"]) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loaded = true
          draft.loading = false
          draft.content = content
        }),
      )
    }

    const setLoadError = (file: string, message: string) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loading = false
          draft.error = message
        }),
      )
      showToast({
        variant: "error",
        title: language.t("toast.file.loadFailed.title"),
        description: message,
      })
    }

    const load = (input: string, options?: { force?: boolean }) => {
      const file = path.normalize(input)
      if (!file) return Promise.resolve()

      const directory = scope()
      const key = `${directory}\n${file}`
      ensure(file)

      const current = store.file[file]
      if (!options?.force && current?.loaded) return Promise.resolve()

      const pending = inflight.get(key)
      if (pending) return pending

      setLoading(file)

      if (!isUniverOfficePath(file)) {
        const p = Promise.resolve()
          .then(() => {
            if (scope() !== directory) return
            setLoadError(file, language.t("file.hostFilesystemDisabled"))
          })
          .finally(() => {
            inflight.delete(key)
          })
        inflight.set(key, p)
        return p
      }

      const cur = store.file[file]
      if (cur?.content) {
        const promise = Promise.resolve()
          .then(() => {
            if (scope() !== directory) return
            if (!cur.loaded) setLoaded(file, cur.content as FileState["content"])
            touchFileContent(file, approxBytes(cur.content as FileContent))
            evictContent(new Set([file]))
          })
          .finally(() => {
            inflight.delete(key)
          })
        inflight.set(key, promise)
        return promise
      }

      const pinned = pullSlot(directory, file)
      if (pinned) {
        const mime = officeMimeType(file)
        const body = {
          type: "binary" as const,
          encoding: "base64" as const,
          content: "",
          mimeType: mime,
          unitId: pinned.id,
          unitKind: pinned.kind,
        }
        const promise = Promise.resolve()
          .then(() => {
            if (scope() !== directory) return
            setLoaded(file, body)
            touchFileContent(file, approxBytes(body as unknown as FileContent))
            evictContent(new Set([file]))
            virtualOfficeFiles.set(file, {
              path: file,
              name: getFilename(file),
              type: "file",
              absolute: file,
              ignored: false,
            })
            void tree.listDir(path.dirname(file), { force: true })
          })
          .finally(() => {
            inflight.delete(key)
          })
        inflight.set(key, promise)
        return promise
      }

      const promise = Promise.resolve()
        .then(() => {
          if (scope() !== directory) return
          setLoadError(file, language.t("file.officeImportOnly"))
        })
        .finally(() => {
          inflight.delete(key)
        })

      inflight.set(key, promise)
      return promise
    }

    const patchSpreadsheetUnit = (fp: string, unitId: string) => {
      const target = path.normalize(fp)
      let kind: SheetUnitSlot["kind"] = "sheet"
      setStore(
        "file",
        target,
        produce((draft) => {
          const c = draft.content
          if (c && typeof c === "object" && c !== null && "unitId" in c) {
            ;(c as { unitId: string }).unitId = unitId
            const k = (c as { unitKind?: string }).unitKind
            if (k === "doc" || k === "slide" || k === "sheet") kind = k
          }
        }),
      )
      if (!unitId.startsWith("pending-")) pushSlot(scope(), target, unitId, kind)
    }

    const search = (_query: string, _dirs: "true" | "false") => Promise.resolve([] as string[])

    const upload = async (filepath: string, content: Uint8Array) => {
      const normalized = path.normalize(filepath)
      if (!isUniverOfficePath(normalized)) {
        throw new Error(language.t("file.hostFilesystemDisabled"))
      }
      const base64 = base64FromBytes(content)
      const unitId = `pending-${crypto.randomUUID()}`
      ensure(normalized)
      const mime = officeMimeType(normalized)
      const body = {
        type: "binary" as const,
        encoding: "base64" as const,
        content: base64,
        mimeType: mime,
        unitId,
        unitKind: "sheet" as const,
      }
      setLoaded(normalized, body)
      touchFileContent(normalized, approxBytes(body as unknown as FileContent))
      evictContent(new Set([normalized]))
      virtualOfficeFiles.set(normalized, {
        path: normalized,
        name: getFilename(normalized),
        type: "file",
        absolute: normalized,
        ignored: false,
      })
      void tree.listDir(path.dirname(normalized), { force: true })
    }

    const universerBase = (): string => {
      const o = univerBackendOrigin()
      if (o) return o.replace(/\/$/, "")
      if (typeof globalThis.location === "undefined") return ""
      return globalThis.location.origin.replace(/\/$/, "")
    }

    const seedOfficeVirtualRow = (
      dir: string,
      fp: string,
      base: { unitId: string; unitKind: SheetUnitSlot["kind"] },
      label: string,
      dirty: Set<string>,
    ) => {
      if (virtualOfficeFiles.has(fp)) return
      pushSlot(dir, fp, base.unitId, base.unitKind)
      ensure(fp)
      const mime = officeMimeType(fp)
      const body = {
        type: "binary" as const,
        encoding: "base64" as const,
        content: "",
        mimeType: mime,
        unitId: base.unitId,
        unitKind: base.unitKind,
      }
      setLoaded(fp, body)
      touchFileContent(fp, approxBytes(body as unknown as FileContent))
      evictContent(new Set([fp]))
      virtualOfficeFiles.set(fp, {
        path: fp,
        name: label,
        type: "file",
        absolute: fp,
        ignored: false,
      })
      dirty.add(path.normalizeDir(path.dirname(fp)))
    }

    createEffect(() => {
      const dir = scope()
      if (!dir) return
      const baseUrl = universerBase()
      if (!baseUrl) return
      void listPersistedUniverUnits(baseUrl)
        .then((units) => {
          if (scope() !== dir) return
          const dirty = new Set<string>()
          const known = new Set<string>()
          for (const fp of listSlotPathsForScope(dir)) {
            const slot = pullSlot(dir, fp)
            if (!slot) continue
            known.add(slot.id)
            seedOfficeVirtualRow(dir, path.normalize(fp), { unitId: slot.id, unitKind: slot.kind }, getFilename(fp), dirty)
          }
          for (const row of units) {
            if (known.has(row.id)) continue
            const fp = path.normalize(`univer-${row.id}.xlsx`)
            const stem = row.name.replace(/[/\\]/g, "-").trim() || row.id
            const label = stem.toLowerCase().endsWith(".xlsx") ? stem : `${stem}.xlsx`
            seedOfficeVirtualRow(dir, fp, { unitId: row.id, unitKind: "sheet" }, label, dirty)
          }
          for (const d of dirty) void tree.listDir(d, { force: true })
        })
        .catch((err: unknown) => {
          console.error("[veritly] listPersistedUniverUnits failed", err)
          throw err
        })
    })

    const mkdir = async (dirpath: string) => {
      void dirpath
      throw new Error(language.t("file.hostFilesystemDisabled"))
    }

    const remove = async (filepath: string, recursive = false) => {
      void filepath
      void recursive
      throw new Error(language.t("file.hostFilesystemDisabled"))
    }

    const stop = sdk.event.listen((e) => {
      invalidateFromWatcher(e.details, {
        normalize: path.normalize,
        hasFile: (file) => Boolean(store.file[file]),
        isOpen: (file) => tabs.all().some((tab) => path.pathFromTab(tab) === file),
        loadFile: (file) => {
          void load(file, { force: true })
        },
        node: tree.node,
        isDirLoaded: tree.isLoaded,
        refreshDir: (dir) => {
          void tree.listDir(dir, { force: true })
        },
      })
    })

    const get = (input: string) => {
      const file = path.normalize(input)
      const state = store.file[file]
      const content = state?.content
      if (!content) return state
      if (hasFileContent(file)) {
        touchFileContent(file)
        return state
      }
      touchFileContent(file, approxBytes(content))
      return state
    }

    function withPath(input: string, action: (file: string) => unknown) {
      return action(path.normalize(input))
    }
    const scrollTop = (input: string) => withPath(input, (file) => view().scrollTop(file))
    const scrollLeft = (input: string) => withPath(input, (file) => view().scrollLeft(file))
    const selectedLines = (input: string) => withPath(input, (file) => view().selectedLines(file))
    const setScrollTop = (input: string, top: number) => withPath(input, (file) => view().setScrollTop(file, top))
    const setScrollLeft = (input: string, left: number) => withPath(input, (file) => view().setScrollLeft(file, left))
    const setSelectedLines = (input: string, range: SelectedLineRange | null) =>
      withPath(input, (file) => view().setSelectedLines(file, range))

    onCleanup(() => {
      stop()
      viewCache.clear()
    })

    return {
      ready: () => view().ready(),
      normalize: path.normalize,
      tab: path.tab,
      pathFromTab: path.pathFromTab,
      tree: {
        list: tree.listDir,
        refresh: (input: string) => tree.listDir(input, { force: true }),
        state: tree.dirState,
        children: tree.children,
        expand: tree.expandDir,
        collapse: tree.collapseDir,
        toggle(input: string) {
          if (tree.dirState(input)?.expanded) {
            tree.collapseDir(input)
            return
          }
          tree.expandDir(input)
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
      upload,
      mkdir,
      remove,
      patchSpreadsheetUnit,
    }
  },
})
