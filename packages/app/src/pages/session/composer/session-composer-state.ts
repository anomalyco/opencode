import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { Todo } from "@/types"
import type { FormInfo, PermissionRequest } from "@opencode-ai/client/promise"
import { useParams } from "@solidjs/router"
import { showToast } from "@/utils/toast"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useWorkspaceLocation } from "@/context/location"
import { sessionPermissionRequest, sessionQuestionForm } from "./session-request-tree"
import { useData } from "@/context/server"

export const todoState = (input: {
  count: number
  done: boolean
  live: boolean
}): "hide" | "clear" | "open" | "close" => {
  if (input.count === 0) return "hide"
  if (!input.live) return "clear"
  if (!input.done) return "open"
  return "close"
}

export const todoDockAtBoundary = (state: ReturnType<typeof todoState>) => state === "open"

const idle = { type: "idle" as const }

export function createSessionComposerController(options?: { closeMs?: number | (() => number) }) {
  const params = useParams()
  const sdk = useWorkspaceLocation()
  const serverSDK = useServerSDK()
  const data = useData()
  const language = useLanguage()
  const permission = usePermission()
  createEffect(() => {
    if (!params.id || serverSDK.connection.status() !== "connected") return
    void data.shell.sync({ directory: sdk().directory }).catch(() => undefined)
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

  // TODO: Restore todos when they are available from the current session API.
  const todos = createMemo((): Todo[] => [])

  const done = createMemo(
    () => todos().length > 0 && todos().every((todo) => todo.status === "completed" || todo.status === "cancelled"),
  )

  const live = createMemo(() => data.session.status(params.id ?? "") === "running" || blocked())
  const primary = () => {
    const id = params.id
    return !!id && !data.session.get(id)?.parentID
  }
  const backgroundBlocking = createMemo(() => {
    if (!primary()) return []
    const id = params.id
    if (!id) return []
    const assistant = data.session.message.list(id).findLast(
      (message) => message.type === "assistant" && message.time.completed === undefined,
    )
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
    await serverSDK.api.session
      .background({ sessionID })
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const [store, setStore] = createStore({
    sessionID: params.id,
    responding: undefined as string | undefined,
    dock: todos().length > 0 && !done() && live(),
    closing: false,
    opening: false,
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

  let timer: number | undefined
  let raf: number | undefined

  const closeMs = () => {
    const value = options?.closeMs
    if (typeof value === "function") return Math.max(0, value())
    if (typeof value === "number") return Math.max(0, value)
    return 400
  }

  const scheduleClose = () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      setStore({ dock: false, closing: false })
      timer = undefined
    }, closeMs())
  }

  createEffect(
    on(
      () => [params.id, todos().length, done(), live()] as const,
      ([id, count, complete, active], previous) => {
        if (raf) cancelAnimationFrame(raf)
        raf = undefined

        const next = todoState({
          count,
          done: complete,
          live: active,
        })

        if (!previous || previous[0] !== id) {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          setStore({ sessionID: id, dock: todoDockAtBoundary(next), closing: false, opening: false })
          return
        }

        if (next === "hide") {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          setStore({ dock: false, closing: false, opening: false })
          return
        }

        if (next === "clear") {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          return
        }

        if (next === "open") {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          const hidden = !store.dock || store.closing
          setStore({ dock: true, closing: false })
          if (hidden) {
            setStore("opening", true)
            raf = requestAnimationFrame(() => {
              setStore("opening", false)
              raf = undefined
            })
            return
          }
          setStore("opening", false)
          return
        }

        setStore({ dock: true, opening: false, closing: true })
        if (!timer) scheduleClose()
      },
    ),
  )

  onCleanup(() => {
    if (!timer) return
    window.clearTimeout(timer)
  })

  onCleanup(() => {
    if (!raf) return
    cancelAnimationFrame(raf)
  })

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
    todos,
    dock: () =>
      store.sessionID === params.id
        ? store.dock
        : todoDockAtBoundary(todoState({ count: todos().length, done: done(), live: live() })),
    closing: () => store.sessionID === params.id && store.closing,
    opening: () => store.sessionID === params.id && store.opening,
  }
}

export type SessionComposerController = ReturnType<typeof createSessionComposerController>
