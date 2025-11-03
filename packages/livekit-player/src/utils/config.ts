export interface LiveKitConfig {
  url: string
  apiKey: string
  apiSecret: string
  roomName: string
  participantName: string
}

export function getEnvConfig(): LiveKitConfig {
  return {
    url: import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880',
    apiKey: import.meta.env.VITE_LIVEKIT_API_KEY || 'devkey',
    apiSecret: import.meta.env.VITE_LIVEKIT_API_SECRET || 'secret',
    roomName: import.meta.env.VITE_LIVEKIT_ROOM_NAME || 'dev',
    participantName: import.meta.env.VITE_LIVEKIT_PARTICIPANT_NAME || 'player-user'
  }
}
