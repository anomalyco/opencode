// Audio-reactive blob controller with liquid physics
// Each orb reacts to different frequency bands independently
// Main circles also pulse with audio

interface OrbPhysics {
  x: number
  y: number
  vx: number
  vy: number
  targetX: number
  targetY: number
  scale: number
  targetScale: number
}

interface MainPhysics {
  x: number
  y: number
  vx: number
  vy: number
  targetX: number
  targetY: number
  radius: number
  targetRadius: number
  vr: number // velocity for radius
}

export class BlobAudioReactor {
  private listeningOrbs: SVGCircleElement[] = []
  private speakingOrbs: SVGCircleElement[] = []
  private listeningMain: SVGCircleElement | null = null
  private speakingMain: SVGCircleElement | null = null
  
  private userMicHandler: ((e: Event) => void) | null = null
  private agentAudioHandler: ((e: Event) => void) | null = null
  private animationFrame: number | null = null
  
  // Physics state for each orb
  private listeningPhysics: OrbPhysics[] = []
  private speakingPhysics: OrbPhysics[] = []
  
  // Physics state for main circles
  private listeningMainPhysics: MainPhysics = {
    x: 100, y: 100, vx: 0, vy: 0,
    targetX: 100, targetY: 100,
    radius: 60, targetRadius: 60, vr: 0
  }
  
  private speakingMainPhysics: MainPhysics = {
    x: 100, y: 100, vx: 0, vy: 0,
    targetX: 100, targetY: 100,
    radius: 72, targetRadius: 72, vr: 0
  }
  
  // Physics constants for thick liquid feel
  private readonly SPRING = 0.08 // Lower = more viscous
  private readonly DAMPING = 0.85 // Higher = more friction
  private readonly MAIN_SPRING = 0.04 // Main circle moves slower
  private readonly MAIN_DAMPING = 0.88 // Main circle has more friction
  private readonly MIN_VELOCITY = 0.01 // Stop threshold

  constructor() {
    this.setupEventListeners()
    this.startPhysicsLoop()
  }

  private setupEventListeners() {
    // Listen for YOUR microphone frequency bands
    this.userMicHandler = (e: Event) => {
      const bands = (e as CustomEvent).detail as number[]
      this.updateListeningTargets(bands)
    }

    // Listen for AGENT audio frequency bands
    this.agentAudioHandler = (e: Event) => {
      const bands = (e as CustomEvent).detail as number[]
      console.log('💜 BlobAudioReactor received agentAudioLevel:', bands.map(b => b.toFixed(2)).join(', '))
      this.updateSpeakingTargets(bands)
    }

    window.addEventListener('userMicLevel', this.userMicHandler)
    window.addEventListener('agentAudioLevel', this.agentAudioHandler)
  }

  private startPhysicsLoop() {
    const update = () => {
      this.updatePhysics()
      this.animationFrame = requestAnimationFrame(update)
    }
    update()
  }

  public attachListeningOrbs(orbs: SVGCircleElement[]) {
    this.listeningOrbs = orbs
    // Initialize physics for each orb
    this.listeningPhysics = orbs.map(() => ({
      x: 100, y: 100, vx: 0, vy: 0,
      targetX: 100, targetY: 100,
      scale: 1, targetScale: 1
    }))
    console.log('🎨 Attached', orbs.length, 'listening orbs with physics')
  }

  public attachSpeakingOrbs(orbs: SVGCircleElement[]) {
    this.speakingOrbs = orbs
    // Initialize physics for each orb
    this.speakingPhysics = orbs.map(() => ({
      x: 100, y: 100, vx: 0, vy: 0,
      targetX: 100, targetY: 100,
      scale: 1, targetScale: 1
    }))
    console.log('🎨 Attached', orbs.length, 'speaking orbs with physics')
  }

  public attachListeningMain(main: SVGCircleElement) {
    this.listeningMain = main
    console.log('🎨 Attached listening main circle with physics')
  }

  public attachSpeakingMain(main: SVGCircleElement) {
    this.speakingMain = main
    console.log('🎨 Attached speaking main circle with physics')
  }

