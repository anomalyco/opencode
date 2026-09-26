import fs from "fs"
import * as tty from "node:tty"

export const INTERACTIVE_INPUT_ERROR = "--mini requires a controlling terminal for input"
export const PIPED_STDIN_MAX_BYTES = 10 * 1024 * 1024

export async function readPipedStdin(maxBytes = PIPED_STDIN_MAX_BYTES): Promise<string> {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = Bun.stdin.stream().getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        throw new Error(`Piped input exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB limit`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString("utf8")
}

type InteractiveStdin = {
  stdin: NodeJS.ReadStream
  cleanup?: () => void
}

function openTerminalStdin(path: string): NodeJS.ReadStream {
  return new tty.ReadStream(fs.openSync(path, "r"))
}

export function resolveInteractiveStdin(
  stdin: NodeJS.ReadStream = process.stdin,
  open: (path: string) => NodeJS.ReadStream = openTerminalStdin,
  platform = process.platform,
): InteractiveStdin {
  if (stdin.isTTY) {
    return { stdin }
  }

  const file = platform === "win32" ? "CONIN$" : "/dev/tty"

  try {
    const stream = open(file)
    return {
      stdin: stream,
      cleanup: () => {
        stream.destroy()
      },
    }
  } catch (error) {
    throw new Error(INTERACTIVE_INPUT_ERROR, { cause: error })
  }
}
