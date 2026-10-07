import { onCleanup } from "solid-js"
import type { VoiceError, VoiceResult } from "@/voice/types"
import { createStore } from "solid-js/store"

export type VoiceRecordingError = "permission" | "device" | "busy" | "security" | "unsupported" | "failed"
export type VoiceRecorder = ReturnType<typeof createVoiceRecorder>
export type VoiceProcessingRequest = { audio: Blob; seconds: number; submitAfterTranscription: true }

export function createVoiceRecorder(options?: {
  transcribe: (audio: Blob, signal: AbortSignal) => Promise<VoiceResult<void>>
}) {
  const [state, setState] = createStore({
    status: "idle" as "idle" | "requesting" | "recording" | "stopping" | "ready" | "processing",
    seconds: 0,
    url: "",
    playing: false,
    pendingRequests: 0,
    processingError: undefined as VoiceError | undefined,
    error: undefined as VoiceRecordingError | undefined,
  })
  const resources = {
    generation: 0,
    processing: undefined as AbortController | undefined,
    blob: undefined as Blob | undefined,
    processOnStop: false,
    stream: undefined as MediaStream | undefined,
    recorder: undefined as MediaRecorder | undefined,
    context: undefined as AudioContext | undefined,
    source: undefined as MediaStreamAudioSourceNode | undefined,
    frame: 0,
    audio: undefined as HTMLAudioElement | undefined,
    canvas: undefined as HTMLCanvasElement | undefined,
    observer: undefined as ResizeObserver | undefined,
    width: 0,
    height: 0,
    color: "",
    started: 0,
    sampled: 0,
    levels: Array<number>(120).fill(0),
  }

  const releaseCapture = () => {
    cancelAnimationFrame(resources.frame)
    resources.frame = 0
    resources.source?.disconnect()
    resources.source = undefined
    resources.stream?.getTracks().forEach((track) => track.stop())
    resources.stream = undefined
    void resources.context?.close().catch(() => undefined)
    resources.context = undefined
  }

  const cancel = () => {
    resources.generation += 1
    resources.processing?.abort()
    resources.processing = undefined
    resources.blob = undefined
    resources.processOnStop = false
    if (resources.recorder?.state !== "inactive") resources.recorder?.stop()
    resources.recorder = undefined
    releaseCapture()
    resources.audio?.pause()
    resources.audio = undefined
    if (state.url) URL.revokeObjectURL(state.url)
    resources.levels.fill(0)
    setState({
      status: "idle",
      seconds: 0,
      url: "",
      playing: false,
      pendingRequests: 0,
      processingError: undefined,
      error: undefined,
    })
  }

  const fail = (error: VoiceRecordingError) => {
    cancel()
    setState("error", error)
  }

  const draw = (offset = 0) => {
    const canvas = resources.canvas
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    const scale = window.devicePixelRatio || 1
    context.setTransform(scale, 0, 0, scale, 0, 0)
    context.clearRect(0, 0, resources.width, resources.height)
    context.strokeStyle = resources.color
    context.lineWidth = 2
    context.lineCap = "round"
    const count = Math.min(resources.levels.length, Math.ceil(resources.width / 5))
    const begin = resources.levels.length - count
    resources.levels.slice(begin).forEach((level, index) => {
      const x = resources.width - (count - index) * 5 - offset * 5 + 3
      const height = Math.max(2, level * (resources.height - 4))
      context.beginPath()
      context.moveTo(x, (resources.height - height) / 2)
      context.lineTo(x, (resources.height + height) / 2)
      context.stroke()
    })
  }

  const setCanvas = (canvas: HTMLCanvasElement) => {
    resources.observer?.disconnect()
    resources.canvas = canvas
    const resize = () => {
      resources.width = canvas.clientWidth
      resources.height = canvas.clientHeight
      resources.color = getComputedStyle(canvas).color
      const scale = window.devicePixelRatio || 1
      canvas.width = Math.round(resources.width * scale)
      canvas.height = Math.round(resources.height * scale)
      draw()
    }
    resources.observer = new ResizeObserver(resize)
    resources.observer.observe(canvas)
    resize()
  }

  const stop = () => {
    if (state.status !== "recording") return
    setState({ status: "stopping", seconds: Math.max(1, Math.ceil((performance.now() - resources.started) / 1000)) })
    resources.recorder?.stop()
    releaseCapture()
    draw()
  }

  const requestProcessing = async () => {
    const audio = resources.blob
    if (!audio || state.status !== "ready") return
    resources.audio?.pause()
    if (options) {
      const generation = resources.generation
      const controller = new AbortController()
      resources.processing = controller
      setState({ status: "processing", processingError: undefined })
      const result = await options.transcribe(audio, controller.signal)
      if (generation !== resources.generation) return
      resources.processing = undefined
      if (result.ok) {
        cancel()
        return
      }
      setState({ status: "ready", processingError: result.error === "cancelled" ? undefined : result.error })
      return
    }
    // A future STT adapter can preventDefault(), transcribe detail.audio,
    // then submit the resulting text through the existing composer controller.
    const detail: VoiceProcessingRequest = { audio, seconds: state.seconds, submitAfterTranscription: true }
    const request = new CustomEvent("opencode:voice-process", { detail, cancelable: true })
    if (window.dispatchEvent(request)) setState("pendingRequests", (count) => count + 1)
  }

  const process = () => {
    if (state.status === "ready") return requestProcessing()
    if (state.status !== "recording") return
    resources.processOnStop = true
    stop()
  }

  const start = async () => {
    if (state.status !== "idle") return
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined" ||
      typeof AudioContext === "undefined"
    ) {
      fail("unsupported")
      return
    }
    const generation = ++resources.generation
    setState({ status: "requesting", error: undefined })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      })
      // A permission prompt can outlive cancellation or a session change.
      if (generation !== resources.generation) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      resources.stream = stream
      const context = new AudioContext()
      resources.context = context
      await context.resume()
      if (generation !== resources.generation) return
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      const buffer = new Float32Array(analyser.fftSize)
      resources.source = context.createMediaStreamSource(stream)
      resources.source.connect(analyser)
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      )
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      resources.recorder = recorder
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (generation === resources.generation && event.data.size) chunks.push(event.data)
      }
      recorder.onerror = () => {
        if (generation === resources.generation) fail("failed")
      }
      recorder.onstop = () => {
        if (generation !== resources.generation) return
        resources.recorder = undefined
        releaseCapture()
        const blob = new Blob(chunks, { type: recorder.mimeType })
        if (!blob.size) {
          fail("failed")
          return
        }
        resources.blob = blob
        setState({ status: "ready", url: URL.createObjectURL(blob) })
        if (resources.processOnStop) {
          resources.processOnStop = false
          requestProcessing()
        }
      }
      stream.getAudioTracks().forEach((track) => track.addEventListener("ended", stop, { once: true }))
      resources.started = performance.now()
      resources.sampled = resources.started
      recorder.start(250)
      setState("status", "recording")
      const tick = (now: number) => {
        if (generation !== resources.generation || state.status !== "recording") return
        if (now - resources.sampled >= 50) {
          analyser.getFloatTimeDomainData(buffer)
          const rms = Math.sqrt(buffer.reduce((sum, value) => sum + value * value, 0) / buffer.length)
          resources.levels.shift()
          resources.levels.push(Math.min(1, rms * 8))
          resources.sampled = now
          const seconds = Math.floor((now - resources.started) / 1000)
          if (seconds !== state.seconds) setState("seconds", seconds)
        }
        draw(Math.min(1, (now - resources.sampled) / 50))
        resources.frame = requestAnimationFrame(tick)
      }
      resources.frame = requestAnimationFrame(tick)
    } catch (error) {
      if (generation !== resources.generation) return
      const name = error instanceof Error ? error.name : ""
      fail(
        name === "NotAllowedError"
          ? "permission"
          : name === "SecurityError"
            ? "security"
            : name === "NotFoundError"
              ? "device"
              : name === "NotReadableError"
                ? "busy"
                : "failed",
      )
    }
  }

  const togglePlayback = () => {
    const audio = resources.audio
    if (!audio || state.status !== "ready") return
    if (!audio.paused) {
      audio.pause()
      return
    }
    void audio.play().catch(() => setState("error", "failed"))
  }

  onCleanup(() => {
    cancel()
    resources.observer?.disconnect()
  })

  return {
    state,
    audio: () => resources.blob,
    active: () => state.status !== "idle",
    start,
    stop,
    process,
    cancel,
    setCanvas,
    setAudio: (audio: HTMLAudioElement) => (resources.audio = audio),
    setPlaying: (playing: boolean) => setState("playing", playing),
    togglePlayback,
  }
}
