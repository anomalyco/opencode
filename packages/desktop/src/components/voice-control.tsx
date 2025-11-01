import { createSignal, Show, onCleanup, createEffect } from "solid-js"
import { Button, Icon } from "@opencode-ai/ui"
import { createSpeechRecognition } from "@/utils/speech"
import type { Room } from "livekit-client"

interface VoiceControlProps {
  onTranscript?: (text: string, isFinal: boolean) => void
  room?: Room
  disabled?: boolean
}

export function VoiceControl(props: VoiceControlProps) {
  const [mode, setMode] = createSignal<"local" | "livekit">("local")
  const [roomConnected, setRoomConnected] = createSignal(false)

  const speech = createSpeechRecognition({
    onFinal: (text) => {
      props.onTranscript?.(text, true)
    },
    onInterim: (text) => {
      props.onTranscript?.(text, false)
    },
  })

  createEffect(() => {
    if (props.room) {
      setRoomConnected(props.room.state === "connected")

      const handleStateChange = () => {
        setRoomConnected(props.room!.state === "connected")
      }

      props.room.on("connectionStateChanged", handleStateChange)

      onCleanup(() => {
        props.room?.off("connectionStateChanged", handleStateChange)
      })
    }
  })

  const toggleRecording = () => {
    if (speech.isRecording()) {
      speech.stop()
    } else {
      speech.start()
    }
  }

  const toggleMode = () => {
    setMode((prev) => (prev === "local" ? "livekit" : "local"))
  }

  return (
    <div class="flex items-center gap-2">
      <Show when={speech.isSupported()}>
        <Button
          variant={speech.isRecording() ? "primary" : "secondary"}
          onClick={toggleRecording}
          disabled={props.disabled}
          class="flex items-center gap-2"
          classList={{
            "bg-red-500 hover:bg-red-600": speech.isRecording(),
          }}
        >
          <Show when={speech.isRecording()} fallback={<Icon name="robot" class="w-4 h-4" />}>
            <div class="w-2 h-2 rounded-full bg-white animate-pulse" />
          </Show>
          <span>{speech.isRecording() ? "Stop" : "Speak"}</span>
        </Button>
      </Show>

      <Show when={roomConnected()}>
        <Button variant="ghost" onClick={toggleMode} class="flex items-center gap-2">
          <Icon name={mode() === "livekit" ? "avatar-square" : "robot"} class="w-4 h-4" />
          <span class="text-xs">{mode() === "livekit" ? "Room" : "Local"}</span>
        </Button>
      </Show>

      <Show when={speech.interim()}>
        <div class="text-sm text-gray-500 italic px-2">{speech.interim()}</div>
      </Show>
    </div>
  )
}