  private updateListeningTargets(bands: number[]) {
    if (this.listeningPhysics.length === 0) return

    // Calculate average intensity for main circle
    const avgIntensity = bands.reduce((a, b) => a + b, 0) / bands.length

    // Update main circle target
    if (avgIntensity < 0.005) {
      this.listeningMainPhysics.targetRadius = 60 // Base radius
      this.listeningMainPhysics.targetX = 100
      this.listeningMainPhysics.targetY = 100
    } else {
      // Pulse radius based on audio
      const radiusPulse = Math.pow(avgIntensity, 0.5) * 15
      this.listeningMainPhysics.targetRadius = 60 + radiusPulse
      
      // Subtle drift
      const drift = avgIntensity * 3
      this.listeningMainPhysics.targetX = 100 + Math.sin(Date.now() / 1000) * drift
      this.listeningMainPhysics.targetY = 100 + Math.cos(Date.now() / 1000) * drift
    }

    // Update orbs
    this.listeningPhysics.forEach((physics, index) => {
      const bandLevel = bands[index] || 0
      
      if (bandLevel < 0.005) {
        // No sound - drift back to center
        physics.targetX = 100
        physics.targetY = 100
        physics.targetScale = 1
      } else {
        // Sound detected - move based on frequency band
        const intensity = Math.pow(bandLevel, 0.4) * 60
        const baseAngle = (index / bands.length) * Math.PI * 2
        const angleVariation = bandLevel * 3
        const angle = baseAngle + Math.sin(Date.now() / 1000 + index) * angleVariation
        
        physics.targetX = 100 + Math.cos(angle) * intensity
        physics.targetY = 100 + Math.sin(angle) * intensity
        physics.targetScale = 1 + bandLevel * 0.6
      }
    })
  }

  private updateSpeakingTargets(bands: number[]) {
    if (this.speakingPhysics.length === 0) return

    // Calculate average intensity for main circle
    const avgIntensity = bands.reduce((a, b) => a + b, 0) / bands.length

    // Update main circle target
    if (avgIntensity < 0.005) {
      this.speakingMainPhysics.targetRadius = 72 // Base radius
      this.speakingMainPhysics.targetX = 100
      this.speakingMainPhysics.targetY = 100
    } else {
      // Pulse radius based on audio
      const radiusPulse = Math.pow(avgIntensity, 0.5) * 18
      this.speakingMainPhysics.targetRadius = 72 + radiusPulse
      
      // Subtle drift
      const drift = avgIntensity * 3
      this.speakingMainPhysics.targetX = 100 + Math.sin(Date.now() / 1000) * drift
      this.speakingMainPhysics.targetY = 100 + Math.cos(Date.now() / 1000) * drift
    }

    // Update orbs
    this.speakingPhysics.forEach((physics, index) => {
      const bandLevel = bands[index] || 0
      
      if (bandLevel < 0.005) {
        // No sound - drift back to center
        physics.targetX = 100
        physics.targetY = 100
        physics.targetScale = 1
      } else {
        // Sound detected - move based on frequency band
        const intensity = Math.pow(bandLevel, 0.4) * 60
        const baseAngle = (index / bands.length) * Math.PI * 2
        const angleVariation = bandLevel * 3
        const angle = baseAngle + Math.sin(Date.now() / 1000 + index) * angleVariation
        
        physics.targetX = 100 + Math.cos(angle) * intensity
        physics.targetY = 100 + Math.sin(angle) * intensity
        physics.targetScale = 1 + bandLevel * 0.6
      }
    })
  }

