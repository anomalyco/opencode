import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useSDK } from "@tui/context/sdk"
import { For, Show, createResource } from "solid-js"

export function DialogInstructions() {
  const sdk = useSDK()
  const { theme } = useTheme()

  const [instructions] = createResource(async () => {
    const result = await sdk.client.instructions.list()
    return result.data
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Instructions
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <Show when={!instructions.loading} fallback={<text fg={theme.textMuted}>Loading...</text>}>
        <Show
          when={(instructions()?.files?.length ?? 0) + (instructions()?.urls?.length ?? 0) > 0}
          fallback={<text fg={theme.textMuted}>No instruction files loaded</text>}
        >
          <Show when={instructions()?.files?.length}>
            <box>
              <text fg={theme.text}>Files</text>
              <For each={instructions()?.files}>
                {(file) => (
                  <box flexDirection="row" gap={1}>
                    <text flexShrink={0} fg={theme.success}>
                      •
                    </text>
                    <text fg={theme.text} wrapMode="word">
                      {file}
                    </text>
                  </box>
                )}
              </For>
            </box>
          </Show>
          <Show when={instructions()?.urls?.length}>
            <box>
              <text fg={theme.text}>URLs</text>
              <For each={instructions()?.urls}>
                {(url) => (
                  <box flexDirection="row" gap={1}>
                    <text flexShrink={0} fg={theme.success}>
                      •
                    </text>
                    <text fg={theme.text} wrapMode="word">
                      {url}
                    </text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        </Show>
      </Show>
    </box>
  )
}
