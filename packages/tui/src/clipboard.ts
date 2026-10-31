import {
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  decodePasteBytes,
  type ClipboardService as CoreClipboardService,
  type RendererClipboardBoundary,
} from "@opentui/core"
import type { ClipboardContent, ClipboardService } from "./context/clipboard"

export type OwnedClipboardService = Required<ClipboardService> & Readonly<{ dispose(): Promise<void> }>

export function createTuiClipboard(renderer: RendererClipboardBoundary): OwnedClipboardService {
  return createClipboardAdapter(
    createClipboard({
      host: createHostClipboard(),
      terminal: createRendererClipboardAdapter(renderer),
    }),
  )
}

export function createClipboardAdapter(clipboard: CoreClipboardService): OwnedClipboardService {
  return {
    async read(): Promise<ClipboardContent | undefined> {
      const result = await clipboard.read({
        preferredTypes: ["image/png", "text/plain"],
        selection: "clipboard",
      })
      if (result.status !== "read") {
        if (result.status === "failed") throw result.error
        if (result.status === "timed-out") throw new Error("Clipboard read timed out")
        if (result.status === "limit-exceeded") {
          throw new RangeError("Clipboard content exceeded configured read or image conversion limits")
        }
        // WSL keeps the clipboard on the Windows side: Windows Terminal owns the selection and
        // the native host clipboard has no bridge to it, so this read fails unless WSLg forwards
        // Wayland. Read the Windows clipboard through interop instead.
        if (result.status === "cancelled" || !isWSL()) return undefined
        return readWindowsClipboard()
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

const WINDOWS_CLIPBOARD_IMAGE = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$image = [System.Windows.Forms.Clipboard]::GetImage()",
  "if (-not $image) { exit 0 }",
  "$stream = New-Object System.IO.MemoryStream",
  "$image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)",
  "[System.Convert]::ToBase64String($stream.ToArray())",
].join("; ")

// Containers on Docker Desktop or devcontainers on Windows also run the WSL kernel but have no
// interop, so detect WSL by the variables it sets instead of the kernel release.
function isWSL() {
  return process.platform === "linux" && Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP)
}

async function readWindowsClipboard(): Promise<ClipboardContent | undefined> {
  if (!Bun.which("powershell.exe")) {
    throw new Error("Clipboard image paste under WSL needs powershell.exe interop, which is not available")
  }
  const child = Bun.spawn(["powershell.exe", "-NonInteractive", "-NoProfile", "-Command", WINDOWS_CLIPBOARD_IMAGE], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  })
  const timeout = setTimeout(() => child.kill(), 10_000)
  try {
    const output = await new Response(child.stdout).text()
    if ((await child.exited) !== 0) throw new Error("Reading the Windows clipboard image failed")
    const data = output.trim()
    if (!data) return undefined
    return { data, mime: "image/png" }
  } finally {
    clearTimeout(timeout)
  }
}
