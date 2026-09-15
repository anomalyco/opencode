import { createEffect, createMemo, createRoot, getOwner, onCleanup, type Accessor } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import type { ServerSDK } from "@/context/server-sdk"
import type { ServerSync } from "./server-sync"
import { useParams, useSearchParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"
import { useGlobal } from "./global"
import { ServerConnection, useServer } from "./server"
import { type DraftTab, useTabs } from "./tabs"
import { useSettings } from "./settings"
import { requireServerKey } from "@/utils/session-route"
import type { ServerScope } from "@/utils/server-scope"
import { normalizePermissionRequest } from "./global-sync/utils"

type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
  directory?: string
}) => void

function isNonAllowRule(rule: unknown) {
  if (!rule) return false
  if (typeof rule === "string") return rule !== "allow"
  if (typeof rule !== "object") return false
  if (Array.isArray(rule)) return false

  for (const action of Object.values(rule)) {
    if (action !== "allow") return true
  }

  return false
}

function hasPermissionPromptRules(permission: unknown) {
  if (!permission) return false
  if (typeof permission === "string") return permission !== "allow"
  if (typeof permission !== "object") return false
  if (Array.isArray(permission)) return false

  const config = permission as Record<string, unknown>
  return Object.values(config).some(isNonAllowRule)
}

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  gate: false,
  init: () => {
    const params = useParams<{ serverKey?: string; dir?: string; id?: string }>()
    const [search] = useSearchParams<{ draftId?: string }>()
    const global = useGlobal()
    const server = useServer()
    const tabs = useTabs()
    const settings = useSettings()
    const owner = getOwner()
    const states = new Map<ServerScope, { key: ServerConnection.Key; dispose: () => void; state: PermissionState }>()

    const activeDraft = createMemo(() => {
      if (!search.draftId) return
      return tabs.store.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === search.draftId)
    })

    const activeServer = createMemo(() => {
      if (params.serverKey && settings.general.newLayoutDesigns()) return requireServerKey(params.serverKey)
      return activeDraft()?.server ?? server.key
    })

    const ensure = (key: ServerConnection.Key) => {
      const conn = global.servers.list().find((item) => ServerConnection.key(item) === key)
      if (!conn) throw new Error(`Permission server not found: ${key}`)
      const ctx = global.ensureServerCtx(conn)
      const existing = states.get(ctx.sdk.scope)
      if (existing && global.servers.list().some((item) => ServerConnection.key(item) === existing.key)) {
        return existing.state
      }
      if (existing) {
        existing.dispose()
        states.delete(ctx.sdk.scope)
      }
      const root = createRoot(
        (dispose) => ({
          key,
          dispose,
          state: createServerPermissionState({
            sdk: ctx.sdk,
            sync: ctx.sync,
            autoApprove: settings.permissions.autoApprove,
            setAutoApprove: settings.permissions.setAutoApprove,
          }),
        }),
        owner ?? undefined,
      )
      states.set(ctx.sdk.scope, root)
      return root.state
    }

    createEffect(() => {
      global.servers.list().forEach((conn) => ensure(ServerConnection.key(conn)))
    })

    createEffect(() => {
      const list = global.servers.list()
      const keys = new Set(list.map(ServerConnection.key))
      states.forEach((value, scope) => {
        if (keys.has(value.key)) return
        value.dispose()
        states.delete(scope)
        const replacement = list.find((conn) => server.scope(ServerConnection.key(conn)) === scope)
        if (replacement) ensure(ServerConnection.key(replacement))
      })
    })

    onCleanup(() => states.forEach((value) => value.dispose()))

    let lastSelected: PermissionState | undefined
    const selected = () => {
      const key = activeServer()
      if (global.servers.list().some((conn) => ServerConnection.key(conn) === key)) {
        lastSelected = ensure(key)
      }
      if (lastSelected) return lastSelected
      return ensure(server.key)
    }
    const activeDirectory = createMemo(() => {
      const directory = decode64(params.dir)
      if (directory) return directory
      const draft = activeDraft()
      if (draft) return draft.directory
      if (!params.id) return
      if (!global.servers.list().some((conn) => ServerConnection.key(conn) === activeServer())) return
      return selected().sync.session.lineage.peek(params.id)?.session.directory
    })

    const permissionsEnabled = createMemo(() => {
      const directory = activeDirectory()
      if (!directory) return false
      return selected().permissionsEnabled(directory)
    })

    return {
      ready: () => selected().ready(),
      ensureServerState: (key: ServerConnection.Key) => ensure(key).api,
      currentServerState: () => selected().api,
      respond(input: Parameters<PermissionRespondFn>[0]) {
        selected().respond(input)
      },
      autoResponds(permission: PermissionRequest, directory?: string) {
        return selected().autoResponds(permission, directory)
      },
      isAutoAccepting(sessionID: string, directory?: string) {
        return selected().isAutoAccepting(sessionID, directory)
      },
      isAutoAcceptingDirectory(directory: string) {
        return selected().isAutoAcceptingDirectory(directory)
      },
      toggleAutoAccept(sessionID: string, directory: string) {
        selected().toggleAutoAccept(sessionID, directory)
      },
      toggleAutoAcceptDirectory(directory: string) {
        selected().toggleAutoAcceptDirectory(directory)
      },
      enableAutoAccept(sessionID: string, directory: string) {
        selected().enableAutoAccept(sessionID, directory)
      },
      disableAutoAccept(sessionID: string, directory?: string) {
        selected().disableAutoAccept(sessionID, directory)
      },
      permissionsEnabled,
      isPermissionAllowAll(directory: string) {
        return selected().isPermissionAllowAll(directory)
      },
    }
  },
})

