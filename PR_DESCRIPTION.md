# Terminal Pet Companion - PR Description

## Type of change
- [x] New feature

## What does this PR do?

This PR adds an **interactive ASCII pet companion** to the OpenCode TUI sidebar, bringing personality and visual feedback to the terminal experience.

### Core Features

**🐱 Autonomous Pet Behavior**
- Pet walks/runs left-right autonomously across the sidebar
- Multiple states: walk, run, sleep, play, eat, hide
- Smooth ASCII animation at 10 FPS
- Pet chases a bouncing ball in play mode

**🌦️ Weather System**
- Dynamic weather: sunny ☀️, rainy 🌧️, cloudy ☁️
- Weather affects pet behavior:
  - **Rain** → Pet hides indoors or sleeps (70% probability)
  - **Sunny** → Pet plays outside, runs, chases ball
  - **Cloudy** → Normal mixed behavior
- Real-time rain drop animation

**🎵 CAVA Audio Visualizer**
- 16-bar spectrum analyzer (3-row display)
- Integrates with system CAVA for real audio visualization
- Falls back to simulated spectrum if CAVA unavailable
- Audio level drives pet running speed (louder = faster)

### Technical Implementation

**Files Added:**
- `pet.tsx` - Pet animation engine, movement physics, behavior state machine
- `spectrum.tsx` - CAVA integration via child_process spawn, ASCII output parsing
- `widgets.tsx` - Container component integrating pet + audio + stats

**Architecture:**
- Uses SolidJS reactive signals for smooth 60fps updates
- CAVA spawned as child process, reads ASCII output via stdout
- Pet position/state managed independently, audio provides enhancement
- Weather transitions every 10-20s, pet state changes every 3-8s

### Why This Works

The pet system uses a **behavior tree** approach:
1. Weather state influences behavior probabilities
2. Pet autonomously transitions between states
3. Audio level acts as an "energy boost" multiplier
4. All animations run independently without blocking TUI

CAVA integration:
- Spawns `cava -p /dev/stdin` with custom config
- Parses semicolon-delimited ASCII output (e.g., "1;3;5;7;5;3;1")
- Gracefully falls back to sine-wave simulation if CAVA missing

## How did you verify your code works?

1. **Built and tested locally** on Arch Linux with:
   - CAVA installed → Real audio visualization works
   - CAVA removed → Fallback simulation works
   - Multiple weather states → Pet behavior changes correctly
   
2. **Tested scenarios:**
   - Pet walks continuously without audio
   - Pet runs faster when music plays (CAVA active)
   - Rain triggers hide/sleep behavior
   - Sunny weather triggers play/run behavior
   - Ball physics work in play mode
   
3. **Performance:**
   - No noticeable CPU impact (tested with `htop`)
   - Animations smooth at 10 FPS (pet) + 30 FPS (audio)
   - Child process cleanup verified on plugin unload

## Screenshots / recordings

_Will add GIF/video showing:_
- Pet walking left-right
- Weather transitions (sunny → rain → pet hides)
- CAVA spectrum responding to music
- Pet running faster with audio

## Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR
- [x] Code follows existing TUI plugin patterns
- [x] No external dependencies added (uses built-in child_process)
- [x] Graceful fallback when CAVA unavailable

---

## Future Enhancements (Not in this PR)

- External pet config file (JSON) for custom ASCII art
- Multiple pet types (cat, dog, owl, bunny)
- Pet responds to session events (celebrates on success, sad on error)
- Configurable weather probability
- Pet "mood" system based on session activity
