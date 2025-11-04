import React from 'react'
import { useEffect, useState, useRef } from 'react'
import { Room, RoomEvent, ConnectionState, RemoteParticipant, ConnectionQuality, RemoteAudioTrack, Track } from 'livekit-client'
import { Signal, SignalHigh, SignalMedium, SignalLow, SignalZero, Users } from 'lucide-react'
import './ChatIndicator.css'

type AgentState = 'disconnected' | 'connecting' | 'listening' | 'speaking'

interface ChatIndicatorProps {
  room: Room
  connectionState: ConnectionState
}

export default function ChatIndicator({ room, connectionState }: ChatIndicatorProps) {
  const [showBorder, setShowBorder] = useState(() => localStorage.getItem("hal-show-border") !== "false")
  const [showBlobOutline, setShowBlobOutline] = useState(() => localStorage.getItem("blob-show-outline") === "true")
  const [showGlow, setShowGlow] = useState(() => localStorage.getItem("show-glow") !== "false")
  const [agentState, setAgentState] = useState<AgentState>('disconnected')
  const [participantCount, setParticipantCount] = useState(0)
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>(ConnectionQuality.Excellent)
  const [, forceUpdate] = useState(0)
  
  // Agent (remote) audio bands - PURPLE
  const agentBandsRef = useRef<number[]>([0, 0, 0, 0])
  const agentAudioContextRef = useRef<AudioContext | null>(null)
  const agentAnimationFrameRef = useRef<number>()
  
  // User (local mic) audio bands - GREEN
  const userBandsRef = useRef<number[]>([0, 0, 0, 0])
  const userAudioContextRef = useRef<AudioContext | null>(null)
  const userAnimationFrameRef = useRef<number>()
  
  const renderAnimationFrameRef = useRef<number>()


  // Widget overlay state
  const [activeWidget, setActiveWidget] = useState<{gridIndex: number} | null>(null)
  const [widgetSizes, setWidgetSizes] = useState<Record<number, {width: number, height: number}>>(() => {
    const saved = localStorage.getItem('widget-sizes')
    return saved ? JSON.parse(saved) : {}
  })
  const [resizing, setResizing] = useState<{handle: string, startX: number, startY: number, startWidth: number, startHeight: number} | null>(null)

  // Camera refs
  const cameraVideoRef = useRef<HTMLVideoElement>(null)
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null)
  const [showCamera, setShowCamera] = useState(true)


  // Resize handlers
  const handleResizeStart = (e: React.MouseEvent<HTMLDivElement>, handle: string) => {
    if (!activeWidget) return
    e.stopPropagation()
    const size = widgetSizes[activeWidget.gridIndex] || {width: 1, height: 1}
    setResizing({
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: size.width,
      startHeight: size.height
    })
  }
  useEffect(() => {
    if (!resizing || !activeWidget) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizing.startX
      const deltaY = e.clientY - resizing.startY
      
      let newWidth = resizing.startWidth
      let newHeight = resizing.startHeight
      let newGridIndex = activeWidget.gridIndex

      const cols = Math.floor(window.innerWidth / 160)

      if (resizing.handle === 'right') {
        const gridDelta = Math.round(deltaX / 160)
        newWidth = Math.max(1, resizing.startWidth + gridDelta)
      } else if (resizing.handle === 'bottom') {
        const gridDelta = Math.round(deltaY / 160)
        newHeight = Math.max(1, resizing.startHeight + gridDelta)
      } else if (resizing.handle === 'left') {
        const gridDelta = Math.round(deltaX / 160)
        if (gridDelta !== 0) {
          newWidth = Math.max(1, resizing.startWidth - gridDelta)
          // Move gridIndex left by gridDelta
          const currentX = activeWidget.gridIndex % cols
          const currentY = Math.floor(activeWidget.gridIndex / cols)
          const newX = Math.max(0, currentX + gridDelta)
          newGridIndex = newX + currentY * cols
        }
      } else if (resizing.handle === 'top') {
        const gridDelta = Math.round(deltaY / 160)
        if (gridDelta !== 0) {
          newHeight = Math.max(1, resizing.startHeight - gridDelta)
          // Move gridIndex up by gridDelta rows
          const currentX = activeWidget.gridIndex % cols
          const currentY = Math.floor(activeWidget.gridIndex / cols)
          const newY = Math.max(0, currentY + gridDelta)
          newGridIndex = currentX + newY * cols
        }
      }

      // If gridIndex changed, need to move the widget
      if (newGridIndex !== activeWidget.gridIndex) {
        const oldSizes = { ...widgetSizes }
        delete oldSizes[activeWidget.gridIndex]
        oldSizes[newGridIndex] = { width: newWidth, height: newHeight }
        setWidgetSizes(oldSizes)
        setActiveWidget({ gridIndex: newGridIndex })
        localStorage.setItem('widget-sizes', JSON.stringify(oldSizes))
      } else {
        const newSizes = { ...widgetSizes, [activeWidget.gridIndex]: { width: newWidth, height: newHeight } }
        setWidgetSizes(newSizes)
        localStorage.setItem('widget-sizes', JSON.stringify(newSizes))
      }
    }

    const handleMouseUp = () => {
      setResizing(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [resizing, activeWidget, widgetSizes])
  // Force re-renders for animation

  // Keyboard shortcut to toggle HAL border (Cmd+B)

  // Keyboard shortcut to toggle blob outline (Cmd+Shift+B)
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'b') {
        e.preventDefault()
        setShowBlobOutline(prev => {
          const newValue = !prev
          localStorage.setItem('blob-show-outline', String(newValue))
          return newValue
        })
      }
    }
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [])
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setShowBorder(prev => {
          const newValue = !prev
          localStorage.setItem("hal-show-border", String(newValue))
          return newValue
        })
      }
    }
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [])
  useEffect(() => {
    const animate = () => {
      forceUpdate(n => n + 1)
      renderAnimationFrameRef.current = requestAnimationFrame(animate)
    }
    animate()
    
    return () => {
      if (renderAnimationFrameRef.current) {
        cancelAnimationFrame(renderAnimationFrameRef.current)
      }
    }
  }, [])

  // Camera setup
  useEffect(() => {
    if (!showCamera || connectionState !== ConnectionState.Connected) return
    
    let animationId: number
    let stream: MediaStream | null = null
    
    navigator.mediaDevices.getUserMedia({ 
      video: { 
        width: { ideal: 1280 }, 
        height: { ideal: 720 },
        facingMode: "user"
      } 
    })
      .then(mediaStream => {
        stream = mediaStream
        const video = cameraVideoRef.current
        const canvas = cameraCanvasRef.current
        if (!video || !canvas) return
        
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        
        video.srcObject = stream
        video.play()
        
        const drawFrame = () => {
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            const size = 400
            const radius = size / 2
            
            ctx.clearRect(0, 0, size, size)
            ctx.save()
            
            ctx.beginPath()
            ctx.arc(radius, radius, radius * 0.85, 0, Math.PI * 2)
            ctx.closePath()
            ctx.clip()
            
            const vw = video.videoWidth
            const vh = video.videoHeight
            const cropSize = Math.min(vw, vh)
            const cropX = (vw - cropSize) / 2
            const cropY = (vh - cropSize) / 2
            
            ctx.translate(size, 0)
            ctx.scale(-1, 1)
            
            ctx.drawImage(video, cropX, cropY, cropSize, cropSize, 0, 0, size, size)
            
            ctx.restore()
          }
          animationId = requestAnimationFrame(drawFrame)
        }
        
        drawFrame()
      })
      .catch(err => console.error('[Camera] Error:', err))
    
    return () => {
      if (animationId) cancelAnimationFrame(animationId)
      if (stream) stream.getTracks().forEach(track => track.stop())
    }
  }, [showCamera, connectionState])

  // Setup local microphone audio monitoring - GREEN
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) {
      return
    }
    
    // Get local microphone audio
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        console.log('🎤 Got user microphone access')
        
        // Clean up old context
        if (userAudioContextRef.current) {
          userAudioContextRef.current.close()
        }
        if (userAnimationFrameRef.current) {
          cancelAnimationFrame(userAnimationFrameRef.current)
        }
        
        const audioContext = new AudioContext()
        const analyser = audioContext.createAnalyser()
        const source = audioContext.createMediaStreamSource(stream)
        
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.6
        source.connect(analyser)
        
        userAudioContextRef.current = audioContext
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount)
        
        const analyze = () => {
          analyser.getByteFrequencyData(dataArray)
          
          const bandSize = Math.floor(dataArray.length / 4)
          const bands: number[] = []
          
          for (let i = 0; i < 4; i++) {
            const start = i * bandSize
            const end = start + bandSize
            const bandData = dataArray.slice(start, end)
            const average = bandData.reduce((a, b) => a + b, 0) / bandData.length
            bands.push(average / 255)
          }
          
          userBandsRef.current = bands
          
          userAnimationFrameRef.current = requestAnimationFrame(analyze)
        }
        
        analyze()
      })
      .catch(err => {
        console.error('Failed to get microphone access:', err)
      })
    
    return () => {
      if (userAnimationFrameRef.current) {
        cancelAnimationFrame(userAnimationFrameRef.current)
      }
      if (userAudioContextRef.current) {
        userAudioContextRef.current.close()
      }
    }
  }, [connectionState])

  // Setup agent audio monitoring - PURPLE
  useEffect(() => {
    if (connectionState === ConnectionState.Disconnected) {
      setAgentState('disconnected')
      return
    }
    
    if (connectionState === ConnectionState.Connecting || connectionState === ConnectionState.Reconnecting) {
      setAgentState('connecting')
      return
    }
    
    if (connectionState !== ConnectionState.Connected || !room) {
      return
    }
    
    setAgentState('speaking')
    
    const setupAgentAudio = (track: Track) => {
      console.log('🎧 Setting up agent audio monitoring', track.sid)
      
      const audioTrack = track as RemoteAudioTrack
      const mediaStreamTrack = audioTrack.mediaStreamTrack
      
      if (!mediaStreamTrack) {
        console.warn('⚠️ No mediaStreamTrack available')
        return
      }
      
      // Clean up old context
      if (agentAudioContextRef.current) {
        agentAudioContextRef.current.close()
      }
      if (agentAnimationFrameRef.current) {
        cancelAnimationFrame(agentAnimationFrameRef.current)
      }
      
      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      const stream = new MediaStream([mediaStreamTrack])
      const source = audioContext.createMediaStreamSource(stream)
      
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      
      agentAudioContextRef.current = audioContext
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      
      const analyze = () => {
        analyser.getByteFrequencyData(dataArray)
        
        const bandSize = Math.floor(dataArray.length / 4)
        const bands: number[] = []
        
        for (let i = 0; i < 4; i++) {
          const start = i * bandSize
          const end = start + bandSize
          const bandData = dataArray.slice(start, end)
          const average = bandData.reduce((a, b) => a + b, 0) / bandData.length
          bands.push(average / 255)
        }
        
        agentBandsRef.current = bands
        
        agentAnimationFrameRef.current = requestAnimationFrame(analyze)
      }
      
      analyze()
      console.log('✅ Agent audio monitoring started')
    }
    
    const handleTrackSubscribed = (track: Track, publication: any, participant: RemoteParticipant) => {
      console.log('📥 Track subscribed:', track.kind, track.sid)
      if (track.kind !== Track.Kind.Audio) return
      setupAgentAudio(track)
    }
    
    // Check for existing remote audio tracks
    room.remoteParticipants.forEach((participant) => {
      console.log('👤 Checking participant:', participant.identity)
      participant.trackPublications.forEach((publication) => {
        if (publication.track && publication.track.kind === Track.Kind.Audio) {
          console.log('🔊 Found existing audio track')
          setupAgentAudio(publication.track)
        }
      })
    })
    
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    
    return () => {
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed)
      if (agentAnimationFrameRef.current) {
        cancelAnimationFrame(agentAnimationFrameRef.current)
      }
      if (agentAudioContextRef.current) {
        agentAudioContextRef.current.close()
      }
    }
  }, [room, connectionState])

  // Update participant count
  useEffect(() => {
    if (connectionState === ConnectionState.Connected && room?.remoteParticipants) {
      const count = Array.from(room.remoteParticipants.values()).length + 1
      setParticipantCount(count)
    }
  }, [room, connectionState])

  // Agent (purple) calculations
  const agentBands = agentBandsRef.current
  const agentAvgIntensity = agentBands.reduce((a, b) => a + b, 0) / agentBands.length
  const agentBaseRadius = 50
  const agentRadiusPulse = Math.pow(agentAvgIntensity, 0.5) * 18
  const agentRadius = agentBaseRadius + agentRadiusPulse

  // User (green) calculations
  const userBands = userBandsRef.current
  const userAvgIntensity = userBands.reduce((a, b) => a + b, 0) / userBands.length
  const userBaseRadius = 50
  const userRadiusPulse = Math.pow(userAvgIntensity, 0.5) * 18
  const userRadius = userBaseRadius + userRadiusPulse

  const getOrbPosition = (index: number, bandLevel: number) => {
    if (bandLevel < 0.005) {
      return { x: 100, y: 100, scale: 1 }
    }
    
    const intensity = Math.pow(bandLevel, 0.3) * 60
    const baseAngle = (index / 4) * Math.PI * 2
    const angleVariation = bandLevel * 8
    const angle = baseAngle + Math.sin(Date.now() / 500 + index) * angleVariation
    
    return {
      x: 100 + Math.cos(angle) * intensity,
      y: 100 + Math.sin(angle) * intensity,
      scale: 1 + bandLevel * 0.6
    }
  }

  // Agent orb positions
  const agentOrb1 = getOrbPosition(0, agentBands[0] || 0)
  const agentOrb2 = getOrbPosition(1, agentBands[1] || 0)
  const agentOrb3 = getOrbPosition(2, agentBands[2] || 0)
  const agentOrb4 = getOrbPosition(3, agentBands[3] || 0)

  // User orb positions
  const userOrb1 = getOrbPosition(0, userBands[0] || 0)
  const userOrb2 = getOrbPosition(1, userBands[1] || 0)
  const userOrb3 = getOrbPosition(2, userBands[2] || 0)
  const userOrb4 = getOrbPosition(3, userBands[3] || 0)

  const getQualityIcon = () => {
    switch (connectionQuality) {
      case ConnectionQuality.Excellent: return <SignalHigh size={14} />
      case ConnectionQuality.Good: return <SignalMedium size={14} />
      case ConnectionQuality.Poor: return <SignalLow size={14} />
      case ConnectionQuality.Lost: return <SignalZero size={14} />
      default: return <Signal size={14} />
    }
  }

  const getQualityColor = () => {
    switch (connectionQuality) {
      case ConnectionQuality.Excellent: return '#3b82f6'
      case ConnectionQuality.Good: return '#fbbf24'
      case ConnectionQuality.Poor: return '#fb7185'
      case ConnectionQuality.Lost: return '#666'
      default: return '#888'
    }
  }

  // HAL 9000 eye calculations - scales with agent audio
  const halScale = 1 // + (agentAvgIntensity * 0.3)
  const halGlow = agentAvgIntensity * 90
  const halOpacity = 0.6 + (agentAvgIntensity * 0.3)

  return (
    <>
      {/* Widget Grid - OUTSIDE scaled container to fill full window */}
      <div style={{ position: "absolute", inset: "0px", display: "grid", gridTemplateColumns: "repeat(auto-fill, 150px)", gridAutoRows: "150px", gap: "10px", zIndex: 1 }}>
        {Array.from({ length: 50 }).map((_, i) => (
          <div 
            key={i} 
            onClick={() => {
              // Create widget at this grid position if it doesn't exist
              if (!widgetSizes[i]) {
                const newSizes = { ...widgetSizes, [i]: { width: 1, height: 1 } }
                setWidgetSizes(newSizes)
                localStorage.setItem('widget-sizes', JSON.stringify(newSizes))
              }
              setActiveWidget({ gridIndex: i })
            }}
            style={{ 
              border: "3px dashed transparent", 
              borderRadius: "20px", 
              backgroundColor: "transparent",
              cursor: "pointer",
              pointerEvents: "auto",
              transition: "border-color 0.2s, background-color 0.2s"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.border = "3px dashed rgba(255, 255, 255, 0.2)"
              e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.1)"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.border = "3px dashed transparent"
              e.currentTarget.style.backgroundColor = "transparent"
            }}
          />
        ))}
      </div>

      {/* All widgets - always visible */}
      {Object.entries(widgetSizes).map(([gridIndexStr, size]) => {
        const gridIndex = parseInt(gridIndexStr)
        const widthPx = size.width * 150 + (size.width - 1) * 10
        const heightPx = size.height * 150 + (size.height - 1) * 10
        const isActive = activeWidget?.gridIndex === gridIndex
        
        return (
          <div
            key={gridIndex}
            onClick={(e) => {
              e.stopPropagation()
              setActiveWidget({ gridIndex })
            }}
            style={{
              position: "absolute",
              left: `${(gridIndex % Math.floor(window.innerWidth / 160)) * 160}px`,
              top: `${Math.floor(gridIndex / Math.floor(window.innerWidth / 160)) * 160}px`,
              width: `${widthPx}px`,
              height: `${heightPx}px`,
              background: isActive ? "rgba(59, 130, 246, 0.4)" : "rgba(0, 0, 0, 0.3)",
              border: isActive ? "2px solid rgba(59, 130, 246, 0.8)" : "2px solid rgba(100, 100, 100, 0.4)",
              borderRadius: "20px",
              pointerEvents: "auto",
              zIndex: isActive ? 50 : 40,
              cursor: "pointer"
            }}
          >
            {isActive && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    const newSizes = { ...widgetSizes }
                    delete newSizes[gridIndex]
                    setWidgetSizes(newSizes)
                    setActiveWidget(null)
                  }}
                  style={{
                    position: "absolute",
                    top: "10px",
                    right: "10px",
                    background: "rgba(239, 68, 68, 0.8)",
                    border: "none",
                    borderRadius: "50%",
                    width: "30px",
                    height: "30px",
                    cursor: "pointer",
                    color: "white",
                    fontSize: "18px"
                  }}
                >
                  ×
                </button>

                {/* Resize handles - only on active widget */}
                <div
                  onMouseDown={(e) => handleResizeStart(e, 'right')}
                  style={{
                    position: "absolute",
                    right: "-5px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: "10px",
                    height: "60px",
                    background: "rgba(59, 130, 246, 0.6)",
                    borderRadius: "5px",
                    cursor: "ew-resize"
                  }}
                />
                <div
                  onMouseDown={(e) => handleResizeStart(e, 'bottom')}
                  style={{
                    position: "absolute",
                    bottom: "-5px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: "60px",
                    height: "10px",
                    background: "rgba(59, 130, 246, 0.6)",
                    borderRadius: "5px",
                    cursor: "ns-resize"
                  }}
                />
              </>
            )}
          </div>
        )
      })}

      <div className="chat-indicator" style={{ transform: "scale(0.6)" }}>
      {/* PURPLE - Agent Audio with HAL 9000 Eye Overlay */}
      <div className="status-container">
        <div className="blob-container">
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%) scale(1)", width: "400px", height: "400px", pointerEvents: "none", opacity: 0.6, filter: "drop-shadow(rgba(255, 0, 0, 0.6) 0px 0px 0px)", transition: "opacity 0.1s, transform 0.1s, filter 0.1s" }}>
            <svg xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox="0 0 562.5 562.5" width="100%" height="100%"><defs><linearGradient id="linearGradient2781"><stop id="stop2782" offset="0" style={{ stopColor: "rgb(252, 255, 0)", stopOpacity: 1 }} /><stop id="stop2784" offset="1" style={{ stopColor: "rgb(255, 0, 0)", stopOpacity: 1 }} /></linearGradient><linearGradient id="linearGradient1530"><stop id="stop1531" offset="0" style={{ stopColor: "rgb(255, 0, 0)", stopOpacity: 1 }} /><stop id="stop1534" offset="0.5" style={{ stopColor: "rgb(238, 0, 0)", stopOpacity: 1 }} /><stop id="stop4709" offset="0.75" style={{ stopColor: "rgb(164, 0, 0)", stopOpacity: 1 }} /><stop id="stop1532" offset="1" style={{ stopColor: "rgb(0, 0, 0)", stopOpacity: 1 }} /></linearGradient><radialGradient gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient1530" id="radialGradient2175" fy="441.98581" fx="279.27597" r="218.70837" cy="441.98581" cx="279.27597" /><radialGradient gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient2781" id="radialGradient2176" fy="450.62323" fx="279.27597" r="37.428738" cy="450.62323" cx="279.27597" /></defs><g id="g3882" transform="matrix(0.999995,0.000000,0.000000,1.000000,-366.8852,-202.1756)"><g id="g1285" transform="matrix(0.706473,0.000000,0.000000,0.706473,392.0851,234.7421)"><path id="path908" transform="matrix(0.871134,0.000000,0.000000,0.871134,104.5141,-37.87046)" d="M 555.67282 441.98581 A 276.39685 276.39685 0 1 1  2.8791199,441.98581 A 276.39685 276.39685 0 1 1  555.67282 441.98581 z" style={{ fill: "url(#radialGradient2175)", fillOpacity: 1, fillRule: "evenodd", stroke: "none", strokeWidth: 0, strokeLinecap: "butt", strokeLinejoin: "round", strokeMiterlimit: 4, strokeOpacity: 1 }} /><path id="path2158" transform="matrix(0.871134,0.000000,0.000000,0.871134,104.5141,-45.39481)" d="M 316.70471 450.62323 A 37.428738 37.428738 0 1 1  241.84723,450.62323 A 37.428738 37.428738 0 1 1  316.70471 450.62323 z" style={{ fill: "url(#radialGradient2176)", fillOpacity: 0.75, fillRule: "evenodd", stroke: "none", strokeWidth: "1pt", strokeLinecap: "butt", strokeLinejoin: "miter", strokeOpacity: 1 }} /></g></g></svg>
          </div>

          <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="blob-svg">
            <defs>
              <filter id="goo-agent">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />                
                
              </filter>
              
              <filter id="blur-tight">
                <feGaussianBlur in="SourceGraphic" stdDeviation="8" />
              </filter>
              
              <radialGradient id="glass-purple" cx="50%" cy="50%">
                <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.8" />
                <stop offset="50%" stopColor="#c4b5fd" stopOpacity="0.9" />
                <stop offset="70%" stopColor="#a78bfa" stopOpacity="0.3" /><stop offset="95%" stopColor="#a78bfa" stopOpacity="0" />
              </radialGradient>
            </defs>
            
            <g filter="none">
              {/* Orb glow halos - drawn first so they're behind */}
              <circle cx={agentOrb1.x} cy={agentOrb1.y} r="80" fill="#a78bfa" opacity={0.8 * (agentBands[0] || 0)} filter="url(#blur-tight)" />
              <circle cx={agentOrb2.x} cy={agentOrb2.y} r="70" fill="#a78bfa" opacity={0.8 * (agentBands[1] || 0)} filter="url(#blur-tight)" />
              <circle cx={agentOrb3.x} cy={agentOrb3.y} r="60" fill="#a78bfa" opacity={0.8 * (agentBands[2] || 0)} filter="url(#blur-tight)" />
              <circle cx={agentOrb4.x} cy={agentOrb4.y} r="50" fill="#a78bfa" opacity={0.8 * (agentBands[3] || 0)} filter="url(#blur-tight)" />
              
              <circle className="blob-main" cx="100" cy="100" r={agentRadius - 1} fill="url(#glass-purple)" shape-rendering="geometricPrecision" />
              <circle className="blob-orb" cx={agentOrb1.x} cy={agentOrb1.y} r="50" fill="url(#glass-purple)" style={{ transform: `scale(${agentOrb1.scale})`, transformOrigin: '100px 100px' }} />
              <circle className="blob-orb" cx={agentOrb2.x} cy={agentOrb2.y} r="20" fill="url(#glass-purple)" style={{ transform: `scale(${agentOrb2.scale})`, transformOrigin: '100px 100px' }} />
              <circle className="blob-orb" cx={agentOrb3.x} cy={agentOrb3.y} r="18" fill="url(#glass-purple)" style={{ transform: `scale(${agentOrb3.scale})`, transformOrigin: '100px 100px' }} />
              <circle className="blob-orb" cx={agentOrb4.x} cy={agentOrb4.y} r="15" fill="url(#glass-purple)" style={{ transform: `scale(${agentOrb4.scale})`, transformOrigin: '100px 100px' }} />
              <circle cx="100" cy="100" r="20" fill="#a78bfa" opacity="0.6" filter="url(#blur-tight)" />
            </g>
          </svg>
          
          {/* HAL 9000 Eye Overlay - EXACT SVG FROM USER */}
          <div 
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: `translate(-50%, -50%) scale(${halScale})`,
              width: '300px',
              height: '300px',
              pointerEvents: 'none',
              opacity: halOpacity,
              filter: `drop-shadow(0 0 ${halGlow}px rgba(255, 0, 0, 0.6))`,
              transition: 'opacity 0.1s ease, transform 0.1s ease, filter 0.1s ease'
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              xmlnsXlink="http://www.w3.org/1999/xlink"
              viewBox="0 0 562.5 562.5"
              width="100%"
              height="100%"
            >
              <defs>
                <linearGradient id="linearGradient3671">
                  <stop id="stop3673" offset="0" style={{ stopColor: '#272727', stopOpacity: 1 }} />
                  <stop id="stop3679" offset="0.92592591" style={{ stopColor: '#272727', stopOpacity: 0.49803922 }} />
                  <stop id="stop3675" offset="1" style={{ stopColor: '#272727', stopOpacity: 0 }} />
                </linearGradient>
                <linearGradient id="linearGradient3143">
                  <stop id="stop3145" offset="0" style={{ stopColor: '#5e5e5e', stopOpacity: 1 }} />
                  <stop id="stop3153" offset="0.48148149" style={{ stopColor: '#5e5e5e', stopOpacity: 1 }} />
                  <stop id="stop3147" offset="1" style={{ stopColor: '#ffffff', stopOpacity: 1 }} />
                </linearGradient>
                <linearGradient id="linearGradient3877">
                  <stop id="stop3878" offset="0" style={{ stopColor: '#d3d3d3', stopOpacity: 1 }} />
                  <stop id="stop3881" offset="0.5" style={{ stopColor: '#000000', stopOpacity: 0.47422680 }} />
                  <stop id="stop3880" offset="1" style={{ stopColor: '#b0b0b0', stopOpacity: 1 }} />
                  <stop id="stop3879" offset="1" style={{ stopColor: '#c5c5c5', stopOpacity: 1 }} />
                </linearGradient>
                <linearGradient id="linearGradient2976">
                  <stop id="stop2977" offset="0" style={{ stopColor: '#999999', stopOpacity: 1 }} />
                  <stop id="stop2978" offset="1" style={{ stopColor: '#000000', stopOpacity: 1 }} />
                </linearGradient>
                <linearGradient id="linearGradient1621">
                  <stop id="stop1622" offset="0" style={{ stopColor: '#000000', stopOpacity: 0 }} />
                  <stop id="stop1626" offset="0.58647060" style={{ stopColor: '#868686', stopOpacity: 0.21568628 }} />
                  <stop id="stop1625" offset="1" style={{ stopColor: '#000000', stopOpacity: 0 }} />
                </linearGradient>
                <linearGradient id="linearGradient1613">
                  <stop id="stop1614" offset="0" style={{ stopColor: '#fff0f0', stopOpacity: 1 }} />
                  <stop id="stop1615" offset="0.74384898" style={{ stopColor: '#4c4242', stopOpacity: 1 }} />
                  <stop id="stop1616" offset="0.85169548" style={{ stopColor: '#746969', stopOpacity: 1 }} />
                  <stop id="stop1617" offset="1" style={{ stopColor: '#e4d6d6', stopOpacity: 1 }} />
                </linearGradient>
                <linearGradient id="linearGradient4787">
                  <stop id="stop4788" offset="0" style={{ stopColor: '#000000', stopOpacity: 0 }} />
                  <stop id="stop4789" offset="1" style={{ stopColor: '#000000', stopOpacity: 1 }} />
                </linearGradient>
                
                <linearGradient id="linearGradient4762">
                  <stop id="stop4763" offset="0" style={{ stopColor: '#d7d7d7', stopOpacity: 1 }} />
                  <stop id="stop4764" offset="1" style={{ stopColor: '#6a6a6a', stopOpacity: 1 }} />
                </linearGradient>
                <linearGradient id="linearGradient4731">
                  <stop id="stop4732" offset="0" style={{ stopColor: '#ffffff', stopOpacity: 0.80198020 }} />
                  <stop id="stop4733" offset="1" style={{ stopColor: '#ffffff', stopOpacity: 0 }} />
                </linearGradient>
                <linearGradient id="linearGradient4727">
                  <stop id="stop4728" offset="0" style={{ stopColor: '#ffffff', stopOpacity: 0.47524753 }} />
                  <stop id="stop4729" offset="1" style={{ stopColor: '#ffffff', stopOpacity: 0 }} />
                </linearGradient>
                <linearGradient id="linearGradient4699">
                  <stop id="stop4700" offset="0" style={{ stopColor: '#ffffff', stopOpacity: 0.67450982 }} />
                  <stop id="stop4703" offset="1" style={{ stopColor: '#ffffff', stopOpacity: 0 }} />
                </linearGradient>
                <linearGradient id="linearGradient4680">
                  <stop id="stop4681" offset="0" style={{ stopColor: '#ffffff', stopOpacity: 1 }} />
                  <stop id="stop4692" offset="0.85705882" style={{ stopColor: '#ffffff', stopOpacity: 0.49803922 }} />
                  <stop id="stop4690" offset="0.98" style={{ stopColor: '#ffffff', stopOpacity: 0 }} />
                  <stop id="stop4684" offset="1" style={{ stopColor: '#ffffff', stopOpacity: 0 }} />
                </linearGradient>
                <linearGradient id="linearGradient4666">
                  <stop id="stop4667" offset="0" style={{ stopColor: '#ffffff', stopOpacity: 0 }} />
                  <stop id="stop4677" offset="0.74384898" style={{ stopColor: '#ffffff', stopOpacity: 0 }} />
                  <stop id="stop4678" offset="0.85169548" style={{ stopColor: '#ffffff', stopOpacity: 0.53465348 }} />
                  <stop id="stop4669" offset="1" style={{ stopColor: '#ffffff', stopOpacity: 0.68316829 }} />
                </linearGradient>
                <linearGradient id="linearGradient3416">
                  <stop id="stop3417" offset="0" style={{ stopColor: '#ffffff', stopOpacity: 1 }} />
                  <stop id="stop3418" offset="1" style={{ stopColor: '#ffffff', stopOpacity: 0 }} />
                </linearGradient>
                <linearGradient id="linearGradient2781">
                  <stop id="stop2782" offset="0" style={{ stopColor: '#fcff00', stopOpacity: 1 }} />
                  <stop id="stop2784" offset="1" style={{ stopColor: '#ff0000', stopOpacity: 1 }} />
                </linearGradient>
                <linearGradient id="linearGradient1530">
                  <stop id="stop1531" offset="0" style={{ stopColor: '#ff0000', stopOpacity: 1 }} />
                  <stop id="stop1534" offset="0.5" style={{ stopColor: '#ee0000', stopOpacity: 1 }} />
                  <stop id="stop4709" offset="0.75" style={{ stopColor: '#a40000', stopOpacity: 1 }} />
                  <stop id="stop1532" offset="1" style={{ stopColor: '#000000', stopOpacity: 1 }} />
                </linearGradient>
                <radialGradient spreadMethod="reflect" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient4765" id="radialGradient2171" fy="737.46417" fx="287.74374" r="295.89142" cy="737.46417" cx="287.74374" />
                <radialGradient spreadMethod="reflect" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient4765" id="radialGradient2173" fy="737.46417" fx="287.74374" r="327.51413" cy="737.46417" cx="287.74374" />
                <radialGradient spreadMethod="pad" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient1621" id="radialGradient2174" fy="459.26886" fx="278.78949" r="404.96548" cy="463.68466" cx="274.55768" />
                <radialGradient gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient1530" id="radialGradient2175" fy="441.98581" fx="279.27597" r="218.70837" cy="441.98581" cx="279.27597" />
                <radialGradient gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient2781" id="radialGradient2176" fy="450.62323" fx="279.27597" r="37.428738" cy="450.62323" cx="279.27597" />
                <radialGradient spreadMethod="reflect" gradientTransform="scale(1.338494,0.747108)" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient4666" id="radialGradient2177" fy="353.93729" fx="210.28436" r="246.68530" cy="353.93729" cx="206.99892" />
                <radialGradient spreadMethod="pad" gradientTransform="scale(1.338494,0.747108)" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient4680" id="radialGradient2178" fy="276.05798" fx="208.64165" r="123.43803" cy="269.48709" cx="208.64165" />
                <radialGradient gradientTransform="scale(1.913099,0.522712)" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient4699" id="radialGradient2179" fy="534.65698" fx="143.73607" r="69.098587" cy="533.88885" cx="143.31262" />
                <linearGradient gradientTransform="scale(1.125463,0.888523)" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient3416" id="linearGradient2180" y2="360.40796" x2="117.32087" y1="429.20853" x1="116.24075" />
                <linearGradient gradientTransform="scale(1.145102,0.873285)" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient3416" id="linearGradient2181" y2="368.41385" x2="347.54733" y1="368.41385" x1="413.24863" />
                <radialGradient gradientTransform="scale(1.913099,0.522712)" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient4727" id="radialGradient2182" fy="534.65698" fx="143.73607" r="69.098587" cy="533.88885" cx="143.31262" />
                <linearGradient gradientTransform="scale(1.125463,0.888523)" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient4731" id="linearGradient2183" y2="389.16043" x2="171.59686" y1="390.52960" x1="60.344574" />
                <linearGradient gradientTransform="scale(1.145102,0.873285)" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient3416" id="linearGradient2184" y2="374.69113" x2="332.64600" y1="376.48462" x1="443.95441" />
                <radialGradient gradientTransform="scale(0.989176,1.010943)" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient4727" id="radialGradient2185" fy="380.43008" fx="353.78625" r="31.279371" cy="380.08240" cx="353.59454" />
                <radialGradient gradientTransform="scale(1.010943,0.989176)" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient4727" id="radialGradient2186" fy="397.66397" fx="210.65385" r="31.279371" cy="397.31625" cx="210.46217" />
                <linearGradient gradientTransform="scale(1.125464,0.888522)" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient4731" id="linearGradient2187" y2="460.58051" x2="219.83492" y1="460.90915" x1="193.12994" />
                <radialGradient gradientTransform="scale(1.737464,0.575552)" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient4699" id="radialGradient2188" fy="564.17297" fx="157.95760" r="46.977146" cy="564.17297" cx="157.95760" />
                <linearGradient gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient4787" id="linearGradient2307" y2="-68.125107" x2="309.93845" y1="698.68085" x1="309.93845" />
                <linearGradient gradientTransform="scale(0.999208,1.000792)" gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient2976" id="linearGradient4565" y2="722.44666" x2="613.83386" y1="240.83360" x1="579.15771" />
                <radialGradient gradientUnits="userSpaceOnUse" xlinkHref="#linearGradient3671" id="radialGradient3677" fy="481.43597" fx="637.46222" r="178.05966" cy="481.43597" cx="637.46222" />
              </defs>
              <path id="path4528" style={{ fill: '#000000', fillOpacity: 1, fillRule: 'evenodd', stroke: 'none', strokeWidth: 2.3475611, strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeMiterlimit: 4, strokeOpacity: 1 }} transform="matrix(-0.655393,1.028921e-16,-1.028916e-16,-0.655396,453.7058,567.2513)" d="M 592.43381 441.60568 A 313.52167 313.52167 0 1 1  -34.609528,441.60568 A 313.52167 313.52167 0 1 1  592.43381 441.60568 z" />
              <path id="path4770" style={{ fill: 'url(#radialGradient2171)', fillOpacity: 0.75, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} transform="matrix(-0.655393,1.028921e-16,-1.028916e-16,-0.655396,453.7055,567.2513)" d="M 592.43381 441.60568 A 313.52167 313.52167 0 1 1  -34.609528,441.60568 A 313.52167 313.52167 0 1 1  592.43381 441.60568 z" />
              <path id="path4772" style={{ fill: 'url(#linearGradient2307)', fillOpacity: 0.75, fillRule: 'evenodd', stroke: 'none', strokeWidth: 2.3475611, strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeMiterlimit: 4, strokeOpacity: 1 }} transform="matrix(-0.655393,1.028921e-16,-1.028916e-16,-0.655396,453.7058,567.2513)" d="M 592.43381 441.60568 A 313.52167 313.52167 0 1 1  -34.609528,441.60568 A 313.52167 313.52167 0 1 1  592.43381 441.60568 z" />
              <path id="path4760" style={{ fill: 'url(#radialGradient2173)', fillOpacity: 0.75, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} transform="matrix(0.615430,0.000000,0.000000,0.615433,99.25791,6.046065)" d="M 592.43381 441.60568 A 313.52167 313.52167 0 1 1  -34.609528,441.60568 A 313.52167 313.52167 0 1 1  592.43381 441.60568 z" />
              <path id="path1619" style={{ fill: 'url(#radialGradient2174)', fillOpacity: 0.75, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} transform="matrix(0.615430,0.000000,0.000000,0.615433,99.25791,6.046065)" d="M 592.43381 441.60568 A 313.52167 313.52167 0 1 1  -34.609528,441.60568 A 313.52167 313.52167 0 1 1  592.43381 441.60568 z" />
              <g id="g3882" transform="matrix(0.999995,0.000000,0.000000,1.000000,-366.8852,-202.1756)">
                <g id="g4743" transform="matrix(0.615433,0.000000,0.000000,0.615433,465.9215,207.9876)">
                  <path id="path4044" style={{ fill: 'url(#radialGradient2177)', fillOpacity: 1, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} transform="matrix(0.863367,-3.820997e-2,3.037779e-2,0.686396,31.41537,100.6770)" d="M 279.28125,162.06250 C 126.36322,162.06250 2.2187600,286.20697 2.2187500,439.12500 C 2.2187500,449.86415 2.9347920,460.42741 4.1250000,470.84375 C 4.1919378,471.13499 4.4511644,471.34140 4.7500000,471.34140 C 5.0488356,471.34140 5.3080622,471.13499 5.3750000,470.84375 C 21.079720,333.50313 137.75254,226.71875 279.28125,226.71875 C 420.81032,226.71875 537.48323,333.50267 553.18750,470.84375 C 553.25444,471.13499 553.51366,471.34140 553.81250,471.34140 C 554.11134,471.34140 554.37056,471.13499 554.43750,470.84375 C 555.62774,460.42646 556.31250,449.86257 556.31250,439.12500 C 556.31247,286.20706 432.19929,162.06250 279.28125,162.06250 z " />
                  <path id="path4679" style={{ fill: 'url(#radialGradient2178)', fillOpacity: 1, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} transform="matrix(0.801859,0.000000,0.000000,0.580012,54.72754,110.0790)" d="M 279.28125,162.06250 C 126.36322,162.06250 2.2187600,286.20697 2.2187500,439.12500 C 2.2187500,449.86415 2.9347920,460.42741 4.1250000,470.84375 C 4.1919378,471.13499 4.4511644,471.34140 4.7500000,471.34140 C 5.0488356,471.34140 5.3080622,471.13499 5.3750000,470.84375 C 21.079720,333.50313 137.75254,226.71875 279.28125,226.71875 C 420.81032,226.71875 537.48323,333.50267 553.18750,470.84375 C 553.25444,471.13499 553.51366,471.34140 553.81250,471.34140 C 554.11134,471.34140 554.37056,471.13499 554.43750,470.84375 C 555.62774,460.42646 556.31250,449.86257 556.31250,439.12500 C 556.31247,286.20706 432.19929,162.06250 279.28125,162.06250 z " />
                  <g id="g4716">
                    <path id="path4698" style={{ fill: 'url(#radialGradient2179)', fillOpacity: 1, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} d="M 274.98013,270.23711 C 252.70441,270.23711 231.47862,273.57098 212.19888,279.58086 L 223.89878,304.57879 C 242.35004,299.12282 253.85401,297.51836 274.98013,297.51836 C 296.31261,297.51836 310.84306,299.20878 329.44061,304.76629 L 338.57388,279.89336 C 319.06558,273.71149 297.59055,270.23711 274.98013,270.23711 z " />
                    <path id="path4705" style={{ fill: 'url(#linearGradient2180)', fillOpacity: 0.75, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} d="M 132.44016,319.62263 L 112.28622,349.85354 L 136.75886,362.80964 L 166.98976,345.53484 L 132.44016,319.62263 z " />
                    <path id="path4707" style={{ fill: 'url(#linearGradient2181)', fillOpacity: 0.75, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} d="M 402.11377,332.48713 L 437.72679,344.96268 L 450.71901,327.76590 L 429.08539,307.89506 L 402.11377,332.48713 z " />
                  </g>
                  <path id="path4721" style={{ fill: 'url(#radialGradient2182)', fillOpacity: 1, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} transform="matrix(0.626783,0.000000,0.000000,0.626783,104.2744,170.1763)" d="M 274.98013,270.23711 C 252.70441,270.23711 231.47862,273.57098 212.19888,279.58086 L 223.89878,304.57879 C 242.35004,299.12282 253.85401,297.51836 274.98013,297.51836 C 296.31261,297.51836 310.84306,299.20878 329.44061,304.76629 L 338.57388,279.89336 C 319.06558,273.71149 297.59055,270.23711 274.98013,270.23711 z " />
                  <path id="path4722" style={{ fill: 'url(#linearGradient2183)', fillOpacity: 0.75, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} transform="matrix(0.626783,0.000000,0.000000,0.626783,104.2744,170.1763)" d="M 132.44016,319.62263 L 112.28622,349.85354 L 136.75886,362.80964 L 166.98976,345.53484 L 132.44016,319.62263 z " />
                  <path id="path4723" style={{ fill: 'url(#linearGradient2184)', fillOpacity: 0.75, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} transform="matrix(0.626783,0.000000,0.000000,0.626783,104.2744,170.1763)" d="M 402.11377,332.48713 L 437.72679,344.96268 L 450.71901,327.76590 L 429.08539,307.89506 L 402.11377,332.48713 z " />
                  <path id="path4736" style={{ fill: 'url(#radialGradient2185)', fillOpacity: 1, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} d="M 353.39293,387.85036 C 348.66491,383.12235 343.45214,379.32481 338.08444,376.50828 L 335.26195,384.29738 C 340.33624,387.05561 343.11849,389.15677 347.60250,393.64078 C 352.13030,398.16858 354.85559,401.61145 357.62333,406.73835 L 364.84112,403.39762 C 362.01260,397.94489 358.19197,392.64940 353.39293,387.85036 z " />
                  <path id="path4737" style={{ fill: 'url(#radialGradient2186)', fillOpacity: 1, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} d="M 209.28294,396.89699 C 204.55493,401.62501 200.75739,406.83778 197.94086,412.20548 L 205.72996,415.02797 C 208.48819,409.95368 210.58935,407.17143 215.07336,402.68742 C 219.60116,398.15962 223.04403,395.43433 228.17093,392.66659 L 224.83020,385.44880 C 219.37747,388.27732 214.08198,392.09795 209.28294,396.89699 z " />
                  <path id="path4738" style={{ fill: 'url(#linearGradient2187)', fillOpacity: 0.75, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} d="M 232.84931,402.95772 L 228.01155,410.21433 L 233.88596,413.32430 L 241.14258,409.17767 L 232.84931,402.95772 z " />
                  <path id="path4739" style={{ fill: 'url(#radialGradient2188)', fillOpacity: 0.75, fillRule: 'evenodd', stroke: 'none', strokeWidth: '1pt', strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeOpacity: 1 }} d="M 274.96237,309.81739 C 230.46231,309.81739 194.34541,332.11291 194.34539,359.58346 C 194.34539,360.81402 194.50628,362.01945 194.64873,363.22769 C 197.69751,337.47020 232.46357,317.12026 274.96237,317.12026 C 317.46117,317.12026 352.22724,337.47019 355.27601,363.22769 C 355.41846,362.01945 355.57935,360.81402 355.57935,359.58346 C 355.57935,332.11291 319.46243,309.81738 274.96237,309.81739 z " />
                </g>
              </g>
            </svg>
          </div>
          
          <div className="blob-glow" style={{ background: 'radial-gradient(circle, #a78bfa 0%, transparent 25%)', display: showGlow ? 'block' : 'none' }} />
        </div>
      </div>

      {/* BLUE - User Microphone */}
      <div className="status-container">
        <div className="blob-container">
          <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="blob-svg">
            <defs>
              <filter id="goo-user">
                
                <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />                
              </filter>
              
              <radialGradient id="glass-blue" cx="50%" cy="50%">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.8" />
                <stop offset="50%" stopColor="#60a5fa" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </radialGradient>
            </defs>
            
            
            <g filter="none">
              {/* Blue orb glow halos - drawn first so they're behind */}
              <circle cx={userOrb1.x} cy={userOrb1.y} r="80" fill="#60a5fa" opacity={1.0 * (userBands[0] || 0)} filter="url(#blur-tight)" />
              <circle cx={userOrb2.x} cy={userOrb2.y} r="70" fill="#60a5fa" opacity={1.0 * (userBands[1] || 0)} filter="url(#blur-tight)" />
              <circle cx={userOrb3.x} cy={userOrb3.y} r="60" fill="#60a5fa" opacity={1.0 * (userBands[2] || 0)} filter="url(#blur-tight)" />
              <circle cx={userOrb4.x} cy={userOrb4.y} r="50" fill="#60a5fa" opacity={1.0 * (userBands[3] || 0)} filter="url(#blur-tight)" />
              
              <circle className="blob-main" cx="100" cy="100" r={userRadius - 1} fill="url(#glass-blue)" shape-rendering="geometricPrecision" />
              <circle className="blob-orb" cx={userOrb1.x} cy={userOrb1.y} r="50" fill="url(#glass-blue)" style={{ transform: `scale(${userOrb1.scale})`, transformOrigin: '100px 100px' }} />
              <circle className="blob-orb" cx={userOrb2.x} cy={userOrb2.y} r="20" fill="url(#glass-blue)" style={{ transform: `scale(${userOrb2.scale})`, transformOrigin: '100px 100px' }} />
              <circle className="blob-orb" cx={userOrb3.x} cy={userOrb3.y} r="18" fill="url(#glass-blue)" style={{ transform: `scale(${userOrb3.scale})`, transformOrigin: '100px 100px' }} />
              <circle className="blob-orb" cx={userOrb4.x} cy={userOrb4.y} r="15" fill="url(#glass-blue)" style={{ transform: `scale(${userOrb4.scale})`, transformOrigin: '100px 100px' }} />
              <circle cx="100" cy="100" r="20" fill="#60a5fa" opacity="0.6" filter="url(#blur-tight)" />
            </g>
          </svg>
          <div className="blob-glow" style={{ background: 'radial-gradient(circle, #60a5fa 0%, transparent 25%)', display: showGlow ? 'block' : 'none' }} />
        </div>
      </div>


      {/* Camera feed */}
      {showCamera && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%) scale(0.7)', // Adjust scale here (e.g., 0.5, 1.5, 2)
            width: '200px',
            height: '190px',
            pointerEvents: 'none',
            zIndex: 200,
          }}
        >
          <video 
            ref={cameraVideoRef} 
            autoPlay 
            playsInline 
            muted 
            style={{ display: 'none' }} 
          />
          <canvas
            ref={cameraCanvasRef}
            width={400}
            height={400}
            style={{
              width: '100%',
              height: '100%',
              opacity: 0.3,
              filter: 'grayscale(1) contrast(1.8) brightness(0.9) blur(1px)',
              mixBlendMode: 'overlay'
            }}
          />
        </div>
      )}

    </div>
  </>
  )
}
