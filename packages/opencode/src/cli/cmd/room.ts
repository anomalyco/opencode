import { cmd } from "./cmd"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Config } from "../../config/config"
import { createRoomAgent } from "../../livekit/room-agent"
import type { LiveKitConfig, RoomAgentConfig } from "../../livekit/types"

export const RoomCommand = cmd({
  command: "room",
  describe: "LiveKit room operations for voice collaboration",
  builder: (yargs) =>
    yargs
      .command(RoomJoinCommand)
      .command(RoomCreateCommand)
      .command(RoomAgentCommand)
      .command(RoomListCommand)
      .command(RoomLeaveCommand)
      .demandCommand(),
  async handler() {},
})

export const RoomJoinCommand = cmd({
  command: "join <name>",
  describe: "join a LiveKit room",
  builder: (yargs) =>
    yargs
      .positional("name", {
        describe: "room name to join",
        type: "string",
        demandOption: true,
      })
      .option("participant", {
        alias: ["p"],
        describe: "participant name",
        type: "string",
      })
      .option("server", {
        alias: ["s"],
        describe: "LiveKit server URL",
        type: "string",
      }),
  async handler(args) {
    try {
      UI.empty()
      UI.println("🎤 Joining LiveKit Room")
      UI.empty()

      const config = await Config.get()
      const liveKitConfig = await getLiveKitConfig(config, args.server)

      UI.println(`Server: ${liveKitConfig.serverUrl}`)
      UI.println(`Room: ${args.name}`)
      UI.println(`Participant: ${args.participant || "opencode-user"}`)
      UI.empty()

      // TODO: Implement actual room joining with UI
      UI.println("⚠️  Room joining UI not yet implemented")
      UI.println("Use 'opencode room agent start' to start an AI agent in a room")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to join room: ${message}`)
      process.exit(1)
    }
  },
})

export const RoomCreateCommand = cmd({
  command: "create <name>",
  describe: "create a new LiveKit room",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "room name to create",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    try {
      UI.empty()
      UI.println("🏠 Creating LiveKit Room")
      UI.empty()

      UI.println(`Room: ${args.name}`)
      UI.empty()

      // TODO: Implement room creation via LiveKit API
      UI.println("⚠️  Room creation not yet implemented")
      UI.println("Rooms are auto-created when participants join")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to create room: ${message}`)
      process.exit(1)
    }
  },
})

export const RoomAgentCommand = cmd({
  command: "agent",
  describe: "manage OpenCode room agent",
  builder: (yargs) =>
    yargs
      .command(RoomAgentStartCommand)
      .command(RoomAgentStopCommand)
      .command(RoomAgentStatusCommand)
      .demandCommand(),
  async handler() {},
})

