import { batch, createComputed, createEffect, createMemo, on, onCleanup, untrack } from "solid-js"
import { createStore, produce, reconcile, unwrap } from "solid-js/store"
import type { FileContent } from "@opencode/plugin/gui"
import { abort } from "@opencode/util/abort"
import { isFileNotFoundError } from "@opencode/client/promise"
import { createSimpleContext } from "@opencode/ui/context"
import { showToast } from "@/shell/notifications/toast"
import { useParams } from "@solidjs/router"
import { getDirectory, getFilename } from "@opencode/util/path"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useLanguage } from "@/runtime/i18n/language"
import { usePluginAttachment } from "@/runtime/plugin/host-apis"
import { createPathHelpers } from "./path"
import { artifactKind, artifactMime } from "@opencode/util/artifact"
import { usePlatform } from "@/runtime/platform/platform"
import { fileStreamUrl } from "@/runtime/server/api"
import { fileContentFromBytes, headStreamedFile, streamedFileContent, streamedKinds } from "./artifact"
import { approxBytes, createFileContentCache } from "./content-cache"
import {
  createFileContentState,
  selectFileLoading,
  selectFileMissing,
  selectFileState,
  transitionFileContent,
  type FileContentEffect,
  type FileContentEvent,
  type FileContentState,
} from "./content-machine"
import { createFileViewCache } from "./view-cache"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import { createFileTreeStore } from "./tree-store"
import { invalidateFromWatcher } from "./watcher"
import { selectionFromLines, type FileState, type FileSelection, type SelectedLineRange } from "./types"

export type { FileSelection, SelectedLineRange, FileState }

export { selectionFromLines }