type PermissionState = ReturnType<typeof createServerPermissionState>
type PermissionEvent = Parameters<Parameters<ServerSDK["event"]["listen"]>[0]>[0]

function createServerPermissionState(input: {
  sdk: ServerSDK
  sync: ServerSync
  autoApprove: Accessor<boolean>
  setAutoApprove: (value: boolean) => void
}) {
  const MAX_RESPONDED = 1000
  const RESPONDED_TTL_MS = 60 * 60 * 1000
  const AUTO_RESPONSE_RETRY_LIMIT = 2
  const AUTO_RESPONSE_RETRY_DELAY_MS = 1000
  const responded = new Map<string, number>()
  const meta = { disposed: false }

  function pruneResponded(now: number) {
    for (const [id, ts] of responded) {
      if (now - ts < RESPONDED_TTL_MS) break
      responded.delete(id)
    }

    for (const id of responded.keys()) {
      if (responded.size <= MAX_RESPONDED) break
      responded.delete(id)
    }
  }

  const respond: PermissionRespondFn = (request) => {
    if (meta.disposed) return
    input.sdk.api.permission
      .reply({
        sessionID: request.sessionID,
        requestID: request.permissionID,
        reply: request.response,
        location: request.directory ? { directory: request.directory } : undefined,
      })
      .catch(() => {
        responded.delete(request.permissionID)
      })
  }

  const list = async (directory: string) => {
    if ((await input.sdk.protocol) === "v1") {
      return (await input.sdk.client.permission.list({ directory })).data ?? []
    }
    return input.sdk.api.permission.request
      .list({ location: { directory } })
      .then((result) => result.data.map(normalizePermissionRequest))
  }

  function respondOnce(permission: PermissionRequest, directory?: string, attempt = 0) {
    if (meta.disposed || !input.autoApprove()) return
    const now = Date.now()
    const hit = responded.has(permission.id)
    responded.delete(permission.id)
    responded.set(permission.id, now)
    pruneResponded(now)
    if (hit) return
    input.sdk.api.permission
      .reply({
        sessionID: permission.sessionID,
        requestID: permission.id,
        reply: "once",
        location: directory ? { directory } : undefined,
      })
      .catch(() => {
        responded.delete(permission.id)
        if (meta.disposed || !input.autoApprove() || attempt >= AUTO_RESPONSE_RETRY_LIMIT) return
        setTimeout(() => respondOnce(permission, directory, attempt + 1), AUTO_RESPONSE_RETRY_DELAY_MS * (attempt + 1))
      })
  }

  function sessions(directory?: string) {
    const info = Object.values(input.sync.session.data.info).filter((session) => !!session)
    if (!directory) return info
    return [...info, ...input.sync.child(directory, { bootstrap: false })[0].session]
  }

  function isAutoAccepting(sessionID: string, directory?: string) {
    void sessionID
    void directory
    return input.autoApprove()
  }

  function isAutoAcceptingDirectory(directory: string) {
    void directory
    return input.autoApprove()
  }

  function shouldAutoRespond(permission: PermissionRequest, directory?: string) {
    void permission
    void directory
    return input.autoApprove()
  }

  const SWEEP_RETRY_LIMIT = 2
  let sweepGeneration = 0

  function sweepPending(attempt = 0, generation = ++sweepGeneration) {
    if (meta.disposed || !input.autoApprove()) return
    void input.sdk.api.session
      .active()
      .then((active) =>
        Promise.all(
          Object.keys(active).map((sessionID) =>
            input.sync.session.resolve(sessionID, { force: true }).then(
              () => true,
              () => false,
            ),
          ),
        ),
      )
      .then((resolved) =>
        Promise.all(
          [
            ...new Set(
              sessions()
                .map((session) => session.directory)
                .filter((directory): directory is string => !!directory),
            ),
          ].map((directory) =>
            list(directory).then(
              (permissions) => {
                permissions.forEach((permission) => respondOnce(permission, directory))
                return true
              },
              () => false,
            ),
          ),
        ).then((listed) => resolved.every(Boolean) && listed.every(Boolean)),
      )
      .catch(() => false)
      .then((complete) => {
        if (complete || meta.disposed || !input.autoApprove() || generation !== sweepGeneration) return
        if (attempt >= SWEEP_RETRY_LIMIT) return
        setTimeout(() => sweepPending(attempt + 1, generation), 1000 * (attempt + 1))
      })
  }

  const handlePermission = (e: PermissionEvent) => {
    const event = e.details
    if (event?.type === "server.connected") {
      sweepPending()
      return
    }
    if (event?.type !== "permission.asked") return
    respondOnce(event.properties, e.name)
  }

  const unsubscribe = input.sdk.event.listen((event) => {
    handlePermission(event)
  })
  onCleanup(() => {
    meta.disposed = true
    unsubscribe()
  })

  createEffect(() => {
    if (!input.autoApprove()) {
      sweepGeneration++
      return
    }
    sweepPending()
  })

  const api = {
    ready: () => !meta.disposed,
    respond,
    autoResponds(permission: PermissionRequest, directory?: string) {
      if (meta.disposed) return false
      return shouldAutoRespond(permission, directory)
    },
    isAutoAccepting(sessionID: string, directory?: string) {
      if (meta.disposed) return false
      return isAutoAccepting(sessionID, directory)
    },
    isAutoAcceptingDirectory(directory: string) {
      if (meta.disposed) return false
      return isAutoAcceptingDirectory(directory)
    },
    toggleAutoAccept(sessionID: string, directory: string) {
      void sessionID
      void directory
      if (meta.disposed) return
      input.setAutoApprove(!input.autoApprove())
    },
    toggleAutoAcceptDirectory(directory: string) {
      void directory
      if (meta.disposed) return
      input.setAutoApprove(!input.autoApprove())
    },
    enableAutoAccept(sessionID: string, directory: string) {
      void sessionID
      void directory
      if (meta.disposed) return
      if (input.autoApprove()) return
      input.setAutoApprove(true)
    },
    disableAutoAccept(sessionID: string, directory?: string) {
      void sessionID
      void directory
      if (meta.disposed) return
      if (!input.autoApprove()) return
      input.setAutoApprove(false)
    },
    isPermissionAllowAll(directory: string) {
      if (meta.disposed) return false
      const [childStore] = input.sync.child(directory)
      return childStore.config.permission === "allow"
    },
  }

  return {
    ...api,
    api,
    sync: input.sync,
    permissionsEnabled(directory: string) {
      if (meta.disposed) return false
      const [childStore] = input.sync.child(directory)
      return hasPermissionPromptRules(childStore.config.permission)
    },
  }
}
