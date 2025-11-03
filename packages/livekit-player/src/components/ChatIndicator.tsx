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
        return '#666666'
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

  const getGradientId = () => {
    return `gradient-${agentState}`
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
      {/* SVG Filters and Gradients for ferrofluid effect */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          {/* Metallic shine */}
          <filter id="metallic">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 25 -10" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop"/>
          </filter>

          {/* 3D Metallic Gradient for listening (green) */}
          <radialGradient id="gradient-listening" cx="30%" cy="30%">
            <stop offset="0%" stopColor="#a7f3d0" stopOpacity="1" />
            <stop offset="30%" stopColor="#6ee7b7" stopOpacity="1" />
            <stop offset="60%" stopColor="#34d399" stopOpacity="1" />
            <stop offset="100%" stopColor="#059669" stopOpacity="1" />
          </radialGradient>

          {/* 3D Metallic Gradient for thinking (blue) */}
          <radialGradient id="gradient-thinking" cx="30%" cy="30%">
            <stop offset="0%" stopColor="#bfdbfe" stopOpacity="1" />
            <stop offset="30%" stopColor="#93c5fd" stopOpacity="1" />
            <stop offset="60%" stopColor="#3b82f6" stopOpacity="1" />
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="1" />
          </radialGradient>

          {/* 3D Metallic Gradient for speaking (purple) */}
          <radialGradient id="gradient-speaking" cx="30%" cy="30%">
            <stop offset="0%" stopColor="#e9d5ff" stopOpacity="1" />
            <stop offset="30%" stopColor="#c4b5fd" stopOpacity="1" />
            <stop offset="60%" stopColor="#8b5cf6" stopOpacity="1" />
            <stop offset="100%" stopColor="#6d28d9" stopOpacity="1" />
          </radialGradient>

          {/* 3D Metallic Gradient for connecting (yellow) */}
          <radialGradient id="gradient-connecting" cx="30%" cy="30%">
            <stop offset="0%" stopColor="#fef3c7" stopOpacity="1" />
            <stop offset="30%" stopColor="#fde68a" stopOpacity="1" />
            <stop offset="60%" stopColor="#f59e0b" stopOpacity="1" />
            <stop offset="100%" stopColor="#d97706" stopOpacity="1" />
          </radialGradient>

          {/* 3D Metallic Gradient for disconnected (gray) */}
          <radialGradient id="gradient-disconnected" cx="30%" cy="30%">
            <stop offset="0%" stopColor="#d1d5db" stopOpacity="1" />
            <stop offset="30%" stopColor="#9ca3af" stopOpacity="1" />
            <stop offset="60%" stopColor="#6b7280" stopOpacity="1" />
            <stop offset="100%" stopColor="#374151" stopOpacity="1" />
          </radialGradient>

          {/* Specular metallic shine */}
          <radialGradient id="shine" cx="25%" cy="25%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.9)" />
            <stop offset="30%" stopColor="rgba(255,255,255,0.4)" />
            <stop offset="70%" stopColor="rgba(255,255,255,0.1)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>
      </svg>

      <div className="status-container">
        {/* Ferrofluid SVG Blob */}
        <div className="blob-container">
          <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="blob-svg">
            {/* Main ferrofluid blob with metallic gradient */}
            <path 
              className={`blob-path ${agentState}`}
              fill={`url(#${getGradientId()})`}
              d="M100,20 C120,20 140,25 155,40 C170,55 180,75 180,100 C180,125 170,145 155,160 C140,175 120,180 100,180 C80,180 60,175 45,160 C30,145 20,125 20,100 C20,75 30,55 45,40 C60,25 80,20 100,20 Z" 
            />
            {/* Metallic shine overlay */}
            <ellipse
              className="blob-shine"
              cx="70"
              cy="60"
              rx="50"
              ry="40"
              fill="url(#shine)"
              opacity="0.8"
            />
          </svg>
          <div className="blob-glow" style={{ backgroundColor: getStatusColor() }} />
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
