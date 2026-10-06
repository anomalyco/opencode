import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { ClientError } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Spinner } from "@opencode/ui/spinner"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { useWorkspaceLocation } from "@/workspaces/location"
import type { ComposerEditorModel } from "./interaction"

const waveBars = 5

const preferredMimes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]

const isVoiceSupported = () =>
  typeof navigator !== "undefined" &&
  typeof window !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  typeof MediaRecorder !== "undefined"

function encodeBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const chunks: string[] = []

  // String.fromCharCode has an argument limit; chunk to avoid a stack overflow.
  for (let index = 0; index < bytes.length; index += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 8192)))
  }

  return btoa(chunks.join(""))
}

// OpenAI-compatible servers commonly reject the browser's webm/opus recording,
// and local speech servers often accept WAV only. Decoding in a 16 kHz context
// resamples the audio, and the first channel is encoded as a small PCM WAV.
async function encodeWav(samples: Float32Array) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index))
  }

  write(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  write(8, "WAVE")
  write(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true)
  view.setUint32(28, 16000 * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, "data")
  view.setUint32(40, samples.length * 2, true)

  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]!))
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  }

  return new Blob([buffer], { type: "audio/wav" })
}

async function toWav(blob: Blob) {
  const context = new OfflineAudioContext(1, 16000, 16000)
  const decoded = await context.decodeAudioData(await blob.arrayBuffer())

  return encodeWav(decoded.getChannelData(0))
}

