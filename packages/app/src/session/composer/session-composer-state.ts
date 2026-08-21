import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { FormInfo, PermissionRequest } from "@opencode-ai/client/promise"
import { useParams } from "@solidjs/router"
import { showToast } from "@/utils/toast"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useWorkspaceLocation } from "@/context/location"
import { sessionPermissionRequest, sessionQuestionForm } from "@/session/requests/session-request-tree"
import { useData } from "@/context/server"

export function createSessionComposerController() {
  const params = useParams()
  const sdk = useWorkspaceLocation()
  const serverSDK = useServerSDK()
  const data = useData()
  const language = useLanguage()
  const permission = usePermission()
  createEffect(() => {
    const id = params.id
    if (!id || serverSDK.connection.status() !== "connected") return
    void Promise.all([
      data.shell.sync({ directory: sdk().directory }),
      data.session.permission.sync(id),
      data.session.form.sync(id),
    ]).catch(() => undefined)
  })

  const questionRequest = createMemo((): FormInfo | undefined => {
    return sessionQuestionForm(data.session.list(), data.session.form.list, params.id)
  })

  const permissionRequest = createMemo((): PermissionRequest | undefined => {
    return sessionPermissionRequest(data.session.list(), data.session.permission.list, params.id, (item) => {
      return !permission.autoResponds(item, sdk().directory)
    })
  })

  const blocked = createMemo(() => {
    const id = params.id
    if (!id) return false
    return !!permissionRequest() || !!questionRequest()
  })

  const primary = () => {
    const id = params.id
    return !!id && !data.session.get(id)?.parentID
  }
  const backgroundBlocking = createMemo(() => {
    if (!primary()) return []
    const id = params.id
    if (!id) return []
    const assistant = data.session.message
      .list(id)
      .findLast((message) => message.type === "assistant" && message.time.completed === undefined)
    if (assistant?.type !== "assistant") return []
    return assistant.content.flatMap((part) => {
      if (part.type !== "tool" || part.state.status !== "running") return []
      if (part.name !== "shell" && part.name !== "subagent") return []
      const value = part.name === "shell" ? part.state.metadata.shellID : part.state.metadata.sessionID
      const label = part.name === "shell" ? part.state.input.command : part.state.input.description
      return [
        {
          type: part.name as "shell" | "subagent",
          id: typeof value === "string" ? value : undefined,
          label: typeof label === "string" ? label : undefined,
        },
      ]
    })
  })
  const backgroundTasks = createMemo(() => {
    if (!primary()) return []
    const id = params.id
    if (!id) return []
    const blocking = backgroundBlocking()
    const messages = data.session.message.list(id)
    const completed = new Set(
      messages.flatMap((message) => {
        if (message.type !== "synthetic") return []
        if (message.metadata?.source === "subagent" && typeof message.metadata.childID === "string")
          return [message.metadata.childID]
        if (message.metadata?.source === "shell" && typeof message.metadata.jobID === "string")
          return [message.metadata.jobID]
        return []
      }),
    )
    const backgrounded = messages.flatMap((message) => {
      if (message.type !== "assistant") return []
      return message.content.flatMap((part) => {
        if (part.type !== "tool" || part.name !== "subagent") return []
        if (part.state.status !== "completed" || part.state.metadata?.status !== "running") return []
        const sessionID = part.state.metadata.sessionID
        if (typeof sessionID !== "string" || completed.has(sessionID)) return []
        const description = part.state.input.description
        return [
          {
            id: sessionID,
            type: "subagent" as const,
            label: typeof description === "string" ? description : sessionID,
          },
        ]
      })
    })
    const active = data.session.list().flatMap((info) => {
      if (info?.parentID !== id) return []
      if (data.session.status(info.id) === "idle") return []
      if (
        blocking.some(
          (item) => item.type === "subagent" && (item.id === info.id || (!!item.label && info.title === item.label)),
        )
      )
        return []
      return [{ id: info.id, type: "subagent" as const, label: info.title ?? info.id }]
    })
    const backgroundShells = messages.flatMap((message) => {
      if (message.type !== "assistant") return []
      return message.content.flatMap((part) => {
        if (part.type !== "tool" || part.name !== "shell" || completed.has(part.id)) return []
        if (part.state.status !== "completed" || part.state.metadata?.status !== "running") return []
        const shellID = part.state.metadata.shellID
        const command = part.state.input.command
        return [
          {
            id: typeof shellID === "string" ? shellID : part.id,
            type: "shell" as const,
            label: typeof command === "string" ? command : part.id,
          },
        ]
      })
    })
    const running = data.shell.list({ directory: sdk().directory }).flatMap((shell) => {
      if (shell.status !== "running" || shell.metadata.sessionID !== id) return []
      if (
        blocking.some(
          (item) => item.type === "shell" && (item.id === shell.id || (!!item.label && shell.command === item.label)),
        )
      )
        return []
      return [{ id: shell.id, type: "shell" as const, label: shell.command }]
    })
    return [
      ...new Map([...backgrounded, ...active, ...backgroundShells, ...running].map((task) => [task.id, task])).values(),
    ]
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
    permissionRequest,
    permissionResponding,
    background: {
      blocking: backgroundBlocking,
      tasks: backgroundTasks,
      move: moveToBackground,
    },
    decide,
  }
}

export type SessionComposerController = ReturnType<typeof createSessionComposerController>
