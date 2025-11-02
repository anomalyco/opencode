#!/usr/bin/env bun
/**
 * Direct Agent Communication - No audio published to LiveKit
 * Agent handles audio internally via its own VAD/STT/TTS pipeline
 */

import { Room, RoomEvent } from "@livekit/rtc-node"
import { AccessToken } from "livekit-server-sdk"

const config = {
  url: process.env.LIVEKIT_URL || "",
  roomName: process.env.LIVEKIT_DEFAULT_ROOM || "test-room",
  apiKey: process.env.LIVEKIT_API_KEY || "",
  apiSecret: process.env.LIVEKIT_API_SECRET || "",
  participantName: "User",
}

async function generateToken(): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: config.participantName,
    name: config.participantName,
  })
  token.addGrant({
    roomJoin: true,
    room: config.roomName,
    canPublish: false,  // DON'T publish audio - let agent handle it
    canSubscribe: true,
  })
  return await token.toJwt()
}

async function main() {
  console.log("🤖 Direct Agent Mode")
  console.log("=" .repeat(50))
  console.log("Agent handles audio directly (no WebRTC tracks)")
  console.log("=" .repeat(50))

  const token = await generateToken()
  const room = new Room()

  room.on(RoomEvent.Connected, () => {
    console.log("\n✅ Connected to room")
    console.log(`   Participants: ${room.remoteParticipants.size}`)
    
    for (const [identity, participant] of room.remoteParticipants) {
      console.log(`   - ${identity}${participant.metadata?.includes('agent') ? ' (AGENT)' : ''}`)
    }
    
    console.log("\n💡 Your Cartesia agent should:")
    console.log("   - Use HyperX mic (:11) via Deepgram STT")
    console.log("   - Process speech with Groq LLM")
    console.log("   - Play audio via Cartesia TTS")
    console.log("   - No WebRTC audio overhead")
    console.log("\n⏳ Listening for agent data...")
  })

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    const isAgent = participant.metadata?.includes('agent')
    console.log(`\n${isAgent ? '🤖' : '👤'} ${participant.identity} joined${isAgent ? ' (AGENT)' : ''}`)
  })

  room.on(RoomEvent.DataReceived, (payload, participant) => {
    if (!participant) return
    
    try {
      const text = new TextDecoder().decode(payload)
      const data = JSON.parse(text)
      
      console.log(`\n📨 Data from ${participant.identity}:`)
      console.log(`   Type: ${data.type}`)
      
      if (data.type === "transcript") {
        console.log(`   🎤 User: ${data.transcript}`)
      } else if (data.type === "agent_speech") {
        console.log(`   🤖 Agent: ${data.text}`)
      } else {
        console.log(`   Data: ${JSON.stringify(data).slice(0, 200)}`)
      }
    } catch (err) {
      // Not JSON, probably binary
      console.log(`   📦 Binary data: ${payload.length} bytes`)
    }
  })

  await room.connect(config.url, token, {
    autoSubscribe: true,
    dynacast: false,
  })

  console.log("\n🎤 Your agent should now be listening via HyperX mic")
  console.log("🔊 Agent responses will play through your speakers")
  console.log("\n💬 Speak to your agent!\n")

  // Keep running
  await new Promise(() => {})
}

process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down...")
  process.exit(0)
})

main()