export function createComposerVoice(input: { controller: ComposerEditorModel }) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const location = useWorkspaceLocation()

  const supported = isVoiceSupported()
  const [recording, setRecording] = createSignal(false)
  const [transcribing, setTranscribing] = createSignal(false)
  const [levels, setLevels] = createSignal<number[]>([])
  const [elapsed, setElapsed] = createSignal(0)
  const [lastRecording, setLastRecording] = createSignal<Blob | undefined>()

  // SAFETY: every slot starts empty and is assigned before any read by the
  // helpers below; the annotations only pick the mutable union member.
  const audio = {
    recorder: undefined as MediaRecorder | undefined,
    stream: undefined as MediaStream | undefined,
    context: undefined as AudioContext | undefined,
    analyser: undefined as AnalyserNode | undefined,
    frame: undefined as number | undefined,
    timer: undefined as ReturnType<typeof setInterval> | undefined,
    chunks: [] as Blob[],
    mime: "",
    controller: undefined as AbortController | undefined,
    cancelled: false,
    starting: false,
    stopping: false,
  }

  const stopMeter = () => {
    if (audio.frame !== undefined) cancelAnimationFrame(audio.frame)
    audio.frame = undefined
    audio.analyser = undefined
    void audio.context?.close().catch(() => undefined)
    audio.context = undefined
  }

  const stopTimer = () => {
    if (audio.timer !== undefined) clearInterval(audio.timer)
    audio.timer = undefined
  }

  const releaseStream = () => {
    audio.stream?.getTracks().forEach((track) => track.stop())
    audio.stream = undefined
  }

  // Map -60..0 dBFS onto 0..1 and smooth it, so the bars follow the voice
  // instead of jittering with every animation frame.
  const startMeter = () => {
    const analyser = audio.analyser

    if (!analyser) return
    const data = new Uint8Array(analyser.fftSize)
    let smoothed = 0

    const tick = () => {
      if (audio.analyser !== analyser) return
      analyser.getByteTimeDomainData(data)
      let sum = 0

      for (let index = 0; index < data.length; index++) {
        const value = (data[index]! - 128) / 128
        sum += value * value
      }

      const db = 20 * Math.log10(Math.max(Math.sqrt(sum / data.length), 0.001))
      const target = Math.max(0, Math.min(1, (db + 60) / 60))
      smoothed += (target - smoothed) * 0.35
      setLevels((previous) => [...previous.slice(-(waveBars - 1)), smoothed])
      audio.frame = requestAnimationFrame(tick)
    }

    audio.frame = requestAnimationFrame(tick)
  }

  const startTimer = () => {
    stopTimer()
    const startedAt = Date.now()
    setElapsed(0)
    audio.timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250)
  }

  const start = async () => {
    if (!supported || audio.recorder || audio.starting || audio.stopping) return
    audio.starting = true
    audio.cancelled = false

    try {
      // Created inside the click handler: creating it after the async permission
      // dialog can leave the context suspended under autoplay policies, which
      // freezes the meter.
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      audio.context = context
      audio.analyser = analyser
      void context.resume().catch(() => undefined)

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => undefined)

      if (!stream) {
        stopMeter()
        showToast({
          title: language.t("prompt.voice.micDenied.title"),
          description: language.t("prompt.voice.micDenied.description"),
        })

        return
      }

      // The composer can unmount, or the user can cancel, while the permission
      // dialog is open; release the stream instead of recording without UI.
      if (audio.cancelled) {
        stream.getTracks().forEach((track) => track.stop())
        stopMeter()

        return
      }

      audio.stream = stream
      context.createMediaStreamSource(stream).connect(analyser)

      const mime = preferredMimes.find((item) => MediaRecorder.isTypeSupported?.(item))
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      audio.mime = recorder.mimeType || mime || "audio/webm"
      audio.chunks = []
      audio.recorder = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audio.chunks.push(event.data)
      }

      recorder.start()

      setLastRecording(undefined)
      setLevels([])
      setRecording(true)
      startMeter()
      startTimer()

      // Let local transcription servers pre-warm (e.g. load a model) while the
      // recording is still in progress; failures are irrelevant here.
      void sdk.api.voice.recording({ location: { directory: location().directory } }).catch(() => undefined)
    } finally {
      audio.starting = false
    }
  }

  const stopRecording = async () => {
    const recorder = audio.recorder

    if (!recorder) return undefined
    audio.recorder = undefined

    const blob = await new Promise<Blob | undefined>((resolve) => {
      recorder.onstop = () =>
        resolve(audio.chunks.length > 0 ? new Blob(audio.chunks, { type: audio.mime }) : undefined)

      try {
        recorder.stop()
      } catch {
        resolve(undefined)
      }
    })

    stopMeter()
    releaseStream()
    stopTimer()
    setRecording(false)

    if (!blob) return undefined

    // Keep the converted WAV so retries re-upload a format every server accepts.
    return (await toWav(blob).catch(() => undefined)) ?? blob
  }

  const insert = (text: string, mode: "insert" | "send") => {
    const parts = [...input.controller.parts(), { type: "text" as const, content: text, start: 0, end: 0 }]
    const value = parts.map((part) => ("content" in part ? part.content : "")).join("")
    input.controller.onInput(value, parts, value.length)
    input.controller.restoreFocus()

    if (mode === "send") setTimeout(() => input.controller.submit(), 0)
  }

  const transcribe = async (blob: Blob, mode: "insert" | "send") => {
    if (blob.size === 0) {
      showToast({
        title: language.t("prompt.voice.noAudio.title"),
        description: language.t("prompt.voice.noAudio.description"),
      })

      return
    }

    setLastRecording(blob)
    setTranscribing(true)
    const controller = new AbortController()
    audio.controller = controller
    const prompt = input.controller.value().trim()

    const request = {
      location: { directory: location().directory },
      audio: encodeBase64(await blob.arrayBuffer()),
      mime: blob.type || audio.mime || "audio/webm",
    }

    const result = await sdk.api.voice
      .transcribe(prompt ? { ...request, prompt } : request, { signal: controller.signal })
      .then((response) => ({ ok: true as const, text: response.text }))
      .catch((error) => ({
        ok: false as const,
        offline: error instanceof ClientError && error.reason === "Transport",
        message: error instanceof Error ? error.message : String(error),
      }))

    audio.controller = undefined
    setTranscribing(false)

    if (controller.signal.aborted || audio.cancelled) return

    if (!result.ok) {
      showToast({
        title: language.t("prompt.voice.failed.title"),
        description: result.offline ? language.t("prompt.voice.offline.description") : result.message,
      })

      return
    }

    const text = result.text?.trim()

    if (!text) {
      showToast({
        title: language.t("prompt.voice.empty.title"),
        description: language.t("prompt.voice.empty.description"),
      })

      return
    }

    setLastRecording(undefined)
    insert(text, mode)
  }

  const stop = async (mode: "insert" | "send") => {
    if (!recording()) return
    audio.stopping = true
    audio.cancelled = false

    try {
      const blob = await stopRecording()

      if (!blob) return
      await transcribe(blob, mode)
    } finally {
      audio.stopping = false
    }
  }

  const cancelTranscription = () => {
    audio.cancelled = true
    audio.controller?.abort()
    audio.controller = undefined
    setTranscribing(false)
    setLastRecording(undefined)
    showToast({ title: language.t("prompt.voice.cancelled") })
  }

  const cancel = async () => {
    if (recording()) await stopRecording()
    audio.cancelled = true
    audio.controller?.abort()
    audio.controller = undefined
    setTranscribing(false)
    setLastRecording(undefined)
  }

  const toggle = async () => {
    if (transcribing()) {
      cancelTranscription()

      return
    }

    if (recording()) {
      await stop("insert")

      return
    }

    await start()
  }

  const confirmRetry = () => {
    const blob = lastRecording()

    if (!blob || transcribing()) return
    audio.cancelled = false
    void transcribe(blob, "insert")
  }

  onCleanup(() => {
    audio.cancelled = true
    audio.controller?.abort()

    try {
      audio.recorder?.stop()
    } catch {}

    stopMeter()
    releaseStream()
    stopTimer()
  })

  const elapsedLabel = createMemo(() => {
    const total = elapsed()

    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
  })

  // The composer keeps its own submit button while recording; the send label
  // switches so the button reads as "stop and send" instead of "send".
  return {
    supported,
    recording,
    transcribing,
    hasRecording: () => lastRecording() !== undefined,
    levels,
    elapsedLabel,
    sendLabel: () => language.t("prompt.voice.send"),
    toggle,
    stopInsert: () => stop("insert"),
    stopSend: () => stop("send"),
    cancel,
    cancelTranscription,
    confirmRetry,
    discard: () => setLastRecording(undefined),
  }
}

