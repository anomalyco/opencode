import { isDeepEqual } from "remeda"
import type { ParsedKey } from "@opentui/core"

/**
 * Numpad key name mapping from OpenTUI ParsedKey names
 * Handles kitty protocol names (kp0-kp9, kpenter, etc.)
 */
const NUMPAD_KEY_NAMES = new Set([
  "kp0",
  "kp1",
  "kp2",
  "kp3",
  "kp4",
  "kp5",
  "kp6",
  "kp7",
  "kp8",
  "kp9",
  "kpdecimal",
  "kpdivide",
  "kpmultiply",
  "kpplus",
  "kpminus",
  "kpenter",
  "kpequal",
  "kphome",
  "kpend",
  "kppgup",
  "kppgdn",
  "kpup",
  "kpdown",
  "kpleft",
  "kpright",
  "kpdelete",
  "kpbackspace",
])

/**
 * Check if a key event should be treated as Enter/Return.
 * Includes main keyboard Enter and numpad Enter variants.
 */
export function isEnterKey(key: { name: string }): boolean {
  return key.name === "return" || key.name === "kpenter"
}

export namespace Keybind {
  /**
   * Keybind info derived from OpenTUI's ParsedKey with our custom `leader` field.
   * This ensures type compatibility and catches missing fields at compile time.
   */
  export type Info = Pick<ParsedKey, "name" | "ctrl" | "meta" | "shift" | "super"> & {
    leader: boolean // our custom field
  }

  export function match(a: Info | undefined, b: Info): boolean {
    if (!a) return false
    const normalizedA = { ...a, super: a.super ?? false }
    const normalizedB = { ...b, super: b.super ?? false }
    return isDeepEqual(normalizedA, normalizedB)
  }

  /**
   * Convert OpenTUI's ParsedKey to our Keybind.Info format.
   * This helper ensures all required fields are present and avoids manual object creation.
   */
  export function fromParsedKey(key: ParsedKey, leader = false): Info {
    // Detect numpad keys from kitty protocol or legacy sequences
    const detectedNumpad = detectNumpadKeyName(key)

    return {
      name: detectedNumpad ?? (key.name === " " ? "space" : key.name),
      ctrl: key.ctrl,
      meta: key.meta,
      shift: key.shift,
      super: key.super ?? false,
      leader,
    }
  }

  /**
   * Detect numpad key name from ParsedKey
   *
   * Handles:
   * - Kitty protocol: name already contains "kp*" names
   * - Legacy SS3 sequences: \x1bO0-\x1bO9 mapped to kp0-kp9
   * - Terminal limitation: raw digits (NumLock ON in VSCode) treated as numpad
   */
  function detectNumpadKeyName(key: ParsedKey): string | null {
    // Already detected by OpenTUI (kitty protocol)
    if (key.name && NUMPAD_KEY_NAMES.has(key.name)) {
      return key.name
    }

    // Legacy SS3 sequences (DEC Aided Key mode)
    const sequence = (key as { sequence?: string }).sequence
    if (sequence) {
      // Match SS3 numpad: \x1bO followed by digit
      const ss3Match = sequence.match(/^\x1bO([0-9])$/)
      if (ss3Match) {
        return "kp" + ss3Match[1]
      }

      // Match SS3 numpad operators
      const ss3OpMap: Record<string, string> = {
        "\x1bO*": "kpmultiply",
        "\x1bO+": "kpplus",
        "\x1bO-": "kpminus",
        "\x1bO/": "kpdivide",
        "\x1bO.": "kpdecimal",
        "\x1b[3~": "kpdelete",
        "\x1b[1~": "kphome",
        "\x1b[4~": "kpend",
        "\x1b[5~": "kppgup",
        "\x1b[6~": "kppgdn",
        "\x1bOA": "kpup",
        "\x1bOB": "kpdown",
        "\x1bOC": "kpright",
        "\x1bOD": "kpleft",
      }
      if (ss3OpMap[sequence]) {
        return ss3OpMap[sequence]
      }
    }

    // modifyOtherKeys numpad codes (48-57 = kp0-kp9)
    if (sequence) {
      const csiuMatch = sequence.match(/^\x1b\[\d+;?[0-9]*u$/)
      if (csiuMatch) {
        const codeMatch = sequence.match(/\x1b\[(\d+);?(\d*)u/)
        if (codeMatch) {
          const code = parseInt(codeMatch[1])
          if (code >= 48 && code <= 57) {
            const digit = code - 48
            return "kp" + digit
          }
        }
      }
    }

    return null
  }

  export function toString(info: Info | undefined): string {
    if (!info) return ""
    const parts: string[] = []

    if (info.ctrl) parts.push("ctrl")
    if (info.meta) parts.push("alt")
    if (info.super) parts.push("super")
    if (info.shift) parts.push("shift")
    if (info.name) {
      if (info.name === "delete") parts.push("del")
      else parts.push(info.name)
    }

    let result = parts.join("+")

    if (info.leader) {
      result = result ? `<leader> ${result}` : `<leader>`
    }

    return result
  }

  export function parse(key: string): Info[] {
    if (key === "none") return []

    return key.split(",").map((combo) => {
      // Handle <leader> syntax by replacing with leader+
      const normalized = combo.replace(/<leader>/g, "leader+")
      const parts = normalized.toLowerCase().split("+")
      const info: Info = {
        ctrl: false,
        meta: false,
        shift: false,
        leader: false,
        name: "",
      }

      for (const part of parts) {
        switch (part) {
          case "ctrl":
            info.ctrl = true
            break
          case "alt":
          case "meta":
          case "option":
            info.meta = true
            break
          case "super":
            info.super = true
            break
          case "shift":
            info.shift = true
            break
          case "leader":
            info.leader = true
            break
          case "esc":
            info.name = "escape"
            break
          default:
            info.name = part
            break
        }
      }

      return info
    })
  }
}
