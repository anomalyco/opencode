import type { OpenCodeClient } from "@opencode/client/promise"
import { decodeEvent, type VoiceEvent } from "./protocol"
import { delegatorInstructions, liveInstructions, tools } from "./spec"

export class VoiceFailure extends Error {
  constructor(readonly reason: "unavailable" | "microphone" | "dropped" | "connection") {
    super(reason)
  }
}

export class VoiceTransport {
  readonly abort = new AbortController()
  private peer = new RTCPeerConnection({ iceServers: [], bundlePolicy: "max-bundle", rtcpMuxPolicy: "require" })
  private channel = this.peer.createDataChannel("oai-events", { negotiated: true, id: 4, ordered: true })
  private audio = new Audio()
  private context = new AudioContext()
  private stream?: MediaStream
  private timer?: ReturnType<typeof setInterval>
  private ended = false
  private closing?: Promise<void>
  private closed = Promise.withResolvers<void>()
  private ready = Promise.withResolvers<void>()
  private input?: AnalyserNode
  private output?: AnalyserNode
  private samples = new Float32Array(256)

  constructor(
    private readonly inputOptions: {
      api: OpenCodeClient
      event: (event: VoiceEvent) => void
      levels: (input: number, output: number) => void
      dropped: () => void
    },
  ) {
    // A media element pulls the remote track in Chromium. A Web Audio-only
    // sink can report silence even while RTP is arriving.
    this.audio.autoplay = true
    this.channel.onmessage = (message: MessageEvent<string>) => {
      const event = decodeEvent(message.data)

      if (!event) return

      if (event.type === "session.closed") {
        this.closed.resolve()

        if (!this.ended) this.fail()

        return
      }

      if (event.type === "session.started") this.ready.resolve()

      if (event.type === "error") this.fail()
      this.inputOptions.event(event)
    }

    this.channel.onclose = () => {
      if (!this.ended) this.fail()
    }

    this.peer.onconnectionstatechange = () => {
      if (!this.ended && ["failed", "disconnected", "closed"].includes(this.peer.connectionState)) this.fail()
    }

    this.peer.ontrack = (event) => {
      if (this.ended) return
      const stream = new MediaStream([event.track])
      this.audio.srcObject = stream
      this.output = this.analyser(stream)
      void this.audio.play().catch(() => this.fail())
    }

    this.abort.signal.addEventListener("abort", () => this.ready.reject(new VoiceFailure("connection")), { once: true })
    // End may happen before join has reached the readiness wait.
    void this.ready.promise.catch(() => undefined)
  }

  async join(viewing: { id: string; title?: string }, tail: string) {
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(35_000)])
    await this.context.resume()
    const offered = await this.inputOptions.api.voice.models({ signal })

    if (
      !offered.models.some(
        (model) =>
          model.model === "gpt-live-1" &&
          model.available &&
          model.transports.includes("webrtc"),
      )
    ) {
      throw new VoiceFailure("unavailable")
    }

    const sender = this.peer.addTransceiver("audio", { direction: "sendrecv" }).sender
    await this.peer.setLocalDescription(await this.peer.createOffer())
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      if (this.peer.iceGatheringState === "complete") return resolve()
      const aborted = () => reject(signal.reason)
      signal.addEventListener("abort", aborted, { once: true })
      this.peer.onicegatheringstatechange = () => {
        if (this.peer.iceGatheringState !== "complete") return
        signal.removeEventListener("abort", aborted)
        resolve()
      }
    })
    signal.throwIfAborted()

    const response = await this.inputOptions.api.voice.session(
      {
        model: "gpt-live-1",
        session: {
          model: "gpt-live-1",
          instructions: liveInstructions,
          audio: { output: { voice: "marin" } },
          delegation: {
            type: "responses",
            responses: {
              model: "gpt-6.1-sol",
              instructions: delegatorInstructions(viewing, tail),
              tools,
              reasoning: { effort: "low" },
            },
          },
        },
        transport: { type: "webrtc", sdp: this.peer.localDescription!.sdp, dcid: 4 },
      },
      { signal },
    )

    if (response.transport.type !== "webrtc") throw new VoiceFailure("connection")
    await this.peer.setRemoteDescription({ type: "answer", sdp: response.transport.sdp })
    signal.throwIfAborted()
    const timedOut = () => this.ready.reject(new VoiceFailure("connection"))
    signal.addEventListener("abort", timedOut, { once: true })
    await this.ready.promise.finally(() => signal.removeEventListener("abort", timedOut))
    signal.throwIfAborted()

    const stream = await navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
      .catch(() => {
        throw new VoiceFailure("microphone")
      })

    if (this.ended || signal.aborted) {
      stream.getTracks().forEach((track) => track.stop())
      throw new VoiceFailure("connection")
    }

    this.stream = stream
    this.input = this.analyser(stream)
    await sender.replaceTrack(stream.getAudioTracks()[0])
    this.timer = setInterval(() => this.inputOptions.levels(this.level(this.input), this.level(this.output)), 100)
  }

  send(event: object) {
    if (this.ended || this.channel.readyState !== "open") throw new VoiceFailure("dropped")
    this.channel.send(JSON.stringify({ event_id: crypto.randomUUID(), ...event }))
  }

  mute(muted: boolean) {
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
    this.send({ type: muted ? "session.input_audio.mute" : "session.input_audio.unmute" })
  }

  /** The call runs on the server's own OpenAI key, so its data channel can update the backend's instructions. */
  instructions(instructions: string) {
    this.send({ type: "session.update", session: { delegation: { type: "responses", responses: { instructions } } } })
  }

  close() {
    return (this.closing ??= this.dispose())
  }

  private async dispose() {
    this.ended = true
    this.stream?.getTracks().forEach((track) => track.stop())
    this.audio.pause()
    this.audio.srcObject = null
    clearInterval(this.timer)
    this.abort.abort()

    await Promise.resolve()
      .then(async () => {
        if (this.channel.readyState !== "open") return
        this.channel.send(JSON.stringify({ type: "session.close", event_id: crypto.randomUUID() }))
        const timeout = setTimeout(() => this.closed.resolve(), 1000)
        await this.closed.promise
        clearTimeout(timeout)
      })
      .catch(() => undefined)
      .finally(async () => {
        this.peer.close()
        await this.context.close().catch(() => undefined)
      })
  }

  private fail() {
    if (this.ended) return
    this.inputOptions.dropped()
    void this.close()
  }

  private analyser(stream: MediaStream) {
    const node = this.context.createAnalyser()
    node.fftSize = 256
    this.context.createMediaStreamSource(stream).connect(node)

    return node
  }

  private level(node?: AnalyserNode) {
    if (!node) return 0
    node.getFloatTimeDomainData(this.samples)

    return Math.sqrt(this.samples.reduce((sum, value) => sum + value * value, 0) / this.samples.length)
  }
}
