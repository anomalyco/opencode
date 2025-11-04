import { useEffect, useState, useRef } from 'react'
import { Room, RoomEvent, ConnectionState, RoomOptions, RemoteTrackPublication, RemoteParticipant, Track, DisconnectReason } from 'livekit-client'
import ChatIndicator from './components/ChatIndicator'
import { getEnvConfig } from './utils/config'
import TitleBar from './components/TitleBar'
import { generateToken } from './utils/token'

function App() {
  const [room] = useState(() => new Room())
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected)
  const [error, setError] = useState<string>('')
  const [isReconnecting, setIsReconnecting] = useState(false)
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const config = getEnvConfig()

  useEffect(() => {
    const connectToRoom = async () => {
      try {
        setConnectionState(ConnectionState.Connecting)
        setError('')
        
        // Generate a proper JWT token
        const token = await generateToken(
          config.roomName,
          config.participantName,
          config.apiKey,
          config.apiSecret
        )
        
        console.debug('🔌 Connecting to room:', config.roomName, 'at', config.url)
        
        // Room options with audio enabled
        const roomOptions: RoomOptions = {
          adaptiveStream: true,
          dynacast: true,
          audioCaptureDefaults: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }
        
        // Connect to the room with the token
        await room.connect(config.url, token, roomOptions)

        console.debug('✅ Connected to room:', room.name)
        setConnectionState(ConnectionState.Connected)
        
        // Enable microphone after connecting
        try {
          console.debug('🎤 Requesting microphone access...')
          await room.localParticipant.setMicrophoneEnabled(true)
          console.debug('✅ Microphone enabled')
          
          // Enable audio level monitoring on local tracks
          setTimeout(() => {
            if (room.localParticipant?.audioTracks) {
              room.localParticipant.audioTracks.forEach((publication) => {
                if (publication.track) {
                  console.debug('🎧 Enabling audio level observation on track:', publication.trackSid)
                  publication.track.on('audioLevelChanged', (level: number) => {
                    // This will be picked up by ChatIndicator
                    console.debug('🎤 Local audio level:', level.toFixed(3))
                  })
                }
              })
            } else {
              console.warn('⚠️ audioTracks not available yet')
            }
          }, 1000)
          
        } catch (micError) {
          console.error('❌ Failed to enable microphone:', micError)
          setError('Failed to access microphone. Please grant permission.')
        }
        
        // Check for existing remote participants and their tracks
        room.remoteParticipants.forEach((participant) => {
          console.debug('👤 Existing participant:', participant.identity)
          participant.trackPublications.forEach((publication) => {
            if (publication.track && publication.track.kind === Track.Kind.Audio) {
              attachAudioTrack(publication.track)
            }
          })
        })
      } catch (err) {
        console.error('❌ Failed to connect:', err)
        setError(err instanceof Error ? err.message : 'Failed to connect')
        setConnectionState(ConnectionState.Disconnected)
      }
    }

    const attachAudioTrack = (track: Track) => {
      // Check if already attached
      if (audioElementsRef.current.has(track.sid)) {
        console.debug('⚠️ Audio element already exists for track:', track.sid)
        return
      }

      const audioElement = track.attach()
      audioElement.autoplay = true
      audioElement.volume = 1.0
      audioElement.id = `audio-${track.sid}`
      document.body.appendChild(audioElement)
      audioElementsRef.current.set(track.sid, audioElement)
      
      console.debug('🔊 Audio element attached:', audioElement.id)
      
      // Clean up on track end
      const cleanup = () => {
        const element = audioElementsRef.current.get(track.sid)
        if (element) {
          element.remove()
          audioElementsRef.current.delete(track.sid)
          console.debug('🗑️ Audio element removed:', track.sid)
        }
      }
      
      track.once('ended', cleanup)
    }

    const detachAudioTrack = (trackSid: string) => {
      const element = audioElementsRef.current.get(trackSid)
      if (element) {
        element.remove()
        audioElementsRef.current.delete(trackSid)
        console.debug('🗑️ Audio element detached:', trackSid)
      }
    }

    // Set up event listeners
    room.on(RoomEvent.Connected, () => {
      console.debug('🎉 Room connected')
      setConnectionState(ConnectionState.Connected)
      setIsReconnecting(false)
    })

    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      console.debug('💔 Room disconnected, reason:', reason)
      setConnectionState(ConnectionState.Disconnected)
      setIsReconnecting(false)
      
      // Show user-friendly disconnect messages
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
        setError('Another participant with the same identity joined.')
      } else if (reason === DisconnectReason.ROOM_DELETED) {
        setError('Room was closed.')
      } else if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
        setError('You were removed from the room.')
      }
    })

    room.on(RoomEvent.Reconnecting, () => {
      console.debug('🔄 Room reconnecting...')
      setConnectionState(ConnectionState.Reconnecting)
      setIsReconnecting(true)
    })

    room.on(RoomEvent.Reconnected, () => {
      console.debug('✅ Room reconnected')
      setConnectionState(ConnectionState.Connected)
      setIsReconnecting(false)
    })

    room.on(RoomEvent.LocalTrackPublished, (publication) => {
      console.debug('📤 Local track published:', publication.trackName)
    })

    room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      console.debug('📤 Local track unpublished:', publication.trackName)
    })

    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      console.debug('👤 Participant joined:', participant.identity)
    })

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      console.debug('👋 Participant left:', participant.identity)
    })

    room.on(RoomEvent.TrackSubscribed, (
      track,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant
    ) => {
      console.debug('📥 Track subscribed:', track.kind, 'from', participant.identity)
      
      if (track.kind === Track.Kind.Audio) {
        attachAudioTrack(track)
      }
    })

    room.on(RoomEvent.TrackUnsubscribed, (
      track,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant
    ) => {
      console.debug('📤 Track unsubscribed:', track.kind, 'from', participant.identity)
      
      if (track.kind === Track.Kind.Audio) {
        detachAudioTrack(track.sid)
      }
    })
    
    room.on(RoomEvent.TrackPublished, (
      publication: RemoteTrackPublication,
      participant: RemoteParticipant
    ) => {
      console.debug('📢 Track published:', publication.kind, 'from', participant.identity)
    })

    room.on(RoomEvent.TrackUnpublished, (
      publication: RemoteTrackPublication,
      participant: RemoteParticipant
    ) => {
      console.debug('📢 Track unpublished:', publication.kind, 'from', participant.identity)
    })

    connectToRoom()

    // Cleanup on unmount or window close
    const cleanup = () => {
      console.debug('🧹 Cleaning up room connection...')
      
      // Clean up all audio elements
      audioElementsRef.current.forEach((element) => {
        element.remove()
      })
      audioElementsRef.current.clear()
      
      // Disconnect from room
      room.disconnect()
    }

    window.addEventListener('beforeunload', cleanup)

    return () => {
      window.removeEventListener('beforeunload', cleanup)
      cleanup()
    }
  }, [])

  if (error) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100vh',
        color: '#ff4444',
        padding: '20px',
        textAlign: 'center',
        flexDirection: 'column',
        gap: '10px'
      }}>
        <div>
          <h2>Connection Error</h2>
          <p>{error}</p>
          <button 
            onClick={() => window.location.reload()}
            style={{
              marginTop: '20px',
              padding: '10px 20px',
              background: '#4ade80',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              color: '#000',
              fontSize: '16px',
              fontWeight: '500'
            }}
          >
            Retry Connection
          </button>
        </div>
      </div>
    )
  }

  if (isReconnecting) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        flexDirection: 'column',
        gap: '20px'
      }}>
        <div style={{
          width: '60px',
          height: '60px',
          border: '4px solid #333',
          borderTop: '4px solid #ffa500',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <div style={{ fontSize: '18px', color: '#ffa500' }}>Reconnecting...</div>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }

  return (
    <>
      <ChatIndicator room={room} connectionState={connectionState} />
    </>
  )
}

export default App
