import { createMemo, createSignal, onCleanup } from "solid-js"
import type { TextareaRenderable } from "@opentui/core"
import { Voice } from "../../util/voice"
import { useSync } from "../../context/sync"
import { useSDK } from "../../context/sdk"
import { useTuiConfig } from "../../config"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import { useToast } from "../../ui/toast"

type VoiceDeps = {
  input: () => TextareaRenderable | undefined
  promptInput: () => string
  sessionID: () => string | undefined
  workspaceID: () => string | undefined
}

export function useVoice(deps: VoiceDeps) {
  const sync = useSync()
  const sdk = useSDK()
  const tuiConfig = useTuiConfig()
  const toast = useToast()
  const renderer = useRenderer()
  const { theme } = useTheme()

  const [recording, setRecording] = createSignal(false)
  const [processing, setProcessing] = createSignal(false)
  const [pendingRetry, setPendingRetry] = createSignal(false)

  const voiceConfig = createMemo(() => tuiConfig.voice)

  const instance = Voice.create({
    config: voiceConfig,
    transcription: () => sync.data.config.voice,
    prompt: () => deps.promptInput(),
    transcribe: (audio, mime, prompt, signal) =>
      sdk.client.audio
        .transcribe({
          workspace: deps.workspaceID(),
          audio,
          mime,
          ...(prompt?.trim() ? { prompt } : {}),
          ...(deps.sessionID() ? { sessionID: deps.sessionID() } : {}),
        }, { signal, throwOnError: true })
        .then((res) => res.data),
  })

  function handleResult(result: { text: string; cancelled: boolean } | null | undefined) {
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
    handleResult(result)
  }

  function cancelRetry() {
    instance.clearRecording()
    setPendingRetry(false)
  }

  async function toggle() {
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
      setRecording(false)
      setProcessing(true)
      const result = await instance.stop().catch(catchToast)
      handleResult(result)
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
    if (ok === true) return
    setRecording(false)
    if (ok === false) {
      toast.show({
        message: "Failed to start recording",
        variant: "error",
      })
    }
  }

  onCleanup(() => {
    instance.destroy()
    setProcessing(false)
    setRecording(false)
    setPendingRetry(false)
  })

  const enabled = createMemo(() => instance.isEnabled())
  const label = createMemo(() => {
    if (processing()) return "Transcribing"
    if (recording()) return "Stop"
    return "Record"
  })
  const color = createMemo(() => {
    if (processing()) return theme.warning
    if (recording()) return theme.warning
    if (!enabled()) return theme.textMuted
    return theme.text
  })

  return {
    toggle,
    confirmRetry,
    cancelRetry,
    enabled,
    pendingRetry,
    label,
    color,
    recording,
    processing,
  }
}
