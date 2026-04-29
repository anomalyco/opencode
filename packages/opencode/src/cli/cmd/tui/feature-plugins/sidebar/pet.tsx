import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, onCleanup, For } from "solid-js"

// ============================================================================
// ASCII Pet Art - More detailed
// ============================================================================

const CAT_WALK_LEFT = [
  "   /\\_/\\   ",
  "  ( o.o )  ",
  "  />  <\\  ",
]

const CAT_WALK_RIGHT = [
  "   /\\_/\\   ",
  "  ( o.o )  ",
  "  />  <\\  ",
]

const CAT_RUN_LEFT = [
  "  /\\_/\\    ",
  " ( >o< )~  ",
  " />  <\\   ",
]

const CAT_RUN_RIGHT = [
  "   /\\_/\\   ",
  " ~( >o< )  ",
  "  />  <\\  ",
]

const CAT_SLEEP = [
  "   /\\_/\\   ",
  "  ( - - )  ",
  "  (__n__)  ",
]

const CAT_PLAY = [
  "   /\\_/\\   ",
  "  ( ^o^ )  ",
  "  />  <\\  ",
]

const CAT_EAT = [
  "   /\\_/\\   ",
  "  ( @.@ )  ",
  "  />  <\\  ",
]

const CAT_HIDE = [
  "   ____    ",
  "  |    |   ",
  "  | o.o|   ",
]

// Weather ASCII art
const WEATHER_SUNNY = [
  "   \\|/    ",
  "  --O--   ",
  "   /|\\    ",
]

const WEATHER_RAIN = [
  "  .--.    ",
  " (    ).  ",
  "(___.__)  ",
  " / / / /  ",
]

const WEATHER_CLOUDY = [
  "   .--.   ",
  " .(    ). ",
  "(___.__)  ",
]

const BALL = "●"
const FISH = "><>"

type PetState = "walk" | "run" | "sleep" | "play" | "eat" | "hide"
type Weather = "sunny" | "rain" | "cloudy"

// ============================================================================
// Pet Widget with Movement and Weather Response
// ============================================================================

