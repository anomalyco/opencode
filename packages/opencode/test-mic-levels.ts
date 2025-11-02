#!/usr/bin/env bun
/**
 * Show real-time microphone audio levels
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
  participantName: "Level Test",
}

async function generateToken(): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: config.participantName,
    name: config.participantName,
  })
  token.addGrant({ roomJoin: true, room: config.roomName, canPublish: true, canSubscribe: true })
  return await token.toJwt()
}

function calculateRMS(buffer: Buffer): number {
  const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2)
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const normalized = samples[i] / 32768.0 // Normalize to -1.0 to 1.0
    sum += normalized * normalized
  }
  return Math.sqrt(sum / samples.length)
}

function rmsToDb(rms: number): number {
  if (rms === 0) return -100
  return 20 * Math.log10(rms)
}

function createLevelMeter(db: number): string {
  // Convert dB to visual meter (-60 dB to 0 dB range)
  const normalized = Math.max(0, Math.min(1, (db + 60) / 60))
  const bars = Math.floor(normalized * 40)
  const meter = "█".repeat(bars) + "░".repeat(40 - bars)

  let color = ""
  if (db > -10)
    color = "🔴" // Too loud
  else if (db > -20)
    color = "🟢" // Good
  else if (db > -40)
    color = "🟡" // Quiet
  else color = "⚪" // Very quiet/silence

  return `${color} ${meter} ${db.toFixed(1)} dB`
}

async function main() {
  let micProcess: ReturnType<typeof spawn> | null = null

  try {
    const token = await generateToken()
    const room = new Room()

    console.log("📊 Microphone Level Monitor")
    console.log("=".repeat(70))

    await room.connect(config.url, token, { autoSubscribe: false, dynacast: true })

    const SAMPLE_RATE = 48000
    const NUM_CHANNELS = 1
    const SAMPLES_PER_CHANNEL = 480
    const BYTES_PER_FRAME = SAMPLES_PER_CHANNEL * NUM_CHANNELS * 2

    const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS)
    const audioTrack = LocalAudioTrack.createAudioTrack("microphone", audioSource)
    const options = new TrackPublishOptions()
    options.source = 2 // TrackSource.MICROPHONE

    await room.localParticipant!.publishTrack(audioTrack, options)
    console.log("✅ Microphone track published\n")

    console.log("🎤 Starting HyperX QuadCast S monitoring...")
    console.log("   🟢 Green = Good level (-20 to -10 dB)")
    console.log("   🟡 Yellow = Quiet (-40 to -20 dB)")
    console.log("   ⚪ White = Very quiet/silence (< -40 dB)")
    console.log("   🔴 Red = Too loud (> -10 dB)\n")

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
    micProcess.stderr?.on("data", () => {})

    let micFrames = 0
    let buffer = Buffer.alloc(0)
    let maxDb = -100
    let minDb = 0

    micProcess.stdout.on("data", async (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])

      while (buffer.length >= BYTES_PER_FRAME) {
        const frameData = buffer.subarray(0, BYTES_PER_FRAME)
        buffer = buffer.subarray(BYTES_PER_FRAME)

        const audioFrame = AudioFrame.create(SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_CHANNEL)
        const frameBuffer = Buffer.from(audioFrame.data.buffer)
        frameData.copy(frameBuffer)

        // Calculate audio level
        const rms = calculateRMS(frameData)
        const db = rmsToDb(rms)

        if (db > maxDb) maxDb = db
        if (db < minDb && db > -100) minDb = db

        await audioSource.captureFrame(audioFrame)
        micFrames++

        // Show level every 10 frames (~100ms)
        if (micFrames % 10 === 0) {
          const levelMeter = createLevelMeter(db)
          process.stdout.write(
            `\r${levelMeter}   Frame: ${micFrames}   Max: ${maxDb.toFixed(1)} dB  `,
          )
        }
      }
    })

    console.log("🎤 SPEAK INTO YOUR MICROPHONE!\n")

    await new Promise((resolve) => setTimeout(resolve, 30000))

    console.log("\n\n📊 Session Stats:")
    console.log(`   Total frames: ${micFrames}`)
    console.log(`   Max level: ${maxDb.toFixed(1)} dB`)
    console.log(`   Duration: ${Math.floor(micFrames / 100)} seconds`)

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
