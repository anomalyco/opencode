import { useEffect, useState, useRef } from 'react'
import { Room, RoomEvent, ConnectionState, RemoteParticipant, ConnectionQuality, LocalAudioTrack } from 'livekit-client'
import { Signal, SignalHigh, SignalMedium, SignalLow, SignalZero, Users } from 'lucide-react'
import './ChatIndicator.css'

type AgentState = 'disconnected' | 'connecting' | 'listening' | 'thinking' | 'speaking'

interface ChatIndicatorProps {
  room: Room
  connectionState: ConnectionState
}

export default function ChatIndicator({ room, connectionState }: ChatIndicatorProps) {
  const [agentState, setAgentState] = useState<AgentState>('disconnected')
  const [showListening, setShowListening] = useState(false)
  const [participantCount, setParticipantCount] = useState(0)
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>(ConnectionQuality.Excellent)
  const [remoteParticipant, setRemoteParticipant] = useState<RemoteParticipant | null>(null)
  const listeningBlobRef = useRef<SVGCircleElement>(null)
  const currentRadiusRef = useRef(60)
  const targetRadiusRef = useRef(60)
  const animationFrameRef = useRef<number>()
  const listeningTimeoutRef = useRef<NodeJS.Timeout>()
  const speakingCooldownRef = useRef<NodeJS.Timeout>()
  const wasSpeakingRef = useRef(false)

  // Smooth animation loop for listening blob only
  useEffect(() => {
    const animate = () => {
      if (!listeningBlobRef.current) return

      // Smoothly interpolate current radius toward target radius
      const diff = targetRadiusRef.current - currentRadiusRef.current
      currentRadiusRef.current += diff * 0.15 // Smooth easing

      listeningBlobRef.current.setAttribute('r', currentRadiusRef.current.toFixed(1))
      
      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const updateState = () => {
      if (connectionState === ConnectionState.Disconnected) {
        setAgentState('disconnected')
        setShowListening(false)
        targetRadiusRef.current = 48
        if (listeningTimeoutRef.current) {
          clearTimeout(listeningTimeoutRef.current)
        }
        if (speakingCooldownRef.current) {
          clearTimeout(speakingCooldownRef.current)
        }
      } else if (connectionState === ConnectionState.Connecting || connectionState === ConnectionState.Reconnecting) {
        setAgentState('connecting')
        setShowListening(false)
        targetRadiusRef.current = 63
        if (listeningTimeoutRef.current) {
          clearTimeout(listeningTimeoutRef.current)
        }
        if (speakingCooldownRef.current) {
          clearTimeout(speakingCooldownRef.current)
        }
      } else if (connectionState === ConnectionState.Connected) {
        const remoteParticipants = Array.from(room.remoteParticipants.values())
        
        if (remoteParticipants.length > 0 && !remoteParticipant) {
          setRemoteParticipant(remoteParticipants[0])
        }
        
        const someoneSpeaking = remoteParticipants.some((p: RemoteParticipant) => p.isSpeaking)
        
        if (someoneSpeaking) {
          // Agent is speaking - stay in speaking mode
          wasSpeakingRef.current = true
          setAgentState('speaking')
          setShowListening(true) // Show immediately when speaking
          targetRadiusRef.current = 72
          
          // Clear any pending timeouts
          if (listeningTimeoutRef.current) {
            clearTimeout(listeningTimeoutRef.current)
          }
          if (speakingCooldownRef.current) {
            clearTimeout(speakingCooldownRef.current)
          }
        } else {
          // Agent stopped speaking
          if (wasSpeakingRef.current) {
            // She WAS speaking, wait 2 seconds before switching to listening
            // This handles pauses in her speech
            if (speakingCooldownRef.current) {
              clearTimeout(speakingCooldownRef.current)
            }
            
            speakingCooldownRef.current = setTimeout(() => {
              // After cooldown, switch to listening
              wasSpeakingRef.current = false
              setAgentState('listening')
              setShowListening(false)
              
              // Then wait another 500ms before showing "Listening" text
              if (listeningTimeoutRef.current) {
                clearTimeout(listeningTimeoutRef.current)
              }
              listeningTimeoutRef.current = setTimeout(() => {
                setShowListening(true)
              }, 500)
            }, 2000) // 2 second cooldown after speaking stops
          } else {
            // Already in listening mode
            setAgentState('listening')
            
            // Only show "Listening" text after 500ms delay
            if (listeningTimeoutRef.current) {
              clearTimeout(listeningTimeoutRef.current)
            }
            listeningTimeoutRef.current = setTimeout(() => {
              setShowListening(true)
            }, 500)
          }
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

    // Listen for local audio level changes (YOUR VOICE)
    const handleLocalAudioLevel = (level: number) => {
      // Only react to audio levels when in listening mode
      if (agentState === 'listening') {
        const baseRadius = 60
        const maxBoost = 120 // Huge boost for dramatic effect!
        const boost = Math.pow(level, 0.5) * maxBoost // Power curve for better sensitivity
        targetRadiusRef.current = baseRadius + boost
        
        // Only log significant audio levels to reduce console spam
        if (level > 0.01) {
          console.debug('🎤 Audio level:', level.toFixed(3), '→ radius:', (baseRadius + boost).toFixed(1))
        }
      }
    }

    // Set up audio level monitoring
    const setupAudioMonitoring = () => {
      if (!room.localParticipant?.audioTracks) {
        console.warn('⚠️ audioTracks not available for monitoring')
        return
      }
      
      room.localParticipant.audioTracks.forEach((publication) => {
        const track = publication.track as LocalAudioTrack
        if (track) {
          console.debug('🎧 Setting up audio level listener on track:', publication.trackSid)
          track.on('audioLevelChanged', handleLocalAudioLevel)
        }
      })
    }

    // Try to set up immediately and also after a delay
    setupAudioMonitoring()
    const timeoutId = setTimeout(setupAudioMonitoring, 1500)

    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
    room.on(RoomEvent.ConnectionQualityChanged, handleConnectionQualityChanged)
    room.on(RoomEvent.AudioPlaybackStatusChanged, updateState)
    room.on(RoomEvent.LocalTrackPublished, setupAudioMonitoring)

    const interval = setInterval(updateState, 200)
    
    return () => {
      clearInterval(interval)
      clearTimeout(timeoutId)
      if (listeningTimeoutRef.current) {
        clearTimeout(listeningTimeoutRef.current)
      }
      if (speakingCooldownRef.current) {
        clearTimeout(speakingCooldownRef.current)
      }
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected)
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
      room.off(RoomEvent.ConnectionQualityChanged, handleConnectionQualityChanged)
      room.off(RoomEvent.AudioPlaybackStatusChanged, updateState)
      room.off(RoomEvent.LocalTrackPublished, setupAudioMonitoring)
      
      // Clean up audio level listeners with null check
      if (room.localParticipant?.audioTracks) {
        room.localParticipant.audioTracks.forEach((publication) => {
          const track = publication.track as LocalAudioTrack
          if (track) {
            track.off('audioLevelChanged', handleLocalAudioLevel)
          }
        })
      }
    }
  }, [room, connectionState, remoteParticipant, agentState])

  const getStatusMessage = () => {
    switch (agentState) {
      case 'disconnected':
        return 'Disconnected'
      case 'connecting':
        return 'Connecting...'
      case 'listening':
        return showListening ? 'Listening' : ''
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
        {/* Ferrofluid SVG Blob */}
        <div className="blob-container">
          <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="blob-svg">
            <defs>
              {/* Gooey filter for blob merging effect */}
              <filter id="goo">
                <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
                <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8" result="goo" />
                <feBlend in="SourceGraphic" in2="goo" />
              </filter>
              
              {/* Specular metallic shine */}
              <radialGradient id="shine" cx="30%" cy="30%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.9)" />
                <stop offset="30%" stopColor="rgba(255,255,255,0.4)" />
                <stop offset="70%" stopColor="rgba(255,255,255,0.1)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>
            </defs>
            
            {/* LISTENING - Green */}
            <g filter="url(#goo)" className={`blob-group listening ${agentState === 'listening' ? 'active' : 'hidden'}`}>
              <circle ref={listeningBlobRef} className="blob-main" cx="100" cy="100" r="60" fill="#4ade80" />
              <circle className="blob-orb blob-orb-1" cx="100" cy="100" r="25" fill="#4ade80" />
              <circle className="blob-orb blob-orb-2" cx="100" cy="100" r="20" fill="#4ade80" />
              <circle className="blob-orb blob-orb-3" cx="100" cy="100" r="18" fill="#4ade80" />
              <circle className="blob-orb blob-orb-4" cx="100" cy="100" r="15" fill="#4ade80" />
            </g>
            
            {/* SPEAKING - Purple */}
            <g filter="url(#goo)" className={`blob-group speaking ${agentState === 'speaking' ? 'active' : 'hidden'}`}>
              <circle className="blob-main" cx="100" cy="100" r="72" fill="#a78bfa" />
              <circle className="blob-orb blob-orb-1" cx="100" cy="100" r="25" fill="#a78bfa" />
              <circle className="blob-orb blob-orb-2" cx="100" cy="100" r="20" fill="#a78bfa" />
              <circle className="blob-orb blob-orb-3" cx="100" cy="100" r="18" fill="#a78bfa" />
              <circle className="blob-orb blob-orb-4" cx="100" cy="100" r="15" fill="#a78bfa" />
            </g>
            
            {/* THINKING - Blue */}
            <g filter="url(#goo)" className={`blob-group thinking ${agentState === 'thinking' ? 'active' : 'hidden'}`}>
              <circle className="blob-main" cx="100" cy="100" r="66" fill="#60a5fa" />
              <circle className="blob-orb blob-orb-1" cx="100" cy="100" r="25" fill="#60a5fa" />
              <circle className="blob-orb blob-orb-2" cx="100" cy="100" r="20" fill="#60a5fa" />
              <circle className="blob-orb blob-orb-3" cx="100" cy="100" r="18" fill="#60a5fa" />
              <circle className="blob-orb blob-orb-4" cx="100" cy="100" r="15" fill="#60a5fa" />
            </g>
            
            {/* CONNECTING - Yellow */}
            <g filter="url(#goo)" className={`blob-group connecting ${agentState === 'connecting' ? 'active' : 'hidden'}`}>
              <circle className="blob-main" cx="100" cy="100" r="63" fill="#fbbf24" />
              <circle className="blob-orb blob-orb-1" cx="100" cy="100" r="25" fill="#fbbf24" />
              <circle className="blob-orb blob-orb-2" cx="100" cy="100" r="20" fill="#fbbf24" />
              <circle className="blob-orb blob-orb-3" cx="100" cy="100" r="18" fill="#fbbf24" />
              <circle className="blob-orb blob-orb-4" cx="100" cy="100" r="15" fill="#fbbf24" />
            </g>
            
            {/* DISCONNECTED - Gray */}
            <g filter="url(#goo)" className={`blob-group disconnected ${agentState === 'disconnected' ? 'active' : 'hidden'}`}>
              <circle className="blob-main" cx="100" cy="100" r="48" fill="#666666" />
              <circle className="blob-orb blob-orb-1" cx="100" cy="100" r="25" fill="#666666" />
              <circle className="blob-orb blob-orb-2" cx="100" cy="100" r="20" fill="#666666" />
              <circle className="blob-orb blob-orb-3" cx="100" cy="100" r="18" fill="#666666" />
              <circle className="blob-orb blob-orb-4" cx="100" cy="100" r="15" fill="#666666" />
            </g>
            
            {/* Metallic shine overlay */}
            <ellipse
              className="blob-shine"
              cx="80"
              cy="80"
              rx="40"
              ry="35"
              fill="url(#shine)"
              opacity="0.6"
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
