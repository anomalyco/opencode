import { createResource, For, Show } from "solid-js"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { useTheme } from "../context/theme"

export function SandboxStatus() {
  const client = useClient()
  const data = useData()
  const location = useLocation()
  const theme = useTheme().surface("dialog")
  const [status] = createResource(
    () => ({
      directory: location.ref?.directory ?? data.location.default().directory,
      connected: client.connection.status() === "connected",
    }),
    (input) => (input.connected ? client.api.experimental.sandbox.status({ location: { directory: input.directory } }) : undefined),
  )
  const available = () => client.connection.status() === "connected" && !status.loading && !status.error && status()
  return (
    <box flexDirection="column" flexShrink={0}>
      <Show
        when={available()}
        fallback={
          <text fg={theme.text.base} wrapMode="word">
            <b>Sandbox</b>{" · "}
            <span style={{ fg: theme.text.feedback.warning.base }}>
              {status.loading ? "Checking…" : "Enforcement unknown"}
            </span>
          </text>
        }
      >
        {(policy) => (
          <>
            <text fg={theme.text.base} wrapMode="word">
              <b>Sandbox</b>{" · "}
              <span style={{ fg: policy().active ? theme.text.feedback.success.base : theme.text.feedback.warning.base }}>
                {policy().active ? "Active" : "Disabled"}
              </span>
              {policy().active ? ` · ${policy().reads} reads · network blocked` : " · host access"}
            </text>
            <Show when={policy().active}>
              <text fg={theme.text.muted} wrapMode="word">
                Escapes: {policy().escalation === "on-request" ? "approval or session grant" : "disabled"}
              </text>
              <Show when={policy().writableRoots.length > 0}>
                <text fg={theme.text.muted}>Writes:</text>
                <box paddingLeft={2} flexShrink={0}>
                  <For each={policy().writableRoots}>
                    {(root) => (
                      <box flexDirection="row">
                        <text fg={theme.text.base} flexShrink={0}>- </text>
                        <text fg={theme.text.feedback.info.base} wrapMode="word" flexGrow={1}>
                          {root}
                        </text>
                      </box>
                    )}
                  </For>
                </box>
              </Show>
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}
