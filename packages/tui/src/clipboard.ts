import {
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  decodePasteBytes,
  type ClipboardSelection,
  type ClipboardService as CoreClipboardService,
  type RendererClipboardBoundary,
} from "@opentui/core"
import type { ClipboardContent, ClipboardService } from "./context/clipboard"

export type OwnedClipboardService = Required<ClipboardService> & Readonly<{ dispose(): Promise<void> }>
export type ClipboardWriteSelection = ClipboardSelection | "both"

export function createTuiClipboard(
  renderer: RendererClipboardBoundary,
  selection: ClipboardWriteSelection,
): OwnedClipboardService {
  return createClipboardAdapter(
    createClipboard({
      host: createHostClipboard(),
      terminal: createRendererClipboardAdapter(renderer),
    }),
    selection,
  )
}

export function createClipboardAdapter(
  clipboard: CoreClipboardService,
  selection: ClipboardWriteSelection = "clipboard",
): OwnedClipboardService {
  const readSelection: ClipboardSelection = selection === "primary" ? "primary" : "clipboard"
  const writeSelections: ClipboardSelection[] = selection === "both" ? ["clipboard", "primary"] : [selection]

  return {
    async read(): Promise<ClipboardContent | undefined> {
      const result = await clipboard.read({
        preferredTypes: ["image/png", "text/plain"],
        selection: readSelection,
      })
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
      const payload = text.replaceAll("\0", "")
      const results = await Promise.all(
        writeSelections.map((selection) =>
          clipboard.writeText(payload, {
            destination: "all-available",
            selection,
          }),
        ),
      )
      if (results.some((result) => result.host.status === "written" || result.terminal.status === "attempted")) return
      const failure = results.map((result) => (result.host.status === "failed" ? result.host.error : undefined)).find(
        (error) => error !== undefined,
      )
      if (failure) throw failure
      const [first] = results
      throw new Error(`Clipboard write failed (host: ${first.host.status}, terminal: ${first.terminal.status})`)
    },
    dispose() {
      return clipboard.dispose()
    },
  }
}
