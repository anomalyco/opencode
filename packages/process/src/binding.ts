import { createRequire } from "node:module"
import path from "node:path"

export interface Command {
  readonly executable: string
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string | undefined>>
}

export interface Launch {
  executable: string
  args: readonly string[]
  cwd?: string
  env?: Record<string, string>
  overlapped: boolean
}

export interface NativeProcess {
  readonly pid: number
  readonly exited: Promise<number>
  readStdout(): Promise<Uint8Array | null>
  readStderr(): Promise<Uint8Array | null>
  terminate(): void
  close(): void
}

export function start(command: Command): NativeProcess {
  if (process.platform !== "win32") throw new Error("Foreground capture is not implemented for this platform")
  if (!path.isAbsolute(command.executable)) throw new Error("executable must be an absolute path")
  // Bun's compiler embeds literal require() assets; Node ESM needs createRequire().
  const binding: { start(input: Launch): NativeProcess } = process.versions.bun
    ? require("../native/capture.win32.node")
    : createRequire(import.meta.url)("../native/capture.win32.node")
  const child = binding.start({
    executable: command.executable,
    args: command.args ?? [],
    ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
    env: Object.fromEntries(
      Object.entries(command.env ?? process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    // Match the current runtime's existing `stdio: "overlapped"` behavior.
    overlapped: !process.versions.bun,
  })
  // Bun's Windows spawn reports the low eight bits, unlike Node's full DWORD.
  return Object.assign(child, { exited: child.exited.then((code) => (process.versions.bun ? code & 255 : code)) })
}
