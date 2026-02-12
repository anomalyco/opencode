import { createMemo, createSignal, For, Show } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"

function Status(props: { status: string; loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.status === "ready") {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Ready</span>
  }
  if (props.status === "downloading") {
    return <span style={{ fg: theme.textMuted }}>⬇ Downloading</span>
  }
  if (props.status === "loading") {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.status === "disabled") {
    return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
  }
  if (props.status === "idle") {
    return <span style={{ fg: theme.textMuted }}>○ Idle</span>
  }
  return <span style={{ fg: theme.error }}>✗ Error</span>
}

export function DialogVoice() {
  const local = useLocal()
  const sync = useSync()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)

  const voiceData = () => sync.data.voice
  const voiceStatus = () => (voiceData() as any)?.status ?? "disabled"
  const voiceModel = () => (voiceData() as any)?.model

  const options = createMemo(() => {
    const loadingModel = loading()
    const currentStatus = voiceStatus()

    const result: DialogSelectOption<string>[] = []

    // Toggle voice on/off
    result.push({
      value: "toggle",
      title: currentStatus === "disabled" ? "Enable Voice" : "Disable Voice",
      description: "Toggle voice transcription",
      footer: <Status status={currentStatus} loading={loadingModel === "toggle"} />,
      category: "Control",
    })

    // Model selection
    const models = [
      { name: "tiny", size: "75 MB", description: "Fast, lower accuracy" },
      { name: "base", size: "142 MB", description: "Balanced speed and accuracy" },
      { name: "small", size: "466 MB", description: "Better accuracy, slower" },
    ]

    for (const model of models) {
      const isCurrent = voiceModel() === model.name
      result.push({
        value: `model:${model.name}`,
        title: `${model.name} (${model.size})`,
        description: model.description,
        footer: loadingModel === model.name ? <span>⋯ Loading</span> : isCurrent ? <span>✓ Active</span> : undefined,
        category: "Models",
      })
    }

    return result
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "select",
      onTrigger: async (option: DialogSelectOption<string>) => {
        if (loading() !== null) return

        const value = option.value

        if (value === "toggle") {
          setLoading("toggle")
          try {
            await local.voice.toggle()
          } catch (error) {
            console.error("Failed to toggle voice:", error)
          } finally {
            setLoading(null)
          }
          return
        }

        if (value.startsWith("model:")) {
          const modelName = value.replace("model:", "") as "tiny" | "base" | "small"
          setLoading(modelName)
          try {
            await local.voice.switchModel(modelName)
          } catch (error) {
            console.error("Failed to switch voice model:", error)
          } finally {
            setLoading(null)
          }
        }
      },
    },
  ])

  return (
    <DialogSelect
      ref={setRef}
      title="Voice Settings"
      options={options()}
      keybind={keybinds()}
      onSelect={(option) => {
        // Don't close on select, only on escape
      }}
    />
  )
}
