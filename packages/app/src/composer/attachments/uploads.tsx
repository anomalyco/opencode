import { createEffect, createRoot, For, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { Toast, toaster } from "@opencode/ui/toast"
import { useLanguage } from "@/runtime/i18n/language"

export type Upload = {
  id: string
  filename: string
  mime: string
  size: number
  loaded: number
  cancel: () => void
}

// Uploads outlive the composer that started them, so one process-wide list feeds every chip
// and the single progress toast.
const [state, setState] = createStore<{ items: Upload[] }>({ items: [] })

export const uploads = {
  items: () => state.items,
  /** Runs `work` while the upload is listed. Resolves to undefined when the user cancels it. */
  async track<T>(
    input: Pick<Upload, "id" | "filename" | "mime" | "size">,
    work: (report: (loaded: number) => void, signal: AbortSignal) => Promise<T>,
  ): Promise<T | undefined> {
    const controller = new AbortController()
    setState("items", (items) => [...items, { ...input, loaded: 0, cancel: () => controller.abort() }])
    try {
      return await work(
        (loaded) => setState("items", (item) => item.id === input.id, "loaded", loaded),
        controller.signal,
      )
    } catch (error) {
      if (controller.signal.aborted) return undefined
      throw error
    } finally {
      setState("items", (items) => items.filter((item) => item.id !== input.id))
    }
  },
}

// Sonner builds toast content outside the app's Solid tree: no context and no owner. This host
// lives inside the providers, lends the toast its language instance, and gives the content a
// root of its own so progress stays reactive.
export function UploadToastHost() {
  const language = useLanguage()
  let active: { id: number; dispose: () => void } | undefined
  const dismiss = () => {
    if (!active) return
    toaster.dismiss(active.id)
    active.dispose()
    active = undefined
  }
  createEffect(
    on(
      () => state.items.length > 0,
      (uploading) => {
        if (!uploading) return dismiss()
        if (active) return
        const id = toaster.show(
          (props) =>
            createRoot((dispose) => {
              active = { id: props.toastId, dispose }
              return <UploadToast toastId={props.toastId} language={language} />
            }),
          { persistent: true, resize: () => state.items.length },
        )
        active ??= { id, dispose: () => {} }
      },
    ),
  )
  onCleanup(dismiss)
  return null
}

function UploadToast(props: { toastId: number; language: ReturnType<typeof useLanguage> }) {
  const percent = (item: Upload) => (item.size === 0 ? 100 : Math.floor((item.loaded / item.size) * 100))
  return (
    <Toast toastId={props.toastId}>
      <Toast.Content>
        <For each={state.items}>
          {(item) => (
            <div data-component="upload-row">
              <div data-slot="upload-row-label">
                <span data-slot="upload-row-name" title={item.filename}>
                  {item.filename}
                </span>
                <span data-slot="upload-row-percent">
                  {props.language.t("prompt.toast.uploading.percent", { percent: percent(item) })}
                </span>
              </div>
              <div data-slot="upload-row-track">
                <div
                  data-component="upload-progress"
                  role="progressbar"
                  aria-label={item.filename}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent(item)}
                >
                  <div data-slot="upload-progress-bar" style={{ width: `${percent(item)}%` }} />
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
