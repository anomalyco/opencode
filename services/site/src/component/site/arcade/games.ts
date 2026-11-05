/** The Anomaly Arcade games (anoma.ly/arcade) and their controls, from the arcade repo's docs/controls.md. */

export type ButtonAction = { label: string; code: string; key: string } | { label: string; mouse: true }

export type Game = {
  id: "blackout" | "getaway" | "carrier"
  name: string
  genre: string
  cover: string
  /** The six panel buttons, in reading order (top row, then bottom row). Empty slots stay dark. */
  buttons: (ButtonAction | undefined)[]
  hint: string
  /** Query that skips the game's lobby into solo play, where the game has one. */
  launch: string
}

const key = (label: string, code: string, value: string): ButtonAction => ({ label, code, key: value })

export const games: Game[] = [
  {
    id: "blackout",
    name: "Blackout",
    genre: "Stealth shooter",
    cover: "/arcade404/cover-blackout.webp",
    buttons: [
      { label: "Fire", mouse: true },
      key("Reload", "KeyR", "r"),
      key("Sprint", "ShiftLeft", "Shift"),
      key("Use", "KeyE", "e"),
      key("Equip", "KeyG", "g"),
      key("Melee", "KeyV", "v"),
    ],
    hint: "WASD move · mouse aim · click shoot",
    launch: "?practice",
  },
  {
    id: "getaway",
    name: "Getaway",
    genre: "Cops and robbers",
    cover: "/arcade404/cover-getaway.webp",
    buttons: [
      key("Drift", "Space", " "),
      key("Nitro", "ShiftLeft", "Shift"),
      key("Gadget", "KeyQ", "q"),
      key("Engine", "KeyH", "h"),
      undefined,
      undefined,
    ],
    hint: "WASD drive · Space drift · Shift nitro",
    launch: "?solo",
  },
  {
    id: "carrier",
    name: "Carrier",
    genre: "Naval combat",
    cover: "/arcade404/cover-carrier.webp",
    buttons: [
      key("Fire", "Space", " "),
      key("Boost", "ShiftLeft", "Shift"),
      key("Flares", "KeyF", "f"),
      key("Deploy", "KeyE", "e"),
      key("Camera", "KeyC", "c"),
      key("Map", "KeyG", "g"),
    ],
    hint: "WASD steer · mouse look · E deploy",
    // Carrier has no solo mode: its menu asks for a callsign and joins a live room.
    launch: "",
  },
]

/**
 * Where the game loads. In development the Vite server proxies anoma.ly/arcade under our own
 * origin (/arcade-proxy, vite.config.ts), so the touch panel can dispatch synthetic input into
 * the same-origin frame.
 * TODO(arcade-input-bridge): production cannot reach into the cross-origin frame. It needs the
 * arcade's embed mode: an allowlisted `postMessage` bridge (`arcade-input` key and pointer
 * messages fed into each game's input) plus `frame-ancestors https://opencode.ai`.
 */
export const gameUrl = (game: Game) =>
  `${import.meta.env.DEV ? `/arcade-proxy/${game.id}/` : `https://anoma.ly/arcade/${game.id}/`}${game.launch}`

export const publicGameUrl = (id: Game["id"]) => `https://anoma.ly/arcade/${id}/`

/** Synthetic input for the dev proxy. Returns false when the frame is cross-origin. */
export function sendKey(frame: HTMLIFrameElement | undefined, type: "keydown" | "keyup", code: string, value: string) {
  const win = frameWindow(frame)
  if (!win) return false
  // From the focused element (or the body) it bubbles up to the window, where the games listen.
  const target = win.document.activeElement ?? win.document.body
  target.dispatchEvent(new win.KeyboardEvent(type, { code, key: value, bubbles: true, cancelable: true }))
  return true
}

/** Synthetic mouse button on the game's canvas, at the frame's centre or a given point. */
export function sendMouse(
  frame: HTMLIFrameElement | undefined,
  type: "mousedown" | "mouseup",
  at?: { x: number; y: number },
) {
  const win = frameWindow(frame)
  if (!win) return false
  const x = at?.x ?? win.innerWidth / 2
  const y = at?.y ?? win.innerHeight / 2
  const target = win.document.elementFromPoint(x, y) ?? win.document.body
  const init = {
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === "mousedown" ? 1 : 0,
    bubbles: true,
    cancelable: true,
  }
  target.dispatchEvent(
    new win.PointerEvent(type === "mousedown" ? "pointerdown" : "pointerup", {
      ...init,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    }),
  )
  target.dispatchEvent(new win.MouseEvent(type, init))
  return true
}

type FrameWindow = Window & typeof globalThis

function frameWindow(frame: HTMLIFrameElement | undefined) {
  try {
    const win = frame?.contentWindow as FrameWindow | null | undefined
    // Reading the document throws on a cross-origin frame.
    return win && win.document ? win : undefined
  } catch {
    return undefined
  }
}
