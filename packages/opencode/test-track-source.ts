#!/usr/bin/env bun
/**
 * Debug: Check if we're publishing with correct track source
 */

import {
  Room,
  RoomEvent,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  AudioFrame,
} from "@livekit/rtc-node"
import { AccessToken } from "livekit-server-sdk"
import { spawn } from "child_process"

const config = {
  url: process.env.LIVEKIT_URL || "",
  roomName: process.env.LIVEKIT_DEFAULT_ROOM || "test-room",
  apiKey: process.env.LIVEKIT_API_KEY || "",
  apiSecret: process.env.LIVEKIT_API_SECRET || "",
  participantName: "Source Debug",
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

    console.log("🔍 Track Source Debug")
    console.log("=".repeat(50))

    room.on(RoomEvent.TrackPublished, (publication, participant) => {
      if (participant.identity === config.participantName) {
        console.log("\n📤 OUR TRACK PUBLISHED:")
        console.log(`   Name: ${publication.name}`)
        console.log(`   SID: ${publication.sid}`)
        console.log(`   Kind: ${publication.kind} (1=audio)`)
        console.log(`   Source: ${publication.source}`)
        console.log(`   Muted: ${publication.muted}`)

        // Check what source values mean
        console.log("\n📋 Source Type Reference:")
        console.log("   0 = SOURCE_UNKNOWN")
        console.log("   1 = SOURCE_CAMERA")
        console.log("   2 = SOURCE_MICROPHONE ⬅️  AGENT EXPECTS THIS!")
        console.log("   3 = SOURCE_SCREENSHARE")

        if (publication.source !== 2) {
          console.log("\n⚠️  WARNING: Track source is NOT microphone!")
          console.log("   Agent may ignore this track!")
        } else {
          console.log("\n✅ Track source is correctly set to MICROPHONE")
        }
      }
    })

    await room.connect(config.url, token, { autoSubscribe: false, dynacast: true })
    console.log("✅ Connected")

    const SAMPLE_RATE = 48000
    const NUM_CHANNELS = 1
    const SAMPLES_PER_CHANNEL = 480
    const BYTES_PER_FRAME = SAMPLES_PER_CHANNEL * NUM_CHANNELS * 2

    const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS)
    const audioTrack = LocalAudioTrack.createAudioTrack("microphone", audioSource)

    // CRITICAL: Set source to MICROPHONE
    const options = new TrackPublishOptions()
    options.source = 2 // TrackSource.MICROPHONE (correct value is 2!)

    console.log("\n📡 Publishing track with source = 1 (MICROPHONE)...")
    await room.localParticipant!.publishTrack(audioTrack, options)

    // Start microphone
    console.log("\n🎙️  Starting microphone...")
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
        if (micFrames === 1) console.log("✅ Microphone streaming")
        if (micFrames % 500 === 0) console.log(`📊 Sent ${micFrames} frames`)
      }
    })

    console.log("\n⏳ Running for 20 seconds...")
    console.log("🎤 SPEAK: 'Testing one two three'")
    console.log("\n💡 Watch the agent logs to see if it picks up your audio\n")

    await new Promise((resolve) => setTimeout(resolve, 20000))

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
