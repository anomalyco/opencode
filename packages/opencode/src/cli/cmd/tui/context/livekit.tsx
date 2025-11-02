import { createContext, useContext, createSignal, onCleanup, type ParentComponent } from "solid-js"
import { RoomManager } from "@/livekit/room-manager"
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
    try {
      // Create RoomManager with LiveKit config
      const roomManager = new RoomManager({
        serverUrl: config.url,
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
      })

      // Set up event listeners
      roomManager.on("connected", () => {
        console.log("[LiveKit] Connected to room")
        setConnected(true)
      })

      roomManager.on("disconnected", () => {
        console.log("[LiveKit] Disconnected from room")
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

      setRoomName(config.roomName)
      setManager(roomManager)
    } catch (error) {
      console.error("[LiveKit] Failed to connect:", error)
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
