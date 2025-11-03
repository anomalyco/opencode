import { useEffect, useState } from 'react'
import { Room, RoomEvent, ConnectionState, RemoteParticipant, ConnectionQuality } from 'livekit-client'
import { Signal, SignalHigh, SignalMedium, SignalLow, SignalZero, Users } from 'lucide-react'
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

  useEffect(() => {
    const updateState = () => {
      if (connectionState === ConnectionState.Disconnected) {
        setAgentState('disconnected')
      } else if (connectionState === ConnectionState.Connecting || connectionState === ConnectionState.Reconnecting) {
        setAgentState('connecting')
      } else if (connectionState === ConnectionState.Connected) {
        const remoteParticipants = Array.from(room.remoteParticipants.values())
        
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

    const interval = setInterval(updateState, 200)
    
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
        return 'Listening'
      case 'thinking':
        return 'Processing'
      case 'speaking':
        return 'Speaking'
    }
  }

  const getStatusColor = () => {
    switch (agentState) {
      case 'disconnected':
        return '#666'
      case 'connecting':
        return '#fbbf24'
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
        return <SignalHigh size={14} />
      case ConnectionQuality.Good:
        return <SignalMedium size={14} />
      case ConnectionQuality.Poor:
        return <SignalLow size={14} />
      case ConnectionQuality.Lost:
        return <SignalZero size={14} />
      default:
        return <Signal size={14} />
    }
  }

  const getQualityColor = () => {
    switch (connectionQuality) {
      case ConnectionQuality.Excellent:
        return '#4ade80'
      case ConnectionQuality.Good:
        return '#fbbf24'
      case ConnectionQuality.Poor:
        return '#fb7185'
      case ConnectionQuality.Lost:
        return '#666'
      default:
        return '#888'
    }
  }

  const getQualityLabel = () => {
    switch (connectionQuality) {
      case ConnectionQuality.Excellent:
        return 'Excellent'
      case ConnectionQuality.Good:
        return 'Good'
      case ConnectionQuality.Poor:
        return 'Poor'
      case ConnectionQuality.Lost:
        return 'Lost'
      default:
        return 'Unknown'
    }
  }

  return (
    <div className="chat-indicator">
      <div className="status-container">
        {/* Single unified orb that changes color */}
        <div className="status-orb-wrapper">
          <div 
            className={`status-orb ${agentState}`}
            style={{ backgroundColor: getStatusColor() }}
          >
            <div className="pulse-ring" style={{ borderColor: getStatusColor() }} />
          </div>
        </div>

        {/* Status text */}
        <div className="status-text">{getStatusMessage()}</div>
        
        {/* Connection info */}
        <div className="connection-info">
          <div className="info-row">
            <span className="info-label">Room</span>
            <span className="info-value">{room?.name || 'N/A'}</span>
          </div>
          <div className="info-row">
            <Users size={14} className="info-icon" />
            <span className="info-value">{participantCount}</span>
          </div>
          <div className="info-row" style={{ color: getQualityColor() }}>
            {getQualityIcon()}
            <span className="info-value">{getQualityLabel()}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
