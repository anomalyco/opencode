import type { Config, Path, Project, ProviderAuthResponse } from "@/runtime/server/types"
import { showToast } from "@/shell/notifications/toast"
import { getFilename } from "@opencode-ai/util/path"
import { getOwner, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { type ServerSDK } from "./client"
import { bootstrapDirectory, bootstrapGlobal, loadGlobalConfigQuery, loadPathQuery } from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import type { ProjectMeta } from "./global-sync/types"
import { formatServerError } from "@/runtime/server/errors"
import { queryOptions, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createRefreshQueue } from "./global-sync/queue"
import { directoryKey, updateProjectInfo } from "./global-sync/utils"
import { PathKey } from "@/workspaces/path-key"
import type { ServerScope } from "@/runtime/server/scope"
import { persisted } from "@/runtime/persistence/storage"
import type { ServerApi } from "@/runtime/server/api"
import { toggleMcp } from "./global-sync/mcp"
import { createConnectionSync } from "./server-sync/connection"
import { usePlatform } from "@/runtime/platform/platform"
import type { Data } from "@opencode-ai/client/solid"

type GlobalStore = {
  path: Path
  project: Project[]
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

export const loadLspQuery = (scope: ServerScope, directory: string) =>
  queryOptions({
    queryKey: [scope, directory, "lsp"] as const,
    // TODO: Restore LSP status when the V2 client exposes an LSP API.
    queryFn: async () => [],
  })

function makeQueryOptionsApi(scope: ServerScope, serverAPI: () => ServerApi) {
  return {
    globalConfig: () => loadGlobalConfigQuery(scope),
    path: () => loadPathQuery(scope, null, serverAPI().location),
    lsp: (directory: PathKey) => loadLspQuery(scope, directory),
  }
}
export type QueryOptionsApi = ReturnType<typeof makeQueryOptionsApi>

export function createServerSyncContextInner(serverSDK: ServerSDK, data: Data) {
  const language = useLanguage()
  const platform = usePlatform()
  const owner = getOwner()
  if (!owner) throw new Error("ServerSync must be created within owner")

  const booting = new Map<string, Promise<void>>()
  const queryOptionsApi = makeQueryOptionsApi(serverSDK.scope, () => serverSDK.api)
  const connected = () => serverSDK.connection.status() === "connected"

  const [configQuery, pathQuery] = useQueries(() => ({
    queries: [
      { ...queryOptionsApi.globalConfig(), enabled: connected() },
      { ...queryOptionsApi.path(), enabled: connected() },
    ],
  }))
  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    project: [],
    provider_auth: {},
    get path() {
      const EMPTY = { state: "", config: "", worktree: "", directory: "", home: "" }
      if (pathQuery.isPending) return EMPTY
      return pathQuery.data ?? EMPTY
    },
    get config() {
      if (configQuery.isPending) return {}
      return configQuery.data ?? {}
    },
    get reload() {
      return updateConfigMutation.isPending ? "pending" : undefined
    },
  })

  const queryClient = useQueryClient()
  const bootstrap = useQuery(() => ({
    queryKey: [serverSDK.scope, "bootstrap"],
    queryFn: async () => {
      await bootstrapGlobal({
        serverAPI: serverSDK.api,
        scope: serverSDK.scope,
        setGlobalStore,
        queryClient,
      })
      return Date.now()
    },
    enabled: connected(),
  }))

  const paused = () => untrack(() => globalStore.reload) !== undefined

  const queue = createRefreshQueue({
    paused,
    key: directoryKey,
    bootstrap: () => queryClient.fetchQuery({ queryKey: [serverSDK.scope, "bootstrap"] }),
    bootstrapInstance,
  })

  const children = createChildStoreManager({
    owner,
    connected,
    scope: serverSDK.scope,
    persist: persisted,
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: () => false,
    onBootstrap: (directory) => {
      if (!connected()) return
      void bootstrapInstance(directory)
    },
    onMcp: (directory) => {
      void Promise.all([
        data.location.command.sync({ directory }),
        data.location.mcp.server.sync({ directory }),
        data.location.mcp.resource.sync({ directory }),
      ]).catch((err) => {
        showToast({
          variant: "error",
          title: language.t("toast.project.reloadFailed.title", { project: getFilename(directory) }),
          description: formatServerError(err, language.t),
        })
      })
    },
    onDispose: (directory) => {
      const key = directoryKey(directory)
      queue.clear(key)
    },
    translate: language.t,
    queryOptions: queryOptionsApi,
    data,
    global: {
      get path() {
        return globalStore.path
      },
    },
  })
  const connection = createConnectionSync({
    status: serverSDK.connection.status,
    invalidate: () => {
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === serverSDK.scope,
        refetchType: "none",
      })
    },
    connected: (info) => {
      if (bootstrap.data !== undefined && !bootstrap.isFetching) void bootstrap.refetch()
      Object.keys(children.children)
        .filter(children.active)
        .forEach((directory) => {
          queue.push(directory)
          void data.location.sync({ directory }).catch(() => undefined)
        })
    },
  })

  async function bootstrapInstance(directory: string) {
    const key = directoryKey(directory)
    if (!key) return
    const pending = booting.get(key)
    if (pending) return pending

    children.pin(key)
    const promise = Promise.resolve().then(async () => {
      const child = children.ensureChild(directory)
      await Promise.all([
        data.location.sync({ directory }),
        bootstrapDirectory({
          directory,
          scope: serverSDK.scope,
          mcp: children.mcp(key),
          global: {
            config: globalStore.config,
            path: globalStore.path,
            project: globalStore.project,
          },
          api: serverSDK.api,
          store: child[0],
          setStore: child[1],
          translate: language.t,
          queryClient,
        }),
      ])
    })

    booting.set(key, promise)
    void promise.finally(() => {
      booting.delete(key)
      children.unpin(key)
    })
    return promise
  }

  function applyProjectUpdate(update: Parameters<typeof updateProjectInfo>[1]) {
    setGlobalStore("project", (projects) =>
      projects.map((project) => (project.id === update.id ? updateProjectInfo(project, update) : project)),
    )
  }

  const unsub = serverSDK.event.listen((event) => {
    connection.handleEvent({ type: event.type })
    if (event.type === "project.updated") applyProjectUpdate(event.data)

    if (!event.location) {
      if (event.type === "config.updated" || event.type === "agent.updated" || event.type === "worktree.updated")
        bootstrap.refetch()
      return
    }

    const directory = event.location.directory
    const key = directoryKey(directory)
    if (!children.children[key]) return
    children.mark(key)
    if (event.type === "config.updated" || event.type === "agent.updated") queue.push(key)
    if (event.type === "worktree.updated") void bootstrap.refetch()
  })

  onCleanup(unsub)
  onCleanup(() => {
    queue.dispose()
  })
  onCleanup(() => {
    for (const directory of Object.keys(children.children)) {
      children.disposeDirectory(directoryKey(directory))
    }
  })

  const projectApi = {
    update: applyProjectUpdate,
    meta(directory: string, patch: ProjectMeta) {
      children.projectMeta(directory, patch)
    },
    icon(directory: string, value: string | undefined) {
      children.projectIcon(directory, value)
    },
  }

  const updateConfigMutation = useMutation(() => ({
    mutationFn: async (config: Config) => {
      // TODO: Restore config updates when the V2 client exposes a config API.
      // await serverSDK.api.config.update({ config })
      throw new Error(`Config updates are unavailable: ${Object.keys(config).length} fields were not saved`)
    },
    onSuccess: () => {
      bootstrap.refetch()
      data.location.provider.invalidate()
      data.location.model.invalidate()
      void Promise.all([data.location.provider.sync(), data.location.model.sync()])
    },
  }))

  return {
    data: globalStore,
    set: setGlobalStore,
    child: children.child,
    disableMcp: children.disableMcp,
    // bootstrap,
    updateConfig: updateConfigMutation.mutateAsync,
    project: projectApi,
    mcp: {
      toggle: async (directory: string, name: string) => {
        const key = directoryKey(directory)
        const status = children.child(key, { bootstrap: false })[0].mcp[name]?.status
        if (!status) return
        await toggleMcp({
          status,
          connect: async () => {
            await serverSDK.api.mcp.connect({ server: name, location: { directory: key } })
          },
          disconnect: async () => {
            await serverSDK.api.mcp.disconnect({ server: name, location: { directory: key } })
          },
          authenticate: async () => {
            const server = (await serverSDK.api.mcp.list({ location: { directory: key } })).data.find(
              (item) => item.name === name,
            )
            if (!server?.integrationID) throw new Error(`MCP server ${name} has no authentication integration`)
            const integration = await serverSDK.api.integration.get({
              integrationID: server.integrationID,
              location: { directory: key },
            })
            const method = integration.data?.methods.find((item) => item.type === "oauth" && !item.form?.length)
            if (!method || method.type !== "oauth")
              throw new Error(`MCP server ${name} requires an interactive authentication form`)
            const attempt = await serverSDK.api.integration.oauth.connect({
              integrationID: server.integrationID,
              methodID: method.id,
              location: { directory: key },
            })
            platform.openExternal(attempt.data.url)
          },
          refresh: async () => {
            data.location.mcp.server.invalidate({ directory: key })
            data.location.mcp.resource.invalidate({ directory: key })
            await Promise.all([
              data.location.mcp.server.sync({ directory: key }),
              data.location.mcp.resource.sync({ directory: key }),
            ])
          },
        })
      },
    },
  }
}

export function createServerSyncContext(serverSDK: ServerSDK, data: Data) {
  return createServerSyncContextInner(serverSDK, data)
}

export type ServerSync = ReturnType<typeof createServerSyncContext>
