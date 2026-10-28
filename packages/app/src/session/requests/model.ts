import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { FormInfo, PermissionRequest } from "@opencode/client/promise"
import { useParams } from "@solidjs/router"
import { showToast } from "@/shell/notifications/toast"
import { useServerSDK } from "@/runtime/server/client"
import { useLanguage } from "@/runtime/i18n/language"
import { projectSettingsKey, useSettings } from "@/settings/model"
import { useWorkspaceLocation } from "@/workspaces/location"
import { sessionPermissionRequest, sessionFormRequest, sessionTreeIDs } from "@/session/requests/session-request-tree"
import { createWebSearchRequest } from "./websearch"
import { createSessionBackground } from "@/session/requests/background"
import { createSteerBackground } from "@/session/requests/steer-background"
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
    void Promise.all([data.shell.sync({ directory: sdk().directory }), data.session.permission.sync(id)]).catch(
      () => undefined,
    )
  })

  // Only a running Session can hold a pending form, and events keep loaded forms current. Comparing by value
  // keeps every session update in a large subagent tree from re-requesting forms.
  const formSessions = createMemo(
    () =>
      sessionTreeIDs(data.session.list(), params.id).filter(
        (id) => id === params.id || data.session.status(id) === "running",
      ),
    [],
    { equals: (a, b) => a.join() === b.join() },
  )

  createEffect(() => {
    if (serverSDK.connection.status() !== "connected") return
    void Promise.all(formSessions().map((sessionID) => data.session.form.sync(sessionID))).catch(() => undefined)
  })

  const formRequest = createMemo((): FormInfo | undefined => {
    return sessionFormRequest(data.session.list(), data.session.form.list, params.id)
  })

  // MCP elicitations are owned by the Location rather than a Session, so they are listed per Location.
  const location = createMemo(() => {
    const id = params.id

    return id ? data.session.get(id)?.location : undefined
  })

  createEffect(() => {
    const ref = location()

    if (!ref || serverSDK.connection.status() !== "connected") return
    void data.session.form.sync("global", ref).catch(() => undefined)
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
        location: { directory: session.location.directory },
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

  const elicitationRequest = createMemo(() => {
    if (websearch.request() || questionRequest()) return
    const form = formRequest()

    if (form?.metadata?.kind === "mcp-elicitation") return form

    const ref = location()

    if (!ref) return

    return data.session.form.list("global", ref)?.find((item) => item.metadata?.kind === "mcp-elicitation")
  })

  const permissionRequest = createMemo((): PermissionRequest | undefined => {
    const id = params.id

    const project = projectSettingsKey(serverSDK.scope, id ? data.session.get(id)?.projectID : undefined)

    if (settings.permissions.autoApproves(project)) return

    return sessionPermissionRequest(data.session.list(), data.session.permission.list, id)
  })

  const blocked = createMemo(() => {
    const id = params.id

    if (!id) return false

    return !!permissionRequest() || !!questionRequest() || !!elicitationRequest() || !!websearch.request()
  })

  const primary = () => {
    const id = params.id

    return !!id && !data.session.get(id)?.parentID
  }

  const running = createSessionBackground({
    sessionID: () => params.id,
    messages: data.session.message.list,
    sessions: data.session.list,
    status: data.session.status,
    shells: () => data.shell.list({ directory: sdk().directory }),
  })

  // Moving to the background and the plugins' background list stay with the primary session's own work.
  const blocking = createMemo(() => (primary() ? running.blocking() : []))
  const subagents = createMemo(() => (primary() ? running.subagents() : []))
  const tasks = createMemo(() => (primary() ? running.tasks() : []))

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

  const steer = createSteerBackground({
    sessionID: () => params.id,
    blocking,
    move: (sessionID) => serverSDK.api.session.background({ sessionID }),
  })

  const [store, setStore] = createStore<{ responding: string | undefined }>({ responding: undefined })

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
      .reply({ sessionID: perm.sessionID, requestID: perm.id, decision: response })
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        setStore("responding", (id) => (id === perm.id ? undefined : id))
      })
  }

  return {
    blocked,
    questionRequest,
    elicitationRequest,
    websearch,
    permissionRequest,
    permissionResponding,
    background: {
      blocking,
      subagents,
      tasks,
      move: moveToBackground,
      steer,
    },
    decide,
  }
}

export type SessionRequestModel = ReturnType<typeof createSessionRequestModel>
