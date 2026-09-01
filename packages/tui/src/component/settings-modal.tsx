import { createSignal, For } from "solid-js"
import { useTheme } from "../context/theme"

export interface SettingsModalProps {
  onClose: () => void
}

export interface SettingItem {
  id: string
  label: string
  description: string
  value: string
  options?: string[]
}

export function SettingsModal(props: SettingsModalProps) {
  const { theme } = useTheme()
  const [selectedIndex, setSelectedIndex] = createSignal(0)

  const [settings, setSettings] = createSignal<SettingItem[]>([
    {
      id: "stt_enabled",
      label: "Voice STT (Push-to-Talk)",
      description: "Activate microphone voice input via Ctrl+V / /voice hotkey",
      value: "Enabled",
      options: ["Enabled", "Disabled"],
    },
    {
      id: "stt_model",
      label: "Whisper STT Model",
      description: "Speech-to-text neural model deployed on DGX / Local",
      value: "whisper-large-v3",
      options: ["whisper-large-v3", "whisper-large-v3-turbo", "whisper-medium"],
    },
    {
      id: "stt_mode",
      label: "Audio Translation Mode",
      description: "Single-pass real-time translation vs native script transcription",
      value: "Translate to English",
      options: ["Translate to English", "Keep Spoken Language"],
    },
    {
      id: "stt_lang",
      label: "Spoken Language Detection",
      description: "Auto-detect Tamil (ta), Hindi, Spanish, French, Chinese, etc.",
      value: "Auto-Detect (99 Languages)",
      options: ["Auto-Detect (99 Languages)", "Tamil (ta)", "English (en)", "Hindi (hi)"],
    },
    {
      id: "slack_daemon",
      label: "Slack Automation Daemon",
      description: "Socket Mode worker accepting remote tasks via Slack channels",
      value: "Enabled",
      options: ["Enabled", "Disabled"],
    },
    {
      id: "locked_state",
      label: "Locked State Execution",
      description: "Allow daemon to execute tasks while screen is locked (Win+L)",
      value: "Active (24/7)",
      options: ["Active (24/7)", "Paused on Lock"],
    },
  ])

  const toggleSetting = (index: number) => {
    setSettings((prev) => {
      const copy = [...prev]
      const item = copy[index]
      if (item && item.options && item.options.length > 0) {
        const curIdx = item.options.indexOf(item.value)
        const nextIdx = (curIdx + 1) % item.options.length
        copy[index] = { ...item, value: item.options[nextIdx] ?? item.value }
      }
      return copy
    })
  }

  return (
    <box
      flexDirection="column"
      border={["top", "bottom", "left", "right"]}
      borderColor={theme.primary}
      backgroundColor={theme.background}
      padding={1}
      gap={1}
      width={78}
    >
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <text fg={theme.primary}>
          <b>{"⚡ ZIQ-CODE · Feature Settings & Toggles"}</b>
        </text>
        <text fg={theme.textMuted}>{"[Esc / Ctrl+P to Exit]"}</text>
      </box>

      <box border={["bottom"]} borderColor={theme.borderSubtle} />

      {/* Settings List */}
      <box flexDirection="column" gap={1}>
        <For each={settings()}>
          {(item, idx) => {
            const isSelected = () => idx() === selectedIndex()
            return (
              <box
                flexDirection="column"
                backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                paddingLeft={1}
                paddingRight={1}
              >
                <box flexDirection="row" justifyContent="space-between" alignItems="center">
                  <box flexDirection="row" gap={1}>
                    <text fg={isSelected() ? theme.accent : theme.textMuted}>
                      {isSelected() ? "▶" : " "}
                    </text>
                    <text fg={isSelected() ? theme.text : theme.textMuted}>
                      <b>{item.label}</b>
                    </text>
                  </box>

                  {/* Value Pill */}
                  <box
                    border={["top", "bottom", "left", "right"]}
                    borderColor={isSelected() ? theme.accent : theme.borderSubtle}
                    backgroundColor={theme.backgroundPanel}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <text
                      fg={
                        item.value === "Enabled" || item.value === "Active (24/7)" || item.value === "Translate to English"
                          ? theme.success
                          : theme.info
                      }
                    >
                      <b>{item.value}</b>
                    </text>
                  </box>
                </box>

                {/* Description */}
                <box paddingLeft={3}>
                  <text fg={theme.textMuted}>
                    <i>{item.description}</i>
                  </text>
                </box>
              </box>
            )
          }}
        </For>
      </box>

      <box border={["top"]} borderColor={theme.borderSubtle} />

      {/* Footer Navigation Hints */}
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <text fg={theme.textMuted}>
          {"[↑/↓] Navigate  ·  [Space / Enter] Toggle  ·  [Esc] Save & Close"}
        </text>
        <text fg={theme.warning}>
          <b>{"● Auto-Saved"}</b>
        </text>
      </box>
    </box>
  )
}