function PetWidget(props: { api: TuiPluginApi; session_id: string; audioLevel?: number }) {
  const theme = () => props.api.theme.current
  
  // Pet state
  const [petState, setPetState] = createSignal<PetState>("walk")
  const [petX, setPetX] = createSignal(0) // -10 to 10
  const [petDir, setPetDir] = createSignal<"left" | "right">("right")
  const [frame, setFrame] = createSignal(0)
  
  // Weather state
  const [weather, setWeather] = createSignal<Weather>("sunny")
  const [rainDrops, setRainDrops] = createSignal<Array<{ x: number; y: number }>>([])
  
  // Ball/toy position
  const [ballX, setBallX] = createSignal(5)
  const [ballY, setBallY] = createSignal(0)
  const [ballVelX, setBallVelX] = createSignal(1)
  const [ballVelY, setBallVelY] = createSignal(0)

  // Animation loop - 10 FPS
  const animTimer = setInterval(() => {
    setFrame(f => (f + 1) % 2)
    
    const currentWeather = weather()
    const currentState = petState()
    const audioBoost = (props.audioLevel ?? 0) > 0.3 ? 1.5 : 1
    
    // Pet movement logic
    if (currentState === "walk" || currentState === "run") {
      const speed = currentState === "run" ? 0.5 * audioBoost : 0.2
      setPetX(x => {
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
    if (currentState === "play") {
      setBallX(x => {
        const next = x + ballVelX()
        if (next > 10 || next < -10) {
          setBallVelX(v => -v)
          return next > 10 ? 10 : -10
        }
        return next
      })
      setBallY(y => {
        const next = y + ballVelY()
        if (next > 2) {
          setBallVelY(-0.5)
          return 2
        }
        if (next < 0) {
          setBallVelY(0.5)
          return 0
        }
        return next
      })
    }
    
    // Rain drops
    if (currentWeather === "rain") {
      setRainDrops(drops => {
        const next = drops.map(d => ({ ...d, y: d.y + 1 })).filter(d => d.y < 5)
        if (Math.random() < 0.4) {
          next.push({ x: Math.floor(Math.random() * 20) - 10, y: 0 })
        }
        return next
      })
    }
  }, 100)

  // State transitions - every 3-8 seconds
  const stateTimer = setInterval(() => {
    const currentWeather = weather()
    const r = Math.random()
    
    // Weather influences behavior
    if (currentWeather === "rain") {
      // 70% chance to hide or sleep when raining
      if (r < 0.4) setPetState("hide")
      else if (r < 0.7) setPetState("sleep")
      else setPetState("walk")
    } else if (currentWeather === "sunny") {
      // Active when sunny
      if (r < 0.3) setPetState("play")
      else if (r < 0.5) setPetState("run")
      else if (r < 0.8) setPetState("walk")
      else setPetState("eat")
    } else {
      // Cloudy - normal behavior
      if (r < 0.4) setPetState("walk")
      else if (r < 0.6) setPetState("sleep")
      else if (r < 0.8) setPetState("play")
      else setPetState("eat")
    }
  }, Math.random() * 5000 + 3000)

  // Weather changes - every 10-20 seconds
  const weatherTimer = setInterval(() => {
    const r = Math.random()
    if (r < 0.4) setWeather("sunny")
    else if (r < 0.7) setWeather("cloudy")
    else setWeather("rain")
    
    if (weather() !== "rain") setRainDrops([])
  }, Math.random() * 10000 + 10000)

  onCleanup(() => {
    clearInterval(animTimer)
    clearInterval(stateTimer)
    clearInterval(weatherTimer)
  })

  // Render pet art based on state
  const petArt = createMemo(() => {
    const state = petState()
    const dir = petDir()
    const f = frame()
    
    if (state === "sleep") return CAT_SLEEP
    if (state === "hide") return CAT_HIDE
    if (state === "eat") return CAT_EAT
    if (state === "play") return CAT_PLAY
    if (state === "run") return dir === "left" ? CAT_RUN_LEFT : CAT_RUN_RIGHT
    return dir === "left" ? CAT_WALK_LEFT : CAT_WALK_RIGHT
  })

  const weatherArt = createMemo(() => {
    const w = weather()
    if (w === "sunny") return WEATHER_SUNNY
    if (w === "rain") return WEATHER_RAIN
    return WEATHER_CLOUDY
  })

  const petIndent = createMemo(() => {
    const x = Math.round(petX())
    return " ".repeat(Math.max(0, 10 + x))
  })

  const ballIndent = createMemo(() => {
    const x = Math.round(ballX())
    return " ".repeat(Math.max(0, 10 + x))
  })

  const stateLabel = createMemo(() => {
    const s = petState()
    if (s === "walk") return "walking..."
    if (s === "run") return "running!"
    if (s === "sleep") return "zzZ..."
    if (s === "play") return "playing!"
    if (s === "eat") return "nom nom"
    if (s === "hide") return "hiding from rain"
    return s
  })

  const weatherColor = createMemo(() => {
    const w = weather()
    const t = theme()
    if (w === "sunny") return t.warning
    if (w === "rain") return t.info
    return t.textMuted
  })

  return (
    <box>
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme().text}>
          <b>Pet</b>
        </text>
        <text fg={weatherColor()}>{weather() === "sunny" ? "☀️" : weather() === "rain" ? "🌧️" : "☁️"}</text>
      </box>
      
      {/* Weather display */}
      <For each={weatherArt()}>
        {(line) => <text fg={weatherColor()}>{line}</text>}
      </For>
      
      {/* Rain drops */}
      {weather() === "rain" && (
        <box>
          <For each={rainDrops()}>
            {(drop) => <text fg={theme().info}>{" ".repeat(Math.max(0, 10 + drop.x)) + "."}</text>}
          </For>
        </box>
      )}
      
      {/* Pet */}
      <For each={petArt()}>
        {(line) => <text fg={theme().accent}>{petIndent()}{line}</text>}
      </For>
      
      {/* Ball/toy */}
      {petState() === "play" && (
        <text fg={theme().warning}>{ballIndent()}{BALL}</text>
      )}
      
      {petState() === "eat" && (
        <text fg={theme().success}>{petIndent()}{FISH}</text>
      )}
      
      <text fg={theme().textMuted}>{stateLabel()}</text>
    </box>
  )
}

export { PetWidget }
