#!/usr/bin/env bun
/**
 * Save agent audio to file to verify it's valid
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
import { writeFileSync } from "fs"

const config = {
  url: process.env.LIVEKIT_URL || "",
  roomName: process.env.LIVEKIT_DEFAULT_ROOM || "test-room",
  apiKey: process.env.LIVEKIT_API_KEY || "",
  apiSecret: process.env.LIVEKIT_API_SECRET || "",
  participantName: "Audio Debug",
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
  const audioBuffers: Buffer[] = []

  try {
    const token = await generateToken()
    const room = new Room()

    console.log("🔍 Audio Debug - Save & Play")
    console.log("=".repeat(50))

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (participant.identity === config.participantName) return

      console.log(`\n📥 Agent audio from: ${participant.identity}`)

      if (track.kind === 1) {
        const audioTrack = track as RemoteAudioTrack
        const stream = new AudioStream(audioTrack)

        // Play AND save
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
              if (done) {
                console.log(
                  `   ✅ Received ${count} frames (${audioBuffers.reduce((a, b) => a + b.length, 0)} bytes)`,
                )

                // Save to file
                const audioData = Buffer.concat(audioBuffers)
                writeFileSync("/tmp/agent-audio.raw", audioData)
                console.log(`   💾 Saved to /tmp/agent-audio.raw`)
                console.log(`   🔊 Play it with: ffplay -f s16le -ar 48000 /tmp/agent-audio.raw`)

                if (ffplay.stdin && !ffplay.stdin.destroyed) ffplay.stdin.end()
                break
              }
              count++

              const buffer = Buffer.from(value.data.buffer)
              audioBuffers.push(buffer)

              if (count === 1) {
                console.log(`   🔊 Playing frame 1 (${buffer.length} bytes)`)
                console.log(
                  `   📊 First 10 samples: ${new Int16Array(buffer.buffer, buffer.byteOffset, 10)}`,
                )
              }

              if (ffplay.stdin && !ffplay.stdin.destroyed) {
                ffplay.stdin.write(buffer)
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

    // Publish mic
    const SAMPLE_RATE = 48000
    const NUM_CHANNELS = 1
    const SAMPLES_PER_CHANNEL = 480
    const BYTES_PER_FRAME = SAMPLES_PER_CHANNEL * NUM_CHANNELS * 2

    const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS)
    const audioTrack = LocalAudioTrack.createAudioTrack("microphone", audioSource)
    const options = new TrackPublishOptions()
    options.source = 2 // TrackSource.MICROPHONE

    await room.localParticipant!.publishTrack(audioTrack, options)
    console.log("✅ Mic published")

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
        if (micFrames === 1) console.log("✅ Mic streaming")
      }
    })

    console.log("\n🎤 Say: 'Hello, test one two three'")
    console.log("⏳ Running 60 seconds...\n")

    await new Promise((resolve) => setTimeout(resolve, 60000))

    console.log("\n🧹 Cleanup...")
    if (micProcess) micProcess.kill("SIGTERM")
    await room.disconnect()
    console.log("✅ Done - Check /tmp/agent-audio.raw")
    process.exit(0)
  } catch (error) {
    console.error("❌ Error:", error)
    if (micProcess) micProcess.kill()
    process.exit(1)
  }
}

main()
