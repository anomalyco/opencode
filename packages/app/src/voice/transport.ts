import type { OpenCodeClient } from "@opencode/client/promise"
import { cutsOffSpeech, decodeEvent, errorDisposition, type VoiceEvent } from "./protocol"
import { tools } from "./spec"

export class VoiceFailure extends Error {
  constructor(readonly reason: "unavailable" | "microphone" | "dropped" | "connection") {
    super(reason)
  }
}

/** A client event sent over the Live data channel; the transport adds `event_id`. */
export type VoiceClientEvent =
  | { type: "session.input_audio.mute" | "session.input_audio.unmute" | "response.create" }
  | { type: "session.update"; session: { delegation: { type: "responses"; responses: { instructions: string } } } }
  | { type: "response.item.create"; item: { type: "function_call_output"; call_id: string; output: string } }
  | {
      type: "response.item.create"
      item: { type: "message"; role: "user"; content: { type: "input_text"; text: string }[] }
    }
  | { type: "session.commentary.append" | "session.instructions.append"; delegation_id: null; content: string }

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
  /** A WebRTC "disconnected" gets a few seconds to come back before the call drops, as on iOS. */
  private disconnected?: ReturnType<typeof setTimeout>
  /** While the agent's speech is cut off, when it last went quiet. */
  private cut?: { quietAt?: number }

  constructor(
    private readonly inputOptions: {
      api: OpenCodeClient
      event: (event: VoiceEvent) => void
      levels: (input: number, output: number) => void
      /** The voice session ended; `fatal` when it can't come back, such as a refused key or a safety filter. */
      dropped: (fatal?: string) => void
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

        // A safety filter ends the call; other closes reconnect, as on iOS.
        if (!this.ended) this.fail(event.reason === "content" ? "A safety filter ended the voice call." : undefined)

        return
      }

      if (event.type === "session.started") this.ready.resolve()

      if (event.type === "error" && event.error) {
        const disposition = errorDisposition(event.error)

        if (disposition === "expired") return this.fail()

        if (disposition === "fatal") return this.fail(event.error.message ?? "The voice service refused the call.")

        if (cutsOffSpeech(event.error)) this.interrupt()

        return
      }

      this.inputOptions.event(event)
    }

    this.channel.onclose = () => {
      if (!this.ended) this.fail()
    }

    this.peer.onconnectionstatechange = () => {
      const state = this.peer.connectionState
      clearTimeout(this.disconnected)

      if (this.ended) return

      if (state === "disconnected") this.disconnected = setTimeout(() => this.fail(), 5000)

      if (state === "failed" || state === "closed") this.fail()
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

  /** Starts the voice session with the voice agent's and the delegator's instructions. */
  async join(instructions: { live: string; delegator: string }, voice: string) {
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(35_000)])
    await this.context.resume()
    const offered = await this.inputOptions.api.experimental.voice.models({ signal })

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

    const response = await this.inputOptions.api.experimental.voice.session(
      {
        model: "gpt-live-1",
        session: {
          model: "gpt-live-1",
          instructions: instructions.live,
          audio: { output: { voice } },
          delegation: {
            type: "responses",
            responses: {
              model: "gpt-6.1-sol",
              instructions: instructions.delegator,
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
    this.timer = setInterval(() => {
      const output = this.level(this.output)
      this.release(output)
      this.inputOptions.levels(this.level(this.input), output)
    }, 50)
  }

  send(event: VoiceClientEvent) {
    if (this.ended || this.channel.readyState !== "open") throw new VoiceFailure("dropped")

    // Something new for the agent to say lets its speech through again.
    if (event.type === "session.commentary.append" || event.type === "session.instructions.append") this.resume()
    this.channel.send(JSON.stringify({ event_id: crypto.randomUUID(), ...event }))
  }

  /**
   * Stops the agent's speech now, as iOS flushes playback when the user talks over it: the rest of that reply stays
   * silent until the agent has been quiet for half a second or it's given something new to say.
   */
  interrupt() {
    this.audio.muted = true
    this.cut = {}
  }

  private resume() {
    this.audio.muted = false
    this.cut = undefined
  }

  private release(output: number) {
    const cut = this.cut

    if (!cut) return

    if (output > 0.005) return void (cut.quietAt = undefined)
    cut.quietAt ??= Date.now()

    if (Date.now() - cut.quietAt >= 500) this.resume()
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
    clearTimeout(this.disconnected)
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

  private fail(fatal?: string) {
    if (this.ended) return
    this.inputOptions.dropped(fatal)
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
