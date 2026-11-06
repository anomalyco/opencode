import { createEffect, createRoot, createSignal, For, on, onCleanup, untrack } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { Toast, toaster } from "@opencode/ui/toast"
import { abort } from "@opencode/util/abort"
import { useLanguage } from "@/runtime/i18n/language"
import {
  INITIAL_UPLOAD_MACHINE_STATE,
  selectUploadEntries,
  transitionUploads,
  uploadPercent,
  type UploadEntry,
  type UploadScope,
  type UploadMachineEffect,
  type UploadMachineEvent,
} from "./upload-machine"

export type Upload = {
  id: string
  filename: string
  mime: string
  size: number
  loaded: number
  cancel: () => void
}

type UploadWork = (report: (loaded: number) => void, signal: AbortSignal) => Promise<string>

// Uploads outlive the composer that started them, so one process-wide machine feeds every chip
// and the single progress toast.
const [machineState, setMachineState] = createSignal(INITIAL_UPLOAD_MACHINE_STATE)

// Rows keep their identity while progress streams, so a cancel button under the pointer is not replaced.
const [view, setView] = createStore<{ items: Upload[] }>({ items: [] })

type Run = {
  work: UploadWork
  result: PromiseWithResolvers<string | undefined>
  controller: AbortController
  timer?: ReturnType<typeof setTimeout>
}

const runs = new Map<number, Run>()

// Handed from `track` to the `upload.run` effect its start causes in the same dispatch.
let starting: { work: UploadWork; result: PromiseWithResolvers<string | undefined> } | undefined

function dispatch(event: UploadMachineEvent) {
  const previous = untrack(machineState)
  const next = transitionUploads(previous, event)

  if (next.state !== previous) {
    setMachineState(next.state)
    setView("items", reconcile(selectUploadEntries(next.state).map(row), { key: "id" }))
  }

  next.effects.forEach(run)
}

function row(entry: UploadEntry): Upload {
  return {
    id: entry.id,
    filename: entry.filename,
    mime: entry.mime,
    size: entry.size,
    loaded: entry.loaded,
    cancel: () => dispatch({ type: "upload.cancelled", id: entry.id }),
  }
}

function run(effect: UploadMachineEffect) {
  const attempt = effect.attempt

  if (effect.type === "upload.run") {
    if (!starting) return
    const current: Run = { ...starting, controller: new AbortController() }
    starting = undefined
    runs.set(attempt, current)
    void Promise.try(() =>
      current.work((loaded) => dispatch({ type: "upload.progress", attempt, loaded }), current.controller.signal),
    ).then(
      (path) => dispatch({ type: "upload.succeeded", attempt, path }),
      (error) => dispatch({ type: "upload.failed", attempt, error }),
    )

    return
  }

  const current = runs.get(attempt)

  if (!current) return
  clearTimeout(current.timer)

  if (effect.type === "timer.clear") return

  if (effect.type === "timer.reset") {
    current.timer = setTimeout(() => dispatch({ type: "upload.timed-out", attempt }), effect.timeoutMs)

    return
  }

  if (effect.type === "upload.abort") return abort(current.controller)
  runs.delete(attempt)

  if (effect.type === "upload.resolve") return current.result.resolve(effect.path)
  current.result.reject(effect.error)
}

export const uploads = {
  items: () => view.items,
  /** Uploads in flight for one draft; they survive the composer view remounting. */
  forScope(scope: UploadScope) {
    const ids = selectUploadEntries(machineState()).flatMap((entry) => (entry.scope === scope ? [entry.id] : []))

    return view.items.filter((item) => ids.includes(item.id))
  },
  /** Runs `work` while the upload is listed and resolves to its path, or to undefined when it is cancelled. */
  track(input: Pick<UploadEntry, "id" | "scope" | "filename" | "mime" | "size">, work: UploadWork) {
    const result = Promise.withResolvers<string | undefined>()
    starting = { work, result }
    dispatch({ type: "upload.started", ...input })

    // A duplicate id starts nothing.
    if (starting) {
      starting = undefined
      result.resolve(undefined)
    }

    return result.promise
  },
  cancel: (id: string) => dispatch({ type: "upload.cancelled", id }),
  cancelScope: (scope: UploadScope) => dispatch({ type: "scope.cancelled", scope }),
}

// Sonner builds toast content outside the app's Solid tree: no context and no owner. This host
// lives inside the providers, lends the toast its language instance, and gives the content a
// root of its own so progress stays reactive.
export function UploadToastHost() {
  const language = useLanguage()
  let toast: { id: number; dispose: () => void } | undefined

  const dismiss = () => {
    if (!toast) return
    toaster.dismiss(toast.id)
    toast.dispose()
    toast = undefined
  }

  createEffect(
    on(
      () => view.items.length > 0,
      (uploading) => {
        if (!uploading) return dismiss()

        if (toast) return
        let root: (() => void) | undefined

        const id = toaster.show(
          (props) => {
            // Sonner renders the content again when the toast resizes; the previous root must not leak.
            root?.()

            return createRoot((dispose) => {
              root = dispose

              return <UploadToast toastId={props.toastId} language={language} />
            })
          },
          { persistent: true, resize: () => view.items.length },
        )

        toast = {
          id,
          dispose: () => {
            root?.()
            root = undefined
          },
        }
      },
    ),
  )
  onCleanup(dismiss)

  return null
}

function UploadToast(props: { toastId: number; language: ReturnType<typeof useLanguage> }) {
  return (
    <Toast toastId={props.toastId}>
      <Toast.Content>
        <For each={view.items}>
          {(item) => (
            <div data-component="upload-row">
              <div data-slot="upload-row-label">
                <span data-slot="upload-row-name" title={item.filename}>
                  {item.filename}
                </span>
                <span data-slot="upload-row-percent">
                  {props.language.t("prompt.toast.uploading.percent", { percent: uploadPercent(item) })}
                </span>
              </div>
              <div data-slot="upload-row-track">
                <div
                  data-component="upload-progress"
                  role="progressbar"
                  aria-label={item.filename}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={uploadPercent(item)}
                >
                  <div data-slot="upload-progress-bar" style={{ width: `${uploadPercent(item)}%` }} />
                </div>
                <button
                  type="button"
                  data-slot="upload-row-cancel"
                  aria-label={props.language.t("prompt.toast.uploading.cancelFile", { filename: item.filename })}
                  onClick={() => item.cancel()}
                >
                  <Icon name="outline-xmark" />
                </button>
              </div>
            </div>
          )}
        </For>
      </Toast.Content>
    </Toast>
  )
}
