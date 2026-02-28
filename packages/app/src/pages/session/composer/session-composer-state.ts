import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { PermissionRequest, QuestionRequest, Todo } from "@opencode-ai/sdk/v2"
import { useParams } from "@solidjs/router"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { sessionPermissionRequest, sessionQuestionRequest } from "./session-request-tree"

export function createSessionComposerBlocked() {
  const params = useParams()
  const permission = usePermission()
  const sdk = useSDK()
  const sync = useSync()
  const permissionRequest = createMemo(() =>
    sessionPermissionRequest(sync.data.session, sync.data.permission, params.id, (item) => {
      return !permission.autoResponds(item, sdk.directory)
    }),
  )
  const questionRequest = createMemo(() => sessionQuestionRequest(sync.data.session, sync.data.question, params.id))

  return createMemo(() => {
    const id = params.id
    if (!id) return false
    return !!permissionRequest() || !!questionRequest()
  })
}

export function createSessionComposerState() {
  const params = useParams()
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const permission = usePermission()

  const questionRequest = createMemo((): QuestionRequest | undefined => {
    return sessionQuestionRequest(sync.data.session, sync.data.question, params.id)
  })

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

  const todos = createMemo((): Todo[] => {
    const id = params.id
    if (!id) return []
    return globalSync.data.session_todo[id] ?? []
  })

  const [store, setStore] = createStore({
    responding: undefined as string | undefined,
    dock: todos().length > 0,
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

  const done = createMemo(
    () => todos().length > 0 && todos().every((todo) => todo.status === "completed" || todo.status === "cancelled"),
  )

  let timer: number | undefined
  let raf: number | undefined

  const scheduleClose = () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      setStore({ dock: false, closing: false })
      timer = undefined
    }, 400)
  }

  createEffect(
    on(
      () => [todos().length, done()] as const,
      ([count, complete], prev) => {
        if (raf) cancelAnimationFrame(raf)
        raf = undefined

        if (count === 0) {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          setStore({ dock: false, closing: false, opening: false })
          return
        }

        if (!complete) {
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

        if (prev && prev[1]) {
          if (store.closing && !timer) scheduleClose()
          return
        }

        setStore({ dock: true, opening: false, closing: true })
        scheduleClose()
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
