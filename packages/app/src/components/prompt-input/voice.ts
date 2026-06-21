import { createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createVoiceRuntime, type VoiceRuntimeOptions } from "./voice-runtime"

export { voiceSidecarBaseUrl } from "./voice-sidecar"

export type VoicePhase = "listening" | "hearing" | "transcribing" | "speaking"

export type VoiceDisplayState = "off" | VoicePhase | "working"

const statusKey: Record<VoiceDisplayState, string> = {
  off: "prompt.voice.status.off",
  listening: "prompt.voice.status.listening",
  hearing: "prompt.voice.status.hearing",
  transcribing: "prompt.voice.status.transcribing",
  working: "prompt.voice.status.working",
  speaking: "prompt.voice.status.speaking",
}

export function voiceStatusKey(state: VoiceDisplayState) {
  return statusKey[state]
}

function disclosureDismissed() {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem("opencode.voice.disclosure") === "1"
}

export type VoiceConnectOptions = Omit<VoiceRuntimeOptions, "setPhase" | "onError"> & {
  onError: (message: string) => void
}

export function createVoiceComposerState(options: { working: () => boolean; connect?: VoiceConnectOptions }) {
  const [store, setStore] = createStore({
    on: false,
    phase: "listening" as VoicePhase,
    showDisclosure: false,
    disclosureDismissed: disclosureDismissed(),
    connecting: false,
  })

  let runtime: ReturnType<typeof createVoiceRuntime> | undefined

  const display = createMemo((): VoiceDisplayState => {
    if (!store.on) return "off"
    if (store.phase === "speaking") return "speaking"
    if (options.working()) return "working"
    return store.phase
  })

  const active = createMemo(() => display() !== "off")

  const stopRuntime = () => {
    runtime?.stop()
    runtime = undefined
    setStore("connecting", false)
  }

  const toggle = () => {
    if (store.on) {
      stopRuntime()
      setStore({ on: false, phase: "listening", showDisclosure: false })
      return
    }
    setStore({ on: true, phase: "listening" })
    if (!store.disclosureDismissed) setStore("showDisclosure", true)

    if (!options.connect) return

    if (!options.connect.sessionID()) {
      options.connect.onError("prompt.voice.error.noSession")
      setStore("on", false)
      return
    }

    runtime = createVoiceRuntime({
      sidecarUrl: options.connect.sidecarUrl,
      opencodeUrl: options.connect.opencodeUrl,
      directory: options.connect.directory,
      sessionID: options.connect.sessionID,
      agent: options.connect.agent,
      setPhase: (phase) => setStore("phase", phase),
      onError: (message) => {
        options.connect!.onError(message)
        const fatal =
          message === "voice stream closed" ||
          message === "voice stream connection failed" ||
          message.startsWith("prompt.voice.error.")
        if (!fatal) return
        stopRuntime()
        setStore({ on: false, phase: "listening" })
      },
    })
    setStore("connecting", true)
    void runtime
      .start()
      .catch((error) => {
        options.connect!.onError(error instanceof Error ? error.message : "voice failed")
        stopRuntime()
        setStore({ on: false, phase: "listening" })
      })
      .finally(() => setStore("connecting", false))
  }

  onCleanup(() => stopRuntime())

  return {
    store,
    display,
    active,
    toggle,
    dismissDisclosure: () => {
      if (typeof localStorage !== "undefined") localStorage.setItem("opencode.voice.disclosure", "1")
      setStore({ showDisclosure: false, disclosureDismissed: true })
    },
    setPhase: (phase: VoicePhase) => setStore("phase", phase),
  }
}

export type VoiceComposerState = ReturnType<typeof createVoiceComposerState>

export function voiceComposerBorderClass(state: VoiceDisplayState) {
  if (state === "off") return ""
  if (state === "hearing" || state === "speaking") return "ring-1 ring-inset ring-icon-info-active/60"
  if (state === "working") return "ring-1 ring-inset ring-icon-interactive-base/40"
  return "ring-1 ring-inset ring-border-base/80"
}
