#!/usr/bin/env bun
/**
 * Verify agent receives our microphone audio
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
} from "@livekit/rtc-node"
import { AccessToken } from "livekit-server-sdk"
import { spawn } from "child_process"

const config = {
  url: process.env.LIVEKIT_URL || "",
  roomName: process.env.LIVEKIT_DEFAULT_ROOM || "test-room",
  apiKey: process.env.LIVEKIT_API_KEY || "",
  apiSecret: process.env.LIVEKIT_API_SECRET || "",
  participantName: "Test User",
}

async function generateToken(): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: config.participantName,
    name: config.participantName,
  })
  token.addGrant({ roomJoin: true, room: config.roomName, canPublish: true, canSubscribe: true })
  return await token.toJwt()
}

async function main() {
  let micProcess: ReturnType<typeof spawn> | null = null

  try {
    const token = await generateToken()
    const room = new Room()

    console.log("🔍 Verify Agent Hears Us")
    console.log("=".repeat(70))

    // Track publication
    room.on(RoomEvent.TrackPublished, (publication, participant) => {
      if (participant.identity === config.participantName) {
        console.log("\n📤 OUR TRACK PUBLISHED:")
        console.log(`   Name: ${publication.name}`)
        console.log(`   SID: ${publication.sid}`)
        console.log(`   Kind: ${publication.kind}`)
        console.log(`   Source: ${publication.source}`)
        console.log(`   Muted: ${publication.muted}`)
        console.log("")
        console.log("   ⚠️  AGENT SHOULD NOW SEE THIS TRACK")
        console.log("   ⚠️  Check agent logs for 'input stream attached'")
      }
    })

    // Agent audio playback
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (participant.identity === config.participantName) return

      console.log(`\n📥 Agent audio: ${participant.identity}`)

      if (track.kind === 1) {
        const audioTrack = track as RemoteAudioTrack
        const stream = new AudioStream(audioTrack)
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
        let count = 0

        ;(async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              count++
              if (count === 1) console.log(`   🔊 Agent speaking...`)
              if (ffplay.stdin && !ffplay.stdin.destroyed) {
                ffplay.stdin.write(Buffer.from(value.data.buffer))
              }
            }
          } catch (err) {}
        })()
      }
    })

    await room.connect(config.url, token, { autoSubscribe: true, dynacast: true })
    console.log("✅ Connected")

    const SAMPLE_RATE = 48000
    const NUM_CHANNELS = 1
    const SAMPLES_PER_CHANNEL = 480
    const BYTES_PER_FRAME = SAMPLES_PER_CHANNEL * NUM_CHANNELS * 2

    const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS)
    const audioTrack = LocalAudioTrack.createAudioTrack("microphone", audioSource)

    const options = new TrackPublishOptions()
    options.source = 2 // MICROPHONE (2, not 1!)

    console.log("\n📡 Publishing microphone with source=1 (MICROPHONE)...")
    await room.localParticipant!.publishTrack(audioTrack, options)

    // Start mic
    micProcess = spawn("ffmpeg", [
      "-f",
      "avfoundation",
      "-i",
      ":11",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-",
    ])
    if (!micProcess.stdout) throw new Error("No mic")
    micProcess.stderr?.on("data", () => {})

    let micFrames = 0
    let buffer = Buffer.alloc(0)
    let hasAudio = false

    micProcess.stdout.on("data", async (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])

      while (buffer.length >= BYTES_PER_FRAME) {
        const frameData = buffer.subarray(0, BYTES_PER_FRAME)
        buffer = buffer.subarray(BYTES_PER_FRAME)

        const audioFrame = AudioFrame.create(SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_CHANNEL)
        const frameBuffer = Buffer.from(audioFrame.data.buffer)
        frameData.copy(frameBuffer)

        // Check if audio has signal
        const samples = new Int16Array(frameBuffer.buffer)
        for (let i = 0; i < samples.length; i++) {
          if (Math.abs(samples[i]) > 100) {
            hasAudio = true
            break
          }
        }

        await audioSource.captureFrame(audioFrame)
        micFrames++

        if (micFrames === 1) {
          console.log("\n✅ Microphone streaming started")
          console.log("   Sending audio frames to LiveKit...")
        }

        if (micFrames % 500 === 0) {
          console.log(
            `   📊 Sent ${micFrames} frames - ${hasAudio ? "🔊 HAS AUDIO" : "🔇 SILENCE"}`,
          )
          hasAudio = false
        }
      }
    })

    console.log("\n" + "=".repeat(70))
    console.log("⏳ Running for 90 seconds")
    console.log("=".repeat(70))
    console.log("\n🎤 SPEAK LOUDLY INTO YOUR HYPERX MICROPHONE:")
    console.log("   Say: 'Hello, this is a test. Can you hear me?'")
    console.log("\n📋 Watch for:")
    console.log("   1. '📊 Sent XXX frames - 🔊 HAS AUDIO' (confirms we're sending)")
    console.log("   2. Agent logs showing 'input stream attached' or 'speech detected'")
    console.log("   3. '📥 Agent audio' (agent responding)\n")

    await new Promise((resolve) => setTimeout(resolve, 90000))

    console.log("\n🧹 Cleanup...")
    if (micProcess) micProcess.kill("SIGTERM")
    await room.disconnect()
    console.log("✅ Done")
    console.log("\n📋 Check agent logs to see if it detected your speech")
    process.exit(0)
  } catch (error) {
    console.error("❌ Error:", error)
    if (micProcess) micProcess.kill()
    process.exit(1)
  }
}

main()
