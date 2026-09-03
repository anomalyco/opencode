import { OpenCode, type MigrationV1StatusOutput } from "@opencode-ai/client/promise"
import { useLanguage } from "@opencode-ai/app/desktop"
import { Loader } from "@opencode-ai/ui/loader"
import { showToast, toaster, Toast } from "@opencode-ai/ui/toast"
import { createRoot, createSignal, onCleanup, onMount } from "solid-js"
import type { ServerReadyData } from "../shared/ipc-contract"

type Progress = Extract<MigrationV1StatusOutput, { status: "running" }>["progress"]

export function MigrationStatus(props: { server: ServerReadyData }) {
  const language = useLanguage()
  const [progress, setProgress] = createSignal<Progress>()
  const abort = new AbortController()
  let toastID: number | undefined
  let disposeToast: (() => void) | undefined

  const hide = () => {
    if (toastID !== undefined) toaster.dismiss(toastID)
    toastID = undefined
    disposeToast?.()
    disposeToast = undefined
  }

  const show = () => {
    if (toastID !== undefined) return
    toastID = toaster.show(
      ({ toastId }) =>
        createRoot((dispose) => {
          disposeToast?.()
          disposeToast = dispose
          return (
            <Toast toastId={toastId}>
              <div data-slot="toast-v2-header" class="col-span-full">
                <Toast.Icon>
                  <Loader />
                </Toast.Icon>
                <Toast.Content>
                  <Toast.Title dir="auto">{format(progress())}</Toast.Title>
                </Toast.Content>
              </div>
            </Toast>
          )
        }),
      { persistent: true },
    )
  }

  onMount(async () => {
    await wait(1_000, abort.signal)
    if (abort.signal.aborted) return

    const client = OpenCode.make({
      baseUrl: props.server.url,
      headers: props.server.password
        ? { Authorization: `Basic ${btoa(`opencode:${props.server.password}`)}` }
        : undefined,
    })

    void (async () => {
      while (true) {
        const status = await client.migration.v1.status({ signal: abort.signal })
        setProgress(status.status === "running" ? status.progress : undefined)
        if (status.status === "running") show()
        else hide()
        if (status.status === "completed") return
        if (status.status === "error") throw new Error(status.error)
        await wait(1_000, abort.signal)
      }
    })().catch((error) => {
      if (abort.signal.aborted) return
      hide()
      showToast({
        variant: "error",
        title: language.t("toast.migration.failed.title"),
        description: error instanceof Error ? error.message : String(error),
        duration: 10_000,
      })
    })
  })

  onCleanup(() => {
    abort.abort()
    hide()
  })

  return null
}

function format(progress: Progress | undefined) {
  if (!progress) return ""
  if (progress.numerator === undefined) return progress.label
  if (progress.denominator === undefined) return `${progress.label} ${progress.numerator}`
  return `${progress.label} ${progress.numerator}/${progress.denominator}`
}

function wait(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, delay)
    signal.addEventListener("abort", done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
  })
}
