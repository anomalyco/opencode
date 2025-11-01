import { createContext, useContext, createSignal, onCleanup, type ParentComponent } from "solid-js"
import { Room, RoomEvent, ConnectionState } from "livekit-client"

export interface LiveKitConfig {
  serverUrl: string
  apiKey: string
  apiSecret: string
}

interface LiveKitContextValue {
  room: () => Room | undefined
  isConnected: () => boolean
  connect: (roomName: string, participantName: string) => Promise<void>
  disconnect: () => Promise<void>
  enableMicrophone: () => Promise<void>
  disableMicrophone: () => Promise<void>
  isMicrophoneEnabled: () => boolean
}

const LiveKitContext = createContext<LiveKitContextValue>()

export function useLiveKit() {
  const ctx = useContext(LiveKitContext)
  if (!ctx) {
    throw new Error("useLiveKit must be used within LiveKitProvider")
  }
  return ctx
}

interface LiveKitProviderProps {
  config?: LiveKitConfig
}

export const LiveKitProvider: ParentComponent<LiveKitProviderProps> = (props) => {
  const [room, setRoom] = createSignal<Room>()
  const [isConnected, setIsConnected] = createSignal(false)
  const [isMicrophoneEnabled, setIsMicrophoneEnabled] = createSignal(false)

  const generateToken = async (roomName: string, participantName: string): Promise<string> => {
    if (!props.config) {
      throw new Error("LiveKit config not provided")
    }

    // In browser context, we need to call a backend endpoint to generate token
    // For now, we'll assume the token is generated server-side
    const response = await fetch("/api/livekit/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomName,
        participantName,
      }),
    })

    if (!response.ok) {
      throw new Error("Failed to generate LiveKit token")
    }

    const data = await response.json()
    return data.token
  }

  const connect = async (roomName: string, participantName: string) => {
    if (!props.config) {
      throw new Error("LiveKit config not provided")
    }

    const token = await generateToken(roomName, participantName)
    const newRoom = new Room()

    newRoom.on(RoomEvent.Connected, () => {
      setIsConnected(true)
    })

    newRoom.on(RoomEvent.Disconnected, () => {
      setIsConnected(false)
      setIsMicrophoneEnabled(false)
    })

    await newRoom.connect(props.config.serverUrl, token)
    setRoom(newRoom)
  }

  const disconnect = async () => {
    const currentRoom = room()
    if (currentRoom) {
      await currentRoom.disconnect()
      setRoom(undefined)
      setIsConnected(false)
      setIsMicrophoneEnabled(false)
    }
  }

  const enableMicrophone = async () => {
    const currentRoom = room()
    if (!currentRoom) return

    await currentRoom.localParticipant.setMicrophoneEnabled(true)
    setIsMicrophoneEnabled(true)
  }

  const disableMicrophone = async () => {
    const currentRoom = room()
    if (!currentRoom) return

    await currentRoom.localParticipant.setMicrophoneEnabled(false)
    setIsMicrophoneEnabled(false)
  }

  onCleanup(async () => {
    await disconnect()
  })

  const value: LiveKitContextValue = {
    room,
    isConnected,
    connect,
    disconnect,
    enableMicrophone,
    disableMicrophone,
    isMicrophoneEnabled,
  }

  return <LiveKitContext.Provider value={value}>{props.children}</LiveKitContext.Provider>
}
