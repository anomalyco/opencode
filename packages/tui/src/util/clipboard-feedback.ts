import type { ClipboardWriteResult } from "../context/clipboard"

export function clipboardFeedback(
  result: ClipboardWriteResult,
  success: { message: string; variant: "info" | "success" } = { message: "Copied to clipboard", variant: "info" },
) {
  if (result === "written") return success
  return { message: "Copy sent to terminal (requires OSC 52 support)", variant: "info" as const }
}
