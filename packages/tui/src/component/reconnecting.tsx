import type { Service } from "@opencode-ai/client/effect"
import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { Spinner } from "./spinner"

export function Reconnecting(props: { status?: Service.Status }) {
  const theme = useTheme().theme
  const copy = () => reconnectingCopy(props.status)

  return (
    <box
      position="absolute"
      zIndex={10_000}
      top={0}
      right={0}
      bottom={0}
      left={0}
      backgroundColor={theme.background}
      alignItems="center"
      justifyContent="center"
    >
      <box width={62} maxWidth="90%" flexDirection="column" alignItems="center" gap={1}>
        <Show when={!copy().loading} fallback={<Spinner color={theme.textMuted}>{copy().message}</Spinner>}>
          <text fg={theme.error}>{copy().message}</text>
          <Show when={copy().detail}>
            {(detail) => (
              <text fg={theme.textMuted} wrapMode="word">
                {detail()}
              </text>
            )}
          </Show>
          <Show when={copy().action}>
            {(action) => (
              <text fg={theme.text} wrapMode="word">
                {action()}
              </text>
            )}
          </Show>
        </Show>
      </box>
    </box>
  )
}

export function reconnectingCopy(status?: Service.Status) {
  if (status?.type === "starting")
    return {
      loading: true,
      message: status.version ? `Starting OpenCode ${status.version}...` : "Starting background service...",
    }
  if (status?.type === "stopping")
    return {
      loading: true,
      message: status.targetVersion ? `Updating to ${status.targetVersion}...` : "Restarting background service...",
    }
  if (status?.type === "failed")
    return { loading: false, message: "Background service failed", detail: status.message, action: status.action }
  if (status?.type === "unresponsive")
    return {
      loading: false,
      message: "Background service is not responding",
      action: "Run `opencode service restart` to recover it.",
    }
  return { loading: true, message: "Waiting for background service..." }
}
