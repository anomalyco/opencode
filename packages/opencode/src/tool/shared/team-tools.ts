import { MessageV2 } from "../../session/message-v2"

export function clip(text?: string, max = 500) {
  if (!text) return ""
  if (text.length <= max) return text
  return text.slice(0, max - 3) + "..."
}

export function body(msg?: MessageV2.WithParts, max = 500) {
  return clip(
    msg?.parts
      .filter((part): part is MessageV2.TextPart => part.type === "text" && part.ignored !== true)
      .map((part) => part.text)
      .join(""),
    max,
  )
}

export function err(msg?: MessageV2.Assistant["error"]) {
  if (!msg) return ""
  if ("message" in msg.data && typeof msg.data.message === "string") return msg.data.message
  return msg.name
}

export function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`
}
