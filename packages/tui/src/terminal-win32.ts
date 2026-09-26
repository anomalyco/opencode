import { dlopen, ptr, type Pointer } from "bun:ffi"
import type { ReadStream } from "node:tty"

const STD_INPUT_HANDLE = -10
const ENABLE_PROCESSED_INPUT = 0x0001
const GENERIC_READ_WRITE = 0xc0000000
const FILE_SHARE_READ_WRITE = 0x3
const OPEN_EXISTING = 3

const kernel = () =>
  dlopen("kernel32.dll", {
    GetStdHandle: { args: ["i32"], returns: "ptr" },
    GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
    SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
    FlushConsoleInputBuffer: { args: ["ptr"], returns: "i32" },
    CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "ptr" },
  })

let k32: ReturnType<typeof kernel> | undefined
let conin: Pointer | null | undefined

function load() {
  if (process.platform !== "win32") return false
  try {
    k32 ??= kernel()
    return true
  } catch {
    return false
  }
}

// When stdin is piped the TUI reads from a separately opened CONIN$ stream. Its fd
// cannot be translated with _get_osfhandle (Bun fds are not UCRT fds and the CRT
// aborts the process), so open a dedicated handle to the same console input buffer.
function inputHandle(stdin: NodeJS.ReadStream) {
  if (!stdin.isTTY) return
  if (!load()) return
  if (stdin === process.stdin) return k32!.symbols.GetStdHandle(STD_INPUT_HANDLE)
  conin ??= k32!.symbols.CreateFileW(
    Buffer.from("CONIN$\0", "utf16le"),
    GENERIC_READ_WRITE,
    FILE_SHARE_READ_WRITE,
    null,
    OPEN_EXISTING,
    0,
    null,
  )
  return conin
}

/**
 * Clear ENABLE_PROCESSED_INPUT on the console stdin handle.
 */
export function win32DisableProcessedInput(stdin: NodeJS.ReadStream = process.stdin) {
  if (process.platform !== "win32") return
  const handle = inputHandle(stdin)
  if (!handle) return

  const buf = new Uint32Array(1)
  if (k32!.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return

  const mode = buf[0]!
  if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
  k32!.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
}

/**
 * Discard any queued console input (mouse events, key presses, etc.).
 */
export function win32FlushInputBuffer(stdin: NodeJS.ReadStream = process.stdin) {
  if (process.platform !== "win32") return
  const handle = inputHandle(stdin)
  if (!handle) return
  k32!.symbols.FlushConsoleInputBuffer(handle)
}

let unhook: (() => void) | undefined

/**
 * Keep ENABLE_PROCESSED_INPUT disabled.
 *
 * On Windows, Ctrl+C becomes a CTRL_C_EVENT (instead of stdin input) when
 * ENABLE_PROCESSED_INPUT is set. Various runtimes can re-apply console modes
 * (sometimes on a later tick), and the flag is console-global, not per-process.
 *
 * We combine:
 * - A `setRawMode(...)` hook to re-clear after known raw-mode toggles.
 * - A low-frequency poll as a backstop for native/external mode changes.
 */
export function win32InstallCtrlCGuard(input: NodeJS.ReadStream = process.stdin) {
  if (process.platform !== "win32") return
  if (unhook) return unhook

  const stdin = input as ReadStream
  const original = stdin.setRawMode

  const handle = inputHandle(stdin)
  if (!handle) return
  const buf = new Uint32Array(1)

  if (k32!.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return
  const initial = buf[0]!

  const enforce = () => {
    if (k32!.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return
    const mode = buf[0]!
    if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
    k32!.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
  }

  // Some runtimes can re-apply console modes on the next tick; enforce twice.
  const later = () => {
    enforce()
    setImmediate(enforce)
  }

  let wrapped: ReadStream["setRawMode"] | undefined

  if (typeof original === "function") {
    wrapped = (mode: boolean) => {
      const result = original.call(stdin, mode)
      later()
      return result
    }

    stdin.setRawMode = wrapped
  }

  // Ensure it's cleared immediately too (covers any earlier mode changes).
  later()

  const interval = setInterval(enforce, 100)
  interval.unref()

  let done = false
  unhook = () => {
    if (done) return
    done = true

    clearInterval(interval)
    if (wrapped && stdin.setRawMode === wrapped) {
      stdin.setRawMode = original
    }

    k32!.symbols.SetConsoleMode(handle, initial)
    unhook = undefined
  }

  return unhook
}