export type ComposerVoiceController = ReturnType<typeof createComposerVoice>

export function ComposerVoice(props: { voice: ComposerVoiceController }) {
  const language = useLanguage()
  const voice = props.voice

  // Thin bars land on fractional device pixels at browser zoom levels like
  // 125%, where each bar rounds differently and widths look uneven. Widths and
  // gaps are snapped to whole device pixels for the current pixel ratio and
  // re-snapped when zoom changes (window resize).
  const [ratio, setRatio] = createSignal(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1)

  if (typeof window !== "undefined") {
    const update = () => setRatio(window.devicePixelRatio || 1)
    window.addEventListener("resize", update)
    onCleanup(() => window.removeEventListener("resize", update))
  }

  const snap = (value: number) => `${Math.round(value * ratio()) / ratio()}px`

  return (
    <Show when={voice.supported}>
      <div data-slot="composer-voice" class="me-2 flex shrink-0 items-center gap-1.5">
        <Switch>
          <Match when={voice.recording()}>
            <div class="flex items-center gap-1.5" aria-live="polite">
              <span class="size-1.5 shrink-0 animate-pulse rounded-full bg-icon-warning-base" />
              <span class="text-13-medium tabular-nums text-icon-warning-base">{voice.elapsedLabel()}</span>
              <span class="flex h-4 shrink-0 items-end" style={{ gap: snap(3) }} aria-hidden="true">
                <For each={voice.levels()}>
                  {(level) => (
                    <span
                      class="shrink-0 rounded-full bg-icon-warning-base transition-[height] duration-75 ease-out"
                      style={{ width: snap(3), height: `${3 + level * 13}px` }}
                    />
                  )}
                </For>
              </span>
            </div>
            <Tooltip placement="top" value={language.t("prompt.voice.insert")}>
              <IconButton
                type="button"
                variant="ghost"
                class="size-7 rounded-md p-[6px]"
                icon={<Icon name="pause" size="small" />}
                aria-label={language.t("prompt.voice.insert")}
                onClick={() => void voice.stopInsert()}
              />
            </Tooltip>
            <Tooltip placement="top" value={language.t("prompt.voice.cancel")}>
              <IconButton
                type="button"
                variant="ghost-muted"
                class="size-7 rounded-md p-[6px]"
                icon={<Icon name="close" size="small" />}
                aria-label={language.t("prompt.voice.cancel")}
                onClick={() => void voice.cancel()}
              />
            </Tooltip>
          </Match>
          <Match when={voice.transcribing()}>
            <div class="flex items-center px-1" aria-live="polite">
              <Spinner class="size-4 text-icon-warning-base" />
            </div>
            <Tooltip placement="top" value={language.t("prompt.voice.cancel")}>
              <IconButton
                type="button"
                variant="ghost-muted"
                class="size-7 rounded-md p-[6px]"
                icon={<Icon name="close" size="small" />}
                aria-label={language.t("prompt.voice.cancel")}
                onClick={voice.cancelTranscription}
              />
            </Tooltip>
          </Match>
          <Match when={voice.hasRecording()}>
            <Button
              type="button"
              variant="ghost"
              size="small"
              class="h-6 shrink-0 px-1.5 text-13-medium text-icon-warning-base"
              onClick={voice.confirmRetry}
            >
              {language.t("prompt.voice.retry")}
            </Button>
            <Button
              type="button"
              variant="ghost-muted"
              size="small"
              class="h-6 shrink-0 px-1.5 text-13-medium text-text-weak"
              onClick={voice.discard}
            >
              {language.t("prompt.voice.discard")}
            </Button>
          </Match>
          <Match when={true}>
            <Tooltip placement="top" value={language.t("prompt.voice.tooltip")}>
              <IconButton
                type="button"
                variant="ghost"
                class="size-7 rounded-md p-[6px]"
                icon={<Icon name="mic" size="small" />}
                aria-label={language.t("prompt.voice.tooltip")}
                onClick={() => void voice.toggle()}
              />
            </Tooltip>
          </Match>
        </Switch>
      </div>
    </Show>
  )
}
