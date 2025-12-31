import { createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { Permission } from "@opencode-ai/sdk/v2/client"
import { persisted } from "@/utils/persist"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "./global-sync"
import { useParams } from "@solidjs/router"

type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
  directory?: string
}) => void

const AUTO_ACCEPT_TYPES = new Set(["edit", "write"])

function shouldAutoAccept(perm: Permission) {
  return AUTO_ACCEPT_TYPES.has(perm.type)
}

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const params = useParams()
    const globalSDK = useGlobalSDK()
    const globalSync = useGlobalSync()

    const permissionsEnabled = createMemo(() => {
      if (!params.dir) return false
      const [store] = globalSync.child(params.dir)
      return store.config.permission !== undefined
    })

    const [store, setStore, _, ready] = persisted(
      "permission.v3",
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

    function respondOnce(permission: Permission, directory?: string) {
      if (responded.has(permission.id)) return
      responded.add(permission.id)
      respond({
        sessionID: permission.sessionID,
        permissionID: permission.id,
        response: "once",
        directory,
      })
    }

    function isAutoAccepting(sessionID: string) {
      return store.autoAcceptEdits[sessionID] ?? false
    }

    const unsubscribe = globalSDK.event.listen((e) => {
      const event = e.details
      if (event?.type !== "permission.updated") return

      const perm = event.properties
      if (!isAutoAccepting(perm.sessionID)) return
      if (!shouldAutoAccept(perm)) return

      respondOnce(perm, e.name)
    })
    onCleanup(unsubscribe)

    function enable(sessionID: string, directory: string) {
      setStore("autoAcceptEdits", sessionID, true)

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

    function disable(sessionID: string) {
      setStore("autoAcceptEdits", sessionID, false)
    }

    return {
      ready,
      respond,
      autoResponds(permission: Permission) {
        return isAutoAccepting(permission.sessionID) && shouldAutoAccept(permission)
      },
      isAutoAccepting,
      toggleAutoAccept(sessionID: string, directory: string) {
        if (isAutoAccepting(sessionID)) {
          disable(sessionID)
          return
        }

        enable(sessionID, directory)
      },
      enableAutoAccept(sessionID: string, directory: string) {
        if (isAutoAccepting(sessionID)) return
        enable(sessionID, directory)
      },
      disableAutoAccept(sessionID: string) {
        disable(sessionID)
      },
      permissionsEnabled,
    }
  },
})
