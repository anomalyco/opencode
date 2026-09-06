import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { FormInfo, PermissionRequest } from "@opencode-ai/client/promise"
import { useParams } from "@solidjs/router"
import { showToast } from "@/shell/notifications/toast"
import { useServerSDK } from "@/runtime/server/client"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { useWorkspaceLocation } from "@/workspaces/location"
import { sessionPermissionRequest, sessionFormRequest, sessionTreeIDs } from "@/session/requests/session-request-tree"
import { createWebSearchRequest } from "./websearch"
import { createSessionBackground } from "@/session/requests/background"
import { useData } from "@/runtime/server/current"

export function createSessionRequestModel() {
  const params = useParams()
  const sdk = useWorkspaceLocation()
  const serverSDK = useServerSDK()
  const data = useData()
  const language = useLanguage()
  const settings = useSettings()
  createEffect(() => {
    const id = params.id
    if (!id || serverSDK.connection.status() !== "connected") return
    void Promise.all([
      data.shell.sync({ directory: sdk().directory }),
      data.session.permission.sync(id),
    ]).catch(() => undefined)
  })
  createEffect(() => {
    const id = params.id
    if (!id || serverSDK.connection.status() !== "connected") return
    void Promise.all(
      sessionTreeIDs(data.session.list(), id).map((sessionID) => data.session.form.sync(sessionID)),
    ).catch(() => undefined)
  })

  const formRequest = createMemo((): FormInfo | undefined => {
    return sessionFormRequest(data.session.list(), data.session.form.list, params.id)
  })
  const websearch = createWebSearchRequest({
    owner: () => params.id,
    connected: () => serverSDK.connection.status() === "connected",
    request: () => {
      const form = formRequest()
      return form?.metadata?.kind === "websearch.provider" ? form : undefined
    },
    providers: async (sessionID) => {
      const session = data.session.get(sessionID) ?? (await serverSDK.api.session.get({ sessionID }))
      const result = await serverSDK.api.websearch.providers({
        location: { directory: session.location.directory, workspace: session.location.workspaceID },
      })
      return result.data.map((provider) => ({ value: provider.id, label: provider.name }))
    },
    reply: (input) => data.session.form.reply(input),
    events: serverSDK.event,
  })
  const questionRequest = createMemo(() => {
    if (websearch.request()) return
    const form = formRequest()
    return form?.metadata?.kind === "question" ? form : undefined
  })

  const permissionRequest = createMemo((): PermissionRequest | undefined => {
    if (settings.permissions.autoApprove()) return undefined
    return sessionPermissionRequest(data.session.list(), data.session.permission.list, params.id)
  })

  const blocked = createMemo(() => {
    const id = params.id
    if (!id) return false
    return !!permissionRequest() || !!questionRequest() || !!websearch.request()
  })

  const primary = () => {
    const id = params.id
    return !!id && !data.session.get(id)?.parentID
  }
  const background = createSessionBackground({
    sessionID: () => (primary() ? params.id : undefined),
    messages: data.session.message.list,
    sessions: data.session.list,
    status: data.session.status,
    shells: () => data.shell.list({ directory: sdk().directory }),
  })
  const moveToBackground = async () => {
    if (!primary()) return
    const sessionID = params.id
    if (!sessionID) return
    await serverSDK.api.session.background({ sessionID }).catch((error) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    })
  }

  const [store, setStore] = createStore({
    responding: undefined as string | undefined,
  })

  const permissionResponding = createMemo(() => {
    const perm = permissionRequest()
    if (!perm) return false
    return store.responding === perm.id
  })

  const decide = (response: "once" | "always" | "reject") => {
    const perm = permissionRequest()
    if (!perm) return
    if (store.responding === perm.id) return

    setStore("responding", perm.id)
    serverSDK.api.permission
      .reply({ sessionID: perm.sessionID, requestID: perm.id, reply: response })
      .catch((err: unknown) => {
        const description = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description })
      })
      .finally(() => {
        setStore("responding", (id) => (id === perm.id ? undefined : id))
      })
  }

  return {
    blocked,
    questionRequest,
    websearch,
    permissionRequest,
    permissionResponding,
    background: {
      blocking: background.blocking,
      tasks: background.tasks,
      move: moveToBackground,
    },
    decide,
  }
}

export type SessionRequestModel = ReturnType<typeof createSessionRequestModel>
