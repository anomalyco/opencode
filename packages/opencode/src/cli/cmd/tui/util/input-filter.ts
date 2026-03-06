import type { KeyEvent, ParsedKey } from "@opentui/core"

const LOCK = new Set(["capslock", "numlock", "scrolllock"])

export function privateuse(name: string) {
  const chars = [...name]
  if (chars.length !== 1) return false
  const code = chars[0].codePointAt(0)
  if (code === undefined) return false
  if (code >= 0xe000 && code <= 0xf8ff) return true
  if (code >= 0xf0000 && code <= 0xffffd) return true
  return code >= 0x100000 && code <= 0x10fffd
}

export function drop(key: Pick<ParsedKey, "name">) {
  if (!key.name) return false
  if (LOCK.has(key.name.toLowerCase())) return true
  return privateuse(key.name)
}

export function guard(key: Pick<KeyEvent, "name" | "preventDefault">) {
  if (!drop(key)) return false
  key.preventDefault()
  return true
}
