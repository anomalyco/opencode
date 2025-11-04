import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { TextAttributes, TextareaRenderable } from "@opentui/core"
import { onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"

export interface LiveKitConfig {
  url: string
  roomName: string
  apiKey: string
  apiSecret: string
}

interface DialogLiveKitProps {
  onConnect: (config: LiveKitConfig) => void
  onCancel: () => void
}

export function DialogLiveKit(props: DialogLiveKitProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  let urlInput: TextareaRenderable
  let roomInput: TextareaRenderable
  let apiKeyInput: TextareaRenderable
  let apiSecretInput: TextareaRenderable

  // Helper to get input refs in order
  const inputRefs = () => [urlInput, roomInput, apiKeyInput, apiSecretInput]

  // Get default values from environment variables
  const defaultUrl = process.env.LIVEKIT_URL || ""
  const defaultRoom = process.env.LIVEKIT_DEFAULT_ROOM || "dev"
  const defaultApiKey = process.env.LIVEKIT_API_KEY || ""
  const defaultApiSecret = process.env.LIVEKIT_API_SECRET || ""

  const fields = [
    {
      name: "url",
      ref: (r: TextareaRenderable) => (urlInput = r),
      placeholder: "wss://your-livekit-server.com",
    },
    { name: "roomName", ref: (r: TextareaRenderable) => (roomInput = r), placeholder: "my-room" },
    { name: "apiKey", ref: (r: TextareaRenderable) => (apiKeyInput = r), placeholder: "API Key" },
    {
      name: "apiSecret",
      ref: (r: TextareaRenderable) => (apiSecretInput = r),
      placeholder: "API Secret",
    },
  ]

  onMount(() => {
    dialog.setSize("large")
    setTimeout(() => {
      urlInput?.focus()
    }, 1)
  })

  const handleSubmit = () => {
    const config: LiveKitConfig = {
      url: urlInput.plainText.trim(),
      roomName: roomInput.plainText.trim(),
      apiKey: apiKeyInput.plainText.trim(),
      apiSecret: apiSecretInput.plainText.trim(),
    }

    if (config.url && config.roomName) {
      props.onConnect(config)
      dialog.clear()
    }
  }

  const handleTab = (currentIndex: number, backwards = false) => {
    const direction = backwards ? -1 : 1
    const nextIndex = (currentIndex + direction + fields.length) % fields.length
    setTimeout(() => {
      inputRefs()[nextIndex]?.focus()
    }, 1)
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD}>Connect to LiveKit</text>
        <text fg={theme.textMuted}>esc to cancel</text>
      </box>

      <box gap={1}>
        <box>
          <text fg={theme.textMuted}>LiveKit Server URL:</text>
          <textarea
            ref={(val: TextareaRenderable) => (urlInput = val)}
            placeholder="wss://your-livekit-server.com"
            initialValue={defaultUrl}
            onSubmit={handleSubmit}
            keyBindings={[
              { name: "tab", action: "custom", callback: () => handleTab(0, false) },
              { name: "shift+tab", action: "custom", callback: () => handleTab(0, true) },
              { name: "return", action: "submit" },
            ]}
          />
        </box>

        <box>
          <text fg={theme.textMuted}>Room Name:</text>
          <textarea
            ref={(val: TextareaRenderable) => (roomInput = val)}
            placeholder="my-room"
            initialValue={defaultRoom}
            onSubmit={handleSubmit}
            keyBindings={[
              { name: "tab", action: "custom", callback: () => handleTab(1, false) },
              { name: "shift+tab", action: "custom", callback: () => handleTab(1, true) },
              { name: "return", action: "submit" },
            ]}
          />
        </box>

        <box>
          <text fg={theme.textMuted}>API Key:</text>
          <textarea
            ref={(val: TextareaRenderable) => (apiKeyInput = val)}
            placeholder="devkey"
            initialValue={defaultApiKey}
            onSubmit={handleSubmit}
            keyBindings={[
              { name: "tab", action: "custom", callback: () => handleTab(2, false) },
              { name: "shift+tab", action: "custom", callback: () => handleTab(2, true) },
              { name: "return", action: "submit" },
            ]}
          />
        </box>

        <box>
          <text fg={theme.textMuted}>API Secret:</text>
          <textarea
            ref={(val: TextareaRenderable) => (apiSecretInput = val)}
            placeholder="secret"
            initialValue={defaultApiSecret}
            onSubmit={handleSubmit}
            keyBindings={[
              { name: "tab", action: "custom", callback: () => handleTab(3, false) },
              { name: "shift+tab", action: "custom", callback: () => handleTab(3, true) },
              { name: "return", action: "submit" },
            ]}
          />
        </box>
      </box>

      <box paddingTop={1} paddingBottom={1} justifyContent="center" alignItems="center">
        <box
          paddingLeft={2}
          paddingRight={2}
          border
          borderColor={theme.primary}
          onMouseUp={handleSubmit}
        >
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            Connect
          </text>
        </box>
      </box>

      <box paddingBottom={1}>
        <text fg={theme.textMuted}>Tab/Shift+Tab to switch • Enter to connect • Esc to cancel</text>
      </box>
    </box>
  )
}
