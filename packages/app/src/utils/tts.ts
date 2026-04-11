import { createSignal, onCleanup } from "solid-js"
import { cleanTextForSpeech } from "@opencode-ai/util/text"
import { sendTTSEvent } from "./tts-telemetry"

export function createTTS(url: () => string, fetcher: () => typeof fetch) {
  const [enabled, setEnabled] = createSignal(true)
  const [speaking, setSpeaking] = createSignal(false)
  const [paused, setPaused] = createSignal(false)
  const [voices, setVoices] = createSignal<string[]>([])
  const [voice, setVoice] = createSignal("")
  const [rate, setRate] = createSignal("+0%")
  const [last, setLast] = createSignal<string | undefined>()

  type QueueItem = {
    text: string
    sessionID?: string
    messageID?: string
    partID?: string
  }
  let queue: QueueItem[] = []
  let audio: HTMLAudioElement | undefined
  let blob: string | undefined
  let mounted = true

  const load = async () => {
    try {
      const f = fetcher() ?? fetch
      const res = await f(`${url()}/tts/voices`)
      if (!res.ok) return
      const list = (await res.json()) as string[]
      setVoices(list)
      if (!voice() && list.length > 0) setVoice(list[0])
    } catch {}
  }

  const synthesize = async (text: string): Promise<string | undefined> => {
    try {
      const f = fetcher() ?? fetch
      const res = await f(`${url()}/tts/speak`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          voice: voice() || undefined,
          rate: rate() || undefined,
        }),
      })
      if (!res.ok) return undefined
      const data = await res.blob()
      return URL.createObjectURL(data)
    } catch {
      return undefined
    }
  }

  const revoke = () => {
    if (!blob) return
    URL.revokeObjectURL(blob)
    blob = undefined
  }

  const process = async () => {
    if (!mounted || speaking() || queue.length === 0) return
    const item = queue.shift()
    if (!item) return
    setSpeaking(true)
    setPaused(false)
    const src = await synthesize(item.text)
    if (!src || !mounted) {
      setSpeaking(false)
      if (mounted) process()
      return
    }
    revoke()
    blob = src
    setLast(src)
    audio = new Audio(src)
    const startedAt = Date.now()
    audio.onended = () => {
      sendTTSEvent(url, fetcher, {
        timestamp: new Date().toISOString(),
        event: "ended",
        sessionID: item.sessionID ?? "",
        messageID: item.messageID ?? "",
        partID: item.partID,
        duration: Date.now() - startedAt,
      })
      setSpeaking(false)
      setPaused(false)
      audio = undefined
      process()
    }
    audio.onerror = () => {
      sendTTSEvent(url, fetcher, {
        timestamp: new Date().toISOString(),
        event: "error",
        sessionID: item.sessionID ?? "",
        messageID: item.messageID ?? "",
        partID: item.partID,
        error: "audio error",
      })
      setSpeaking(false)
      setPaused(false)
      audio = undefined
      process()
    }
    audio.onpause = () => setPaused(true)
    audio.onplay = () => setPaused(false)
    audio.play().then(() => {
      sendTTSEvent(url, fetcher, {
        timestamp: new Date().toISOString(),
        event: "started",
        sessionID: item.sessionID ?? "",
        messageID: item.messageID ?? "",
        partID: item.partID,
        queueLength: queue.length,
      })
    }).catch(() => {
      setSpeaking(false)
      audio = undefined
      process()
    })
  }

  const speak = (text: string, meta?: { sessionID?: string; messageID?: string; partID?: string }) => {
    if (!enabled()) return
    const cleaned = cleanTextForSpeech(text)
    if (!cleaned.trim()) return
    queue.push({ text: cleaned, ...meta })
    sendTTSEvent(url, fetcher, {
      timestamp: new Date().toISOString(),
      event: "queued",
      sessionID: meta?.sessionID ?? "",
      messageID: meta?.messageID ?? "",
      partID: meta?.partID,
      queueLength: queue.length,
    })
    process()
  }

  const stop = () => {
    sendTTSEvent(url, fetcher, {
      timestamp: new Date().toISOString(),
      event: "stopped",
      sessionID: "",
      messageID: "",
    })
    queue = []
    if (audio) {
      audio.pause()
      audio.onended = null
      audio.onerror = null
      audio.onpause = null
      audio.onplay = null
      audio = undefined
    }
    setSpeaking(false)
    setPaused(false)
  }

  const togglePause = () => {
    if (!audio) return
    if (paused()) {
      queue = []
      audio.play()
      return
    }
    audio.pause()
  }

  const replay = () => {
    const src = last()
    if (!src) return
    stop()
    setSpeaking(true)
    audio = new Audio(src)
    audio.onended = () => {
      setSpeaking(false)
      setPaused(false)
      audio = undefined
    }
    audio.onerror = () => {
      setSpeaking(false)
      setPaused(false)
      audio = undefined
    }
    audio.onpause = () => setPaused(true)
    audio.onplay = () => setPaused(false)
    audio.play().catch(() => {
      setSpeaking(false)
      audio = undefined
    })
  }

  onCleanup(() => {
    mounted = false
    stop()
    revoke()
  })

  const speakNow = (text: string, meta?: { sessionID?: string; messageID?: string; partID?: string }) => {
    const cleaned = cleanTextForSpeech(text)
    if (!cleaned.trim()) return
    sendTTSEvent(url, fetcher, {
      timestamp: new Date().toISOString(),
      event: "speak_now",
      sessionID: meta?.sessionID ?? "",
      messageID: meta?.messageID ?? "",
      partID: meta?.partID,
    })
    stop()
    queue = [{ text: cleaned, ...meta }]
    process()
  }

  return {
    isSupported: () => true,
    isEnabled: enabled,
    isSpeaking: speaking,
    isPaused: paused,
    voices,
    selectedVoice: voice,
    setVoice,
    rate,
    setRate,
    speak,
    speakNow,
    pause: () => audio?.pause(),
    resume: () => {
      audio?.play()
    },
    togglePause,
    stop,
    toggle: () => {
      const next = !enabled()
      setEnabled(next)
      if (!next) stop()
      return next
    },
    enable: () => setEnabled(true),
    disable: () => {
      setEnabled(false)
      stop()
    },
    queueLength: () => queue.length,
    replay,
    canReplay: () => !!last(),
    load,
  }
}
