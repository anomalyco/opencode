import { batch, createComputed, createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
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
import { fileContentFromBytes, streamedFileContent, streamedKinds } from "./artifact"
import {
  approxBytes,
  evictContentLru,
  hasFileContent,
  removeFileContentBytes,
  resetFileContentLru,
  touchFileContent,
} from "./content-cache"
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

    const inflight = new Map<string, { promise: Promise<void>; silent: boolean }>()

    const [store, setStore] = createStore<{
      file: Record<string, FileState>
    }>({
      file: {},
    })

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

    // The store holds one directory's files. Drop them as soon as the directory changes, before any effect of the same
    // update reads the new one: a file tab can load its file before a later watcher runs, and a reset after that load
    // would discard its reply.
    createComputed(
      on(scope, () => {
        inflight.clear()
        resetFileContentLru()
        batch(() => {
          setStore("file", reconcile({}))
          tree.reset()
        })
      }),
    )

    const viewCache = createFileViewCache(serverSDK.scope)
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
          draft.notFound = false
          draft.content = content
        }),
      )
    }

    const setLoadError = (file: string, message: string, notFound = false, silent = false) => {
      if (notFound) removeFileContentBytes(file)
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loading = false
          draft.notFound = notFound
          draft.error = message

          if (!notFound) return
          draft.loaded = false
          draft.content = undefined
        }),
      )

      if (silent || (notFound && attachment.files.opened().includes(file))) return

      showToast({
        variant: "error",
        title: language.t("toast.file.loadFailed.title"),
        description: message,
      })
    }

    // Media plays from the server's ranged reads, so only a HEAD runs here, for the file's size. A failed HEAD has no
    // body; the full read that follows reports the server's error.
    const read = (file: string, request: { path: string; location: { directory: string } }) => {
      const download = () => serverSDK.api.file.read(request).then((data) => fileContentFromBytes(file, data))

      const url = streamedKinds.has(artifactKind(file))
        ? fileStreamUrl(serverSDK.http, { path: request.path, directory: request.location.directory })
        : undefined

      if (!url) return download()

      return (platform.fetch ?? fetch)(url, { method: "HEAD" }).then((response) =>
        response.ok ? streamedFileContent(file, url, response) : download(),
      )
    }

    // Built-in skills register virtual `/builtin/*.md` paths whose content is inline in `/api/skill`.
    const builtinSkill = async (file: string, directory: string) => {
      if (data.location.skill.list({ directory }) === undefined) {
        await data.location.skill.sync({ directory })
      }

      return (data.location.skill.list({ directory }) ?? data.location.skill.list())?.find((item) => item.path === file)
    }

    const readBuiltin = (file: string, directory: string): Promise<FileState["content"]> =>
      builtinSkill(file, directory).then((skill) =>
        skill ? { type: "text", content: skill.content, mimeType: artifactMime(file) } : undefined,
      )

    const load = (input: string, options?: { force?: boolean; silent?: boolean }) => {
      const file = path.normalize(input)

      if (!file) return Promise.resolve()

      const directory = scope()
      const key = `${directory}\n${file}`
      ensure(file)

      const current = store.file[file]

      if (!options?.force && current?.loaded) return Promise.resolve()

      const silent = Boolean(options?.silent)
      const pending = inflight.get(key)

      if (pending) {
        if (!silent) pending.silent = false

        return pending.promise
      }

      setLoading(file)

      const entry = {
        silent,
        promise: Promise.resolve(),
      }

      // Files outside the workspace are read from their own directory, like markdown images.
      // The trailing separator from getDirectory keeps "/" and "C:/" valid, like readLocalImage.
      const source = file.startsWith("/builtin/")
        ? readBuiltin(file, directory)
        : read(
            file,
            path.absolute(file)
              ? { path: getFilename(file), location: { directory: getDirectory(file) } }
              : { path: file, location: { directory } },
          )

      entry.promise = source
        .then((content) => {
          if (scope() !== directory) return

          if (!content) {
            setLoadError(file, file, true, entry.silent)

            return
          }

          setLoaded(file, content)
          touchFileContent(file, approxBytes(content))
          evictContent(new Set([file]))
        })
        .catch((e) => {
          if (scope() !== directory) return
          setLoadError(
            file,
            formatServerError(e, language.t, language.t("error.chain.unknown")),
            isFileNotFoundError(e),
            entry.silent,
          )
        })
        .finally(() => {
          inflight.delete(key)
        })

      inflight.set(key, entry)

      return entry.promise
    }

    // Lists the parent directory instead of reading the file, so checking a path a message names transfers no content.
    const exists = (input: string) => {
      const file = path.normalize(input)

      if (!file) return Promise.resolve(false)

      if (file.startsWith("/builtin/")) {
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
          hasFile: (file) => Boolean(store.file[file]),
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
      notFound: (input: string) => store.file[path.normalize(input)]?.notFound ?? false,
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
