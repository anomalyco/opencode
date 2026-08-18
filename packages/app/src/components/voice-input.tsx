import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { createStore } from "solid-js/store"
import { createEffect, onCleanup, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { showToast } from "@/utils/toast"
import type { LocalVoiceModel } from "@/voice"

const MAX_RECORDING_MS = 5 * 60 * 1_000
const TARGET_SAMPLE_RATE = 16_000

type Props = {
  insert: (text: string) => void
  restoreFocus?: () => void
  variant?: "legacy" | "v2"
  bindCancel?: (cancel: () => void) => void
}

type VoiceConfiguration =
  | { backend: "local"; model: LocalVoiceModel }
  | { backend: "ai"; model: { providerID: string; modelID: string } }

export function VoiceInputButton(props: Props) {
  const voice = createVoiceInput(props)
  const language = useLanguage()
  props.bindCancel?.(voice.cancel)
  onCleanup(() => props.bindCancel?.(() => undefined))
  const label = () => {
    if (voice.phase === "starting" || voice.phase === "recording") return language.t("voice.action.stopRecording")
    if (voice.phase === "transcribing") return language.t("voice.action.cancelTranscription")
    return language.t("voice.action.startRecording")
  }

  return (
    <Show when={voice.visible()}>
      <Tooltip placement="top" value={label()}>
        <IconButton
          data-action="prompt-voice"
          type="button"
          icon={voice.phase === "idle" ? "microphone" : "stop"}
          variant={voice.phase === "recording" ? "primary" : "secondary"}
          class={
            props.variant === "v2"
              ? "size-7 rounded-md p-[6px] text-v2-icon-icon-muted motion-reduce:animate-none"
              : "size-8 motion-reduce:animate-none"
          }
          classList={{ "animate-pulse": voice.phase === "transcribing" }}
          aria-label={label()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void voice.toggle()
          }}
        />
      </Tooltip>
    </Show>
  )
}

