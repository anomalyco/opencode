import type { OpenCodeClient } from "@opencode/client/promise"
import { uuid } from "@opencode/util/uuid"
import { decodeEvent, type VoiceEvent } from "./protocol"
import { delegatorInstructions, liveInstructions, tools } from "./spec"
import {
  canJoinVoiceTransport,
  canSendVoiceTransport,
  createVoiceTransportState,
  isAcquiringMicVoiceTransport,
  transitionVoiceTransport,
  type VoiceJoinFailure,
  type VoiceJoinTarget,
  type VoiceTransportEffect,
  type VoiceTransportEvent,
} from "./transport-machine"

export class VoiceFailure extends Error {
  constructor(readonly reason: VoiceJoinFailure | "dropped") {
    super(reason)
  }
}

/** A client event sent over the Live data channel; the transport adds `event_id`. */
export type VoiceClientEvent =
  | { type: "session.input_audio.mute" | "session.input_audio.unmute" | "response.create" }
  | { type: "session.update"; session: { delegation: { type: "responses"; responses: { instructions: string } } } }
  | { type: "response.item.create"; item: { type: "function_call_output"; call_id: string; output: string } }
  | { type: "session.commentary.append"; delegation_id: null; content: string }

/** One join of a WebRTC Live session; `transport-machine.ts` owns its lifecycle. */
export class VoiceTransport {
  private readonly abort = new AbortController()
  private peer = new RTCPeerConnection({ iceServers: [], bundlePolicy: "max-bundle", rtcpMuxPolicy: "require" })
  private channel = this.peer.createDataChannel("oai-events", { negotiated: true, id: 4, ordered: true })
  private sender = this.peer.addTransceiver("audio", { direction: "sendrecv" }).sender
  private audio = new Audio()
  private context = new AudioContext()
  private state = createVoiceTransportState()
  private joined = Promise.withResolvers<void>()
  private released = Promise.withResolvers<void>()
  private stream?: MediaStream
  private remoteTrack?: MediaStreamTrack
  private input?: AnalyserNode
  private output?: AnalyserNode
  private samples = new Float32Array(256)
  private joinTimer?: ReturnType<typeof setTimeout>
  private disconnectTimer?: ReturnType<typeof setTimeout>
  private closeTimer?: ReturnType<typeof setTimeout>
  private levelTimer?: ReturnType<typeof setInterval>

  constructor(
    private readonly inputOptions: {
      voice: OpenCodeClient["experimental"]["voice"]
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

      if (event) this.dispatch({ type: "channel.message", event })
    }

    this.channel.onclose = () => this.dispatch({ type: "channel.closed" })
    this.peer.onicegatheringstatechange = () => {
      if (this.peer.iceGatheringState === "complete") this.dispatch({ type: "ice.complete" })
    }

    this.peer.onconnectionstatechange = () => this.dispatch({ type: "peer.state", state: this.peer.connectionState })
    this.peer.ontrack = (event) => {
      this.remoteTrack = event.track
      this.dispatch({ type: "track.received" })
    }
  }

  /** Aborts once the transport starts closing. */
  get signal() {
    return this.abort.signal
  }

  get canSend() {
    return canSendVoiceTransport(this.state)
  }

  join(viewing: VoiceJoinTarget, tail: string) {
    if (!canJoinVoiceTransport(this.state)) return Promise.reject(new VoiceFailure("connection"))
    this.dispatch({ type: "join", viewing, tail })

    return this.joined.promise
  }

