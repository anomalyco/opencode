import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { isPermissionNotFoundError, type FormInfo, type PermissionRequest } from "@opencode/client/promise"
import { abort } from "@opencode/util/abort"
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
import { useData, useServer } from "@/runtime/server/current"
import { needsUser } from "./auto-approve-machine"
import {
  INITIAL_PERMISSION_REPLY_STATE,
  isPermissionReplied,
  isPermissionResponding,
  PERMISSION_REPLIED_LIMIT,
  transitionPermissionReply,
  type PermissionDecision,
  type PermissionReplyEffect,
  type PermissionReplyEvent,
  type PermissionReplyState,
} from "./permission-machine"

export function createSessionRequestModel() {
  const params = useParams()
  const sdk = useWorkspaceLocation()
  const serverSDK = useServerSDK()
  const data = useData()
  const autoApprove = useServer().ctx.autoApprove
  const language = useLanguage()
  const settings = useSettings()
  // Manual replies from the dock, by request. Requests nobody answered from this dock have no entry.
  const [replies, setReplies] = createSignal<Readonly<Record<string, PermissionReplyState>>>({})
  const runs = new Map<string, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()
  const replyState = (requestID: string) => replies()[requestID] ?? INITIAL_PERMISSION_REPLY_STATE

  const stop = serverSDK.event.on("permission.replied", (event) => dispatch(event.data.requestID, { type: "resolved" }))

  onCleanup(() => {
    stop()
    Object.keys(untrack(replies)).forEach((id) => dispatch(id, { type: "disposed" }))
  })

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

    const enabled = settings.permissions.autoApproves(
      projectSettingsKey(serverSDK.scope, id ? data.session.get(id)?.projectID : undefined),
    )

    return sessionPermissionRequest(
      data.session.list(),
      data.session.permission.list,
      id,
      (item) => needsUser(autoApprove.state(item.id), enabled) && !isPermissionReplied(replyState(item.id)),
    )
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

  // The dock keeps the last request mounted while it closes, so its buttons follow that request's reply.
  const lastPermissionID = createMemo<string | undefined>((previous) => permissionRequest()?.id ?? previous)

  const permissionResponding = createMemo(() => {
    const id = lastPermissionID()

    return !!id && isPermissionResponding(replyState(id))
  })

  const decide = (decision: PermissionDecision) => {
    const perm = permissionRequest()

    if (!perm) return
    dispatch(perm.id, { type: "decide", sessionID: perm.sessionID, decision })
  }

  function dispatch(requestID: string, event: PermissionReplyEvent) {
    const state = untrack(() => replyState(requestID))
    const result = transitionPermissionReply(state, event)

    if (result.state !== state) setReplies((current) => pruneReplied({ ...current, [requestID]: result.state }))

    result.effects.forEach((effect) => execute(requestID, effect))
  }

  function execute(requestID: string, effect: PermissionReplyEffect) {
    if (effect.type === "toast-failed") {
      showToast({ title: language.t("common.requestFailed"), description: effect.error })

      return
    }

    if (effect.type === "abort") {
      const run = runs.get(requestID)
      runs.delete(requestID)
      clearTimeout(run?.timer)
      abort(run?.controller)

      return
    }

    const controller = new AbortController()

    runs.set(requestID, {
      controller,
      timer: setTimeout(
        () => dispatch(requestID, { type: "reply.timed-out", attempt: effect.attempt }),
        effect.timeoutMs,
      ),
    })
    // A request another client or the TUI already answered counts as replied.
    void serverSDK.api.permission
      .reply({ sessionID: effect.sessionID, requestID, decision: effect.decision }, { signal: controller.signal })
      .then(
        () => dispatch(requestID, { type: "reply.succeeded", attempt: effect.attempt }),
        (error) =>
          dispatch(
            requestID,
            isPermissionNotFoundError(error)
              ? { type: "reply.succeeded", attempt: effect.attempt }
              : {
                  type: "reply.failed",
                  attempt: effect.attempt,
                  error: error instanceof Error ? error.message : String(error),
                },
          ),
      )
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

// Replied entries only hide requests until `permission.replied` removes them, so the oldest can go.
function pruneReplied(replies: Readonly<Record<string, PermissionReplyState>>) {
  const replied = Object.entries(replies).flatMap(([id, state]) => (isPermissionReplied(state) ? [id] : []))

  if (replied.length <= PERMISSION_REPLIED_LIMIT) return replies
  const drop = new Set(replied.slice(0, replied.length - PERMISSION_REPLIED_LIMIT))

  return Object.fromEntries(Object.entries(replies).filter(([id]) => !drop.has(id)))
}
