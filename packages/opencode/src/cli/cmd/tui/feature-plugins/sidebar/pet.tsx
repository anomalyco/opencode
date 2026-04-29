import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, onCleanup, For } from "solid-js"

// ============================================================================
// Constants & Types
// ============================================================================

const BALL = "●"
const FISH = "><>"
const RAINDROP = "'"

type PetState = "walk" | "run" | "sleep" | "play" | "eat" | "hide"
type Weather = "sunny" | "rain" | "cloudy"
type Direction = "left" | "right"

interface PetFrame {
  lines: string[]
}

interface WeatherFrame {
  lines: string[]
  emoji: string
}

// ============================================================================
// ASCII Art Database
// ============================================================================

const PET_FRAMES: Record<PetState, Record<Direction, PetFrame>> = {
  walk: {
    left: { lines: ["   /\\_/\\   ", "  ( o.o )  ", "  />  <\\  "] },
    right: { lines: ["   /\\_/\\   ", "  ( o.o )  ", "  />  <\\  "] },
  },
  run: {
    left: { lines: ["  /\\_/\\    ", " ( >o< )~  ", " />  <\\   "] },
    right: { lines: ["   /\\_/\\   ", " ~( >o< )  ", "  />  <\\  "] },
  },
  sleep: {
    left: { lines: ["   /\\_/\\   ", "  ( - - )  ", "  (__n__)  "] },
    right: { lines: ["   /\\_/\\   ", "  ( - - )  ", "  (__n__)  "] },
  },
  play: {
    left: { lines: ["   /\\_/\\   ", "  ( ^o^ )  ", "  />  <\\  "] },
    right: { lines: ["   /\\_/\\   ", "  ( ^o^ )  ", "  />  <\\  "] },
  },
  eat: {
    left: { lines: ["   /\\_/\\   ", "  ( @.@ )  ", "  />  <\\  "] },
    right: { lines: ["   /\\_/\\   ", "  ( @.@ )  ", "  />  <\\  "] },
  },
  hide: {
    left: { lines: ["   ____    ", "  |    |   ", "  | o.o|   "] },
    right: { lines: ["   ____    ", "  |    |   ", "  | o.o|   "] },
  },
}

const WEATHER_FRAMES: Record<Weather, WeatherFrame> = {
  sunny: {
    lines: ["   \\|/    ", "  --O--   ", "   /|\\    "],
    emoji: "☀️",
  },
  rain: {
    lines: ["  .--.    ", " (    ).  ", "(___.__)  "],
    emoji: "🌧️",
  },
  cloudy: {
    lines: ["   .--.   ", " .(    ). ", "(___.__)  "],
    emoji: "☁️",
  },
}

const RAIN_PATTERNS = [
  [" ' ' ' ' '", "' ' ' ' ' ", " ' ' ' ' '"],
  ["' ' ' ' ' ", " ' ' ' ' '", "' ' ' ' ' "],
  [" ' ' ' ' '", "' ' ' ' ' ", " ' ' ' ' '"],
]

// ============================================================================
// Pet State Machine
// ============================================================================

class PetStateMachine {
  private state: PetState = "walk"
  private weather: Weather = "sunny"

  getNextState(currentWeather: Weather): PetState {
    this.weather = currentWeather
    const r = Math.random()

    if (currentWeather === "rain") {
      if (r < 0.4) return "hide"
      if (r < 0.7) return "sleep"
      return "walk"
    }

    if (currentWeather === "sunny") {
      if (r < 0.3) return "play"
      if (r < 0.5) return "run"
      if (r < 0.8) return "walk"
      return "eat"
    }

    // Cloudy
    if (r < 0.4) return "walk"
    if (r < 0.6) return "sleep"
    if (r < 0.8) return "play"
    return "eat"
  }

  getStateLabel(state: PetState): string {
    const labels: Record<PetState, string> = {
      walk: "walking...",
      run: "running!",
      sleep: "zzZ...",
      play: "playing!",
      eat: "nom nom",
      hide: "hiding from rain",
    }
    return labels[state]
  }
}

// ============================================================================
// Layout Renderer
// ============================================================================

class PetLayoutRenderer {
  private readonly CANVAS_WIDTH = 30
  private readonly PET_CENTER = 15

