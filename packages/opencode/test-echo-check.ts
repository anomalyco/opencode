#!/usr/bin/env bun
/**
 * Check if our audio is visible to other participants
 */

import {
  Room,
  RoomEvent,
} from "@livekit/rtc-node"
import { AccessToken } from "livekit-server-sdk"

const config = {
  url: process.env.LIVEKIT_URL || "",
  roomName: process.env.LIVEKIT_DEFAULT_ROOM || "test-room",
  apiKey: process.env.LIVEKIT_API_KEY || "",
  apiSecret: process.env.LIVEKIT_API_SECRET || "",
}

async function generateToken(identity: string): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    name: identity,
  })
  token.addGrant({ roomJoin: true, room: config.roomName, canPublish: true, canSubscribe: true })
  return await token.toJwt()
}

async function main() {
  const token = await generateToken("Observer")
  const room = new Room()

  console.log("👁️  Observer: Watching room for audio tracks")
  console.log("=" .repeat(50))

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    console.log(`\n👤 Participant joined: ${participant.identity}`)
  })

  room.on(RoomEvent.TrackPublished, (publication, participant) => {
    console.log(`\n📤 TRACK PUBLISHED by ${participant.identity}:`)
    console.log(`   Name: ${publication.name}`)
    console.log(`   SID: ${publication.sid}`)
    console.log(`   Kind: ${publication.kind === 1 ? 'AUDIO' : 'VIDEO'}`)
    console.log(`   Source: ${publication.source} ${publication.source === 1 ? '(MICROPHONE ✅)' : ''}`)
    console.log(`   Muted: ${publication.muted}`)
  })

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    console.log(`\n📥 SUBSCRIBED to ${participant.identity}:`)
    console.log(`   Track: ${publication.name}`)
    console.log(`   Kind: ${track.kind === 1 ? 'AUDIO' : 'VIDEO'}`)
    console.log(`   ✅ This track is available to all participants`)
  })

  await room.connect(config.url, token, { autoSubscribe: true, dynacast: true })
  console.log("✅ Observer connected")
  console.log("\nMonitoring room... Press Ctrl+C to stop\n")

  // Show current participants
  setTimeout(() => {
    console.log("\n📊 Current participants:")
    for (const [identity, participant] of room.remoteParticipants) {
      console.log(`   ${identity}:`)
      for (const [sid, pub] of participant.trackPublications) {
        console.log(`      - ${pub.name} (kind: ${pub.kind}, source: ${pub.source})`)
      }
    }
  }, 2000)

  await new Promise((resolve) => setTimeout(resolve, 120000))
}

main()
