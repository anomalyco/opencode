import { isDeepEqual } from "remeda"
import type { ParsedKey } from "@opentui/core"

export namespace Keybind {
  /**
   * Keybind info derived from OpenTUI's ParsedKey with our custom `leader` field.
   * This ensures type compatibility and catches missing fields at compile time.
   * Now includes optional `baseCode` for physical key matching.
   */
  export type Info = Pick<ParsedKey, "name" | "ctrl" | "meta" | "shift" | "super" | "baseCode"> & {
    leader: boolean // our custom field
  }

  /**
   * Match options for keybind comparison
   */
  export interface MatchOptions {
    /**
     * Use physical key position (baseCode) instead of character name.
     * Enables keybindings to work correctly with non-English keyboard layouts
     * (Korean, Japanese, Chinese, AZERTY, Dvorak, etc.)
     */
    usePhysicalKeys?: boolean
  }

  /**
   * Match two keybinds.
   * When usePhysicalKeys is true and both have baseCode, matches by physical key position.
   * Otherwise falls back to character-based matching.
   */
  export function match(a: Info, b: Info, options: MatchOptions = {}): boolean {
    const { usePhysicalKeys = false } = options

    // Physical key matching: use baseCode when available
    if (usePhysicalKeys && a.baseCode !== undefined && b.baseCode !== undefined) {
      return (
        a.baseCode === b.baseCode &&
        a.ctrl === b.ctrl &&
        a.meta === b.meta &&
        a.shift === b.shift &&
        (a.super ?? false) === (b.super ?? false) &&
        a.leader === b.leader
      )
    }

    // Fallback: character-based matching (current behavior)
    // Normalize super field (undefined and false are equivalent)
    const normalizedA = { ...a, super: a.super ?? false, baseCode: undefined }
    const normalizedB = { ...b, super: b.super ?? false, baseCode: undefined }
    return isDeepEqual(normalizedA, normalizedB)
  }

  /**
   * Convert OpenTUI's ParsedKey to our Keybind.Info format.
   * This helper ensures all required fields are present and avoids manual object creation.
   * Now preserves baseCode for physical key matching.
   */
  export function fromParsedKey(key: ParsedKey, leader = false): Info {
    return {
      name: key.name,
      ctrl: key.ctrl,
      meta: key.meta,
      shift: key.shift,
      super: key.super ?? false,
      baseCode: key.baseCode,
      leader,
    }
  }

  export function toString(info: Info): string {
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
        baseCode: undefined,
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
            // Generate baseCode for single ASCII characters (a-z, 0-9, punctuation)
            if (part.length === 1) {
              const code = part.charCodeAt(0)
              // ASCII printable characters (32-126)
              if (code >= 32 && code <= 126) {
                info.baseCode = code
              }
            }
            break
        }
      }

      return info
    })
  }
}
