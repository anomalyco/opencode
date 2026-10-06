import { createMemo, createSignal, onCleanup } from "solid-js"
import type { TextareaRenderable } from "@opentui/core"
import { Voice, fallbackTranscriptionModel } from "../../util/voice"
import { useConfig } from "../../config"
import { useClient } from "../../context/client"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import { useToast } from "../../ui/toast"

type VoiceDeps = {
  input: () => TextareaRenderable | undefined
  promptInput: () => string
  submit: () => Promise<unknown> | unknown
}

type VoiceMode = "insert" | "send"

const WAVEFORM_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
const WAVEFORM_BARS = 20

export function useVoice(deps: VoiceDeps) {
  const config = useConfig()
  const toast = useToast()
  const renderer = useRenderer()
  const theme = useTheme()
  const client = useClient()

  const [recording, setRecording] = createSignal(false)
  const [processing, setProcessing] = createSignal(false)
  const [pendingRetry, setPendingRetry] = createSignal(false)
  const [levels, setLevels] = createSignal<number[]>([])
  const [elapsed, setElapsed] = createSignal(0)
  let timer: ReturnType<typeof setInterval> | undefined

  const voiceConfig = createMemo(() => config.data.voice)

  // Transcription happens in the TUI process itself: the recording is posted
  // straight to the configured OpenAI-compatible endpoint. Voice ships
  // unconfigured, so without a server URL we keep the recording and surface a
  // clear error instead of silently doing nothing.
  const transcribe = async (audio: string, mime: string, prompt?: string, signal?: AbortSignal) => {
    const voice = voiceConfig() ?? {}
    const url = voice.url?.trim()
    if (!url) {
      throw new Error("Voice transcription is not configured (set the server URL in Settings -> Voice)")
    }
    const form = new FormData()
    form.append("file", new Blob([Buffer.from(audio, "base64")], { type: mime }), "voice.wav")
    form.append("model", voice.model?.trim() || fallbackTranscriptionModel)
    form.append("response_format", "json")
    if (prompt?.trim()) form.append("prompt", prompt.trim())
    const headers: Record<string, string> = {}
    if (voice.api_key?.trim()) headers.Authorization = `Bearer ${voice.api_key.trim()}`
    const response = await fetch(url, { method: "POST", headers, body: form, signal })
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(body.trim() || `Transcription failed (${response.status} ${response.statusText})`)
    }
    const json = (await response.json()) as { text?: string }
    return { text: json.text ?? "" }
  }

  const stopTimer = () => {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  const startTimer = () => {
    stopTimer()
    const startedAt = Date.now()
    setElapsed(0)
    timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250)
  }

  const instance = Voice.create({
    config: voiceConfig,
    prompt: () => deps.promptInput(),
    onLevel: (level) => setLevels((prev) => [...prev.slice(-(WAVEFORM_BARS - 1)), level]),
    transcribe,
    onError: (error) => {
      setRecording(false)
      stopTimer()
      toast.show({ message: `Recording failed: ${error.message}`, variant: "error", duration: 5000 })
    },
  })

  async function handleResult(result: { text: string; cancelled: boolean } | null | undefined, mode: VoiceMode) {
    setProcessing(false)
    if (result?.cancelled) return
    if (!result) {
      setPendingRetry(instance.hasRecording())
      return
    }
    if (!result.text.trim()) {
      toast.show({
        message: "No speech detected (transcription returned empty text)",
        variant: "warning",
      })
      setPendingRetry(instance.hasRecording())
      return
    }
    instance.clearRecording()
    setPendingRetry(false)
    const input = deps.input()
    if (!input) return
    input.insertText(result.text)
    input.getLayoutNode().markDirty()
    input.gotoBufferEnd()
    renderer.requestRender()
    if (mode === "send") {
      // Let the prompt store pick up the inserted text before submitting.
      await new Promise((resolve) => setTimeout(resolve, 0))
      await deps.submit()
    }
  }

  const catchToast = (error: unknown) => {
    toast.show({
      variant: "error",
      message: error instanceof Error ? error.message : String(error),
      duration: 5000,
    })
    return null
  }

  async function confirmRetry() {
    if (!instance.hasRecording()) return
    setPendingRetry(false)
    setProcessing(true)
    const result = await instance.retry().catch(catchToast)
    await handleResult(result, "insert")
  }

  function cancelRetry() {
    instance.clearRecording()
    setPendingRetry(false)
  }

  async function stop(mode: VoiceMode) {
    if (!recording()) return
    setRecording(false)
    setProcessing(true)
    stopTimer()
    const result = await instance.stop().catch(catchToast)
    await handleResult(result, mode)
  }

  function cancelRecording() {
    if (!recording()) return
    setRecording(false)
    setProcessing(false)
    stopTimer()
    instance.destroy()
  }

  async function toggle(mode: VoiceMode = "insert") {
    if (processing()) {
      const cancelled = instance.cancel()
      if (cancelled) {
        setProcessing(false)
        toast.show({
          message: "Transcription cancelled",
          variant: "info",
          duration: 1500,
        })
      }
      return
    }

    if (recording()) {
      await stop(mode)
      return
    }

    if (!instance.isEnabled()) {
      toast.show({
        message: `Voice input unavailable: ${instance.unavailableMessage() ?? "missing transcription configuration"}`,
        variant: "warning",
      })
      return
    }

    setRecording(true)
    setLevels([])
    startTimer()
    toast.show({
      message: "Recording... press keybind again to stop",
      variant: "info",
      duration: 2000,
    })
    const ok = await instance.start().catch((error) => {
      toast.show({
        variant: "error",
        message: error instanceof Error ? error.message : String(error),
        duration: 5000,
      })
      return "error"
    })
    if (ok === true) {
      // Let local transcription servers pre-warm (e.g. load a model) while the
      // recording is still in progress; failures are irrelevant here.
      void client.api.voice.recording({}).catch(() => undefined)
      return
    }
    setRecording(false)
    stopTimer()
    if (ok === false) {
      toast.show({
        message: "Failed to start recording",
        variant: "error",
      })
    }
  }

  onCleanup(() => {
    stopTimer()
    instance.destroy()
    setProcessing(false)
    setRecording(false)
    setPendingRetry(false)
  })

  const enabled = createMemo(() => instance.isEnabled())
  const color = createMemo(() => {
    if (processing()) return theme.text.feedback.warning.base
    if (recording()) return theme.text.feedback.warning.base
    if (!enabled()) return theme.text.muted
    return theme.text.base
  })
  const waveform = createMemo(() =>
    levels()
      .map(
        (level) =>
          WAVEFORM_CHARS[Math.max(0, Math.min(WAVEFORM_CHARS.length - 1, Math.floor(level * WAVEFORM_CHARS.length)))],
      )
      .join("")
      .padStart(WAVEFORM_BARS, "▁"),
  )
  const elapsedLabel = createMemo(() => {
    const total = elapsed()
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return `${minutes}:${String(seconds).padStart(2, "0")}`
  })

  return {
    toggle,
    stopInsert: () => stop("insert"),
    stopSend: () => stop("send"),
    cancelRecording,
    confirmRetry,
    cancelRetry,
    enabled,
    pendingRetry,
    color,
    recording,
    processing,
    waveform,
    elapsedLabel,
  }
}
