import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { SplitBorder } from "../ui/border"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { pollMigrationStatus, type MigrationProgress } from "./migration-status"
import { Spinner } from "./spinner"

export function MigrationOverlay() {
  const client = useClient()
  const toast = useToast()
  const theme = useTheme()
  const [progress, setProgress] = createSignal<MigrationProgress>()
  const abort = new AbortController()

  onMount(() => {
    void pollMigrationStatus(
      (options) => client.api.experimental.migration.v1.status(options),
      setProgress,
      abort.signal,
    )
      .then(
        (status) => (status.status === "error" ? { title: "Data migration failed", message: status.error } : undefined),
        (error: unknown) => ({ title: "Could not check data migration status", message: errorMessage(error) }),
      )
      .then((failure) => {
        if (abort.signal.aborted) return
        setProgress(undefined)
        if (failure) toast.show({ variant: "error", ...failure, duration: 10_000 })
      })
  })
  onCleanup(() => abort.abort())

  const count = (value: MigrationProgress) => {
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
