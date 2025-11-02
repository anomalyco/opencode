#!/usr/bin/env bun
/**
 * Monitor-Only Voice Session - Listen to agent without publishing audio
 * This prevents the echo loop issue where agent hears itself
 */

import { Room, RoomEvent, RemoteAudioTrack, AudioStream } from "@livekit/rtc-node"
import { AccessToken } from "livekit-server-sdk"
import { spawn } from "child_process"

const config = {
  url: process.env.LIVEKIT_URL || "",
  roomName: process.env.LIVEKIT_DEFAULT_ROOM || "test-room",
  apiKey: process.env.LIVEKIT_API_KEY || "",
  apiSecret: process.env.LIVEKIT_API_SECRET || "",
  participantName: "Monitor",
}

async function generateToken(): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: config.participantName,
    name: config.participantName,
  })
  token.addGrant({
    roomJoin: true,
    room: config.roomName,
    canPublish: false, // ❌ NO AUDIO PUBLISHING
    canSubscribe: true, // ✅ CAN SUBSCRIBE
  })
  return await token.toJwt()
}

async function main() {
  try {
    console.log("🎧 Monitor-Only Voice Session")
    console.log("=".repeat(50))
    console.log("📡 Connecting to room to monitor agent...")
    console.log("🔇 NOT publishing audio (prevents echo loop)")
    console.log("🎤 NO local mic playback (monitor-only)")
    console.log("")

    const token = await generateToken()
    const room = new Room()

    // Handle agent audio playback
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      console.log(`\n🔊 Agent audio from: ${participant.identity} (kind: ${track.kind})`)

      if (track.kind === 1) {
        // Audio track
        const audioTrack = track as RemoteAudioTrack
        const stream = new AudioStream(audioTrack)

        // Play to speakers
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

        ;(async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              if (ffplay.stdin && !ffplay.stdin.destroyed) {
                ffplay.stdin.write(Buffer.from(value.data.buffer))
              }
            }
          } catch (err) {
            console.error("Playback error:", err)
          }
        })()

        console.log("✅ Audio playback started")
      }
    })

    // Handle participant events
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log(`\n👤 Participant joined: ${participant.identity} (${participant.name})`)
    })

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log(`\n👋 Participant left: ${participant.identity}`)
    })

    // Connect to room
    await room.connect(config.url, token, {
      autoSubscribe: true,
      dynacast: true,
    })
    console.log("✅ Connected to room as monitor-only")

    console.log("\n🎧 Monitoring agent audio only...")
    console.log("🔊 Agent responses will play through your speakers")
    console.log("🔇 Your microphone will NOT be used")
    console.log("\nPress Ctrl+C to exit\n")

    // Keep running until interrupted
    await new Promise(() => {})
  } catch (error) {
    console.error("❌ Error:", error)
    process.exit(1)
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down...")
  process.exit(0)
})

main()
