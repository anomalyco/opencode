#!/usr/bin/env bun
/**
 * Test with HyperX QuadCast S microphone
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
  participantName: "HyperX Test",
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

    console.log("🎤 HyperX QuadCast S Microphone Test")
    console.log("=" .repeat(50))

    room.on(RoomEvent.Connected, () => {
      console.log("✅ Connected to room")
    })

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log(`📥 Subscribed to ${participant.identity}`)
      
      if (track.kind === 1) {
        const audioTrack = track as RemoteAudioTrack
        const stream = new AudioStream(audioTrack)
        const ffplay = exec("ffplay -f s16le -ar 48000 -nodisp -autoexit -")
        const reader = stream.getReader()
        let count = 0
        
        ;(async () => {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              if (ffplay.stdin && !ffplay.stdin.destroyed) ffplay.stdin.end()
              break
            }
            count++
            if (count === 1) {
              console.log(`   🔊 Playing audio from ${participant.identity}`)
            }
            if (ffplay.stdin && !ffplay.stdin.destroyed) {
              ffplay.stdin.write(Buffer.from(value.data.buffer))
            }
          }
        })()
      }
    })

    await room.connect(config.url, token, { autoSubscribe: true, dynacast: true })

    // Publish microphone with HyperX QuadCast S
    console.log("\n🎤 Setting up HyperX QuadCast S...")
    const SAMPLE_RATE = 48000
    const NUM_CHANNELS = 1
    const SAMPLES_PER_CHANNEL = 480
    const BYTES_PER_FRAME = SAMPLES_PER_CHANNEL * NUM_CHANNELS * 2

    const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS)
    const audioTrack = LocalAudioTrack.createAudioTrack("hyperx-microphone", audioSource)
    const publication = await room.localParticipant!.publishTrack(audioTrack, new TrackPublishOptions())
    
    console.log("✅ Track published:")
    console.log(`   Name: ${publication.name}`)
    console.log(`   SID: ${publication.sid}`)

    // Use HyperX QuadCast S (audio device :11)
    console.log("\n🎙️  Capturing from HyperX QuadCast S (device :11)...")
    micProcess = spawn("ffmpeg", [
      "-f", "avfoundation",
      "-i", ":11",  // HyperX QuadCast S
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "1",
      "-"
    ])
    
    if (!micProcess.stdout) throw new Error("No mic stdout")
    
    // Show ffmpeg stderr for first few seconds to confirm device
    let stderrShown = false
    micProcess.stderr?.on("data", (data) => {
      if (!stderrShown) {
        const str = data.toString()
        if (str.includes("Input #0")) {
          console.log("📊 FFmpeg input detected:")
          const lines = str.split('\n').filter(l => l.includes('Input') || l.includes('Stream') || l.includes('Audio'))
          lines.forEach(l => console.log(`   ${l.trim()}`))
          stderrShown = true
        }
      }
    })

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
        
        if (micFrames === 1) {
          console.log("✅ HyperX audio streaming!")
        }
        if (micFrames % 500 === 0) {
          console.log(`📊 Sent ${micFrames} frames (${Math.floor(micFrames/100)}s)`)
        }
      }
    })

    console.log("\n⏳ Running for 30 seconds...")
    console.log("   🎤 SPEAK INTO YOUR HYPERX MICROPHONE!")
    console.log("   🔊 Listen for responses")
    
    await new Promise((resolve) => setTimeout(resolve, 30000))

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
