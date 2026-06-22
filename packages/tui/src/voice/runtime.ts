import { createSignal, onCleanup } from "solid-js"
import { playMp3, voiceSidecarBaseUrl } from "./play"
import { voiceControlPlaneUrl } from "./url"

export type TuiVoicePhase = "off" | "listening" | "working" | "speaking"

type TuiTurnResponse = {
  status: "ok" | "idle"
  reason?: string
  transcript?: string
  reply?: string
  speak?: string
  ttsError?: string
  tts?: {
    format: string
    encoding: string
    data: string
  }
  error?: string
}

export type TuiVoiceOptions = {
  sidecarUrl?: () => string
  opencodeUrl: () => string
  serverUrl?: () => string | undefined
  directory: () => string
  sessionID: () => string | undefined
  agent: () => string | undefined
  enabled: () => boolean
  onError: (message: string) => void
}

function base64ToBytes(data: string) {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function createTuiVoice(options: TuiVoiceOptions) {
  const [active, setActive] = createSignal(false)
  const [phase, setPhase] = createSignal<TuiVoicePhase>("off")

  let loop = false
  let abort: AbortController | undefined
  let loopPromise: Promise<void> | undefined

  const label = () => {
    if (!active()) return ""
    if (phase() === "listening") return "Voice · listening… (F3 to stop)"
    if (phase() === "working") return "Voice · working…"
    if (phase() === "speaking") return "Voice · speaking…"
    return "Voice · starting…"
  }

  async function runTurn() {
    const sessionID = options.sessionID()
    if (!sessionID) throw new Error("no active session")

    setPhase("listening")
    const base = (options.sidecarUrl?.() ?? voiceSidecarBaseUrl()).replace(/\/+$/, "")
    const res = await fetch(`${base}/voice/tui/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abort?.signal,
      body: JSON.stringify({
        directory: options.directory(),
        sessionID,
        agent: options.agent(),
        server: voiceControlPlaneUrl({ url: options.opencodeUrl(), serverUrl: options.serverUrl?.() }),
      }),
    })

    const data = (await res.json().catch(() => ({}))) as TuiTurnResponse
    if (!res.ok) {
      throw new Error(typeof data.error === "string" ? data.error : `voice turn failed (${res.status})`)
    }

    if (data.status === "idle") return

    if (data.ttsError) options.onError(data.ttsError)

    if (data.tts?.encoding === "base64" && data.tts.data) {
      setPhase("speaking")
      await playMp3(base64ToBytes(data.tts.data))
    }
  }

  async function runLoop() {
    while (loop) {
      if (!options.enabled()) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        continue
      }
      try {
        await runTurn()
      } catch (error) {
        if (abort?.signal.aborted) break
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes("fetch") || message.includes("ECONNREFUSED")) {
          options.onError("voice sidecar not reachable — start voxcode or voice-stt serve on port 8765")
          stop()
          break
        }
        options.onError(message)
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
    setPhase("off")
  }

  function start() {
    if (loop) return
    if (!process.env.XAI_API_KEY?.trim()) {
      options.onError("XAI_API_KEY is not set")
      return
    }
    loop = true
    setActive(true)
    abort = new AbortController()
    setPhase("listening")
    loopPromise = runLoop()
  }

  function stop() {
    loop = false
    abort?.abort()
    abort = undefined
    setActive(false)
    setPhase("off")
  }

  function toggle() {
    if (active()) stop()
    else start()
  }

  onCleanup(() => stop())

  return {
    active,
    phase,
    label,
    toggle,
    stop,
  }
}
