import { existsSync } from "node:fs"
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

export type ClipboardAdapterOptions = {
  /**
   * Writes text to the Windows clipboard from WSL. Defaults to a `powershell.exe`
   * interop call. Injectable so tests never touch the real clipboard.
   */
  windowsClipboard?: (text: string) => Promise<void>
  /** Overrides WSL detection. Defaults to inspecting the environment. */
  wsl?: boolean
}

export function createTuiClipboard(renderer: RendererClipboardBoundary): OwnedClipboardService {
  return createClipboardAdapter(
    createClipboard({
      host: createHostClipboard(),
      terminal: createRendererClipboardAdapter(renderer),
    }),
  )
}

export function createClipboardAdapter(
  clipboard: CoreClipboardService,
  options: ClipboardAdapterOptions = {},
): OwnedClipboardService {
  const windowsClipboard = options.windowsClipboard ?? writeWindowsClipboard
  const wsl = options.wsl ?? isWSL()
  return {
    async read(): Promise<ClipboardContent | undefined> {
      const result = await clipboard.read({
        preferredTypes: ["image/png", "text/plain"],
        selection: "clipboard",
      })
      if (result.status !== "read") {
        if (result.status === "failed") throw result.error
        if (result.status === "timed-out") throw new Error("Clipboard read timed out")
        if (result.status === "unsupported") throw new Error("Clipboard read is not supported on this system")
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
      const content = text.replaceAll("\0", "")
      if (wsl) {
        // WSLg can report a successful host write that never reaches the Windows clipboard, and
        // Windows Terminal may ignore OSC 52, so mirror the copy through Windows interop too.
        const [interop, result] = await Promise.allSettled([
          windowsClipboard(content),
          clipboard.writeText(content, { destination: "all-available", selection: "clipboard" }),
        ])
        if (interop.status === "fulfilled") return
        if (result.status === "rejected") throw result.reason
        // Report a failure only when no route can have copied the text. A terminal whose OSC 52
        // capability is "unknown" may still handle the write, so keep the previous behaviour there.
        if (result.value.host.status === "written") return
        if (result.value.terminal.status === "attempted" && result.value.terminal.capability !== "unsupported") return
        throw interop.reason
      }
      const result = await clipboard.writeText(content, {
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

const WINDOWS_CLIPBOARD_WRITE = [
  // PowerShell decodes piped stdin with the console input encoding, which is UTF-16 by default.
  "[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)",
  "[Console]::In.ReadToEnd() | Set-Clipboard",
].join("; ")
const WINDOWS_CLIPBOARD_WRITE_TIMEOUT_MS = 3_000
const WSL_POWERSHELL = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"

// Containers on Docker Desktop or devcontainers on Windows run the WSL kernel without interop, so
// detect WSL by the variables it sets rather than the kernel release string.
function isWSL() {
  return process.platform === "linux" && Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP)
}

// Interop writes are serialised so a burst of copies lands in order and the newest one is last.
let windowsWriteQueue: Promise<void> = Promise.resolve()

function writeWindowsClipboard(text: string): Promise<void> {
  const write = windowsWriteQueue.then(() => writeWindowsClipboardRaw(text))
  windowsWriteQueue = write.catch(() => {})
  return write
}

async function writeWindowsClipboardRaw(text: string): Promise<void> {
  const powershell = windowsPowerShell()
  if (!powershell) {
    throw new Error("Clipboard copy under WSL needs powershell.exe interop, which is not available")
  }
  const child = Bun.spawn([powershell, "-NoProfile", "-NonInteractive", "-Command", WINDOWS_CLIPBOARD_WRITE], {
    stdin: new TextEncoder().encode(text),
    stdout: "ignore",
    stderr: "pipe",
  })
  // Drain stderr while the child runs so a full pipe cannot block it.
  const stderr = new Response(child.stderr).text()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill()
  }, WINDOWS_CLIPBOARD_WRITE_TIMEOUT_MS)
  try {
    const exit = await child.exited
    if (timedOut) throw new Error("Clipboard copy under WSL timed out waiting for powershell.exe")
    if (exit !== 0) {
      const message = (await stderr).trim()
      throw new Error(
        `Clipboard copy under WSL failed through powershell.exe (exit ${exit})${message ? `: ${message}` : ""}`,
      )
    }
  } finally {
    clearTimeout(timeout)
  }
}

// `appendWindowsPath=false` drops Windows executables from PATH even though interop still works,
// so fall back to the standard WSL mount location.
function windowsPowerShell(): string | undefined {
  const onPath = Bun.which("powershell.exe")
  if (onPath) return onPath
  return existsSync(WSL_POWERSHELL) ? WSL_POWERSHELL : undefined
}
