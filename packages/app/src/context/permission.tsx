import { createEffect, createMemo, createRoot, getOwner, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { PermissionRequest } from "@opencode-ai/client/promise"
import { Persist, persisted } from "@/utils/persist"
import type { ServerSDK } from "@/context/server-sdk"
import type { ServerSync } from "./server-sync"
import type { Data } from "@opencode-ai/client/solid"
import { useParams, useSearchParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"
import { useGlobal } from "./global"
import { ServerConnection, useServers } from "./servers"
import { type DraftTab, useTabs } from "./tabs"
import { useSettings } from "./settings"
import { requireServerKey } from "@/utils/session-route"
import { ServerScope } from "@/utils/server-scope"
import {
  acceptKey,
  directoryAcceptKey,
  isDirectoryAutoAccepting,
  autoRespondsPermission,
  relocateAutoAccept,
  sessionAutoAccept,
} from "./permission-auto-respond"
import { useServer } from "./server"

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

type PermissionEvent = Parameters<Parameters<ServerSDK["eventByDir"]["listen"]>[0]>[0]

export function createServerPermissionState(input: { sdk: ServerSDK; sync: ServerSync; data: Data }) {
  const [store, setStore, _, ready] = persisted(
    {
      ...Persist.serverGlobal(input.sdk.scope, "permission"),
      ...(input.sdk.scope === ServerScope.local ? { previousKey: "permission.v3" } : {}),
      migrate(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return value

        const data = value as Record<string, unknown>
        if (data.autoAccept) return value

        return {
          ...data,
          autoAccept:
            typeof data.autoAcceptEdits === "object" && data.autoAcceptEdits && !Array.isArray(data.autoAcceptEdits)
              ? data.autoAcceptEdits
              : {},
        }
      },
    },
    createStore({
      autoAccept: {} as Record<string, boolean>,
    }),
  )

  function enableConfiguredDirectory(directory: string) {
    if (meta.disposed || !ready()) return
    const [childStore] = input.sync.child(directory)
    if (childStore.config.permission !== "allow") return
    const key = directoryAcceptKey(directory)
    if (store.autoAccept[key] !== undefined) return
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = true
      }),
    )
  }

  const MAX_RESPONDED = 1000
  const RESPONDED_TTL_MS = 60 * 60 * 1000
  const responded = new Map<string, number>()
  const enableVersion = new Map<string, number>()
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
      })
      .catch(() => {
        responded.delete(request.permissionID)
      })
  }

  const list = async (directory: string) => {
    return input.sdk.api.permission.request.list({ location: { directory } }).then((result) => result.data)
  }

  function respondOnce(permission: PermissionRequest, directory?: string) {
    const now = Date.now()
    const hit = responded.has(permission.id)
    responded.delete(permission.id)
    responded.set(permission.id, now)
    pruneResponded(now)
    if (hit) return
    respond({
      sessionID: permission.sessionID,
      permissionID: permission.id,
      response: "once",
      directory,
    })
  }

  function sessions(_directory?: string) {
    return input.data.session.list()
  }

  function autoAccept(directory?: string) {
    if (!directory) return store.autoAccept
    const next = relocateAutoAccept(store.autoAccept, sessions(directory), directory)
    if (next !== store.autoAccept) setStore("autoAccept", reconcile(next))
    return next
  }

  function isAutoAccepting(sessionID: string, directory?: string) {
    return autoRespondsPermission(autoAccept(directory), sessions(directory), { sessionID }, directory)
  }

  function isAutoAcceptingDirectory(directory: string) {
    return isDirectoryAutoAccepting(store.autoAccept, directory)
  }

  function shouldAutoRespond(permission: PermissionRequest, directory?: string) {
    return autoRespondsPermission(autoAccept(directory), sessions(directory), permission, directory)
  }

  function isPending(permission: PermissionRequest) {
    const pending = input.data.session.permission.list(permission.sessionID)
    return pending === undefined || pending.some((item) => item.id === permission.id)
  }

  async function shouldAutoRespondResolved(permission: PermissionRequest, directory?: string) {
    const override = sessionAutoAccept(autoAccept(directory), sessions(directory), permission, directory)
    if (override !== undefined) return override
    const loaded = new Set<string>()
    while (!loaded.has(input.data.session.root(permission.sessionID))) {
      const root = input.data.session.root(permission.sessionID)
      loaded.add(root)
      if (input.data.session.get(root)) break
      await input.data.session.sync(root).catch(() => undefined)
    }
    if (meta.disposed || !input.data.session.get(permission.sessionID)) return false
    return shouldAutoRespond(permission, directory)
  }

  async function respondPending(
    permission: PermissionRequest,
    directory?: string,
    current: () => boolean = () => true,
  ) {
    if (!current() || !isPending(permission)) return
    if (!(await shouldAutoRespondResolved(permission, directory))) return
    if (meta.disposed || !current() || !isPending(permission)) return
    respondOnce(permission, directory)
  }

  function bumpEnableVersion(sessionID: string, directory?: string) {
    const key = acceptKey(sessionID, directory)
    const next = (enableVersion.get(key) ?? 0) + 1
    enableVersion.set(key, next)
    return next
  }

  const handlePermission = (e: PermissionEvent) => {
    const event = e.details
    if (event?.type !== "permission.asked") return
    void respondPending(event.properties, event.current?.location?.directory)
  }

  const unsubscribe = input.sdk.eventByDir.listen((event) => {
    if (ready()) {
      handlePermission(event)
      return
    }
    void ready.promise?.then(() => {
      if (meta.disposed) return
      handlePermission(event)
    })
  })
  onCleanup(() => {
    meta.disposed = true
    unsubscribe()
  })

  function enableDirectory(directory: string) {
    if (meta.disposed) return
    const key = directoryAcceptKey(directory)
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = true
      }),
    )

    list(directory)
      .then((permissions) => {
        if (meta.disposed) return
        if (!isAutoAcceptingDirectory(directory)) return
        for (const permission of permissions) {
          void respondPending(permission, directory, () => isAutoAcceptingDirectory(directory))
        }
      })
      .catch(() => undefined)
  }

  function disableDirectory(directory: string) {
    if (meta.disposed) return
    const key = directoryAcceptKey(directory)
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = false
      }),
    )
  }

  function enable(sessionID: string, directory: string) {
    if (meta.disposed) return
    const key = acceptKey(sessionID, directory)
    const version = bumpEnableVersion(sessionID, directory)
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = true
        delete draft.autoAccept[sessionID]
      }),
    )

    list(directory)
      .then((permissions) => {
        if (meta.disposed) return
        if (enableVersion.get(key) !== version) return
        if (!isAutoAccepting(sessionID, directory)) return
        for (const permission of permissions) {
          void respondPending(
            permission,
            directory,
            () => enableVersion.get(key) === version && isAutoAccepting(sessionID, directory),
          )
        }
      })
      .catch(() => undefined)
  }

  function disable(sessionID: string, directory?: string) {
    if (meta.disposed) return
    bumpEnableVersion(sessionID, directory)
    const key = directory ? acceptKey(sessionID, directory) : sessionID
    setStore(
      produce((draft) => {
        draft.autoAccept[key] = false
        if (!directory) return
        delete draft.autoAccept[sessionID]
      }),
    )
  }

  const api = {
    ready: () => !meta.disposed && ready(),
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
      if (meta.disposed) return
      if (isAutoAccepting(sessionID, directory)) {
        disable(sessionID, directory)
        return
      }

      enable(sessionID, directory)
    },
    toggleAutoAcceptDirectory(directory: string) {
      if (meta.disposed) return
      if (isAutoAcceptingDirectory(directory)) {
        disableDirectory(directory)
        return
      }
      enableDirectory(directory)
    },
    enableAutoAccept(sessionID: string, directory: string) {
      if (meta.disposed) return
      if (isAutoAccepting(sessionID, directory)) return
      enable(sessionID, directory)
    },
    disableAutoAccept(sessionID: string, directory?: string) {
      if (meta.disposed) return
      disable(sessionID, directory)
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
    enableConfiguredDirectory,
    permissionsEnabled(directory: string) {
      if (meta.disposed) return false
      const [childStore] = input.sync.child(directory)
      return hasPermissionPromptRules(childStore.config.permission)
    },
  }
}

export const usePermission = () => {
  const server = useServer()
  return server.ctx.permission
}
