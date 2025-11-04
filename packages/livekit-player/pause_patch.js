const fs = require('fs');

const file = 'src/components/ChatIndicator.tsx';
let content = fs.readFileSync(file, 'utf8');

// Add isPaused state after showCamera line
content = content.replace(
  /const \[showCamera, setShowCamera\] = useState\(true\)/,
  `const [showCamera, setShowCamera] = useState(true)
  const [isPaused, setIsPaused] = useState(false)

  // HAL lens pause/resume handler
  const handleLensClick = async () => {
    if (!room || connectionState !== ConnectionState.Connected) return
    
    const newPausedState = !isPaused
    setIsPaused(newPausedState)
    
    try {
      // Pause/resume microphone
      await room.localParticipant.setMicrophoneEnabled(!newPausedState)
      
      // Mute/unmute all remote audio tracks
      room.remoteParticipants.forEach((participant) => {
        participant.audioTracks.forEach((publication) => {
          if (publication.track) {
            if (newPausedState) {
              publication.track.muted = true
            } else {
              publication.track.muted = false
            }
          }
        })
      })
      
      // Reset audio bands to zero when paused
      if (newPausedState) {
        agentBandsRef.current = [0, 0, 0, 0]
        userBandsRef.current = [0, 0, 0, 0]
      }
      
      console.log(newPausedState ? '⏸️ HAL paused' : '▶️ HAL resumed')
    } catch (err) {
      console.error('Failed to toggle HAL pause state:', err)
    }
  }`
);

// Add onClick and filter to blob-container
content = content.replace(
  /<div className="blob-container">/,
  '<div className="blob-container" onClick={handleLensClick} style={{ cursor: "pointer", filter: isPaused ? "grayscale(1)" : "none", transition: "filter 0.3s ease" }}>'
);

fs.writeFileSync(file, content);
console.log('✅ Patch applied successfully');
