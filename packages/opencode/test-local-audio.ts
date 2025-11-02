#!/usr/bin/env bun
/**
 * Local Audio Only - Agent in room but audio handled locally
 * No audio tracks published to LiveKit - just data channel communication
 */

import { Room, RoomEvent } from "@livekit/rtc-node"
import { AccessToken } from "livekit-server-sdk"
import { spawn } from "child_process"
import { WebSocket } from "ws"

const config = {
  url: process.env.LIVEKIT_URL || "",
  roomName: process.env.LIVEKIT_DEFAULT_ROOM || "test-room",
  apiKey: process.env.LIVEKIT_API_KEY || "",
  apiSecret: process.env.LIVEKIT_API_SECRET || "",
  participantName: "Local Audio User",
  // OpenAI Realtime WebSocket (if using OpenAI directly)
  openaiApiKey: process.env.OPENAI_API_KEY || "",
}

async function generateToken(): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: config.participantName,
    name: config.participantName,
  })
  token.addGrant({ 
    roomJoin: true, 
    room: config.roomName, 
    canPublish: false,  // We won't publish audio tracks
    canSubscribe: true,
  })
  return await token.toJwt()
}

async function main() {
  console.log("🎙️  Local Audio Mode")
  console.log("=" .repeat(50))
  console.log("Agent in LiveKit room, but audio is local")
  console.log("=" .repeat(50))

  // Connect to LiveKit room (but don't publish audio)
  const token = await generateToken()
  const room = new Room()

  room.on(RoomEvent.Connected, () => {
    console.log("\n✅ Connected to LiveKit room")
    console.log(`   Participants: ${room.remoteParticipants.size}`)
    
    for (const [identity, participant] of room.remoteParticipants) {
      console.log(`   - ${identity}`)
    }
  })

  room.on(RoomEvent.DataReceived, (payload, participant) => {
    try {
      const text = new TextDecoder().decode(payload)
      console.log(`\n📨 Data from ${participant?.identity}: ${text}`)
    } catch (err) {
      console.error("Error decoding data:", err)
    }
  })

  await room.connect(config.url, token, { 
    autoSubscribe: false,  // Don't subscribe to audio tracks
    dynacast: false,
  })

  console.log("\n🔧 Audio Mode: LOCAL (not using LiveKit tracks)")
  console.log("   - Mic: Direct to OpenAI/Agent")
  console.log("   - Speaker: Direct from OpenAI/Agent")
  console.log("   - No WebRTC audio overhead")
  console.log("   - No VAD lag\n")

  // TODO: Connect directly to your agent's audio endpoint
  // Options:
  // 1. OpenAI Realtime API WebSocket
  // 2. Local agent HTTP/WebSocket endpoint
  // 3. Direct TCP connection to agent
  
  console.log("💡 Next steps:")
  console.log("   1. Connect directly to agent audio endpoint (OpenAI Realtime API, etc)")
  console.log("   2. Stream HyperX mic directly to agent")
  console.log("   3. Stream agent audio directly to speakers")
  console.log("   4. Use LiveKit room only for data/signaling\n")

  // Example: Connect to OpenAI Realtime API directly
  if (config.openaiApiKey) {
    console.log("🤖 Connecting to OpenAI Realtime API...")
    
    const ws = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01", {
      headers: {
        "Authorization": `Bearer ${config.openaiApiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    })

    ws.on("open", () => {
      console.log("✅ Connected to OpenAI Realtime API")
      
      // Configure session
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions: "You are a helpful assistant. Be concise.",
          voice: "alloy",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: {
            model: "whisper-1",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
      }))
    })

    ws.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString())
        
        switch (event.type) {
          case "session.created":
            console.log("✅ Session created")
            startAudio(ws)
            break
            
          case "session.updated":
            console.log("✅ Session configured")
            break
            
          case "conversation.item.input_audio_transcription.completed":
            console.log(`\n🎤 You: ${event.transcript}`)
            break
            
          case "response.audio_transcript.delta":
            process.stdout.write(event.delta)
            break
            
          case "response.audio_transcript.done":
            console.log(`\n🤖 Agent: ${event.transcript}`)
            break
            
          case "response.audio.delta":
            // Play audio chunk directly
            playAudioChunk(event.delta)
            break
            
          case "error":
            console.error("\n❌ Error:", event.error)
            break
        }
      } catch (err) {
        console.error("Error parsing message:", err)
      }
    })

    ws.on("error", (err) => {
      console.error("❌ WebSocket error:", err)
    })

    ws.on("close", () => {
      console.log("\n❌ Disconnected from OpenAI")
    })
  } else {
    console.log("⚠️  No OPENAI_API_KEY set - skipping direct audio connection")
    console.log("   Set OPENAI_API_KEY to use direct audio mode\n")
  }

  // Keep running
  await new Promise(() => {})
}

let ffplayProcess: ReturnType<typeof spawn> | null = null
let micProcess: ReturnType<typeof spawn> | null = null

function startAudio(ws: WebSocket) {
  console.log("\n🎤 Starting HyperX microphone...")
  
  // Start microphone capture
  micProcess = spawn("ffmpeg", [
    "-f", "avfoundation",
    "-i", ":11",  // HyperX QuadCast S
    "-f", "s16le",
    "-ar", "24000",  // OpenAI expects 24kHz
    "-ac", "1",
    "-"
  ])
  
  if (!micProcess.stdout) throw new Error("No mic")
  micProcess.stderr?.on("data", () => {})
  
  // Send audio to OpenAI
  micProcess.stdout.on("data", (chunk: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      // Send as base64
      ws.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: chunk.toString("base64"),
      }))
    }
  })
  
  console.log("✅ Microphone streaming to OpenAI")
  console.log("\n🔊 Starting speaker output...")
  
  // Start speaker playback
  ffplayProcess = spawn("ffplay", [
    "-f", "s16le",
    "-ar", "24000",
    "-ac", "1",
    "-nodisp",
    "-autoexit",
    "-"
  ])
  
  console.log("✅ Speaker ready")
  console.log("\n🎙️  You can now speak!\n")
}

function playAudioChunk(base64Audio: string) {
  if (!ffplayProcess || !ffplayProcess.stdin) return
  
  try {
    const buffer = Buffer.from(base64Audio, "base64")
    if (!ffplayProcess.stdin.destroyed) {
      ffplayProcess.stdin.write(buffer)
    }
  } catch (err) {
    console.error("Error playing audio:", err)
  }
}

process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down...")
  if (micProcess) micProcess.kill()
  if (ffplayProcess) ffplayProcess.kill()
  process.exit(0)
})

main()