  renderPetWithToy(
    petLines: string[],
    petX: number,
    state: PetState,
    ballX: number
  ): string[] {
    const result = [...petLines]
    const petPos = this.PET_CENTER + Math.round(petX)
    const indent = " ".repeat(Math.max(0, petPos))

    // Apply pet indent to all lines
    result[0] = indent + result[0]
    result[1] = indent + result[1]
    result[2] = indent + result[2]

    // Add toy on middle line (line 1)
    if (state === "play") {
      const ballPos = this.PET_CENTER + Math.round(ballX)
      const ballIndent = " ".repeat(Math.max(0, ballPos))
      
      if (ballPos < petPos) {
        // Ball is to the left of pet
        const gap = " ".repeat(Math.max(0, petPos - ballPos - 1))
        result[1] = ballIndent + BALL + gap + result[1].trim()
      } else {
        // Ball is to the right of pet
        const gap = " ".repeat(Math.max(0, ballPos - petPos - result[1].trim().length))
        result[1] = result[1] + gap + BALL
      }
    } else if (state === "eat") {
      result[1] = result[1] + " " + FISH
    }

    return result
  }

  renderRain(frameIndex: number): string[] {
    return RAIN_PATTERNS[frameIndex % RAIN_PATTERNS.length]
  }

  renderEmptyLines(count: number): string[] {
    return Array(count).fill(" ".repeat(this.CANVAS_WIDTH))
  }
}

// ============================================================================
// Pet Widget Component
// ============================================================================

function PetWidget(props: { api: TuiPluginApi; session_id: string; audioLevel?: number }) {
  const theme = () => props.api.theme.current

  // State
  const [petState, setPetState] = createSignal<PetState>("walk")
  const [petX, setPetX] = createSignal(0)
  const [petDir, setPetDir] = createSignal<Direction>("right")
  const [weather, setWeather] = createSignal<Weather>("sunny")
  const [ballX, setBallX] = createSignal(5)
  const [ballVelX, setBallVelX] = createSignal(1)
  const [rainFrame, setRainFrame] = createSignal(0)

  // Helpers
  const stateMachine = new PetStateMachine()
  const renderer = new PetLayoutRenderer()

  // Animation loop - 10 FPS
  const animTimer = setInterval(() => {
    setRainFrame((f) => (f + 1) % 3)

    const audioBoost = (props.audioLevel ?? 0) > 0.3 ? 1.5 : 1
    const state = petState()

    // Pet movement
    if (state === "walk" || state === "run") {
      const speed = (state === "run" ? 0.5 : 0.2) * audioBoost
      setPetX((x) => {
        const next = x + (petDir() === "right" ? speed : -speed)
        if (next > 8) {
          setPetDir("left")
          return 8
        }
        if (next < -8) {
          setPetDir("right")
          return -8
        }
        return next
      })
    }

    // Ball physics
    if (state === "play") {
      setBallX((x) => {
        const next = x + ballVelX()
        if (next > 10 || next < -10) {
          setBallVelX((v) => -v)
          return next > 10 ? 10 : -10
        }
        return next
      })
    }
  }, 100)

  // State transitions
  const stateTimer = setInterval(() => {
    setPetState(stateMachine.getNextState(weather()))
  }, Math.random() * 5000 + 3000)

  // Weather changes
  const weatherTimer = setInterval(() => {
    const r = Math.random()
    if (r < 0.4) setWeather("sunny")
    else if (r < 0.7) setWeather("cloudy")
    else setWeather("rain")
  }, Math.random() * 10000 + 10000)

  onCleanup(() => {
    clearInterval(animTimer)
    clearInterval(stateTimer)
    clearInterval(weatherTimer)
  })

  // Computed values
  const currentWeather = createMemo(() => WEATHER_FRAMES[weather()])
  
  const currentPetFrame = createMemo(() => {
    return PET_FRAMES[petState()][petDir()]
  })

  const rainLines = createMemo(() => {
    return weather() === "rain"
      ? renderer.renderRain(rainFrame())
      : renderer.renderEmptyLines(3)
  })

  const petLines = createMemo(() => {
    return renderer.renderPetWithToy(
      currentPetFrame().lines,
      petX(),
      petState(),
      ballX()
    )
  })

  const weatherColor = createMemo(() => {
    const t = theme()
    const w = weather()
    if (w === "sunny") return t.warning
    if (w === "rain") return t.info
    return t.textMuted
  })

  const stateLabel = createMemo(() => {
    return stateMachine.getStateLabel(petState())
  })

  return (
    <box>
      {/* Header */}
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme().text}>
          <b>Pet</b>
        </text>
        <text fg={weatherColor()}>{currentWeather().emoji}</text>
      </box>

      {/* Weather (3 lines) */}
      <For each={currentWeather().lines}>
        {(line) => <text fg={weatherColor()}>{line}</text>}
      </For>

      {/* Rain (3 lines) */}
      <For each={rainLines()}>
        {(line) => <text fg={theme().info}>{line}</text>}
      </For>

      {/* Pet with toy (3 lines) */}
      <For each={petLines()}>
        {(line) => <text fg={theme().accent}>{line}</text>}
      </For>

      {/* State label (1 line) */}
      <text fg={theme().textMuted}>{stateLabel()}</text>
    </box>
  )
}

export { PetWidget }
