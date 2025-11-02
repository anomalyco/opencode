#!/usr/bin/env bun
/**
 * Verify two-way audio by checking if remote participant receives our audio
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
  participantName: "Audio Tester",
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

    console.log("🔧 Two-Way Audio Verification Test")
    console.log("=" .repeat(50))

    // Track events
    room.on(RoomEvent.Connected, () => {
      console.log("✅ Connected to room")
      console.log(`   Participants: ${room.remoteParticipants.size}`)
    })

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log(`👤 Participant joined: ${participant.identity}`)
      console.log(`   Name: ${participant.name}`)
      console.log(`   Tracks: ${participant.trackPublications.size}`)
    })

    room.on(RoomEvent.TrackPublished, (publication, participant) => {
      console.log(`📤 Track PUBLISHED by ${participant.identity}:`)
      console.log(`   Name: ${publication.name}`)
      console.log(`   SID: ${publication.sid}`)
      console.log(`   Kind: ${publication.kind}`)
      console.log(`   Source: ${publication.source}`)
    })

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log(`📥 Track SUBSCRIBED from ${participant.identity}:`)
      console.log(`   Name: ${publication.name}`)
      console.log(`   Kind: ${track.kind}`)
      
      if (track.kind === 1) {
        console.log("   🎧 Starting audio playback...")
        const audioTrack = track as RemoteAudioTrack
        const stream = new AudioStream(audioTrack)
        const reader = stream.getReader()
        let count = 0
        
        ;(async () => {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            count++
            if (count === 1) {
              console.log(`   ✅ Receiving audio frames from ${participant.identity}`)
            }
          }
        })()
      }
    })

    await room.connect(config.url, token, { autoSubscribe: true, dynacast: true })

    // Publish microphone
    console.log("\n🎤 Publishing microphone track...")
    const SAMPLE_RATE = 48000
    const NUM_CHANNELS = 1
    const SAMPLES_PER_CHANNEL = 480
    const BYTES_PER_FRAME = SAMPLES_PER_CHANNEL * NUM_CHANNELS * 2

    const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS)
    const audioTrack = LocalAudioTrack.createAudioTrack("microphone", audioSource)
    const publication = await room.localParticipant!.publishTrack(audioTrack, new TrackPublishOptions())
    
    console.log("✅ Local track published:")
    console.log(`   Name: ${publication.name}`)
    console.log(`   SID: ${publication.sid}`)
    console.log(`   Muted: ${publication.muted}`)

    // Start microphone capture
    console.log("\n🎙️  Capturing microphone...")
    micProcess = spawn("ffmpeg", ["-f", "avfoundation", "-i", ":0", "-f", "s16le", "-ar", "48000", "-ac", "1", "-"])
    
    if (!micProcess.stdout) throw new Error("No mic stdout")
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
        
        if (micFrames === 1) {
          console.log("✅ Microphone streaming started")
        }
        if (micFrames % 500 === 0) {
          console.log(`📊 Sent ${micFrames} frames (${Math.floor(micFrames/100)} seconds of audio)`)
        }
      }
    })

    console.log("\n📊 Current room state:")
    console.log(`   Local tracks: ${room.localParticipant?.trackPublications.size}`)
    for (const [sid, pub] of room.localParticipant?.trackPublications || []) {
      console.log(`      - ${pub.name} (${pub.kind}) ${pub.muted ? "[MUTED]" : "[ACTIVE]"}`)
    }
    
    console.log(`   Remote participants: ${room.remoteParticipants.size}`)
    for (const [identity, participant] of room.remoteParticipants) {
      console.log(`      ${identity}: ${participant.trackPublications.size} tracks`)
    }

    console.log("\n⏳ Running for 20 seconds...")
    console.log("   🎤 SPEAK INTO YOUR MICROPHONE")
    console.log("   🔊 Listen for agent responses")
    
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
