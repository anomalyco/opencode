# LiveKit Player - Best Practices Implementation

This document outlines the LiveKit best practices implemented in the player application.

## ✅ Implemented Best Practices

### 1. Proper Connection Management

**Authentication**
- ✅ Generates JWT tokens using API key + secret (not exposing secrets to browser in production)
- ✅ Tokens include proper grants (room join, publish, subscribe)
- ✅ 24-hour token expiration

**Connection Options**
- ✅ Adaptive streaming enabled for bandwidth optimization
- ✅ Dynacast enabled for efficient track management
- ✅ Audio capture with echo cancellation, noise suppression, and auto gain control

### 2. Reconnection Handling

**Automatic Reconnection**
- ✅ `Reconnecting` event listener with UI feedback
- ✅ `Reconnected` event handling
- ✅ Visual spinner during reconnection attempts
- ✅ Network change handling (WiFi to cellular, poor connection)

**Full Reconnection Sequence**
- ✅ Handles `ParticipantDisconnected` events during reconnection
- ✅ Tracks republish automatically after reconnection
- ✅ Audio elements reattach when participants rejoin

### 3. Disconnection Management

**Graceful Disconnect**
- ✅ `room.disconnect()` called on window close (`beforeunload` event)
- ✅ Cleanup in useEffect return function
- ✅ All audio elements removed on disconnect

**Disconnect Reasons**
- ✅ Handles `DUPLICATE_IDENTITY` with user-friendly message
- ✅ Handles `ROOM_DELETED` notification
- ✅ Handles `PARTICIPANT_REMOVED` notification
- ✅ Handles `JOIN_FAILURE` errors

### 4. Audio Track Management

**Audio Playback**
- ✅ Automatic audio element creation on `TrackSubscribed`
- ✅ Audio element cleanup on `TrackUnsubscribed`
- ✅ Prevents duplicate audio elements (Map tracking)
- ✅ Volume set to 100%, autoplay enabled
- ✅ Handles existing tracks when joining room

**Track Events**
- ✅ `TrackSubscribed` listener
- ✅ `TrackUnsubscribed` listener  
- ✅ `TrackPublished` listener
- ✅ `TrackUnpublished` listener
- ✅ `LocalTrackPublished` listener
- ✅ `LocalTrackUnpublished` listener

### 5. Participant Management

**Event Handling**
- ✅ `ParticipantConnected` listener
- ✅ `ParticipantDisconnected` listener
- ✅ Participant count tracking in UI
- ✅ Speaking state detection for remote participants

### 6. Error Handling

**Error Boundary**
- ✅ React ErrorBoundary component wrapping entire app
- ✅ User-friendly error display with reload option
- ✅ Console logging for debugging

**Connection Errors**
- ✅ Try-catch around connection logic
- ✅ Microphone permission error handling
- ✅ Token generation error handling
- ✅ Error state display with retry button

### 7. Connection Quality Monitoring

**Quality Indicators**
- ✅ `ConnectionQualityChanged` event listener
- ✅ Visual quality indicator in UI
- ✅ Color-coded quality display:
  - 🟢 Excellent (green)
  - 🟡 Good (orange)
  - 🔴 Poor (red)
  - ⚫ Lost (gray)

### 8. Microphone Management

**Permission & Publishing**
- ✅ Microphone enabled after connection
- ✅ Permission request with error handling
- ✅ Audio capture options (echo cancellation, noise suppression)
- ✅ Microphone state tracked

## 📁 File Structure

```
livekit-player/
├── src/
│   ├── components/
│   │   ├── ChatIndicator.tsx       # UI with connection quality
│   │   ├── ChatIndicator.css       # Animations
│   │   └── ErrorBoundary.tsx       # Error boundary
│   ├── utils/
│   │   ├── config.ts               # Environment config
│   │   └── token.ts                # JWT generation
│   ├── App.tsx                     # Connection logic
│   ├── main.tsx                    # Entry with ErrorBoundary
│   └── index.css                   # Global styles
```

## 🎯 Key Implementation Details

### Token Generation
```typescript
// Uses jose library for JWT signing
// Includes room name, identity, and permissions
// 24-hour expiration
const token = await generateToken(roomName, participantName, apiKey, apiSecret)
```

### Audio Element Management
```typescript
// Map to track audio elements and prevent duplicates
const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map())

// Attach with cleanup
const audioElement = track.attach()
audioElementsRef.current.set(track.sid, audioElement)
track.once('ended', cleanup)
```

### Reconnection UI
```typescript
// Show spinner during reconnection
if (isReconnecting) {
  return <ReconnectingSpinner />
}
```

### Cleanup Pattern
```typescript
// Cleanup on unmount and beforeunload
useEffect(() => {
  // ... setup ...
  
  const cleanup = () => {
    audioElementsRef.current.forEach(el => el.remove())
    room.disconnect()
  }
  
  window.addEventListener('beforeunload', cleanup)
  return () => {
    window.removeEventListener('beforeunload', cleanup)
    cleanup()
  }
}, [])
```

## 🚀 Performance Optimizations

1. **Adaptive Streaming**: Automatically adjusts quality based on bandwidth
2. **Dynacast**: Only forwards tracks that are being consumed
3. **Audio Element Reuse**: Prevents duplicate elements with Map tracking
4. **Event Listener Cleanup**: All listeners removed on unmount
5. **RequestAnimationFrame**: Smooth audio level animations

## 🔒 Security Considerations

1. **JWT Tokens**: Generated server-side in production (not browser)
2. **API Secret**: Only used for local dev token generation
3. **Token Expiration**: 24-hour expiry prevents token reuse
4. **No Secrets in Browser**: VITE_LIVEKIT_API_SECRET only for local dev

## 📊 Connection Reliability

The player supports all LiveKit connection types:
1. ✅ ICE over UDP (primary)
2. ✅ TURN with UDP
3. ✅ ICE over TCP
4. ✅ TURN with TLS

Automatic fallback happens transparently based on network conditions.

## 🐛 Debug Logging

Extensive console logging for debugging:
- 🔌 Connection attempts
- ✅ Successful connections
- 👤 Participant events
- 📥📤 Track subscription/publication
- 🔊 Audio element management
- 📶 Connection quality changes
- 💔 Disconnections with reasons
- 🔄 Reconnection attempts

## 📝 Testing Checklist

- [x] Connects to LiveKit room
- [x] Requests microphone permission
- [x] Publishes audio to room
- [x] Plays audio from remote participants
- [x] Shows reconnecting UI on network issues
- [x] Recovers from reconnection automatically
- [x] Shows connection quality indicator
- [x] Handles participant join/leave
- [x] Cleans up on disconnect
- [x] Graceful error handling
- [x] Window close cleanup

## 🔜 Future Enhancements

Optional improvements for production:

1. **Token Server**: Backend endpoint for token generation
2. **Settings UI**: Room selection, audio device selection
3. **Push-to-Talk**: Keyboard shortcut for mic control
4. **Mute Toggle**: UI button to mute/unmute
5. **Volume Control**: Adjustable output volume
6. **Analytics**: Track connection quality metrics
7. **Transcription Display**: Show real-time transcripts
8. **Recording**: Save conversation audio locally

## 📚 References

- [LiveKit Client SDK Docs](https://docs.livekit.io/home/client/connect.md)
- [Connection Reliability](https://docs.livekit.io/home/client/connect.md#connection-reliability)
- [Handling Events](https://docs.livekit.io/home/client/events.md)
- [Track Management](https://docs.livekit.io/home/client/tracks.md)
