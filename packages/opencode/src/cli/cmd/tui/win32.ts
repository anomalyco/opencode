import { dlopen, ptr } from "bun:ffi"

const STD_INPUT_HANDLE = -10
const STD_OUTPUT_HANDLE = -11
const ENABLE_PROCESSED_INPUT = 0x0001
const ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004

const kernel = () =>
  dlopen("kernel32.dll", {
    GetStdHandle: { args: ["i32"], returns: "ptr" },
    GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
    SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
    FlushConsoleInputBuffer: { args: ["ptr"], returns: "i32" },
  })

let k32: ReturnType<typeof kernel> | undefined

function load() {
  if (process.platform !== "win32") return false
  try {
    k32 ??= kernel()
    return true
  } catch {
    return false
  }
}

/**
 * Clear ENABLE_PROCESSED_INPUT on the console stdin handle.
 */
export function win32DisableProcessedInput() {
  if (process.platform !== "win32") return
  if (!process.stdin.isTTY) return
  if (!load()) return

  const handle = k32!.symbols.GetStdHandle(STD_INPUT_HANDLE)
  const buf = new Uint32Array(1)
  if (k32!.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return

  const mode = buf[0]!
  if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
  k32!.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
}

/**
 * Discard any queued console input (mouse events, key presses, etc.).
 */
export function win32FlushInputBuffer() {
  if (process.platform !== "win32") return
  if (!process.stdin.isTTY) return
  if (!load()) return

  const handle = k32!.symbols.GetStdHandle(STD_INPUT_HANDLE)
  k32!.symbols.FlushConsoleInputBuffer(handle)
}

let unhook: (() => void) | undefined

/**
 * Keep ENABLE_PROCESSED_INPUT disabled and ENABLE_VIRTUAL_TERMINAL_PROCESSING
 * enabled.
 *
 * On Windows, Ctrl+C becomes a CTRL_C_EVENT (instead of stdin input) when
 * ENABLE_PROCESSED_INPUT is set. Various runtimes can re-apply console modes
 * (sometimes on a later tick), and the flag is console-global, not per-process.
 * ENABLE_VIRTUAL_TERMINAL_PROCESSING on stdout can be cleared by
 * runtime, causing ANSI escape codes to render as raw text.
 *
 * We combine:
 * - A `setRawMode(...)` hook to re-clear after known raw-mode toggles.
 * - A low-frequency poll as a backstop for native/external mode changes.
 */
export function win32InstallCtrlCGuard() {
  if (process.platform !== "win32") return
  if (!process.stdin.isTTY) return
  if (!load()) return
  if (unhook) return unhook

  const stdin = process.stdin as any
  const original = stdin.setRawMode

  const handle = k32!.symbols.GetStdHandle(STD_INPUT_HANDLE)
  const buf = new Uint32Array(1)

  if (k32!.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return
  const initial = buf[0]!

  const stdoutHandle = process.stdout.isTTY ? k32!.symbols.GetStdHandle(STD_OUTPUT_HANDLE) : null

  let desiredStdoutMode: number | null = null
  if (stdoutHandle) {
    if (k32!.symbols.GetConsoleMode(stdoutHandle, ptr(buf)) !== 0) {
      desiredStdoutMode = buf[0]! | ENABLE_VIRTUAL_TERMINAL_PROCESSING
      k32!.symbols.SetConsoleMode(stdoutHandle, desiredStdoutMode)
    }
  }

  const enforce = () => {
    // Enforce stdin: keep ENABLE_PROCESSED_INPUT cleared
    if (k32!.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return
    const mode = buf[0]!
    if (mode & ENABLE_PROCESSED_INPUT) {
      k32!.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
    }

    // Enforce stdout: keep ENABLE_VIRTUAL_TERMINAL_PROCESSING set
    if (stdoutHandle && desiredStdoutMode !== null) {
      if (k32!.symbols.GetConsoleMode(stdoutHandle, ptr(buf)) === 0) return
      if (buf[0]! !== desiredStdoutMode) {
        k32!.symbols.SetConsoleMode(stdoutHandle, desiredStdoutMode)
      }
    }
  }

  // Some runtimes can re-apply console modes on the next tick; enforce twice.
  const later = () => {
    enforce()
    setImmediate(enforce)
  }

  let wrapped: ((mode: boolean) => unknown) | undefined

  if (typeof original === "function") {
    wrapped = (mode: boolean) => {
      const result = original.call(stdin, mode)
      // setRawMode can reset stdout on Windows.
      // Reapply immediately to close the race window before the next render.
      enforce()
      setImmediate(enforce)
      return result
    }

    stdin.setRawMode = wrapped
  }

  // Ensure it's cleared immediately too (covers any earlier mode changes).
  later()

  // Poll at ~16ms (matching 60fps) to catch any missed changes.
  const interval = setInterval(enforce, 16)
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
