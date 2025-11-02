#!/usr/bin/env bun
/**
 * Simple Voice Session - Just open mic and play agent audio
 */

import {
  Room,
  RoomEvent,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  AudioFrame,
  AudioStream,
  RemoteAudioTrack,
  RemoteParticipant,
} from "@livekit/rtc-node"
import { AccessToken } from "livekit-server-sdk"
import { spawn } from "child_process"

const config = {
  url: process.env.LIVEKIT_URL || "",
  roomName: process.env.LIVEKIT_DEFAULT_ROOM || "test-room",
  apiKey: process.env.LIVEKIT_API_KEY || "",
  apiSecret: process.env.LIVEKIT_API_SECRET || "",
  participantName: "User",
}

async function generateToken(): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: config.participantName,
    name: config.participantName,
  })
  token.addGrant({
    roomJoin: true,
    room: config.roomName,
    canPublish: true,
    canSubscribe: true,
  })
  return await token.toJwt()
}

async function main() {
  let micProcess: ReturnType<typeof spawn> | null = null
  let isAgentSpeaking = false
  let agentSpeakingTimeout: NodeJS.Timeout | null = null

  try {
    console.log("🎤 Simple Voice Session")
    console.log("=".repeat(50))

    const token = await generateToken()
    const room = new Room()

    // Handle agent audio playback
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      // Skip our own tracks
      if (participant.identity === config.participantName) return

      console.log(`\n🔊 Agent track subscribed: ${participant.identity}`)

      if (track.kind === 1) {
        const audioTrack = track as RemoteAudioTrack
        const stream = new AudioStream(audioTrack)

        // Play to speakers
        const ffplay = spawn("ffplay", [
          "-f",
          "s16le",
          "-ar",
          "48000",
          "-nodisp",
          "-autoexit",
          "-volume",
          "100",
          "-",
        ])

        const reader = stream.getReader()

        ;(async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              if (ffplay.stdin && !ffplay.stdin.destroyed) {
                ffplay.stdin.write(Buffer.from(value.data.buffer))
              }
            }
          } catch (err) {
            console.error("Playback error:", err)
          }
        })()
      }
    })

    // VAD: Listen for participant speaking state changes
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const agentSpeaking = speakers.some((s) => s.identity !== config.participantName)

      if (agentSpeaking && !isAgentSpeaking) {
        isAgentSpeaking = true
        if (agentSpeakingTimeout) clearTimeout(agentSpeakingTimeout)
        console.log("🔇 Mic muted - agent speaking")
      } else if (!agentSpeaking && isAgentSpeaking) {
        // Add delay before re-enabling mic
        if (agentSpeakingTimeout) clearTimeout(agentSpeakingTimeout)
        agentSpeakingTimeout = setTimeout(() => {
          isAgentSpeaking = false
          console.log("🎙️  Mic re-enabled")
        }, 500)
      }
    })

    // Connect
    await room.connect(config.url, token, {
      autoSubscribe: true,
      dynacast: true,
    })
    console.log("✅ Connected to room")

    // Setup audio source
    const SAMPLE_RATE = 48000
    const NUM_CHANNELS = 1
    const SAMPLES_PER_CHANNEL = 480 // 10ms frames
    const BYTES_PER_FRAME = SAMPLES_PER_CHANNEL * NUM_CHANNELS * 2

    const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS)
    const audioTrack = LocalAudioTrack.createAudioTrack("microphone", audioSource)

    // Publish with MICROPHONE source (required for agent to recognize it)
    const options = new TrackPublishOptions()
    options.source = 2 // TrackSource.MICROPHONE (2, not 1!)

    await room.localParticipant!.publishTrack(audioTrack, options)
    console.log("✅ Microphone track published")

    // Start capturing from HyperX mic
    micProcess = spawn("ffmpeg", [
      "-f",
      "avfoundation",
      "-i",
      ":11", // HyperX QuadCast S
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-",
    ])

    if (!micProcess.stdout) {
      throw new Error("Failed to start microphone capture")
    }

    // Suppress ffmpeg stderr
    micProcess.stderr?.on("data", () => {})

    let buffer = Buffer.alloc(0)
    let frameCount = 0

    micProcess.stdout.on("data", async (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])

      while (buffer.length >= BYTES_PER_FRAME) {
        const frameData = buffer.subarray(0, BYTES_PER_FRAME)
        buffer = buffer.subarray(BYTES_PER_FRAME)

        // ECHO PREVENTION: Skip mic frames when agent is speaking
        if (isAgentSpeaking) {
          // Discard this frame to prevent echo
          continue
        }

        const audioFrame = AudioFrame.create(SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_CHANNEL)
        const frameBuffer = Buffer.from(audioFrame.data.buffer)
        frameData.copy(frameBuffer)

        await audioSource.captureFrame(audioFrame)
        frameCount++

        if (frameCount === 1) {
          console.log("✅ Microphone streaming started")
          console.log("\n🎙️  You can now speak - agent should hear you")
          console.log("🔊 Agent responses will play through your speakers")
          console.log("⚡ Echo prevention: Mic auto-mutes when agent speaks")
          console.log("\nPress Ctrl+C to exit\n")
        }
      }
    })

    // Keep running until interrupted
    await new Promise(() => {})
  } catch (error) {
    console.error("❌ Error:", error)
    if (micProcess) micProcess.kill()
    process.exit(1)
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down...")
  process.exit(0)
})

main()