function createVoiceInput(props: Props) {
  const settings = useSettings()
  const platform = usePlatform()
  const models = useModels()
  const sdk = useSDK()
  const language = useLanguage()
  const [state, setState] = createStore({
    phase: "idle" as "idle" | "starting" | "recording" | "transcribing",
  })
  let recorder: MediaRecorder | undefined
  let stream: MediaStream | undefined
  let chunks: Blob[] = []
  let timeout: ReturnType<typeof setTimeout> | undefined
  let request: AbortController | undefined
  let activeConfiguration: VoiceConfiguration | undefined
  let operation = 0

  const cleanupRecording = () => {
    if (timeout) clearTimeout(timeout)
    timeout = undefined
    stream?.getTracks().forEach((track) => track.stop())
    stream = undefined
    recorder = undefined
  }

  const fail = (kind: "permission" | "unavailable" | "model" | "transcription" | "empty") => {
    const description = (() => {
      if (kind === "permission") return language.t("voice.error.microphonePermission")
      if (kind === "unavailable") return language.t("voice.error.microphoneUnavailable")
      if (kind === "model") return language.t("voice.error.modelUnavailable")
      if (kind === "empty") return language.t("voice.error.emptyTranscript")
      return language.t("voice.error.transcriptionFailed")
    })()
    showToast({ variant: "error", title: language.t("voice.error.title"), description })
  }

  const selectedConfiguration = (): VoiceConfiguration | undefined => {
    if (settings.voice.backend() === "local") return { backend: "local", model: settings.voice.localModel() }
    const model = settings.voice.aiModel()
    if (!model) return
    return { backend: "ai", model }
  }
  const configurationKey = (configuration: VoiceConfiguration | undefined) => {
    if (!configuration) return ""
    if (configuration.backend === "local") return `local:${configuration.model}`
    return `ai:${configuration.model.providerID}:${configuration.model.modelID}`
  }
  const configured = async (configuration: VoiceConfiguration) => {
    if (configuration.backend === "ai") return !!models.find(configuration.model)?.capabilities.input.audio
    if (!platform.localVoice) return false
    const current = await platform.localVoice.state().catch(() => undefined)
    return current?.runtime === true && current.models[configuration.model].installed
  }

  const start = async () => {
    const current = ++operation
    activeConfiguration = selectedConfiguration()
    setState("phase", "starting")
    try {
      if (!activeConfiguration || !(await configured(activeConfiguration))) {
        if (current !== operation) return
        activeConfiguration = undefined
        setState("phase", "idle")
        fail("model")
        return
      }
      if (current !== operation) return
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      if (current !== operation) {
        media.getTracks().forEach((track) => track.stop())
        return
      }
      stream = media
      chunks = []
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4"].find((value) => MediaRecorder.isTypeSupported(value))
      recorder = new MediaRecorder(media, mimeType ? { mimeType } : undefined)
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onerror = () => {
        if (current !== operation) return
        operation++
        activeConfiguration = undefined
        cleanupRecording()
        setState("phase", "idle")
        fail("unavailable")
      }
      recorder.onstop = () => {
        const audio = new Blob(chunks, { type: recorder?.mimeType || mimeType || "audio/webm" })
        cleanupRecording()
        if (current !== operation) return
        void transcribe(audio, current).catch(() => {
          if (current !== operation) return
          activeConfiguration = undefined
          setState("phase", "idle")
          fail("transcription")
        })
      }
      recorder.start(250)
      setState("phase", "recording")
      timeout = setTimeout(() => recorder?.stop(), MAX_RECORDING_MS)
    } catch (error) {
      if (current !== operation) return
      activeConfiguration = undefined
      cleanupRecording()
      setState("phase", "idle")
      fail(error instanceof DOMException && error.name === "NotAllowedError" ? "permission" : "unavailable")
    }
  }

  const transcribe = async (audio: Blob, current: number) => {
    setState("phase", "transcribing")
    const wav = await toWave(audio)
    if (current !== operation) return
    const configuration = activeConfiguration
    if (!configuration) return
    const text = await (async () => {
      if (configuration.backend === "local") {
        if (!platform.localVoice) throw new Error("Local voice input is unavailable")
        return platform.localVoice.transcribe({ model: configuration.model, audio: wav })
      }
      request = new AbortController()
      const response = await sdk().client.experimental.voice.transcribe(
        {
          directory: sdk().directory,
          voiceTranscriptionPayload: {
            providerID: configuration.model.providerID,
            modelID: configuration.model.modelID,
            mime: "audio/wav",
            audio: encodeBase64(wav),
          },
        },
        { signal: request.signal },
      )
      if (!response.data) throw new Error("AI transcription request failed")
      return response.data.text
    })()
    if (current !== operation) return
    request = undefined
    activeConfiguration = undefined
    const value = text.trim()
    if (!value) {
      fail("empty")
      setState("phase", "idle")
      return
    }
    props.insert(value)
    props.restoreFocus?.()
    setState("phase", "idle")
  }

  const cancel = () => {
    operation++
    request?.abort()
    request = undefined
    if (state.phase === "recording") recorder?.stop()
    if (state.phase === "transcribing" && activeConfiguration?.backend === "local") {
      void platform.localVoice?.cancelTranscription()
    }
    activeConfiguration = undefined
    cleanupRecording()
    setState("phase", "idle")
  }

  createEffect(() => {
    const enabled = settings.voice.enabled()
    const configuration = configurationKey(selectedConfiguration())
    if (state.phase === "idle") return
    if (enabled && configuration === configurationKey(activeConfiguration)) return
    cancel()
  })
  onCleanup(cancel)

  return {
    get phase() {
      return state.phase
    },
    visible: () => platform.platform === "desktop" && settings.voice.enabled(),
    async toggle() {
      if (state.phase === "recording") {
        recorder?.stop()
        return
      }
      if (state.phase === "starting" || state.phase === "transcribing") {
        cancel()
        return
      }
      await start()
    },
    cancel,
  }
}

async function toWave(blob: Blob) {
  const context = new AudioContext()
  const decoded = await context.decodeAudioData(await blob.arrayBuffer()).finally(() => context.close())
  const samples = resampleMono(decoded, TARGET_SAMPLE_RATE)
  const output = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(output)
  writeAscii(view, 0, "RIFF")
  view.setUint32(4, output.byteLength - 8, true)
  writeAscii(view, 8, "WAVEfmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, TARGET_SAMPLE_RATE, true)
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, "data")
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  })
  return output
}

function resampleMono(buffer: AudioBuffer, sampleRate: number) {
  const ratio = buffer.sampleRate / sampleRate
  const output = new Float32Array(Math.ceil(buffer.length / ratio))
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
  output.forEach((_, index) => {
    const start = Math.floor(index * ratio)
    const end = Math.min(buffer.length, Math.max(start + 1, Math.floor((index + 1) * ratio)))
    let value = 0
    for (let source = start; source < end; source++) {
      value += channels.reduce((sum, channel) => sum + (channel[source] ?? 0), 0) / channels.length
    }
    output[index] = value / (end - start)
  })
  return output
}

function writeAscii(view: DataView, offset: number, value: string) {
  Array.from(value).forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)))
}

function encodeBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let value = ""
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    value += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  return btoa(value)
}
