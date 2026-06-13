import { createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { PermissionRequest, QuestionRequest, Todo } from "@opencode-ai/sdk/v2"
import { useParams } from "@solidjs/router"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { composerDriver, composerEnabled, composerEvent } from "@/testing/session-composer"
import { sessionPermissionRequest, sessionQuestionRequest, sessionQuestionRequests } from "./session-request-tree"
import { working as sessionWorking } from "../session-working"
import { permissionRequestNotFound, questionInvalidation } from "./session-question-dock-helpers"
import { todoState } from "./session-composer-state-helpers"

export { todoState }

const idle = { type: "idle" as const }

export function createSessionComposerState(options?: { closeMs?: number | (() => number) }) {
  const params = useParams()
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const permission = usePermission()

  const questionInvalidationFor = (request: QuestionRequest) => {
    return questionInvalidation(request, sync.data.message[request.sessionID] ?? [])
  }

  const isSkippedQuestion = (request: QuestionRequest): boolean => {
    return questionInvalidationFor(request) !== undefined
  }

  const questionRequest = createMemo((): QuestionRequest | undefined => {
    return sessionQuestionRequest(
      sync.data.session,
      sync.data.question,
      params.id,
      (request) => !isSkippedQuestion(request),
    )
  })

  const skippedQuestionRequests = createMemo((): QuestionRequest[] => {
    return sessionQuestionRequests(sync.data.session, sync.data.question, params.id, isSkippedQuestion)
  })

  const skippedQuestionSessionEnded = createMemo((): boolean => {
    return skippedQuestionRequests().some((request) => questionInvalidationFor(request)?.type === "session-ended")
  })

  const clearSkippedQuestions = () => {
    const bySession = new Map<string, Set<string>>()
    for (const request of skippedQuestionRequests()) {
      const ids = bySession.get(request.sessionID)
      if (ids) {
        ids.add(request.id)
        continue
      }
      bySession.set(request.sessionID, new Set([request.id]))
    }

    for (const [sessionID, ids] of bySession) {
      sync.set(
        "question",
        sessionID,
        produce((draft = []) => {
          for (let index = draft.length - 1; index >= 0; index--) {
            const item = draft[index]
            if (item && ids.has(item.id)) draft.splice(index, 1)
          }
          return draft
        }),
      )
    }
  }

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
        if (permissionRequestNotFound(err, perm.id)) {
          console.warn(`[permission-dock] stale request missing on server request=${perm.id} session=${perm.sessionID}`)
          sync.set(
            "permission",
            perm.sessionID,
            produce((draft = []) => {
              const index = draft.findIndex((item) => item.id === perm.id)
              if (index !== -1) draft.splice(index, 1)
              return draft
            }),
          )
          return
        }

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
        if (raf) cancelAnimationFrame(raf)
        raf = undefined

        const next = todoState({
          count,
          done: complete,
          live: active,
        })

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
    skippedQuestionRequests,
    skippedQuestionInvalidation: questionInvalidationFor,
    skippedQuestionSessionEnded,
    clearSkippedQuestions,
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
