#!/usr/bin/env bun
/**
 * Full two-way conversation test - 2 MINUTES
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
import { exec, spawn } from "child_process"

const config = {
  url: process.env.LIVEKIT_URL || "",
  roomName: process.env.LIVEKIT_DEFAULT_ROOM || "test-room",
  apiKey: process.env.LIVEKIT_API_KEY || "",
  apiSecret: process.env.LIVEKIT_API_SECRET || "",
  participantName: "Conversation Test",
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

    console.log("🎤 Full Two-Way Conversation Test")
    console.log("=".repeat(50))

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      // NEVER play our own audio
      if (participant.identity === config.participantName) {
        console.log(`🔇 Skipping our own track`)
        return
      }

      console.log(`\n📥 Agent audio track subscribed: ${participant.identity}`)

      if (track.kind === 1) {
        const audioTrack = track as RemoteAudioTrack
        const stream = new AudioStream(audioTrack)
        const ffplay = exec("ffplay -f s16le -ar 48000 -nodisp -autoexit -")

        const reader = stream.getReader()
        let count = 0

        ;(async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                console.log(`   ℹ️  Agent audio ended (${count} frames)`)
                if (ffplay.stdin && !ffplay.stdin.destroyed) ffplay.stdin.end()
                break
              }
              count++
              if (count === 1) {
                console.log(`   🔊 PLAYING AGENT AUDIO`)
              }
              if (ffplay.stdin && !ffplay.stdin.destroyed) {
                ffplay.stdin.write(Buffer.from(value.data.buffer))
              }
            }
          } catch (err) {
            console.error(`   ❌ Error:`, err)
          }
        })()
      }
    })

    await room.connect(config.url, token, { autoSubscribe: true, dynacast: true })
    console.log("✅ Connected to room")

    // Publish microphone with MICROPHONE source
    const SAMPLE_RATE = 48000
    const NUM_CHANNELS = 1
    const SAMPLES_PER_CHANNEL = 480
    const BYTES_PER_FRAME = SAMPLES_PER_CHANNEL * NUM_CHANNELS * 2

    const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS)
    const audioTrack = LocalAudioTrack.createAudioTrack("microphone", audioSource)

    const options = new TrackPublishOptions()
    options.source = 2 // MICROPHONE source - critical for agent to recognize it! (2, not 1!)

    await room.localParticipant!.publishTrack(audioTrack, options)
    console.log("✅ Microphone track published (source=MICROPHONE)")

    // Start HyperX microphone
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

    micProcess.stdout.on("data", async (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= BYTES_PER_FRAME) {
        const frameData = buffer.subarray(0, BYTES_PER_FRAME)
        buffer = buffer.subarray(BYTES_PER_FRAME)
        const audioFrame = AudioFrame.create(SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_CHANNEL)
        const frameBuffer = Buffer.from(audioFrame.data.buffer)
        frameData.copy(frameBuffer)
        await audioSource.captureFrame(audioFrame)
        micFrames++
        if (micFrames === 1) console.log("✅ Your microphone is streaming")
      }
    })

    console.log("\n" + "=".repeat(50))
    console.log("⏳ TEST RUNNING FOR 2 MINUTES (120 seconds)")
    console.log("=".repeat(50))
    console.log("\n🎤 SPEAK INTO YOUR MICROPHONE:")
    console.log("   Try: 'Hello, can you hear me?'")
    console.log("   Try: 'What's the weather like?'")
    console.log("   Try: 'Tell me a joke'")
    console.log("\n🔊 LISTEN for agent responses")
    console.log("\n⌨️  Press Ctrl+C to stop early\n")

    await new Promise((resolve) => setTimeout(resolve, 120000))

    console.log("\n🧹 Cleanup...")
    if (micProcess) micProcess.kill("SIGTERM")
    await room.disconnect()
    console.log("✅ Done")
    process.exit(0)
  } catch (error) {
    console.error("❌ Error:", error)
    if (micProcess) micProcess.kill()
    process.exit(1)
  }
}

main()
