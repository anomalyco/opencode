import { isDeepEqual } from "remeda"
import type { ParsedKey } from "@opentui/core"

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
    const normalized = (() => {
      if (typeof key.name !== "string") return key

      // Some terminals encode Ctrl+<key> as an ASCII control character.
      // Normalize those to the expected key name + ctrl modifier.
      //
      // NOTE: We intentionally avoid mapping ambiguous codes that commonly
      // overlap with dedicated special keys in terminals.
      const code = key.name.length === 1 ? key.name.charCodeAt(0) : -1

      // Ctrl+Underscore is often represented as \x1F.
      if (code === 0x1f) return { ...key, name: "_", ctrl: true }

      // Map ASCII control codes 1..26 (Ctrl+A..Ctrl+Z) to letters.
      // Skip: backspace (0x08), tab (0x09), linefeed (0x0A), carriage return (0x0D)
      // because those are frequently emitted by non-ctrl special keys.
      if (code >= 0x01 && code <= 0x1a && code !== 0x08 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
        return { ...key, name: String.fromCharCode(code + 0x60), ctrl: true }
      }

      // Normalize single-character names to lowercase for stable matching.
      if (key.name.length === 1) {
        const lower = key.name.toLowerCase()
        if (lower !== key.name) return { ...key, name: lower }
      }

      return key
    })()

    return {
      name: normalized.name,
      ctrl: normalized.ctrl,
      meta: normalized.meta,
      shift: normalized.shift,
      super: normalized.super ?? false,
      leader,
    }
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
