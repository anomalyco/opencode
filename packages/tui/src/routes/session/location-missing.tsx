import { createMemo, Show } from "solid-js"
import { useLocation } from "../../context/location"
import { useTuiPaths } from "../../context/runtime"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import { abbreviateHome } from "../../util/path-format"
import { SessionQuestion } from "./permission"
import { usePromptMove } from "../../component/prompt/move"
import { errorMessage } from "../../util/error"

export function SessionLocationError(props: { projectID: string; sessionID: string }) {
  const location = useLocation()
  const move = usePromptMove({ projectID: () => props.projectID, sessionID: () => props.sessionID })
  return (
    <Show when={location.error}>
      {(error) => (
        <SessionLocationUnavailable
          directory={error().location.directory}
          message={errorMessage(error().cause)}
          onRetry={location.retry}
          onMove={move.open}
        />
      )}
    </Show>
  )
}

export function SessionLocationUnavailable(props: {
  directory: string
  message: string
  onRetry: () => void
  onMove: () => void
}) {
  const paths = useTuiPaths()
  const theme = useTheme("elevated")
  const directory = createMemo(() => Locale.truncateMiddle(abbreviateHome(props.directory, paths.home), 72))

  return (
    <SessionQuestion
      id="session.location-sync-error"
      group="Session sync"
      choicesLabel="Sync actions"
      instance={props.directory}
      title="Could not load session location"
      body={
        <box paddingLeft={1} gap={1}>
          <text fg={theme.text.subdued}>{directory()}</text>
          <text fg={theme.text.default}>{props.message}</text>
        </box>
      }
      options={{ retry: "Retry", move: "Choose directory" }}
      onSelect={(option) => (option === "retry" ? props.onRetry() : props.onMove())}
    />
  )
}
