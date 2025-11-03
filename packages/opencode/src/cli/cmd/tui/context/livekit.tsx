import { createContext, useContext, createSignal, onCleanup, type ParentComponent } from "solid-js"
import type { RoomManager } from "@/livekit/room-manager"
import type { LiveKitConfig } from "../component/dialog-livekit"

interface LiveKitContextValue {
  roomName: () => string | undefined
  isConnected: () => boolean
  connect: (config: LiveKitConfig) => Promise<void>
  disconnect: () => Promise<void>
  roomManager: () => RoomManager | undefined
}

const LiveKitContext = createContext<LiveKitContextValue>()

export const LiveKitProvider: ParentComponent = (props) => {
  const [roomName, setRoomName] = createSignal<string | undefined>()
  const [connected, setConnected] = createSignal(false)
  const [manager, setManager] = createSignal<RoomManager | undefined>()

  const connect = async (config: LiveKitConfig) => {
    console.log("[LiveKit] Starting connection with config:", {
      url: config.url,
      roomName: config.roomName,
      hasApiKey: !!config.apiKey,
      hasApiSecret: !!config.apiSecret,
    })

    try {
      // Lazy load RoomManager to avoid loading LiveKit at startup
      const { RoomManager } = await import("@/livekit/room-manager")

      // Create RoomManager with LiveKit config
      const roomManager = new RoomManager({
        serverUrl: config.url,
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
      })
      console.log("[LiveKit] RoomManager created")

      // Set up event listeners
      roomManager.on("connected", () => {
        console.log("[LiveKit] ✅ Connected to room successfully")
        setConnected(true)
      })

      roomManager.on("disconnected", (reason) => {
        console.log("[LiveKit] ❌ Disconnected from room:", reason)
        setConnected(false)
      })

      roomManager.on("participantJoined", (participant) => {
        console.log("[LiveKit] 👤 Participant joined:", participant.name)
      })

      roomManager.on("participantLeft", (participant) => {
        console.log("[LiveKit] 👋 Participant left:", participant.name)
      })

      // Connect to the room
      console.log("[LiveKit] Attempting to connect to room:", config.roomName)
      await roomManager.connect({
        name: config.roomName,
        participantName: "OpenCode User",
      })
      console.log("[LiveKit] Connect call completed")

      setRoomName(config.roomName)
      setManager(roomManager)
      console.log("[LiveKit] State updated, connection process complete")
    } catch (error) {
      console.error("[LiveKit] ❌ Failed to connect - ERROR:", error)
      console.error("[LiveKit] Error details:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }

  const disconnect = async () => {
    const roomManager = manager()
    if (roomManager) {
      await roomManager.disconnect()
      setManager(undefined)
    }
    setRoomName(undefined)
    setConnected(false)
  }

  // Cleanup on unmount
  onCleanup(() => {
    const roomManager = manager()
    if (roomManager) {
      roomManager.disconnect().catch(console.error)
    }
  })

  const value: LiveKitContextValue = {
    roomName,
    isConnected: connected,
    connect,
    disconnect,
    roomManager: manager,
  }

  return <LiveKitContext.Provider value={value}>{props.children}</LiveKitContext.Provider>
}

export function useLiveKit() {
  const ctx = useContext(LiveKitContext)
  if (!ctx) throw new Error("useLiveKit must be used within LiveKitProvider")
  return ctx
}
