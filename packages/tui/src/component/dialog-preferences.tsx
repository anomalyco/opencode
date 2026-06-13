import { createResource, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { TextAttributes } from "@opentui/core"

export function DialogPreferences() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()

  const fetchPreferences = async (): Promise<string> => {
    try {
      const response = await fetch(`${sdk.url}/global/preferences`)
      if (!response.ok) return ""
      return await response.text()
    } catch {
      return ""
    }
  }

  const updatePreferences = async (content: string): Promise<boolean> => {
    try {
      const response = await fetch(`${sdk.url}/global/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: content,
      })
      return response.ok
    } catch {
      return false
    }
  }

  const [preferences] = createResource(fetchPreferences)

  const handleInitialize = async () => {
    const defaultContent = `# User Preferences

<!-- Edit this file to customize how the AI assistant interacts with you. -->
<!-- This file is in Markdown format and will be included in the system prompt. -->

## Communication

- Language: Respond in the same language the user uses
- Verbosity: Concise by default, detailed when asked

## Code Style

- Follow existing project conventions
- Prefer idiomatic patterns for each language

## Behavior

- Ask for clarification when requirements are ambiguous
- Explain trade-offs when multiple approaches exist
`
    const success = await updatePreferences(defaultContent)
    if (success) {
      dialog.clear()
      toast.show({
        variant: "success",
        message: "Default preferences initialized. Use 'opencode preference edit' to edit.",
        duration: 5000,
      })
    } else {
      toast.show({
        variant: "error",
        message: "Failed to initialize preferences",
      })
    }
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          User Preferences
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show when={preferences.loading}>
        <text fg={theme.textMuted}>Loading preferences...</text>
      </Show>

      <Show when={!preferences.loading}>
        <box>
          <text fg={theme.text}>
            Preferences are stored in Markdown format and included in the system prompt.
          </text>
          <text fg={theme.textMuted}> </text>
          <text fg={theme.text}>To edit preferences, use one of these methods:</text>
          <text fg={theme.text}> </text>
          <box paddingLeft={2}>
            <text fg={theme.accent}>1. CLI command:</text>
            <text fg={theme.text}>   opencode preference edit</text>
            <text fg={theme.text}> </text>
            <text fg={theme.accent}>2. Direct file edit:</text>
            <text fg={theme.text}>   ~/.config/opencode/preferences.md</text>
          </box>
          <text fg={theme.textMuted}> </text>
          <Show when={!preferences()}>
            <box flexDirection="row" gap={2}>
              <text
                fg={theme.accent}
                onMouseUp={handleInitialize}
              >
                [Initialize default preferences]
              </text>
            </box>
          </Show>
          <Show when={preferences()}>
            <text fg={theme.success}>Preferences file exists.</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}
