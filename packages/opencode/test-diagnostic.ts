#!/usr/bin/env bun
/**
 * Diagnostic: Check what the agent sees
 */

import { Room, RoomEvent } from "@livekit/rtc-node"
import { AccessToken } from "livekit-server-sdk"

const config = {
  url: process.env.LIVEKIT_URL || "",
  roomName: process.env.LIVEKIT_DEFAULT_ROOM || "test-room",
  apiKey: process.env.LIVEKIT_API_KEY || "",
  apiSecret: process.env.LIVEKIT_API_SECRET || "",
}

async function main() {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: "diagnostic",
  })
  token.addGrant({ roomJoin: true, room: config.roomName, canSubscribe: true })
  
  const room = new Room()
  
  console.log("🔍 LiveKit Room Diagnostic")
  console.log("=".repeat(50))
  
  room.on(RoomEvent.Connected, () => {
    console.log("\n✅ Connected to room:", room.name)
    console.log(`   Participants: ${room.remoteParticipants.size}`)
    
    for (const [identity, participant] of room.remoteParticipants) {
      console.log(`\n👤 ${identity}:`)
      console.log(`   Is Agent: ${participant.metadata?.includes('agent') ? 'YES' : 'NO'}`)
      console.log(`   Tracks: ${participant.trackPublications.size}`)
      
      for (const [sid, pub] of participant.trackPublications) {
        console.log(`   📍 Track:`)
        console.log(`      Name: ${pub.name}`)
        console.log(`      SID: ${pub.sid}`)
        console.log(`      Kind: ${pub.kind === 0 ? 'VIDEO' : 'AUDIO'}`)
        console.log(`      Source: ${pub.source} ${pub.source === 1 ? '(MICROPHONE)' : ''}`)
        console.log(`      Muted: ${pub.muted}`)
        console.log(`      Subscribed: ${pub.subscribed}`)
      }
    }
  })
  
  room.on(RoomEvent.ParticipantConnected, (p) => {
    console.log(`\n➕ Participant joined: ${p.identity}`)
  })
  
  room.on(RoomEvent.TrackPublished, (pub, p) => {
    console.log(`\n📤 ${p.identity} published:`)
    console.log(`   ${pub.name} (${pub.kind === 0 ? 'VIDEO' : 'AUDIO'}) source=${pub.source}`)
  })
  
  room.on(RoomEvent.TrackSubscribed, (track, pub, p) => {
    console.log(`\n📥 Subscribed to ${p.identity}:`)
    console.log(`   ${pub.name} (kind=${track.kind})`)
  })
  
  await room.connect(config.url, await token.toJwt(), { autoSubscribe: true })
  
  console.log("\n⏳ Monitoring for 60 seconds...")
  console.log("   Run your test script in another terminal\n")
  
  await new Promise(r => setTimeout(r, 60000))
  
  console.log("\n✅ Done")
  process.exit(0)
}

main()
