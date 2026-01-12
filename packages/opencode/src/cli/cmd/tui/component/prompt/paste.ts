import { Clipboard } from "../../util/clipboard"

export async function resolvePastedContent(
  eventText: string,
  readClipboard: () => Promise<Clipboard.Content | undefined>,
): Promise<string | undefined> {
  // Normalize and use paste payload when terminals supply text directly
  const normalized = eventText.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const text = normalized.trim()
  if (text) return text

  // Finder copy often yields empty paste events; fallback to clipboard text
  const clipboardContent = await readClipboard()
  const clipboardText = clipboardContent?.mime.startsWith("text/") ? clipboardContent.data : undefined
  if (!clipboardText) return
  return clipboardText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
}
