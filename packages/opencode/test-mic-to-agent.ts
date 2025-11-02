#!/usr/bin/env bun
/**
 * Debug: Verify microphone audio is reaching the agent
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
  participantName: "Mic Test",
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

    console.log("🔍 Microphone Debug Test")
    console.log("=".repeat(50))

    room.on(RoomEvent.Connected, () => {
      console.log("✅ Connected")
    })

    room.on(RoomEvent.TrackPublished, (publication, participant) => {
      if (participant.identity === config.participantName) {
        console.log(`\n📤 OUR track published:`)
        console.log(`   Name: ${publication.name}`)
        console.log(`   SID: ${publication.sid}`)
        console.log(`   Kind: ${publication.kind}`)
        console.log(`   Muted: ${publication.muted}`)
        console.log(`   Source: ${publication.source}`)
      }
    })

    await room.connect(config.url, token, { autoSubscribe: false, dynacast: true })

    // Setup microphone with VERBOSE logging
    console.log("\n🎤 Setting up microphone...")
    const SAMPLE_RATE = 48000
    const NUM_CHANNELS = 1
    const SAMPLES_PER_CHANNEL = 480
    const BYTES_PER_FRAME = SAMPLES_PER_CHANNEL * NUM_CHANNELS * 2

    const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS)
    console.log(`   ✅ AudioSource created (${SAMPLE_RATE}Hz, ${NUM_CHANNELS}ch)`)

    const audioTrack = LocalAudioTrack.createAudioTrack("microphone", audioSource)
    console.log("   ✅ LocalAudioTrack created")

    const options = new TrackPublishOptions()
    options.source = 2 // TrackSource.MICROPHONE (2, not 1!)

    console.log("\n📡 Publishing track...")
    const publication = await room.localParticipant!.publishTrack(audioTrack, options)
    console.log("✅ Track published:")
    console.log(`   Name: ${publication.name}`)
    console.log(`   SID: ${publication.sid}`)
    console.log(`   Muted: ${publication.muted}`)

    // Start microphone capture
    console.log("\n🎙️  Starting HyperX microphone capture...")
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

    if (!micProcess.stdout) throw new Error("No mic stdout")

    // Show first stderr output to confirm device
    let shownStderr = false
    micProcess.stderr?.on("data", (data) => {
      if (!shownStderr) {
        const str = data.toString()
        if (str.includes("Input #0")) {
          console.log("📊 FFmpeg input:")
          const lines = str.split("\n")
          lines.filter((l) => l.includes("Audio")).forEach((l) => console.log(`   ${l.trim()}`))
          shownStderr = true
        }
      }
    })

    let micFrames = 0
    let totalBytes = 0
    let buffer = Buffer.alloc(0)

    micProcess.stdout.on("data", async (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])

      while (buffer.length >= BYTES_PER_FRAME) {
        const frameData = buffer.subarray(0, BYTES_PER_FRAME)
        buffer = buffer.subarray(BYTES_PER_FRAME)

        const audioFrame = AudioFrame.create(SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_CHANNEL)
        const frameBuffer = Buffer.from(audioFrame.data.buffer)
        frameData.copy(frameBuffer)

        // Check if audio data is non-zero (not silence)
        let hasAudio = false
        const view = new Int16Array(frameBuffer.buffer)
        for (let i = 0; i < view.length; i++) {
          if (Math.abs(view[i]) > 100) {
            // threshold for non-silence
            hasAudio = true
            break
          }
        }

        await audioSource.captureFrame(audioFrame)
        micFrames++
        totalBytes += frameData.length

        if (micFrames === 1) {
          console.log("✅ Microphone streaming started!")
        }

        if (micFrames % 100 === 0) {
          console.log(
            `📊 Sent ${micFrames} frames (${Math.floor(micFrames / 100)}s) - ${hasAudio ? "🔊 HAS AUDIO" : "🔇 SILENCE"}`,
          )
        }
      }
    })

    console.log("\n⏳ Running for 30 seconds...")
    console.log("🎤 SPEAK LOUDLY INTO YOUR HYPERX MICROPHONE!")
    console.log("   Watch for '🔊 HAS AUDIO' messages\n")

    await new Promise((resolve) => setTimeout(resolve, 30000))

    console.log("\n📊 Final stats:")
    console.log(`   Total frames sent: ${micFrames}`)
    console.log(`   Total bytes: ${totalBytes}`)
    console.log(`   Duration: ~${Math.floor(micFrames / 100)} seconds`)

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