  send(event: VoiceClientEvent) {
    if (!this.canSend || this.channel.readyState !== "open") throw new VoiceFailure("dropped")
    this.channel.send(JSON.stringify({ event_id: uuid(), ...event }))
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

  /** Settles once the peer connection and audio are released. */
  close() {
    this.dispatch({ type: "close" })

    return this.released.promise
  }

  private dispatch(event: VoiceTransportEvent) {
    const next = transitionVoiceTransport(this.state, event)
    // Set first: an effect's callback may close this transport again.
    this.state = next.state
    next.effects.forEach((effect) => this.perform(effect))
  }

  private perform(effect: VoiceTransportEffect) {
    if (effect.type === "join.timer.start") {
      this.joinTimer = setTimeout(() => this.dispatch({ type: "join.timeout" }), effect.ms)

      return
    }

    if (effect.type === "join.timer.clear") return clearTimeout(this.joinTimer)

    if (effect.type === "disconnect.timer.start") {
      clearTimeout(this.disconnectTimer)
      this.disconnectTimer = setTimeout(
        () => this.dispatch({ type: "disconnect.timeout", attempt: effect.attempt }),
        effect.ms,
      )

      return
    }

    if (effect.type === "disconnect.timer.clear") return clearTimeout(this.disconnectTimer)

    if (effect.type === "prepare.offer") {
      void this.prepareOffer().catch(() => this.dispatch({ type: "step.failed", step: "offer", reason: "connection" }))

      return
    }

    if (effect.type === "negotiate") {
      void this.negotiate(effect.viewing, effect.tail).catch(() =>
        this.dispatch({ type: "step.failed", step: "negotiating", reason: "connection" }),
      )

      return
    }

    if (effect.type === "acquire.mic") {
      void this.acquireMic().catch(() => this.dispatch({ type: "step.failed", step: "mic", reason: "connection" }))

      return
    }

    if (effect.type === "attach.remote.track") {
      if (!this.remoteTrack) return
      const stream = new MediaStream([this.remoteTrack])
      this.audio.srcObject = stream
      this.output = this.analyser(stream)
      void this.audio.play().catch(() => this.dispatch({ type: "audio.play.failed" }))

      return
    }

    if (effect.type === "meter.start") {
      this.levelTimer = setInterval(
        () => this.inputOptions.levels(this.level(this.input), this.level(this.output)),
        effect.ms,
      )

      return
    }

    if (effect.type === "stop.media") {
      this.stream?.getTracks().forEach((track) => track.stop())
      this.audio.pause()
      this.audio.srcObject = null
      clearInterval(this.levelTimer)
      this.peer.onicegatheringstatechange = null
      this.abort.abort()

      return
    }

    if (effect.type === "close.handshake.start") {
      this.closeTimer = setTimeout(() => this.dispatch({ type: "close.timeout" }), effect.ms)
      // A channel that is already closing throws; its close event is on the way, so settle now.
      void Promise.resolve()
        .then(() => this.channel.send(JSON.stringify({ type: "session.close", event_id: uuid() })))
        .catch(() => this.dispatch({ type: "channel.closed" }))

      return
    }

    if (effect.type === "close.timer.clear") return clearTimeout(this.closeTimer)

    if (effect.type === "release.peer") {
      this.channel.onmessage = null
      this.channel.onclose = null
      this.peer.onconnectionstatechange = null
      this.peer.ontrack = null
      this.peer.close()
      void this.context
        .close()
        .catch(() => undefined)
        .then(() => this.dispatch({ type: "peer.released" }))

      return
    }

    if (effect.type === "forward.event") return this.inputOptions.event(effect.event)

    if (effect.type === "join.resolve") return this.joined.resolve()

    if (effect.type === "join.reject") return this.joined.reject(new VoiceFailure(effect.reason))

    if (effect.type === "notify.dropped") return this.inputOptions.dropped()

    this.released.resolve()
  }

  private async prepareOffer() {
    await this.context.resume()
    const offered = await this.inputOptions.voice.models({ signal: this.abort.signal })

    if (
      !offered.models.some(
        (model) => model.model === "gpt-live-1" && model.available && model.transports.includes("webrtc"),
      )
    )
      return this.dispatch({ type: "step.failed", step: "offer", reason: "unavailable" })

    await this.peer.setLocalDescription(await this.peer.createOffer())
    this.dispatch({ type: "offer.ready", iceComplete: this.peer.iceGatheringState === "complete" })
  }

  private async negotiate(viewing: VoiceJoinTarget, tail: string) {
    const response = await this.inputOptions.voice.session(
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
      { signal: this.abort.signal },
    )

    if (response.transport.type !== "webrtc")
      return this.dispatch({ type: "step.failed", step: "negotiating", reason: "connection" })
    await this.peer.setRemoteDescription({ type: "answer", sdp: response.transport.sdp })
    this.dispatch({ type: "answer.applied" })
  }

  private async acquireMic() {
    const stream = await navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
      .catch(() => undefined)

    if (!stream) return this.dispatch({ type: "step.failed", step: "mic", reason: "microphone" })

    // A permission granted after End or the join timeout must not keep the microphone on.
    if (!isAcquiringMicVoiceTransport(this.state)) return stream.getTracks().forEach((track) => track.stop())

    this.stream = stream
    this.input = this.analyser(stream)
    await this.sender.replaceTrack(stream.getAudioTracks()[0])
    this.dispatch({ type: "mic.ready" })
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
