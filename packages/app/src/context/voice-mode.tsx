import { createContext, useContext, createSignal, createEffect, onCleanup, type ParentProps } from "solid-js"
// useSDK provides url + client scoped to the current directory — required so promptAsync
// sends the correct ?directory= param and LLM responses land on the right event channel
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { useTTS } from "./tts"
import { usePlatform } from "./platform"
import { createVAD } from "@/utils/vad"
import { transition, float32ToWav, type VoiceModeState, type VoiceModeEvent } from "@/utils/voice-mode-state"
import { Identifier } from "@/utils/id"
import { useParams } from "@solidjs/router"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"

type VoiceModeContextValue = {
  state: () => VoiceModeState
  toggle: () => Promise<void>
  isActive: () => boolean
}

const VoiceModeContext = createContext<VoiceModeContextValue>()

export function VoiceModeProvider(props: ParentProps) {
  const [state, setState] = createSignal<VoiceModeState>("idle")
  const sdk = useSDK()
  const sync = useSync()
  const tts = useTTS()
  const platform = usePlatform()
  const params = useParams()

  let vad: Awaited<ReturnType<typeof createVAD>> | undefined
  let lock: WakeLockSentinel | undefined

  const dispatch = (event: VoiceModeEvent) => {
    const next = transition(state(), event)
    if (next !== state()) {
      setState(next)
    }
    return next
  }

  // Transcribe audio via the STT endpoint
  const transcribe = async (audio: Float32Array) => {
    try {
      const blob = float32ToWav(audio)
      const file = new File([blob], "audio.wav", { type: "audio/wav" })
      const form = new FormData()
      form.append("file", file)
      if (params.id) form.append("sessionID", params.id)

      const fetcher = platform.fetch ?? fetch
      const response = await fetcher(`${sdk.url}/voice/transcribe`, {
        method: "POST",
        body: form,
      })

      if (!response.ok) {
        dispatch({ type: "transcription_failed", error: "Request failed" })
        return
      }

      const payload = await response.json().catch(() => ({ text: "" }))
      const text = typeof payload?.text === "string" ? payload.text : ""

      if (!text.trim()) {
        dispatch({ type: "transcription_failed", error: "No speech detected" })
        return
      }

      dispatch({ type: "transcription_complete", text })
      await submitMessage(text)
    } catch (err) {
      dispatch({ type: "transcription_failed", error: String(err) })
    }
  }

  // Submit transcribed text as a message
  const submitMessage = async (text: string) => {
    console.log(`[voice-mode] submitting message via SDK: "${text}"`)
    let messageID: string | undefined
    try {
      const sessionID = params.id
      if (!sessionID) {
        dispatch({ type: "error", message: "No active session" })
        return
      }

      messageID = Identifier.ascending("message")

      const optimisticMessage = {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: Date.now() },
      } as unknown as Message

      const optimisticParts: Part[] = [{
        id: Identifier.ascending("part"),
        messageID,
        sessionID,
        type: "text",
        text,
        time: { created: Date.now() },
      } as unknown as Part]

      sync.session.optimistic.add({
        sessionID,
        message: optimisticMessage,
        parts: optimisticParts,
      })

      await sdk.client.session.promptAsync({
        sessionID,
        messageID,
        parts: [{ type: "text" as const, text }],
      })
    } catch (err) {
      console.error(`[voice-mode] submit error:`, err)
      if (params.id && messageID) {
        sync.session.optimistic.remove({
          sessionID: params.id,
          messageID,
        })
      }
      dispatch({ type: "error", message: String(err) })
    }
  }

  // Listen for response completion via SSE events
  const unsub = sdk.event.listen((e) => {
    try {
      const event = e.details
      if (!event) return
      if (state() !== "waiting" && state() !== "speaking") return

      // Detect message completion
      if (event.type === "message.updated") {
        const msg = event.properties.info as { role?: string; time?: { completed?: number } }
        if (msg.role === "assistant" && msg.time?.completed) {
          dispatch({ type: "response_complete" })
        }
      }
    } catch {
      // Silently ignore
    }
  })
  onCleanup(() => unsub())

  // Detect TTS completion to re-arm listening
  createEffect(() => {
    if (state() === "speaking" && !tts.isSpeaking()) {
      dispatch({ type: "tts_finished" })
    }
  })

  // Wake lock management
  const acquireWakeLock = async () => {
    try {
      if ("wakeLock" in navigator) {
        lock = await navigator.wakeLock.request("screen")
      }
    } catch {
      // Wake lock not supported or denied
    }
  }

  const releaseWakeLock = () => {
    lock?.release()
    lock = undefined
  }

  const startVoiceMode = async () => {
    try {
      vad = await createVAD({
        onSpeechStart: () => {
          // Barge-in: if TTS is playing, stop it
          if (state() === "speaking") {
            tts.stop()
          }
          dispatch({ type: "speech_start" })
        },
        onSpeechEnd: (audio) => {
          const next = dispatch({ type: "speech_end", audio })
          // Only transcribe if we actually transitioned to transcribing (uses return value, not stale signal)
          if (next === "transcribing") void transcribe(audio)
        },
      })
      vad.start()
      await acquireWakeLock()
      dispatch({ type: "toggle" })
    } catch (err) {
      vad?.destroy()
      vad = undefined
      console.error("Failed to start voice mode:", err)
    }
  }

  const stopVoiceMode = () => {
    if (vad) {
      vad.destroy()
      vad = undefined
    }
    tts.stop()
    releaseWakeLock()
    dispatch({ type: "toggle" })
  }

  const toggle = async () => {
    if (state() === "idle") {
      await startVoiceMode()
    } else {
      stopVoiceMode()
    }
  }

  onCleanup(() => {
    if (state() !== "idle") {
      stopVoiceMode()
    }
  })

  const value: VoiceModeContextValue = {
    state,
    toggle,
    isActive: () => state() !== "idle",
  }

  return <VoiceModeContext.Provider value={value}>{props.children}</VoiceModeContext.Provider>
}

export function useVoiceMode() {
  const context = useContext(VoiceModeContext)
  if (!context) {
    throw new Error("useVoiceMode must be used within a VoiceModeProvider")
  }
  return context
}
