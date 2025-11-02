#!/usr/bin/env bun
/**
 * Test with explicit LG HDR 5K speaker output
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
  participantName: "LG Speaker Test",
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

    console.log("🔊 LG HDR 5K Speaker Test")
    console.log("=".repeat(50))

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (participant.identity === config.participantName) {
        console.log(`🔇 Skipping our own track`)
        return
      }

      console.log(`\n📥 Agent audio: ${participant.identity}`)

      if (track.kind === 1) {
        const audioTrack = track as RemoteAudioTrack
        const stream = new AudioStream(audioTrack)

        // Use ffplay with explicit audio device and volume boost
        console.log("   🔊 Starting ffplay to LG HDR 5K speakers...")
        const ffplay = spawn("ffplay", [
          "-f",
          "s16le",
          "-ar",
          "48000",
          "-ac",
          "1",
          "-nodisp",
          "-autoexit",
          "-volume",
          "100", // Max volume
          "-",
        ])

        const reader = stream.getReader()
        let count = 0

        ffplay.stderr?.on("data", (data) => {
          const str = data.toString()
          if (str.includes("Audio")) {
            console.log(`   📊 FFplay: ${str.trim()}`)
          }
        })
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
                console.log(
                  `   ✅ PLAYING TO SPEAKERS (frame size: ${value.data.byteLength} bytes)`,
                )
              }
              if (count % 1000 === 0) {
                console.log(`   📊 Played ${count} frames (~${Math.floor(count / 100)} seconds)`)
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
    console.log("✅ Connected")

    // Publish microphone
    const SAMPLE_RATE = 48000
    const NUM_CHANNELS = 1
    const SAMPLES_PER_CHANNEL = 480
    const BYTES_PER_FRAME = SAMPLES_PER_CHANNEL * NUM_CHANNELS * 2

    const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS)
    const audioTrack = LocalAudioTrack.createAudioTrack("microphone", audioSource)
    const options = new TrackPublishOptions()
    options.source = 2 // TrackSource.MICROPHONE

    await room.localParticipant!.publishTrack(audioTrack, options)
    console.log("✅ Microphone published")

    // Start HyperX mic
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
        if (micFrames % 1000 === 0)
          console.log(`📊 Sent ${Math.floor(micFrames / 100)} seconds of audio`)
      }
    })

    console.log("\n" + "=".repeat(50))
    console.log("⏳ RUNNING FOR 2 MINUTES")
    console.log("=".repeat(50))
    console.log("\n🎤 SPEAK CLEARLY: 'Hello, can you hear me?'")
    console.log("🔊 LISTEN to your LG HDR 5K speakers")
    console.log("🔉 Check volume on your LG display\n")

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
