import type { ParsedKey } from "@opentui/core"

export const probePaste = (evt: ParsedKey, os = process.platform) => {
  const key = evt.name.toLowerCase()
  if (key !== "v") return false
  if (evt.ctrl) return true
  if (os !== "darwin") return false
  return Boolean(evt.super || evt.meta)
}
