import { useEffect, useState } from 'react'
import { Room, RoomEvent, ConnectionState, RemoteParticipant, ConnectionQuality } from 'livekit-client'
import { AudioVisualizer, BarVisualizer, useIsSpeaking } from '@livekit/components-react'
import '@livekit/components-styles'
import './ChatIndicator.css'

type AgentState = 'disconnected' | 'connecting' | 'listening' | 'thinking' | 'speaking'

interface ChatIndicatorProps {
  room: Room
  connectionState: ConnectionState
}

export default function ChatIndicator({ room, connectionState }: ChatIndicatorProps) {
  const [agentState, setAgentState] = useState<AgentState>('disconnected')
  const [participantCount, setParticipantCount] = useState(0)
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>(ConnectionQuality.Excellent)
  const [remoteParticipant, setRemoteParticipant] = useState<RemoteParticipant | null>(null)

  // Get speaking state from local and remote participants
  const localIsSpeaking = room.localParticipant?.isSpeaking ?? false
  const remoteIsSpeaking = remoteParticipant?.isSpeaking ?? false

  useEffect(() => {
    const updateState = () => {
      if (connectionState === ConnectionState.Disconnected) {
        setAgentState('disconnected')
      } else if (connectionState === ConnectionState.Connecting || connectionState === ConnectionState.Reconnecting) {
        setAgentState('connecting')
      } else if (connectionState === ConnectionState.Connected) {
        const remoteParticipants = Array.from(room.remoteParticipants.values())
        
        // Track first remote participant (agent)
        if (remoteParticipants.length > 0 && !remoteParticipant) {
          setRemoteParticipant(remoteParticipants[0])
        }
        
        const someoneSpeaking = remoteParticipants.some((p: RemoteParticipant) => p.isSpeaking)
        const localSpeaking = room.localParticipant?.isSpeaking ?? false
        
        if (someoneSpeaking) {
          setAgentState('speaking')
        } else if (localSpeaking) {
          setAgentState('thinking')
        } else {
          setAgentState('listening')
        }
        
        setParticipantCount(remoteParticipants.length + 1)
      }
    }

    updateState()

    const handleConnectionQualityChanged = (quality: ConnectionQuality) => {
      console.log('📶 Connection quality:', quality)
      setConnectionQuality(quality)
    }

    const handleParticipantConnected = (participant: RemoteParticipant) => {
      if (!remoteParticipant) {
        setRemoteParticipant(participant)
      }
      updateState()
    }

    const handleParticipantDisconnected = (participant: RemoteParticipant) => {
      if (remoteParticipant?.identity === participant.identity) {
        setRemoteParticipant(null)
      }
      updateState()
    }

    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
    room.on(RoomEvent.ConnectionQualityChanged, handleConnectionQualityChanged)

    const interval = setInterval(updateState, 100)
    
    return () => {
      clearInterval(interval)
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected)
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
      room.off(RoomEvent.ConnectionQualityChanged, handleConnectionQualityChanged)
    }
  }, [room, connectionState, remoteParticipant])

  const getStatusMessage = () => {
    switch (agentState) {
      case 'disconnected':
        return 'Disconnected'
      case 'connecting':
        return 'Connecting...'
      case 'listening':
        return 'Listening...'
      case 'thinking':
        return 'Processing...'
      case 'speaking':
        return 'Speaking...'
    }
  }

  const getStatusColor = () => {
    switch (agentState) {
      case 'disconnected':
        return '#666'
      case 'connecting':
        return '#ffa500'
      case 'listening':
        return '#4ade80'
      case 'thinking':
        return '#60a5fa'
      case 'speaking':
        return '#a78bfa'
    }
  }

  const getQualityIcon = () => {
    switch (connectionQuality) {
      case ConnectionQuality.Excellent:
        return '📶'
      case ConnectionQuality.Good:
        return '📶'
      case ConnectionQuality.Poor:
        return '📉'
      case ConnectionQuality.Lost:
        return '❌'
      default:
        return '📶'
    }
  }

  const getQualityColor = () => {
    switch (connectionQuality) {
      case ConnectionQuality.Excellent:
        return '#4ade80'
      case ConnectionQuality.Good:
        return '#ffa500'
      case ConnectionQuality.Poor:
        return '#ff6b6b'
      case ConnectionQuality.Lost:
        return '#666'
      default:
        return '#666'
    }
  }

  // Get audio tracks for visualization
  const localAudioTrack = room.localParticipant?.getTrackPublication('microphone')?.track
  const remoteAudioTrack = remoteParticipant?.getTrackPublication('microphone')?.track

  return (
    <div className="chat-indicator">
      <div className="status-container">
        {/* Main status orb with speaking ring */}
        <div className="status-orb-container">
          <div 
            className={`status-orb ${agentState === 'speaking' ? 'speaking' : ''} ${agentState === 'thinking' ? 'thinking' : ''}`}
            style={{ backgroundColor: getStatusColor() }}
          >
            {agentState === 'speaking' && (
              <div className="pulse-ring" style={{ borderColor: getStatusColor() }} />
            )}
          </div>
        </div>

        {/* Status text */}
        <div className="status-text">{getStatusMessage()}</div>
        
        {/* Audio visualizers */}
        {agentState === 'speaking' && remoteAudioTrack && (
          <div className="audio-visualizer">
            <BarVisualizer 
              state="show-bars"
              trackRef={{ 
                participant: remoteParticipant!,
                source: 'microphone'
              }}
              barCount={8}
              options={{
                minHeight: 4,
                maxHeight: 60,
              }}
            />
          </div>
        )}

        {agentState === 'thinking' && localAudioTrack && (
          <div className="audio-visualizer local">
            <BarVisualizer 
              state="show-bars"
              trackRef={{ 
                participant: room.localParticipant,
                source: 'microphone'
              }}
              barCount={6}
              options={{
                minHeight: 4,
                maxHeight: 40,
              }}
            />
          </div>
        )}
        
        {/* Connection info */}
        <div className="connection-info">
          <div>Room: {room?.name || 'N/A'}</div>
          <div>Participants: {participantCount}</div>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '5px',
            color: getQualityColor()
          }}>
            <span>{getQualityIcon()}</span>
            <span>{ConnectionQuality[connectionQuality]}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
