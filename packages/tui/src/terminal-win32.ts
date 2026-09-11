import { dlopen, ptr } from "bun:ffi"
const STD_INPUT_HANDLE = -10
const ENABLE_PROCESSED_INPUT = 0x0001

type RawModeInput = NodeJS.ReadStream & {
  setRawMode(mode: boolean): NodeJS.ReadStream
}

const kernel = () =>
  dlopen("kernel32.dll", {
    GetStdHandle: { args: ["i32"], returns: "ptr" },
    GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
    SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
    FlushConsoleInputBuffer: { args: ["ptr"], returns: "i32" },
  })

const crt = () =>
  dlopen("ucrtbase.dll", {
    _get_osfhandle: { args: ["i32"], returns: "ptr" },
  })

let k32: ReturnType<typeof kernel> | undefined
let c32: ReturnType<typeof crt> | undefined

function load() {
  if (process.platform !== "win32") return false
  try {
    k32 ??= kernel()
    return true
  } catch {
    return false
  }
}

function loadCrt() {
  if (process.platform !== "win32") return false
  try {
    c32 ??= crt()
    return true
  } catch {
    return false
  }
}

function readStreamFd(stdin: NodeJS.ReadStream) {
  if (!("fd" in stdin)) return undefined
  return typeof stdin.fd === "number" ? stdin.fd : undefined
}

function inputHandle(stdin: NodeJS.ReadStream) {
  if (!stdin.isTTY) return undefined
  if (!load()) return undefined
  if (stdin === process.stdin) return k32!.symbols.GetStdHandle(STD_INPUT_HANDLE)
  const fd = readStreamFd(stdin)
  if (fd === undefined) return undefined
  if (!loadCrt()) return undefined
  return c32!.symbols._get_osfhandle(fd)
}

function hasRawMode(input: NodeJS.ReadStream): input is RawModeInput {
  return "setRawMode" in input && typeof input.setRawMode === "function"
}

function getRawMode(input: RawModeInput) {
  return input.setRawMode
}

/**
 * Clear ENABLE_PROCESSED_INPUT on the console stdin handle.
 */
export function win32DisableProcessedInput(stdin: NodeJS.ReadStream = process.stdin) {
  if (process.platform !== "win32") return

  const handle = inputHandle(stdin)
  if (handle === undefined || handle === null) return
  const buf = new Uint32Array(1)
  if (k32!.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return

  const mode = buf[0]
  if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
  k32!.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
}

/**
 * Discard any queued console input (mouse events, key presses, etc.).
 */
export function win32FlushInputBuffer(stdin: NodeJS.ReadStream = process.stdin) {
  if (process.platform !== "win32") return

  const handle = inputHandle(stdin)
  if (handle === undefined || handle === null) return
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
export function win32InstallCtrlCGuard(input: NodeJS.ReadStream = process.stdin): (() => void) | undefined {
  if (process.platform !== "win32") return undefined
  if (!input.isTTY) return undefined
  if (!load()) return undefined
  if (unhook) return unhook

  const handle = inputHandle(input)
  if (handle === undefined || handle === null) return undefined
  if (!hasRawMode(input)) return undefined

  const original = getRawMode(input)

  const buf = new Uint32Array(1)

  if (k32!.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return undefined
  const initial = buf[0]

  const enforce = () => {
    if (k32!.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return
    const mode = buf[0]
    if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
    k32!.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
  }

  // Some runtimes can re-apply console modes on the next tick; enforce twice.
  const later = () => {
    enforce()
    setImmediate(enforce)
  }

  let wrapped: RawModeInput["setRawMode"] | undefined

  wrapped = (mode: boolean) => {
    const result = original.call(input, mode)
    later()
    return result
  }

  input.setRawMode = wrapped

  // Ensure it's cleared immediately too (covers any earlier mode changes).
  later()

  const interval = setInterval(enforce, 100)
  interval.unref()

  let done = false
  unhook = () => {
    if (done) return
    done = true

    clearInterval(interval)
    if (wrapped && input.setRawMode === wrapped) {
      input.setRawMode = original
    }

    k32!.symbols.SetConsoleMode(handle, initial)
    unhook = undefined
  }

  return unhook
}