export const RoomAgentStartCommand = cmd({
  command: "start",
  describe: "start OpenCode room agent",
  builder: (yargs) =>
    yargs
      .option("room", {
        alias: ["r"],
        describe: "room name to join",
        type: "string",
      })
      .option("name", {
        alias: ["n"],
        describe: "agent name",
        type: "string",
        default: "opencode-assistant",
      })
      .option("transcribe", {
        describe: "enable transcription",
        type: "boolean",
        default: true,
      })
      .option("notes", {
        describe: "enable note taking",
        type: "boolean",
        default: true,
      })
      .option("todos", {
        describe: "enable todo extraction",
        type: "boolean",
        default: true,
      })
      .option("server", {
        alias: ["s"],
        describe: "LiveKit server URL",
        type: "string",
      }),
  async handler(args) {
    try {
      UI.empty()
      prompts.intro("🤖 Starting OpenCode Room Agent")

      // Get LiveKit configuration
      const config = await Config.get()
      const liveKitConfig = await getLiveKitConfig(config, args.server)

      // Get room name
      let roomName = args.room
      if (!roomName) {
        const input = await prompts.text({
          message: "Which room should the agent join?",
          placeholder: "my-room",
          validate: (value) => (value && value.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(input)) throw new UI.CancelledError()
        roomName = input as string
      }

      // Configure agent
      const agentConfig: RoomAgentConfig = {
        name: args.name,
        roomName,
        capabilities: {
          transcribe: args.transcribe,
          takeNotes: args.notes,
          manageTodos: args.todos,
          answerQuestions: true,
          executeTools: true,
        },
      }

      UI.empty()
      UI.println(`🏠 Room: ${roomName}`)
      UI.println(`🤖 Agent: ${args.name}`)
      UI.println(`📝 Transcription: ${args.transcribe ? "✓" : "✗"}`)
      UI.println(`📋 Notes: ${args.notes ? "✓" : "✗"}`)
      UI.println(`✅ Todos: ${args.todos ? "✓" : "✗"}`)
      UI.empty()

      // Create and start agent
      const agent = createRoomAgent(liveKitConfig, agentConfig)

      UI.println("Connecting to room...")
      await agent.joinRoom()

      prompts.outro("✅ Agent started successfully!")
      UI.empty()
      UI.println("The agent is now listening in the room.")
      UI.println("Press Ctrl+C to stop the agent.")
      UI.empty()

      // Handle graceful shutdown
      const cleanup = async () => {
        UI.println("\nStopping agent...")
        await agent.leaveRoom()
        UI.println("Agent stopped.")
        process.exit(0)
      }

      process.on("SIGINT", cleanup)
      process.on("SIGTERM", cleanup)

      // Keep process alive
      await new Promise(() => {})
    } catch (error) {
      if (error instanceof UI.CancelledError) {
        prompts.cancel("Operation cancelled")
        process.exit(0)
      }
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to start agent: ${message}`)
      process.exit(1)
    }
  },
})

export const RoomAgentStopCommand = cmd({
  command: "stop",
  describe: "stop OpenCode room agent",
  async handler() {
    try {
      UI.println("⚠️  Agent stop not yet implemented")
      UI.println("Use Ctrl+C to stop a running agent")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to stop agent: ${message}`)
      process.exit(1)
    }
  },
})

export const RoomAgentStatusCommand = cmd({
  command: "status",
  describe: "show OpenCode room agent status",
  async handler() {
    try {
      UI.println("📊 Room Agent Status")
      UI.empty()
      UI.println("⚠️  Status display not yet implemented")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to get status: ${message}`)
      process.exit(1)
    }
  },
})

export const RoomListCommand = cmd({
  command: "list",
  describe: "list available LiveKit rooms",
  async handler() {
    try {
      UI.println("📋 Available Rooms")
      UI.empty()
      UI.println("⚠️  Room listing not yet implemented")
      UI.println("Rooms are created on-demand when participants join")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to list rooms: ${message}`)
      process.exit(1)
    }
  },
})

export const RoomLeaveCommand = cmd({
  command: "leave",
  describe: "leave current LiveKit room",
  async handler() {
    try {
      UI.println("⚠️  Room leave not yet implemented")
      UI.println("Use Ctrl+C to leave a room")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to leave room: ${message}`)
      process.exit(1)
    }
  },
})

// ============================================================================
// Helpers
// ============================================================================

async function getLiveKitConfig(config: any, serverOverride?: string): Promise<LiveKitConfig> {
  // Check for LiveKit configuration
  const liveKitConfig = config.livekit || {}

  const serverUrl =
    serverOverride ||
    liveKitConfig.serverUrl ||
    process.env.LIVEKIT_URL ||
    process.env.VITE_LIVEKIT_URL

  const apiKey =
    liveKitConfig.apiKey || process.env.LIVEKIT_API_KEY || process.env.VITE_LIVEKIT_API_KEY

  const apiSecret =
    liveKitConfig.apiSecret || process.env.LIVEKIT_API_SECRET || process.env.LIVEKIT_SECRET

  if (!serverUrl || !apiKey || !apiSecret) {
    UI.error("LiveKit configuration missing!")
    UI.empty()
    UI.println("Please configure LiveKit in one of these ways:")
    UI.empty()
    UI.println("1. Environment variables:")
    UI.println("   LIVEKIT_URL=wss://your-server.livekit.cloud")
    UI.println("   LIVEKIT_API_KEY=your-api-key")
    UI.println("   LIVEKIT_API_SECRET=your-api-secret")
    UI.empty()
    UI.println("2. opencode.json:")
    UI.println('   "livekit": {')
    UI.println('     "serverUrl": "wss://your-server.livekit.cloud",')
    UI.println('     "apiKey": "your-api-key",')
    UI.println('     "apiSecret": "your-api-secret"')
    UI.println("   }")
    UI.empty()
    process.exit(1)
  }

  return {
    serverUrl,
    apiKey,
    apiSecret,
  }
}
