import type { Keybind } from "@/util/keybind"

export const WINDOW_MS = 1500

export namespace ExitGuard {
  export function isCtrlC(info: Keybind.Info): boolean {
    return info.name === "c" && info.ctrl && !info.meta && !info.shift && !info.super && !info.leader
  }

  export function consume(input: {
    key: Keybind.Info
    pendingAt?: number
    now: number
    windowMs?: number
  }): {
    action: "confirm" | "exit"
    pendingAt?: number
  } {
    if (!isCtrlC(input.key)) {
      return { action: "exit" }
    }

    if (input.pendingAt === undefined) {
      return { action: "confirm", pendingAt: input.now }
    }

    if (input.now - input.pendingAt <= (input.windowMs ?? WINDOW_MS)) {
      return { action: "exit" }
    }

    return { action: "confirm", pendingAt: input.now }
  }
}
