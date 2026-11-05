import { OpenCode } from "@opencode/client/promise"
import { useLanguage } from "@opencode/app/desktop"
import { Loader } from "@opencode/ui/loader"
import { showToast, toaster, Toast } from "@opencode/ui/toast"
import { createEffect, createRoot, createSignal, onCleanup, onMount } from "solid-js"
import type { ServerReadyData } from "../shared/ipc-contract"
import {
  createMigrationState,
  selectMigrationProgress,
  selectMigrationToastVisible,
  transitionMigration,
  type MigrationEffect,
  type MigrationEvent,
  type MigrationProgress,
} from "./migration-status-machine"

type ToastHandle = { id: number; closed: boolean; dispose: (() => void) | undefined }

export function MigrationStatus(props: { server: ServerReadyData }) {
  const language = useLanguage()
  const initial = createMigrationState()
  const [state, setState] = createSignal(initial.state)
  // The main process credentials sidecar requests; see `wireRendererHeaders`.
  const client = OpenCode.make({ baseUrl: props.server.url })
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  // One handle per shown toast: a render that lands after the dismissal disposes its own root at once.
  let toast: ToastHandle | undefined

  const format = (progress: MigrationProgress | undefined) => {
    if (!progress) return ""

    if (progress.label === "Clearing old events") return language.t("toast.migration.progress.clearingOldEvents")

    if (progress.label === "Migrating sessions") {
      if (progress.numerator === undefined) return language.t("toast.migration.progress.migratingSessions")

      if (progress.denominator === undefined)
        return language.t("toast.migration.progress.migratingSessions.current", { current: progress.numerator })

      return language.t("toast.migration.progress.migratingSessions.progress", {
        current: progress.numerator,
        total: progress.denominator,
      })
    }

    if (progress.numerator === undefined) return language.tDynamic("toast.migration.progress.working", progress.label)

    if (progress.denominator === undefined)
      return language.tDynamic("toast.migration.progress.working.current", `${progress.label} ${progress.numerator}`, {
        current: progress.numerator,
      })

    return language.tDynamic(
      "toast.migration.progress.working.progress",
      `${progress.label} ${progress.numerator}/${progress.denominator}`,
      { current: progress.numerator, total: progress.denominator },
    )
  }

  const hide = () => {
    if (!toast) return
    toast.closed = true
    toaster.dismiss(toast.id)
    toast.dispose?.()
    toast = undefined
  }

  const show = () => {
    if (toast) return
    const handle: ToastHandle = { id: 0, closed: false, dispose: undefined }
    toast = handle
    handle.id = toaster.show(
      ({ toastId }) => {
        const view = createRoot((dispose) => {
          handle.dispose?.()
          handle.dispose = dispose

          return (
            <Toast toastId={toastId}>
              <div data-slot="toast-v2-header" class="col-span-full">
                <Toast.Icon>
                  <Loader />
                </Toast.Icon>
                <Toast.Content>
                  <Toast.Title dir="auto">{format(selectMigrationProgress(state()))}</Toast.Title>
                </Toast.Content>
              </div>
            </Toast>
          )
        })

        if (handle.closed) handle.dispose?.()

        return view
      },
      { persistent: true },
    )
  }

  const run = (effect: MigrationEffect) => {
    if (effect.type === "start-wait") {
      clearTimeout(timer)
      timer = setTimeout(() => dispatch({ type: "poll.due", attempt: effect.attempt }), effect.delayMs)

      return
    }

    if (effect.type === "start-poll") {
      controller?.abort()
      const current = new AbortController()
      controller = current
      clearTimeout(timer)
      timer = setTimeout(() => dispatch({ type: "poll.timed-out", attempt: effect.attempt }), effect.timeoutMs)
      void client.experimental.migration.v1.status({ signal: current.signal }).then(
        (output) => dispatch({ type: "poll.succeeded", attempt: effect.attempt, output }),
        () => dispatch({ type: "poll.failed", attempt: effect.attempt }),
      )

      return
    }

    if (effect.type === "cancel-timer") {
      clearTimeout(timer)
      timer = undefined

      return
    }

    if (effect.type === "abort-poll") {
      controller?.abort()
      controller = undefined

      return
    }

    showToast({
      variant: "error",
      title: language.t("toast.migration.failed.title"),
      description: effect.error,
      duration: 10_000,
    })
  }

  const dispatch = (event: MigrationEvent) => {
    const next = transitionMigration(state(), event)

    if (next.state === state()) return
    setState(next.state)
    next.effects.forEach(run)
  }

  createEffect(() => (selectMigrationToastVisible(state()) ? show() : hide()))

  onMount(() => initial.effects.forEach(run))

  onCleanup(() => {
    dispatch({ type: "disposed" })
    hide()
  })

  return null
}