  private updatePhysics() {
    // Update listening main circle
    if (this.listeningMain) {
      const p = this.listeningMainPhysics
      
      // Position physics
      const fx = (p.targetX - p.x) * this.MAIN_SPRING
      const fy = (p.targetY - p.y) * this.MAIN_SPRING
      p.vx = (p.vx + fx) * this.MAIN_DAMPING
      p.vy = (p.vy + fy) * this.MAIN_DAMPING
      p.x += p.vx
      p.y += p.vy
      
      // Radius physics
      const fr = (p.targetRadius - p.radius) * this.MAIN_SPRING
      p.vr = (p.vr + fr) * this.MAIN_DAMPING
      p.radius += p.vr
      
      // Apply to SVG
      this.listeningMain.setAttribute('cx', p.x.toFixed(1))
      this.listeningMain.setAttribute('cy', p.y.toFixed(1))
      this.listeningMain.setAttribute('r', p.radius.toFixed(1))
    }

    // Update speaking main circle
    if (this.speakingMain) {
      const p = this.speakingMainPhysics
      
      // Position physics
      const fx = (p.targetX - p.x) * this.MAIN_SPRING
      const fy = (p.targetY - p.y) * this.MAIN_SPRING
      p.vx = (p.vx + fx) * this.MAIN_DAMPING
      p.vy = (p.vy + fy) * this.MAIN_DAMPING
      p.x += p.vx
      p.y += p.vy
      
      // Radius physics
      const fr = (p.targetRadius - p.radius) * this.MAIN_SPRING
      p.vr = (p.vr + fr) * this.MAIN_DAMPING
      p.radius += p.vr
      
      // Apply to SVG
      this.speakingMain.setAttribute('cx', p.x.toFixed(1))
      this.speakingMain.setAttribute('cy', p.y.toFixed(1))
      this.speakingMain.setAttribute('r', p.radius.toFixed(1))
    }
    
    // Update listening orbs with liquid physics
    this.listeningOrbs.forEach((orb, index) => {
      const p = this.listeningPhysics[index]
      if (!p) return

      // Spring force towards target (with damping for thick liquid feel)
      const fx = (p.targetX - p.x) * this.SPRING
      const fy = (p.targetY - p.y) * this.SPRING
      
      // Apply forces to velocity
      p.vx += fx
      p.vy += fy
      
      // Apply damping (friction)
      p.vx *= this.DAMPING
      p.vy *= this.DAMPING
      
      // Update position
      p.x += p.vx
      p.y += p.vy
      
      // Smooth scale interpolation
      p.scale += (p.targetScale - p.scale) * 0.15
      
      // Stop when velocity is tiny (liquid settles)
      if (Math.abs(p.vx) < this.MIN_VELOCITY) p.vx = 0
      if (Math.abs(p.vy) < this.MIN_VELOCITY) p.vy = 0
      
      // Apply to SVG
      orb.setAttribute('cx', p.x.toFixed(1))
      orb.setAttribute('cy', p.y.toFixed(1))
      orb.setAttribute('transform', `scale(${p.scale.toFixed(2)})`)
      orb.setAttribute('transform-origin', '100 100')
    })

    // Update speaking orbs with liquid physics
    this.speakingOrbs.forEach((orb, index) => {
      const p = this.speakingPhysics[index]
      if (!p) return

      // Spring force towards target (with damping for thick liquid feel)
      const fx = (p.targetX - p.x) * this.SPRING
      const fy = (p.targetY - p.y) * this.SPRING
      
      // Apply forces to velocity
      p.vx += fx
      p.vy += fy
      
      // Apply damping (friction)
      p.vx *= this.DAMPING
      p.vy *= this.DAMPING
      
      // Update position
      p.x += p.vx
      p.y += p.vy
      
      // Smooth scale interpolation
      p.scale += (p.targetScale - p.scale) * 0.15
      
      // Stop when velocity is tiny (liquid settles)
      if (Math.abs(p.vx) < this.MIN_VELOCITY) p.vx = 0
      if (Math.abs(p.vy) < this.MIN_VELOCITY) p.vy = 0
      
      // Apply to SVG
      orb.setAttribute('cx', p.x.toFixed(1))
      orb.setAttribute('cy', p.y.toFixed(1))
      orb.setAttribute('transform', `scale(${p.scale.toFixed(2)})`)
      orb.setAttribute('transform-origin', '100 100')
    })
  }

  public destroy() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame)
    }
    if (this.userMicHandler) {
      window.removeEventListener('userMicLevel', this.userMicHandler)
    }
    if (this.agentAudioHandler) {
      window.removeEventListener('agentAudioLevel', this.agentAudioHandler)
    }
    this.listeningOrbs = []
    this.speakingOrbs = []
    this.listeningMain = null
    this.speakingMain = null
    this.listeningPhysics = []
    this.speakingPhysics = []
  }
}
