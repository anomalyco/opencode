import {
  createContext,
  useContext,
  createSignal,
  onCleanup,
  batch,
  type ParentComponent,
} from "solid-js"
import type { RoomManager } from "@/livekit/room-manager"

// Local interface for connection config (combines server config + room name)
interface LiveKitConfig {
  url: string
  apiKey: string
  apiSecret: string
  roomName: string
}

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
    try {
      // Lazy load RoomManager to avoid loading LiveKit at startup
      const { RoomManager } = await import("@/livekit/room-manager")

      // Create RoomManager with LiveKit config
      const roomManager = new RoomManager({
        serverUrl: config.url,
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
      })

      // Set up event listeners
      roomManager.on("connected", () => {
        console.log("[LiveKit] Connected to room:", config.roomName)
        setConnected(true)
      })

      roomManager.on("disconnected", (reason) => {
        console.log("[LiveKit] Disconnected:", reason)
        setConnected(false)
      })

      roomManager.on("participantJoined", (participant) => {
        console.log("[LiveKit] Participant joined:", participant.name)
      })

      roomManager.on("participantLeft", (participant) => {
        console.log("[LiveKit] Participant left:", participant.name)
      })

      // Connect to the room
      await roomManager.connect({
        name: config.roomName,
        participantName: "OpenCode User",
      })

      // Batch signal updates to prevent multiple re-renders
      batch(() => {
        setRoomName(config.roomName)
        setManager(roomManager)
      })
    } catch (error) {
      console.error(
        "[LiveKit] Connection failed:",
        error instanceof Error ? error.message : String(error),
      )
      throw error
    }
  }

  const disconnect = async () => {
    const roomManager = manager()
    if (roomManager) {
      await roomManager.disconnect()
    }

    // Batch signal updates to prevent multiple re-renders
    batch(() => {
      setManager(undefined)
      setRoomName(undefined)
      setConnected(false)
    })
  }

  // Cleanup on unmount
  onCleanup(() => {
    const roomManager = manager()
    if (roomManager) {
      roomManager.disconnect().catch(console.error)
    }
  })

  // Memoize context value to prevent re-renders when signals change
  // Only recreate if the actual functions change (which they never do)
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
