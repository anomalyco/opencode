import { createContext, createEffect, onMount, onCleanup, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { createTTS } from "@/utils/tts"
import { usePlatform } from "./platform"
import { useGlobalSDK } from "./global-sdk"
import { useGlobalSync } from "./global-sync"
import { Persist, persisted } from "@/utils/persist"
import { isAutoSpeakable } from "@/utils/tts-filter"
import { sendTTSEvent } from "@/utils/tts-telemetry"
import type { Part } from "@opencode-ai/sdk/v2/client"

type TTSContextValue = ReturnType<typeof createTTS>

const TTSContext = createContext<TTSContextValue>()

export function TTSProvider(props: ParentProps) {
  const platform = usePlatform()
  const globalSDK = useGlobalSDK()
  const tts = createTTS(
    () => globalSDK.url,
    () => platform.fetch ?? fetch,
  )

  const sync = useGlobalSync()

  const [prefs, setPrefs] = persisted(Persist.global("tts"), createStore({ voice: "", rate: "+0%" }))

  createEffect(() => {
    if (prefs.voice) tts.setVoice(prefs.voice)
    if (prefs.rate) tts.setRate(prefs.rate)
  })

  const setVoice = tts.setVoice
  tts.setVoice = (v) => {
    const next = typeof v === "function" ? v(tts.selectedVoice()) : v
    setVoice(() => next)
    setPrefs("voice", next)
  }

  const setRate = tts.setRate
  tts.setRate = (r) => {
    const next = typeof r === "function" ? r(tts.rate()) : r
    setRate(() => next)
    setPrefs("rate", next)
  }

  onMount(() => tts.load())

  const spoken = new Set<string>()
  const max = 500

  const unsub = globalSDK.event.listen((e) => {
    try {
      const event = e.details
      if (!event || event.type !== "message.part.updated") return
      if (!tts.isEnabled()) return
      const part = event.properties.part as Part & { sessionID?: string; messageID?: string }
      const directory = e.name
      if (directory === "global" || !directory) return
      const [store] = sync.peek(directory, { bootstrap: false })
      const session = store.session.find((s) => s.id === part.sessionID)
      const { speakable, reason } = isAutoSpeakable(part, session)
      if (!speakable) {
        sendTTSEvent(() => globalSDK.url, () => platform.fetch ?? fetch, {
          timestamp: new Date().toISOString(),
          event: "skipped",
          sessionID: part.sessionID ?? "",
          messageID: part.messageID ?? "",
          partID: part.id,
          reason,
        })
        return
      }
      // TypeScript type narrowing — isAutoSpeakable already verified type === "text"
      if (part.type !== "text") return
      if (spoken.has(part.id)) return
      spoken.add(part.id)
      if (spoken.size > max) {
        const first = spoken.values().next().value
        if (first) spoken.delete(first)
      }
      tts.speak(part.text ?? "", {
        sessionID: part.sessionID,
        messageID: part.messageID,
        partID: part.id,
      })
    } catch {}
  })
  onCleanup(() => unsub())

  const value: TTSContextValue = { ...tts }
  return <TTSContext.Provider value={value}>{props.children}</TTSContext.Provider>
}

export function useTTS() {
  const context = useContext(TTSContext)
  if (!context) throw new Error("useTTS must be used within a TTSProvider")
  return context
}
