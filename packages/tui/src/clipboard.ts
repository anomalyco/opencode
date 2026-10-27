import {
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  decodePasteBytes,
  type ClipboardService as CoreClipboardService,
  type RendererClipboardBoundary,
} from "@opentui/core"
import { pathToFileURL } from "node:url"
import type { ClipboardContent, ClipboardService } from "./context/clipboard"

export type OwnedClipboardService = Required<ClipboardService> & Readonly<{ dispose(): Promise<void> }>

export function createTuiClipboard(renderer: RendererClipboardBoundary): OwnedClipboardService {
  return createClipboardAdapter(
    createClipboard({
      host: createHostClipboard(),
      terminal: createRendererClipboardAdapter(renderer),
    }),
    readPasteboardFiles,
  )
}

const PASTEBOARD_FILES_SCRIPT = `ObjC.import("AppKit"); const urls = $.NSPasteboard.generalPasteboard.readObjectsForClassesOptions($([$.NSURL]), $({ NSPasteboardURLReadingFileURLsOnlyKey: true })); (urls.js ?? []).map((url) => url.path.js).join("\\n")`

// Paths of files copied in Finder. OpenTUI reads only bitmaps and text, which for a Finder copy are the
// file icon and the bare file names.
export async function readPasteboardFiles() {
  if (process.platform !== "darwin") return []
  const read = async () => {
    const proc = Bun.spawn(["osascript", "-l", "JavaScript", "-e", PASTEBOARD_FILES_SCRIPT], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: 1000,
    })
    const [output, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    return code === 0 ? output.split("\n").filter(Boolean) : []
  }
  // A failed or stuck osascript must not break or block the paste.
  return read().catch(() => [])
}

export function createClipboardAdapter(
  clipboard: CoreClipboardService,
  pasteboardFiles: () => Promise<string[]> = async () => [],
): OwnedClipboardService {
  return {
    async read(): Promise<ClipboardContent | undefined> {
      const result = await clipboard.read({
        preferredTypes: ["image/png", "text/plain"],
        selection: "clipboard",
      })
      // A Finder copy reads as its file icon bitmap; hand the copied files to the paste path resolver instead.
      if (result.status === "read" && result.representation.mimeType === "image/png") {
        const files = await pasteboardFiles()
        if (files.length > 0)
          return { data: files.map((file) => pathToFileURL(file).href).join("\n"), mime: "text/plain" }
      }
      if (result.status !== "read") {
        if (result.status === "failed") throw result.error
        if (result.status === "timed-out") throw new Error("Clipboard read timed out")
        if (result.status === "limit-exceeded") {
          throw new RangeError("Clipboard content exceeded configured read or image conversion limits")
        }
        return undefined
      }

      if (result.representation.mimeType === "image/png") {
        return {
          data: Buffer.from(result.representation.bytes).toString("base64"),
          mime: result.representation.mimeType,
        }
      }
      if (result.representation.mimeType === "text/plain") {
        if (result.representation.bytes.length === 0) return undefined
        return {
          data: decodePasteBytes(result.representation.bytes),
          mime: result.representation.mimeType,
        }
      }
      throw new Error(`Unexpected clipboard MIME type: ${result.representation.mimeType}`)
    },
    async write(text) {
      // OpenTUI rejects NUL before any destination; host clipboard text cannot contain it.
      const result = await clipboard.writeText(text.replaceAll("\0", ""), {
        destination: "all-available",
        selection: "clipboard",
      })
      if (result.host.status === "written" || result.terminal.status === "attempted") return
      if (result.host.status === "failed") throw result.host.error
      throw new Error(`Clipboard write failed (host: ${result.host.status}, terminal: ${result.terminal.status})`)
    },
    dispose() {
      return clipboard.dispose()
    },
  }
}
