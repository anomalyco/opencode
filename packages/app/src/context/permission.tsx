import { createMemo, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { Persist, persisted } from "@/utils/persist"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "./global-sync"
import { useParams } from "@solidjs/router"
import { base64Decode, base64Encode } from "@opencode-ai/util/encode"

type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
  directory?: string
}) => void

function shouldAutoAccept(perm: PermissionRequest) {
  return perm.permission === "edit"
}

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

function hasAutoAcceptPermissionConfig(permission: unknown) {
  if (!permission) return false
  if (typeof permission === "string") return permission !== "allow"
  if (typeof permission !== "object") return false
  if (Array.isArray(permission)) return false

  const config = permission as Record<string, unknown>
  if (isNonAllowRule(config.edit)) return true
  if (isNonAllowRule(config.write)) return true

  return false
}

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const params = useParams()
    const globalSDK = useGlobalSDK()
    const globalSync = useGlobalSync()

    const permissionsEnabled = createMemo(() => {
      const directory = params.dir ? base64Decode(params.dir) : undefined
      if (!directory) return false
      const [store] = globalSync.child(directory)
      return hasAutoAcceptPermissionConfig(store.config.permission)
    })

    const [store, setStore, _, ready] = persisted(
      Persist.global("permission", ["permission.v3"]),
      createStore({
        autoAcceptEdits: {} as Record<string, boolean>,
      }),
    )

    const responded = new Set<string>()

    const respond: PermissionRespondFn = (input) => {
      globalSDK.client.permission.respond(input).catch(() => {
        responded.delete(input.permissionID)
      })
    }

    function respondOnce(permission: PermissionRequest, directory?: string) {
      if (responded.has(permission.id)) return
      responded.add(permission.id)
      respond({
        sessionID: permission.sessionID,
        permissionID: permission.id,
        response: "once",
        directory,
      })
    }

    function acceptKey(sessionID: string, directory?: string) {
      if (!directory) return sessionID
      return `${base64Encode(directory)}/${sessionID}`
    }

    function isAutoAccepting(sessionID: string, directory?: string) {
      const key = acceptKey(sessionID, directory)
      return store.autoAcceptEdits[key] ?? store.autoAcceptEdits[sessionID] ?? false
    }

    const unsubscribe = globalSDK.event.listen((e) => {
      const event = e.details
      if (event?.type !== "permission.asked") return

      const perm = event.properties
      if (!isAutoAccepting(perm.sessionID, e.name)) return
      if (!shouldAutoAccept(perm)) return

      respondOnce(perm, e.name)
    })
    onCleanup(unsubscribe)

    function enable(sessionID: string, directory: string) {
      const key = acceptKey(sessionID, directory)
      setStore(
        produce((draft) => {
          draft.autoAcceptEdits[key] = true
          delete draft.autoAcceptEdits[sessionID]
        }),
      )

      globalSDK.client.permission
        .list({ directory })
        .then((x) => {
          for (const perm of x.data ?? []) {
            if (!perm?.id) continue
            if (perm.sessionID !== sessionID) continue
            if (!shouldAutoAccept(perm)) continue
            respondOnce(perm, directory)
          }
        })
        .catch(() => undefined)
    }

    function disable(sessionID: string, directory?: string) {
      const key = directory ? acceptKey(sessionID, directory) : undefined
      setStore(
        produce((draft) => {
          if (key) delete draft.autoAcceptEdits[key]
          delete draft.autoAcceptEdits[sessionID]
        }),
      )
    }

    return {
      ready,
      respond,
      autoResponds(permission: PermissionRequest, directory?: string) {
        return isAutoAccepting(permission.sessionID, directory) && shouldAutoAccept(permission)
      },
      isAutoAccepting,
      toggleAutoAccept(sessionID: string, directory: string) {
        if (isAutoAccepting(sessionID, directory)) {
          disable(sessionID, directory)
          return
        }

        enable(sessionID, directory)
      },
      enableAutoAccept(sessionID: string, directory: string) {
        if (isAutoAccepting(sessionID, directory)) return
        enable(sessionID, directory)
      },
      disableAutoAccept(sessionID: string, directory?: string) {
        disable(sessionID, directory)
      },
      permissionsEnabled,
    }
  },
})
