#!/usr/bin/env bun
/**
 * Test agent interaction - verify agent receives and responds to our audio
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
  participantName: "Audio Test User",
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
  const audioPlayers = new Map<string, any>()

  try {
    const token = await generateToken()
    const room = new Room()

    console.log("🎤 Agent Interaction Test")
    console.log("=" .repeat(50))

    room.on(RoomEvent.Connected, () => {
      console.log("✅ Connected to room")
      console.log(`   Participants: ${room.remoteParticipants.size}`)
      
      // List existing participants and their tracks
      for (const [identity, participant] of room.remoteParticipants) {
        console.log(`   - ${identity}: ${participant.trackPublications.size} tracks`)
        for (const [sid, pub] of participant.trackPublications) {
          console.log(`     * ${pub.name} (${pub.kind})`)
        }
      }
    })

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log(`\n👤 NEW participant: ${participant.identity}`)
    })

    room.on(RoomEvent.TrackPublished, (publication, participant) => {
      console.log(`\n📤 ${participant.identity} PUBLISHED track:`)
      console.log(`   Name: ${publication.name}`)
      console.log(`   Kind: ${publication.kind}`)
      console.log(`   Source: ${publication.source}`)
    })

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log(`\n📥 SUBSCRIBED to ${participant.identity}:`)
      console.log(`   Track: ${publication.name}`)
      console.log(`   Kind: ${track.kind}`)
      
      if (track.kind === 1) {
        console.log(`   🔊 Starting playback for ${participant.identity}...`)
        
        const audioTrack = track as RemoteAudioTrack
        const stream = new AudioStream(audioTrack)
        const ffplay = exec("ffplay -f s16le -ar 48000 -nodisp -autoexit -", (error) => {
          if (error && error.code !== 0) {
            console.log(`   ⚠️  ${participant.identity} playback ended`)
          }
        })
        
        audioPlayers.set(participant.identity, ffplay)
        
        const reader = stream.getReader()
        let count = 0
        
        ;(async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                console.log(`   ℹ️  ${participant.identity} stream ended (${count} frames)`)
                if (ffplay.stdin && !ffplay.stdin.destroyed) ffplay.stdin.end()
                break
              }
              count++
              if (count === 1) {
                console.log(`   ✅ RECEIVING AUDIO from ${participant.identity}!`)
              }
              if (count % 500 === 0) {
                console.log(`   📊 ${participant.identity}: ${count} frames received`)
              }
              if (ffplay.stdin && !ffplay.stdin.destroyed) {
                ffplay.stdin.write(Buffer.from(value.data.buffer))
              }
            }
          } catch (err) {
            console.error(`   ❌ ${participant.identity} stream error:`, err)
          }
        })()
      }
    })

    room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      console.log(`\n❌ UNSUBSCRIBED from ${participant.identity}: ${publication.name}`)
    })

    await room.connect(config.url, token, { autoSubscribe: true, dynacast: true })

    // Publish microphone
    console.log("\n🎤 Publishing microphone...")
    const SAMPLE_RATE = 48000
    const NUM_CHANNELS = 1
    const SAMPLES_PER_CHANNEL = 480
    const BYTES_PER_FRAME = SAMPLES_PER_CHANNEL * NUM_CHANNELS * 2

    const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS)
    const audioTrack = LocalAudioTrack.createAudioTrack("microphone", audioSource)
    const publication = await room.localParticipant!.publishTrack(audioTrack, new TrackPublishOptions())
    
    console.log("✅ Our track published:")
    console.log(`   Name: ${publication.name}`)
    console.log(`   SID: ${publication.sid}`)

    // Use HyperX QuadCast S
    console.log("\n🎙️  Starting HyperX microphone capture...")
    micProcess = spawn("ffmpeg", ["-f", "avfoundation", "-i", ":11", "-f", "s16le", "-ar", "48000", "-ac", "1", "-"])
    
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
          console.log("✅ Microphone streaming started!")
        }
        if (micFrames % 1000 === 0) {
          console.log(`📊 Sent ${micFrames} frames (${Math.floor(micFrames/100)}s of audio)`)
        }
      }
    })

    console.log("\n⏳ Test running for 45 seconds...")
    console.log("\n🎤 SAY: 'Hello, can you hear me?'")
    console.log("🔊 Listen carefully for agent response...")
    console.log("\n💡 If you hear yourself but not the agent:")
    console.log("   - Check if agent track is muted")
    console.log("   - Verify agent is configured to respond to audio")
    console.log("   - Ensure you're not subscribed to your own track only\n")
    
    await new Promise((resolve) => setTimeout(resolve, 45000))

    console.log("\n🧹 Cleanup...")
    if (micProcess) micProcess.kill("SIGTERM")
    for (const [identity, player] of audioPlayers) {
      console.log(`   Stopping ${identity} playback...`)
      if (player.stdin && !player.stdin.destroyed) player.stdin.end()
      player.kill()
    }
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
