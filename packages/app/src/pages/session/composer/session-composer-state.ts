import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { Todo } from "@/types"
import type { FormInfo, PermissionRequest } from "@opencode-ai/client/promise"
import { useParams } from "@solidjs/router"
import { showToast } from "@/utils/toast"
import { useServerSync } from "@/context/server-sync"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { sessionPermissionRequest, sessionQuestionForm } from "./session-request-tree"
import { createQuery, useQueryClient } from "@tanstack/solid-query"

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
  const sdk = useSDK()
  const sync = useSync()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const queryClient = useQueryClient()
  const language = useLanguage()
  const permission = usePermission()
  const shellKey = () => [serverSDK().scope, sdk().directory, "shell"] as const
  const shells = createQuery(() => ({
    queryKey: shellKey(),
    enabled: !!params.id && serverSDK().connection.status() === "connected",
    queryFn: () =>
      sdk()
        .api.shell.list({ location: { directory: sdk().directory } })
        .then((result) => result.data ?? []),
  }))
  onCleanup(
    sdk().event.listen((event) => {
      if (
        event.details.type !== "shell.created" &&
        event.details.type !== "shell.exited" &&
        event.details.type !== "shell.deleted"
      )
        return
      void queryClient.invalidateQueries({ queryKey: shellKey(), exact: true })
    }),
  )

  const questionRequest = createMemo((): FormInfo | undefined => {
    return sessionQuestionForm(sync().data.session, serverSync().session.data.form, params.id)
  })

  const permissionRequest = createMemo((): PermissionRequest | undefined => {
    return sessionPermissionRequest(sync().data.session, sync().data.permission, params.id, (item) => {
      return !permission.autoResponds(item, sdk().directory)
    })
  })

  const blocked = createMemo(() => {
    const id = params.id
    if (!id) return false
    return !!permissionRequest() || !!questionRequest()
  })

  const todos = createMemo((): Todo[] => {
    const id = params.id
    if (!id) return []
    return serverSync().session.data.todo[id] ?? []
  })

  const done = createMemo(
    () => todos().length > 0 && todos().every((todo) => todo.status === "completed" || todo.status === "cancelled"),
  )

  const live = createMemo(() => sync().data.session_working(params.id ?? "") || blocked())
  const primary = () => {
    const id = params.id
    return !!id && !serverSync().session.get(id)?.parentID
  }
  const backgroundBlocking = createMemo(() => {
    if (!primary()) return []
    const id = params.id
    if (!id) return []
    const assistant = (serverSync().session.data.session_message[id] ?? []).findLast(
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
    const messages = serverSync().session.data.session_message[id] ?? []
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
    const active = Object.values(serverSync().session.data.info).flatMap((info) => {
      if (info?.parentID !== id) return []
      if ((serverSync().session.data.session_status[info.id]?.type ?? "idle") === "idle") return []
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
    const running = (shells.isSuccess || shells.isRefetchError ? shells.data : []).flatMap((shell) => {
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
    await sdk()
      .api.session.background({ sessionID })
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
    sdk()
      .api.permission.reply({ sessionID: perm.sessionID, requestID: perm.id, reply: response })
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

  // Keep stale turn todos from reopening if the model never clears them.
  const clear = () => {
    const id = params.id
    if (!id) return
    sync().set("todo", id, [])
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
          if (next === "clear") clear()
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
          clear()
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
