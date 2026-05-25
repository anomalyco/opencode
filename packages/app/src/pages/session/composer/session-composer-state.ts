import { createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { PermissionRequest, QuestionRequest, Todo } from "@opencode-ai/sdk/v2"
import { useParams } from "@solidjs/router"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { composerDriver, composerEnabled, composerEvent } from "@/testing/session-composer"
import { sessionPermissionRequest, sessionQuestionRequest } from "./session-request-tree"
import { working as sessionWorking } from "../session-working"

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

const idle = { type: "idle" as const }

export function createSessionComposerState(options?: { closeMs?: number | (() => number) }) {
  const params = useParams()
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const permission = usePermission()

  const questionRequest = createMemo((): QuestionRequest | undefined => {
    return sessionQuestionRequest(sync.data.session, sync.data.question, params.id)
  })

  createEffect(
    on(
      () => questionRequest(),
      (request) => {
        console.debug(
          `[tool-freeze] composer question-request t=${performance.now().toFixed(1)} route=${params.id ?? "none"} request=${request?.id ?? "none"} session=${request?.sessionID ?? "none"} questions=${request?.questions.length ?? 0}`,
        )
      },
      { defer: true },
    ),
  )

  const permissionRequest = createMemo((): PermissionRequest | undefined => {
    return sessionPermissionRequest(sync.data.session, sync.data.permission, params.id, (item) => {
      return !permission.autoResponds(item, sdk.directory)
    })
  })

  const blocked = createMemo(() => {
    const id = params.id
    if (!id) return false
    return !!permissionRequest() || !!questionRequest()
  })

  createEffect(
    on(
      () => [blocked(), permissionRequest()?.id, questionRequest()?.id] as const,
      ([next, permissionID, questionID]) => {
        console.debug(
          `[tool-freeze] composer blocked t=${performance.now().toFixed(1)} route=${params.id ?? "none"} blocked=${next ? 1 : 0} permission=${permissionID ?? "none"} question=${questionID ?? "none"}`,
        )
      },
      { defer: true },
    ),
  )

  const [test, setTest] = createStore({
    on: false,
    live: undefined as boolean | undefined,
    todos: undefined as Todo[] | undefined,
  })

  const pull = () => {
    const id = params.id
    if (!id) {
      setTest({ on: false, live: undefined, todos: undefined })
      return
    }

    const next = composerDriver(id)
    if (!next) {
      setTest({ on: false, live: undefined, todos: undefined })
      return
    }

    setTest({
      on: true,
      live: next.live,
      todos: next.todos?.map((todo) => ({ ...todo })),
    })
  }

  onMount(() => {
    if (!composerEnabled()) return

    pull()
    createEffect(on(() => params.id, pull, { defer: true }))

    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionID?: string }>).detail
      if (detail?.sessionID !== params.id) return
      pull()
    }

    window.addEventListener(composerEvent, onEvent)
    onCleanup(() => window.removeEventListener(composerEvent, onEvent))
  })

  const todos = createMemo((): Todo[] => {
    if (test.on && test.todos !== undefined) return test.todos
    const id = params.id
    if (!id) return []
    return globalSync.data.session_todo[id] ?? []
  })

  const done = createMemo(
    () => todos().length > 0 && todos().every((todo) => todo.status === "completed" || todo.status === "cancelled"),
  )

  const status = createMemo(() => {
    const id = params.id
    if (!id) return idle
    return sync.data.session_status[id] ?? idle
  })

  const messages = createMemo(() => {
    const id = params.id
    if (!id) return []
    return sync.data.message[id] ?? []
  })
  const busy = createMemo(() => sessionWorking(status(), messages()))
  const live = createMemo(() => {
    if (test.on && test.live !== undefined) return test.live
    return busy() || blocked()
  })

  createEffect(
    on(
      () => [busy(), blocked(), live()] as const,
      ([nextBusy, nextBlocked, nextLive]) => {
        console.debug(
          `[tool-freeze] composer live t=${performance.now().toFixed(1)} route=${params.id ?? "none"} busy=${nextBusy ? 1 : 0} blocked=${nextBlocked ? 1 : 0} live=${nextLive ? 1 : 0}`,
        )
      },
      { defer: true },
    ),
  )

  const [store, setStore] = createStore({
    responding: undefined as string | undefined,
    dock: todos().length > 0 && live(),
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
    sdk.client.permission
      .respond({ sessionID: perm.sessionID, permissionID: perm.id, response })
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
    if (test.on && test.todos !== undefined) {
      setTest("todos", [])
      return
    }
    const id = params.id
    if (!id) return
    globalSync.todo.set(id, [])
    sync.set("todo", id, [])
  }

  createEffect(
    on(
      () => [todos().length, done(), live()] as const,
      ([count, complete, active]) => {
        const effectStart = performance.now()
        if (raf) cancelAnimationFrame(raf)
        raf = undefined

        const next = todoState({
          count,
          done: complete,
          live: active,
        })

        console.debug(
          `[tool-freeze] composer todo-state t=${effectStart.toFixed(1)} route=${params.id ?? "none"} count=${count} done=${complete ? 1 : 0} live=${active ? 1 : 0} next=${next} dock=${store.dock ? 1 : 0} closing=${store.closing ? 1 : 0}`,
        )

        if (next === "hide") {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          setStore({ dock: false, closing: false, opening: false })
          console.debug(
            `[tool-freeze] composer todo-state-end t=${performance.now().toFixed(1)} took=${(performance.now() - effectStart).toFixed(1)} route=${params.id ?? "none"} next=${next}`,
          )
          return
        }

        if (next === "clear") {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          clear()
          console.debug(
            `[tool-freeze] composer todo-state-end t=${performance.now().toFixed(1)} took=${(performance.now() - effectStart).toFixed(1)} route=${params.id ?? "none"} next=${next}`,
          )
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
            console.debug(
              `[tool-freeze] composer todo-state-end t=${performance.now().toFixed(1)} took=${(performance.now() - effectStart).toFixed(1)} route=${params.id ?? "none"} next=${next} hidden=1`,
            )
            return
          }
          setStore("opening", false)
          console.debug(
            `[tool-freeze] composer todo-state-end t=${performance.now().toFixed(1)} took=${(performance.now() - effectStart).toFixed(1)} route=${params.id ?? "none"} next=${next} hidden=0`,
          )
          return
        }

        setStore({ dock: true, opening: false, closing: true })
        if (!timer) scheduleClose()
        console.debug(
          `[tool-freeze] composer todo-state-end t=${performance.now().toFixed(1)} took=${(performance.now() - effectStart).toFixed(1)} route=${params.id ?? "none"} next=${next}`,
        )
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
    decide,
    todos,
    dock: () => store.dock,
    closing: () => store.closing,
    opening: () => store.opening,
  }
}

export type SessionComposerState = ReturnType<typeof createSessionComposerState>
