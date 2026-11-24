/**
 * The arcade 404's flow, shared by every version of the page: where the visitor is, and what
 * Escape (or the touch Back control) does from there.
 */

export type ArcadeMoment = "floor" | "drag" | "inserting" | "climb" | "select" | "play"

/**
 * Where a dropped token goes. Once the camera is on the coin door (the token was carried over the
 * cabinet), any drop is accepted: the slot pulls the token in from anywhere near it. Released
 * before that, away from the machine, it settles back on the floor where it lay. Nothing is rejected.
 */
export function dropOutcome(overCoinDoor: boolean): "insert" | "settle" {
  return overCoinDoor ? "insert" : "settle"
}

/**
 * Escape from a game goes back to the menu; from the powered-up machine (boot, start, menu) it
 * powers down and returns to the room: the 404 attract, the camera on the wide shot and the token
 * back on the floor. Elsewhere it does nothing.
 */
export function escapeAction(moment: ArcadeMoment): "exit-game" | "power-down" | undefined {
  if (moment === "play") return "exit-game"
  if (moment === "climb" || moment === "select") return "power-down"
  return undefined
}

/** The CRT collapsing to a line and a dot before the camera pulls back, in ms (0 with reduced motion). */
export const powerDownDuration = 420
