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
    process.env,
  )
}

export function createClipboardAdapter(
  clipboard: CoreClipboardService,
  env: Record<string, string | undefined> = {},
): OwnedClipboardService {
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
      const clean = text.replaceAll("\0", "")
      if (await writeTmux(clean, env)) {
        await clipboard.writeText(clean, { destination: "host-only", selection: "clipboard" })
        return
      }
      const result = await clipboard.writeText(clean, {
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

// Inside tmux, OpenTUI wraps OSC 52 in a DCS passthrough, which tmux drops unless allow-passthrough is on.
// load-buffer -w makes tmux itself forward the text to the terminal of the client showing this pane.
// Without -t, tmux may pick another attached client, so the copy would land on the wrong machine.
async function writeTmux(text: string, env: Record<string, string | undefined>) {
  if (!env.TMUX) return false
  const tmux = Bun.which("tmux", { PATH: env.PATH })
  if (!tmux) return false
  const target = await new Response(
    Bun.spawn(
      [
        tmux,
        "display-message",
        "-p",
        ...(env.TMUX_PANE ? ["-t", env.TMUX_PANE] : []),
        "#{client_tty}\t#{set-clipboard}",
      ],
      { env, stdout: "pipe", stderr: "ignore" },
    ).stdout,
  ).text()
  const [client, mode] = target.trimEnd().split("\t")
  if (!client || mode === "off") return false
  const exitCode = await Bun.spawn([tmux, "load-buffer", "-w", "-t", client, "-"], {
    env,
    stdin: new Blob([text]),
    stdout: "ignore",
    stderr: "ignore",
  }).exited
  return exitCode === 0
}
