import { createMemo, Match, onCleanup, Switch, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@opencode-ai/ui/toast"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import type { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"

type VoiceInput = {
  sdk: ReturnType<typeof useSDK>
  editorText: () => string
  addPart: (part: { type: "text"; content: string; start: number; end: number }) => void
  editorRef: HTMLDivElement
  queueScroll: () => void
}

const isVoiceSupported = () =>
  typeof navigator !== "undefined" &&
  typeof window !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  typeof MediaRecorder !== "undefined"

export function createVoiceInput(input: VoiceInput) {
  const { params } = useSessionLayout()

  const [state, setState] = createStore({
    recording: false,
    transcribing: false,
    lastRecording: undefined as Blob | undefined,
  })
  const recording = () => state.recording
  const transcribing = () => state.transcribing
  const hasLastRecording = () => Boolean(state.lastRecording)
  const audio = {
    recorder: undefined as MediaRecorder | undefined,
    stream: undefined as MediaStream | undefined,
    controller: undefined as AbortController | undefined,
    chunks: [] as Blob[],
    mime: "",
  }

  const stopStream = () => {
    audio.stream?.getTracks().forEach((track) => track.stop())
    audio.stream = undefined
  }

  const recordStart = async () => {
    if (!isVoiceSupported()) {
      showToast({
        title: "Voice input unavailable",
        description: "Your browser does not support audio recording.",
      })
      return false
    }
    if (audio.recorder) return false

    const stream = await navigator.mediaDevices
      .getUserMedia({ audio: true })
      .catch(() => undefined)
    if (!stream) {
      showToast({
        title: "Microphone blocked",
        description: "Allow microphone access to start recording.",
      })
      return false
    }

    audio.stream = stream

    const preferred = "audio/webm;codecs=opus"
    const fallback = "audio/webm"
    const mime = MediaRecorder.isTypeSupported(preferred)
      ? preferred
      : MediaRecorder.isTypeSupported(fallback)
        ? fallback
        : ""
    if (!mime) {
      stopStream()
      showToast({
        title: "Voice input unavailable",
        description: "This browser does not support the available audio formats.",
      })
      return false
    }
    const recorder = new MediaRecorder(stream, { mimeType: mime })

    audio.mime = recorder.mimeType || mime
    audio.chunks = []
    audio.recorder = recorder

    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return
      audio.chunks.push(event.data)
    }

    recorder.start()
    setState("recording", true)
    return true
  }

  const recordStop = async () => {
    if (!audio.recorder) return
    const recorder = audio.recorder
    audio.recorder = undefined

    const result = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(audio.chunks, { type: audio.mime || "audio/webm" }))
      }
    })

    recorder.stop()
    const blob = await result
    stopStream()
    setState("recording", false)
    return blob
  }

  const transcribeAudio = async (blob: Blob) => {
    if (!blob.size) {
      showToast({
        title: "No audio captured",
        description: "Try recording again.",
      })
      return
    }

    const mime = blob.type || "audio/webm"
    const prompt = input.editorText()
    const controller = new AbortController()
    audio.controller = controller
    setState("transcribing", true)

    const arrayBuffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    // String.fromCharCode has a max argument limit; chunk to avoid stack overflow
    const chunks: string[] = []
    for (let i = 0; i < bytes.length; i += 8192) {
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
    }
    const base64 = btoa(chunks.join(""))

    const sdk = input.sdk()
    const result = await sdk.client
      .audio.transcribe(
        {
          directory: sdk.directory,
          audio: base64,
          mime,
          ...(prompt.trim() ? { prompt } : {}),
          ...(params.id ? { sessionID: params.id } : {}),
        },
        { signal: controller.signal, throwOnError: true },
      )
      .then((res) => ({ ok: true as const, text: res.data.text }))
      .catch((error) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      }))

    audio.controller = undefined

    if (!result.ok) {
      setState("transcribing", false)
      if (controller.signal.aborted) return
      showToast({
        title: "Transcription failed",
        description: result.message || "Press Retry to try again.",
      })
      return
    }

    setState("transcribing", false)

    if (controller.signal.aborted) return

    const text = result.text ?? ""

    if (!text.trim()) {
      showToast({
        title: "No speech detected",
        description: "Press Retry to try again.",
      })
      return
    }

    // Success — clear saved recording
    setState("lastRecording", undefined)

    input.addPart({ type: "text", content: text, start: 0, end: 0 })
    requestAnimationFrame(() => {
      input.editorRef.focus()
      input.queueScroll()
    })
  }

  const confirmRetry = async () => {
    const blob = state.lastRecording
    if (!blob) return
    await transcribeAudio(blob)
  }

  const cancelRetry = () => {
    setState("lastRecording", undefined)
  }

  const toggleVoice = async () => {
    if (transcribing()) {
      const controller = audio.controller
      if (controller) {
        controller.abort()
        setState("transcribing", false)
        setState("lastRecording", undefined)
        showToast({
          title: "Transcription cancelled",
          description: "Stopped the current transcription.",
        })
      }
      return
    }

    if (recording()) {
      const blob = await recordStop()
      if (!blob) return
      setState("lastRecording", blob)
      await transcribeAudio(blob)
      return
    }

    await recordStart()
  }

  const voiceTitle = createMemo(() =>
    transcribing() ? "Cancel transcription" : recording() ? "Stop recording" : "Voice input",
  )

  onCleanup(() => {
    if (transcribing()) {
      const controller = audio.controller
      if (controller) controller.abort()
      setState("transcribing", false)
    }
    setState("lastRecording", undefined)
    if (!recording()) return
    void recordStop()
  })

  return {
    recording,
    transcribing,
    hasLastRecording,
    voiceTitle,
    toggleVoice,
    confirmRetry,
    cancelRetry,
  }
}

export const VoiceButton: Component<{
  voiceTitle: () => string
  toggleVoice: () => void
  confirmRetry: () => void
  cancelRetry: () => void
  recording: () => boolean
  transcribing: () => boolean
  hasLastRecording: () => boolean
  keybind: string
}> = (props) => (
  <Switch>
    <Match when={props.hasLastRecording() && !props.transcribing() && !props.recording()}>
      <div class="flex items-center gap-1">
        <TooltipKeybind placement="top" title="Retry transcription" keybind={props.keybind}>
          <Button type="button" variant="ghost" class="h-6 shrink-0 px-1.5 text-13-medium text-warning" onClick={props.confirmRetry}>
            Retry
          </Button>
        </TooltipKeybind>
        <Tooltip placement="top" value="Discard recording">
          <Button type="button" variant="ghost" class="h-6 shrink-0 px-1.5 text-13-medium text-text-muted" onClick={props.cancelRetry}>
            Cancel
          </Button>
        </Tooltip>
      </div>
    </Match>
    <Match when={true}>
      <TooltipKeybind placement="top" title={props.voiceTitle()} keybind={props.keybind}>
        <Button type="button" variant="ghost" class="size-7 rounded-md p-[6px] shrink-0" onClick={props.toggleVoice}>
          <Switch>
            <Match when={props.transcribing()}>
              <Spinner class="size-4 text-icon-base" />
            </Match>
            <Match when={props.recording()}>
              <Icon name="stop" size="small" />
            </Match>
            <Match when={true}>
              <Icon name="mic" size="small" />
            </Match>
          </Switch>
        </Button>
      </TooltipKeybind>
    </Match>
  </Switch>
)
