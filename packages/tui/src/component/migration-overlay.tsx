import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { SplitBorder } from "../ui/border"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { Spinner } from "./spinner"

type Progress = { label: string; numerator?: number; denominator?: number }

// The HTTP listener answers before its services finish booting, so status reads can fail with 503 for the first
// seconds. Retry through that window instead of reporting a migration that never ran.
const RETRY_WINDOW_MS = 60_000
const RETRY_DELAY_MS = 1_000

export function MigrationOverlay() {
  const client = useClient()
  const toast = useToast()
  const theme = useTheme()
  const [progress, setProgress] = createSignal<Progress>()
  const abort = new AbortController()

  onMount(async () => {
    await Bun.sleep(1_000)
    void (async () => {
      let retryAfter = Date.now() + RETRY_WINDOW_MS
      while (true) {
        const result = await client.api.experimental.migration.v1.status({ signal: abort.signal }).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        )
        if (!result.ok) {
          if (abort.signal.aborted) return
          if (Date.now() >= retryAfter) throw result.error
          await Bun.sleep(RETRY_DELAY_MS)
          continue
        }
        retryAfter = Date.now() + RETRY_WINDOW_MS
        setProgress(result.value.status === "running" ? result.value.progress : undefined)
        if (result.value.status === "completed") return
        if (result.value.status === "error") throw new Error(result.value.error)
        await Bun.sleep(RETRY_DELAY_MS)
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
