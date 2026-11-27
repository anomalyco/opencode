import { ClientError } from "@opencode/client/promise"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { SplitBorder } from "../ui/border"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { isRecord } from "../util/record"
import { Spinner } from "./spinner"

type Progress = { label: string; numerator?: number; denominator?: number }

// The server answers 503 while it boots, so consecutive transient failures are retried for about 30 polls.
const retries = 30

export function MigrationOverlay(props: { interval?: number }) {
  const client = useClient()
  const toast = useToast()
  const theme = useTheme()
  const [progress, setProgress] = createSignal<Progress>()
  const abort = new AbortController()
  const interval = props.interval ?? 1_000

  onMount(async () => {
    await wait(interval, abort.signal)
    void (async () => {
      let failures = 0
      while (!abort.signal.aborted) {
        const status = await client.api.experimental.migration.v1.status({ signal: abort.signal }).catch((error) => {
          if (abort.signal.aborted || !transient(error) || ++failures > retries) throw error
          return undefined
        })
        if (status) {
          failures = 0
          setProgress(status.status === "running" ? status.progress : undefined)
          if (status.status === "completed") return
          if (status.status === "error") throw new Error(status.error)
        }
        await wait(interval, abort.signal)
      }
    })().catch((error) => {
      if (abort.signal.aborted) return
      setProgress(undefined)
      toast.show({
        variant: "error",
        title: "Data migration failed",
        message: errorMessage(error),
        duration: 10_000,
      })
    })
  })
  onCleanup(() => abort.abort())

  const count = (value: Progress) => {
    if (value.numerator === undefined) return ""
    if (value.denominator === undefined) return ` ${value.numerator}`
    return ` ${value.numerator}/${value.denominator}`
  }

  return (
    <Show when={progress()}>
      {(value) => (
        <box
          position="absolute"
          zIndex={10_000}
          top={1}
          right={2}
          flexDirection="row"
          backgroundColor={theme.background.raised.high}
          border={["left"]}
          borderColor={theme.text.feedback.info.base}
          customBorderChars={SplitBorder.customBorderChars}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
        >
          <Spinner color={theme.text.feedback.info.base}>
            {value().label}
            {count(value())}
          </Spinner>
        </box>
      )}
    </Show>
  )
}

function transient(error: unknown) {
  if (!(error instanceof ClientError)) return false
  if (error.reason === "Transport") return true
  return error.reason === "UnexpectedStatus" && isRecord(error.cause) && Number(error.cause.status) >= 500
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