export const { use: useFile, provider: FileProvider } = createSimpleContext({
  name: "File",
  gate: false,
  init: () => {
    const sdk = useWorkspaceLocation()
    const params = useParams()
    const serverSDK = useServerSDK()
    const data = useData()
    const platform = usePlatform()
    const language = useLanguage()
    const attachment = usePluginAttachment()

    const scope = createMemo(() => sdk().directory)
    const path = createPathHelpers(scope)

    const cache = createFileContentCache()
    const [store, setStore] = createStore({ machine: createFileContentState(untrack(scope)) })

    // The edges of the reads the machine started: each path's read in flight, and the callers awaiting each path.
    const reads = new Map<string, AbortController>()

    const waiters = new Map<string, PromiseWithResolvers<void>>()

    const tree = createFileTreeStore({
      scope,
      normalizeDir: path.normalizeDir,
      list: (dir) =>
        serverSDK.api.file.list({ path: dir, location: { directory: scope() } }).then((x) =>
          x.data.map((entry) => ({
            ...entry,
            name: getFilename(entry.path),
            absolute: `${scope()}/${entry.path}`,
            ignored: false,
          })),
        ),
      onError: (message) => {
        showToast({
          variant: "error",
          title: language.t("toast.file.listFailed.title"),
          description: message,
        })
      },
    })

    const fileEntry = (file: string) => (store.machine.status === "active" ? store.machine.files[file] : undefined)

    const dispatch = (event: FileContentEvent) => {
      const previous = unwrap(store).machine
      const next = transitionFileContent(previous, event)

      if (next.state !== previous) write(previous, next.state)
      next.effects.forEach(execute)
    }

    // Replaces only the entries that changed, so other files' readers stay quiet and no content is deep-merged.
    const write = (previous: FileContentState, next: FileContentState) => {
      if (previous.status !== "active" || next.status !== "active" || previous.directory !== next.directory) {
        setStore("machine", reconcile(next))

        return
      }

      setStore(
        "machine",
        produce((draft) => {
          if (draft.status !== "active") return
          draft.issued = next.issued
          Object.keys(previous.files).forEach((key) => {
            if (!(key in next.files)) delete draft.files[key]
          })
          Object.entries(next.files).forEach(([key, value]) => {
            if (previous.files[key] !== value) draft.files[key] = value
          })
        }),
      )
    }

    const execute = (effect: FileContentEffect) => {
      if (effect.type === "read") return start(effect.directory, effect.path, effect.attempt)

      if (effect.type === "abort.all") {
        reads.forEach(abort)
        reads.clear()
        waiters.forEach((waiter) => waiter.resolve())
        waiters.clear()

        return
      }

      if (effect.type === "settle") {
        waiters.get(effect.path)?.resolve()
        waiters.delete(effect.path)

        return
      }

      if (effect.type === "cache.store") {
        cache.touch(effect.path, approxBytes(effect.content))
        // The file just read and the visible tab keep their content.
        const active = attachment.files.active()
        const evicted = cache.evict(new Set(active ? [effect.path, active] : [effect.path]))

        if (evicted.length > 0) dispatch({ type: "cache.evicted", paths: evicted })

        return
      }

      if (effect.type === "cache.remove") return cache.remove(effect.path)

      if (effect.type === "cache.reset") return cache.reset()

      showToast({
        variant: "error",
        title: language.t("toast.file.loadFailed.title"),
        description: effect.message,
      })
    }

    const start = (directory: string, file: string, attempt: number) => {
      const controller = new AbortController()
      reads.set(file, controller)

      // Files outside the workspace are read from their own directory, like markdown images.
      // The trailing separator from getDirectory keeps "/" and "C:/" valid, like readLocalImage.
      void Promise.resolve()
        .then(() =>
          isVirtualSkill(file)
            ? readBuiltin(file, directory)
            : read(
                file,
                path.absolute(file)
                  ? { path: getFilename(file), location: { directory: getDirectory(file) } }
                  : { path: file, location: { directory } },
                controller.signal,
              ),
        )
        .then(
          (content) => {
            release(file, controller)

            if (content) return dispatch({ type: "load.succeeded", path: file, attempt, content })

            dispatch({ type: "load.missing", path: file, attempt, error: file, opened: opened(file) })
          },
          (error) => {
            release(file, controller)

            // The media HEAD gave up on a server that sent no response.
            const message =
              error instanceof DOMException && error.name === "TimeoutError"
                ? language.t("common.requestFailed")
                : formatServerError(error, language.t, language.t("error.chain.unknown"))

            if (isFileNotFoundError(error)) {
              dispatch({ type: "load.missing", path: file, attempt, error: message, opened: opened(file) })

              return
            }

            dispatch({ type: "load.failed", path: file, attempt, error: message })
          },
        )
    }

    const release = (file: string, controller: AbortController) => {
      if (reads.get(file) === controller) reads.delete(file)
    }

    const opened = (file: string) => attachment.files.opened().includes(file)

    // The machine holds one directory's files. Drop them as soon as the directory changes, before any effect of the
    // same update reads the new one: a file tab can load its file before a later watcher runs, and a reset after that
    // load would discard its reply.
    createComputed(
      on(scope, (directory) => {
        batch(() => {
          dispatch({ type: "scope.changed", directory })
          tree.reset()
        })
      }),
    )

    const viewCache = createFileViewCache(serverSDK.scope)
    const view = createMemo(() => viewCache.load(scope(), params.id))

    // Media plays from the server's ranged reads, so only a HEAD runs here, for the file's size. A failed HEAD has no
    // body; the full read that follows reports the server's error. The API's request queue bounds the download's wait
    // for a response, and its body may take as long as it needs.
    const read = (file: string, request: { path: string; location: { directory: string } }, signal: AbortSignal) => {
      const download = () =>
        serverSDK.api.file.read(request, { signal }).then((data) => fileContentFromBytes(file, data))

      const url = streamedKinds.has(artifactKind(file))
        ? fileStreamUrl(serverSDK.http, { path: request.path, directory: request.location.directory })
        : undefined

      if (!url) return download()

      return headStreamedFile(platform.fetch ?? fetch, url, signal).then((response) =>
        response.ok ? streamedFileContent(file, url, response) : download(),
      )
    }

    // Built-in and virtual skills register `skill://` (or legacy `/builtin/`) paths whose content is inline in `/api/skill`.
    const isVirtualSkill = (file: string) => file.startsWith("skill://") || file.startsWith("/builtin/")

    const builtinSkill = async (file: string, directory: string) => {
      if (data.location.skill.list({ directory }) === undefined) {
        await data.location.skill.sync({ directory })
      }

      return (data.location.skill.list({ directory }) ?? data.location.skill.list())?.find((item) => item.path === file)
    }

    const readBuiltin = (file: string, directory: string): Promise<FileContent | undefined> =>
      builtinSkill(file, directory).then((skill) =>
        skill ? { type: "text", content: skill.content, mimeType: artifactMime(file) } : undefined,
      )

    const load = (input: string, options?: { force?: boolean; silent?: boolean }) => {
      const file = path.normalize(input)

      if (!file) return Promise.resolve()
      dispatch({ type: "load.requested", path: file, force: Boolean(options?.force), silent: Boolean(options?.silent) })
      const current = unwrap(store).machine

      if (current.status !== "active" || !selectFileLoading(current.files[file])) return Promise.resolve()
      const waiter = waiters.get(file) ?? Promise.withResolvers<void>()
      waiters.set(file, waiter)

      return waiter.promise
    }

    // Lists the parent directory instead of reading the file, so checking a path a message names transfers no content.
    const exists = (input: string) => {
      const file = path.normalize(input)

      if (!file) return Promise.resolve(false)

      if (isVirtualSkill(file)) {
        return builtinSkill(file, scope()).then(Boolean, () => false)
      }

      const parent = /[\\/]/.test(file) ? getDirectory(file) : undefined

      return serverSDK.api.file.list({ path: parent, location: { directory: scope() } }).then(
        (x) => x.data.some((entry) => entry.type === "file" && getFilename(entry.path) === getFilename(file)),
        () => false,
      )
    }

    const search = (query: string, dirs: "true" | "false", options?: { limit?: number; signal?: AbortSignal }) =>
      serverSDK.api.file
        .find(
          {
            location: { directory: sdk().directory },
            query,
            type: dirs === "true" ? undefined : "file",
            limit: options?.limit,
          },
          { signal: options?.signal },
        )
        .then(
          (x) => x.data.map((entry) => path.normalize(entry.path)),
          (error) => {
            if (options?.signal?.aborted) throw error

            return []
          },
        )

    createEffect(() => {
      const stop = sdk().event.on("filesystem.changed", (event) => {
        invalidateFromWatcher(event, {
          normalize: path.normalize,
          hasFile: (file) => fileEntry(file) !== undefined,
          isOpen: (file) => attachment.files.opened().includes(file),
          loadFile: (file) => {
            void load(file, { force: true, silent: true })
          },
          node: tree.node,
          isDirLoaded: tree.isLoaded,
          refreshDir: (dir) => {
            void tree.listDir(dir, { force: true })
          },
        })
      })

      onCleanup(stop)
    })

    // The server watches a file for 24 hours from the latest request, so file tabs ask when they open or are shown,
    // and the open tabs ask again on reconnect (a restarted server forgets its watches). Older servers lack the route.
    const watch = (input: string) => {
      const file = path.normalize(input)

      if (!file || path.absolute(file)) return
      void serverSDK.api.experimental.file.watch({ path: file, location: { directory: scope() } }).catch(() => {})
    }

    const unwatch = (input: string) => {
      const file = path.normalize(input)

      if (!file || path.absolute(file)) return
      void serverSDK.api.experimental.file.unwatch({ path: file, location: { directory: scope() } }).catch(() => {})
    }

    createEffect(() => {
      const stop = serverSDK.event.on("server.connected", () => attachment.files.opened().forEach(watch))

      onCleanup(stop)
    })

    const get = (input: string) => {
      const file = path.normalize(input)
      const state = selectFileState(file, fileEntry(file))

      // A read counts as use, so the files on screen are the last to lose their content.
      if (state?.content) cache.touch(file)

      return state
    }

    function withPath<T>(input: string, action: (file: string) => T) {
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
      dispatch({ type: "disposed" })
      viewCache.clear()
    })

    return {
      ready: () => view().ready(),
      normalize: path.normalize,
      absolute: path.absolute,
      tree: {
        list: tree.listDir,
        refresh: (input: string) => tree.listDir(input, { force: true }),
        state: tree.dirState,
        children: tree.children,
        expand: tree.expandDir,
        collapse: tree.collapseDir,
      },
      get,
      notFound: (input: string) => selectFileMissing(fileEntry(path.normalize(input))),
      load,
      watch,
      unwatch,
      exists,
      scrollTop,
      scrollLeft,
      setScrollTop,
      setScrollLeft,
      selectedLines,
      setSelectedLines,
      searchFiles: (query: string, options?: { limit?: number; signal?: AbortSignal }) =>
        search(query, "false", options),
      searchFilesAndDirectories: (query: string, options?: { limit?: number; signal?: AbortSignal }) =>
        search(query, "true", options),
    }
  },
})
