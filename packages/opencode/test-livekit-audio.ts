#!/usr/bin/env bun
/**
 * Test LiveKit Connection
 *
 * This script tests connecting to LiveKit using the default environment variables.
 * Run with: bun test-livekit-direct.ts
 */

import {
  Room,
  RoomEvent,
  ConnectionState,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  AudioFrame,
} from "@livekit/rtc-node"
import { AccessToken } from "livekit-server-sdk"

// Get config from environment
const config = {
  url: process.env.LIVEKIT_URL || "",
  roomName: process.env.LIVEKIT_DEFAULT_ROOM || "test-room",
  apiKey: process.env.LIVEKIT_API_KEY || "",
  apiSecret: process.env.LIVEKIT_API_SECRET || "",
  participantName: "Test User",
}

console.log("🔧 LiveKit Connection Test")
console.log("=".repeat(50))
console.log("Config:")
console.log(`  URL: ${config.url}`)
console.log(`  Room: ${config.roomName}`)
console.log(`  API Key: ${config.apiKey ? config.apiKey.substring(0, 10) + "..." : "NOT SET"}`)
console.log(`  API Secret: ${config.apiSecret ? "***" : "NOT SET"}`)
console.log("=".repeat(50))

if (!config.url || !config.apiKey || !config.apiSecret) {
  console.error("❌ ERROR: Missing required environment variables!")
  console.error("Required:")
  console.error("  - LIVEKIT_URL")
  console.error("  - LIVEKIT_API_KEY")
  console.error("  - LIVEKIT_API_SECRET")
  console.error("Optional:")
  console.error("  - LIVEKIT_DEFAULT_ROOM (defaults to 'test-room')")
  process.exit(1)
}

async function generateToken(): Promise<string> {
  console.log("\n📝 Generating access token...")

  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: config.participantName,
    name: config.participantName,
  })

  token.addGrant({
    roomJoin: true,
    room: config.roomName,
    canPublish: true,
    canSubscribe: true,
  })

  const jwt = await token.toJwt()
  console.log(`✅ Token generated: ${jwt.substring(0, 20)}...`)
  return jwt
}

async function connectToRoom() {
  try {
    const token = await generateToken()

    console.log("\n🔌 Creating Room instance...")
    const room = new Room()

    // Set up event listeners
    room.on(RoomEvent.Connected, () => {
      console.log("✅ Connected event fired!")
      console.log(`   Room name: ${room.name}`)
      console.log(`   Participant SID: ${room.localParticipant?.sid}`)
      console.log(`   Participant Identity: ${room.localParticipant?.identity}`)
      console.log(`   Connection state: ${room.connectionState}`)
    })

    room.on(RoomEvent.Disconnected, (reason) => {
      console.log("❌ Disconnected:", reason)
    })

    room.on(RoomEvent.Reconnecting, () => {
      console.log("🔄 Reconnecting...")
    })

    room.on(RoomEvent.Reconnected, () => {
      console.log("✅ Reconnected!")
    })

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log(`👤 Participant joined: ${participant.identity}`)
    })

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log(`👋 Participant left: ${participant.identity}`)
    })

    console.log("\n🚀 Attempting to connect to LiveKit server...")
    console.log(`   URL: ${config.url}`)
    console.log(`   Room: ${config.roomName}`)

    await room.connect(config.url, token, {
      autoSubscribe: true,
      dynacast: true,
    })

    console.log("\n✅ Successfully connected to LiveKit!")
    console.log(`   Connection state: ${room.connectionState}`)
    console.log(`   Room name: ${room.name}`)
    console.log(`   Local participant: ${room.localParticipant?.identity}`)
    console.log(`   Remote participants: ${room.remoteParticipants.size}`)

    // Test microphone publishing with AudioSource
    console.log("\n🎤 Testing audio publishing with AudioSource...")
    try {
      const SAMPLE_RATE = 48000
      const NUM_CHANNELS = 1

      // Create audio source
      const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS)
      console.log("   ✅ AudioSource created")

      // Create local audio track
      const audioTrack = LocalAudioTrack.createAudioTrack("test-microphone", audioSource)
      console.log("   ✅ LocalAudioTrack created")

      // Publish the track
      const options = new TrackPublishOptions()
      const publication = await room.localParticipant!.publishTrack(audioTrack, options)
      console.log("   ✅ Audio track published successfully")
      console.log(`      Track SID: ${publication.sid}`)

      // Capture and send a test audio frame (silence)
      const SAMPLES_PER_CHANNEL = 480 // 10ms at 48kHz
      const audioFrame = AudioFrame.create(SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_CHANNEL)

      // Send a few frames of silence
      console.log("   📡 Sending test audio frames...")
      for (let i = 0; i < 5; i++) {
        await audioSource.captureFrame(audioFrame)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      console.log("   ✅ Audio frames sent successfully")

      // Unpublish
      await room.localParticipant!.unpublishTrack(publication.sid!)
      console.log("   ✅ Audio track unpublished")
    } catch (error) {
      console.error("   ❌ Audio test failed:", error)
      if (error instanceof Error) {
        console.error(`      ${error.message}`)
      }
    }

    // Test audio playback by listening for remote tracks
    console.log("\n🔊 Setting up remote audio track listener...")
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log(`   📥 Track subscribed: ${publication.sid}`)
      console.log(`      From: ${participant.identity}`)
      console.log(`      Kind: ${track.kind}`)
    })
    console.log("   ✅ Audio playback listener configured")

    // Keep connection alive for a few seconds
    console.log("\n⏳ Keeping connection alive for 5 seconds...")
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Disconnect
    console.log("\n👋 Disconnecting...")
    await room.disconnect()
    console.log("✅ Disconnected successfully")

    console.log("\n🎉 Test completed successfully!")
    process.exit(0)
  } catch (error) {
    console.error("\n❌ CONNECTION FAILED!")
    console.error("Error details:")

    if (error instanceof Error) {
      console.error(`  Message: ${error.message}`)
      console.error(`  Stack: ${error.stack}`)
    } else {
      console.error(`  ${String(error)}`)
    }

    // Additional debugging info
    console.error("\n🔍 Debugging checklist:")
    console.error("  1. Is the LiveKit server URL correct and accessible?")
    console.error("  2. Are the API key and secret valid?")
    console.error("  3. Is the server running and accepting connections?")
    console.error("  4. Check firewall/network settings")
    console.error("  5. Try connecting with LiveKit CLI: livekit-cli join-room")

    process.exit(1)
  }
}

// Run the test
connectToRoom()
