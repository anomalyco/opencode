import { getFilename } from "@opencode/util/path"
import type { Context, SessionScreen } from "@opencode/plugin/gui"

/**
 * Downloads a workspace file to the local machine.
 *
 * Loads the file through the session screen's `Files` API, then saves it through the
 * system save dialog (desktop) or a browser download (web). Text files save through
 * `ctx.system.save`; binary files that the server kept as raw bytes or a stream URL
 * download through a Blob or the URL directly, since `system.save` takes a string.
 *
 * @returns `true` when the download started, `false` when the file could not be loaded
 *   or its bytes were not retained.
 */
export async function downloadFile(ctx: Context, screen: SessionScreen, path: string): Promise<boolean> {
  const file = screen.file

  await file.sync(path, { force: true })

  const content = file.get(path)?.content

  if (!content) return false

  const name = getFilename(path)

  if (content.type === "text") {
    await ctx.system.save({ name, content: content.content })

    return true
  }

  // Binary: system.save takes a string, so stream or blob-download raw bytes instead.
  if (content.url) {
    const link = document.createElement("a")
    link.href = content.url
    link.download = name
    link.click()

    return true
  }

  if (content.bytes) {
    // Copy into a fresh array so the blob owns an `ArrayBuffer` rather than a possibly shared one.
    const blob = new Blob([new Uint8Array(content.bytes)], {
      type: content.mimeType ?? "application/octet-stream",
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)

    return true
  }

  return false
}
