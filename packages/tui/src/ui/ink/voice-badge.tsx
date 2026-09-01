import { createSignal, onMount, onCleanup } from "solid-js"
import { useTheme } from "../../context/theme"

export interface VoiceBadgeProps {
  recording: boolean
  task?: "transcribe" | "translate"
  language?: string
}

export function VoiceBadge(props: VoiceBadgeProps) {
  const { theme } = useTheme()
  const [wave, setWave] = createSignal(0)

  const waveforms = [" ▃▅▇▅▃ ", "▃▅▇█▇▅▃", "▅▇█▇▅▃ ", "▇█▇▅▃ ▃", "█▇▅▃ ▃▅"]

  onMount(() => {
    const interval = setInterval(() => {
      if (props.recording) {
        setWave((w) => (w + 1) % waveforms.length)
      }
    }, 150)
    onCleanup(() => clearInterval(interval))
  })

  if (!props.recording) return null

  return (
    <box
      flexDirection="row"
      alignItems="center"
      gap={1}
      border={["top", "bottom", "left", "right"]}
      borderColor={theme.error}
      backgroundColor={theme.backgroundElement}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={theme.error}>
        <b>{"● REC"}</b>
      </text>
      <text fg={theme.warning}>
        <b>{waveforms[wave()]}</b>
      </text>
      <text fg={theme.textMuted}>
        {props.task === "translate"
          ? "[Auto-Detect → Translate to English]"
          : `[Transcribing: ${props.language ?? "auto"}]`}
      </text>
      <text fg={theme.accent}>
        <b>{"(Press Ctrl+V to finish)"}</b>
      </text>
    </box>
  )
}
