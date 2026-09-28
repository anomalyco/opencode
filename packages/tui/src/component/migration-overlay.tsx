import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { SplitBorder } from "../ui/border"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { Spinner } from "./spinner"

type Progress = { label: string; numerator?: number; denominator?: number }

export function MigrationOverlay() {
  const client = useClient()
  const toast = useToast()
  const theme = useTheme()
  const [progress, setProgress] = createSignal<Progress>()
  const abort = new AbortController()

  onMount(async () => {
    await Bun.sleep(1_000)
    void (async () => {
      while (true) {
        const status = await client.api.migration.v1.status({ signal: abort.signal })
        setProgress(status.status === "running" ? status.progress : undefined)
        if (status.status === "completed") return
        if (status.status === "error") throw new Error(status.error)
        await Bun.sleep(1_000)
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
