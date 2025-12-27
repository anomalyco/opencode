import { createContext, useContext, type ParentProps } from "solid-js"
import { createTTS } from "@/utils/tts"
import { useGlobalSDK } from "./global-sdk"
import type { Part } from "@opencode-ai/sdk/v2/client"

type TTSContextValue = ReturnType<typeof createTTS>

const TTSContext = createContext<TTSContextValue>()

export function TTSProvider(props: ParentProps) {
  const tts = createTTS()
  const globalSDK = useGlobalSDK()

  // Track which text parts we've already spoken to avoid repeats
  const spokenParts = new Set<string>()

  // Listen for message part updates to trigger TTS
  try {
    globalSDK.event.listen((e) => {
      try {
        const event = e.details
        if (!event || event.type !== "message.part.updated") return
        if (!tts.isEnabled()) return

        const part = event.properties.part as Part
        // Only speak completed text parts from assistant messages
        if (part.type !== "text") return
        if (!part.time?.end) return // Not yet complete
        if (spokenParts.has(part.id)) return // Already spoken

        spokenParts.add(part.id)
        tts.speak(part.text ?? "")
      } catch {
        // Silently ignore errors in event handler to prevent app crash
      }
    })
  } catch {
    // Silently ignore if event listener fails to attach
  }

  return <TTSContext.Provider value={tts}>{props.children}</TTSContext.Provider>
}

export function useTTS() {
  const context = useContext(TTSContext)
  if (!context) {
    throw new Error("useTTS must be used within a TTSProvider")
  }
  return context
}
