export * as HiddenConsole from "./hidden-console.bun"

import { dlopen } from "bun:ffi"
import os from "node:os"

// STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE
const standardHandles = [-10, -11, -12] as const
// INVALID_HANDLE_VALUE as an unsigned 64-bit HANDLE.
const invalidHandle = 0xffff_ffff_ffff_ffffn

/**
 * A detached service starts without a console, so Windows opens a visible window for every
 * console child spawned without CREATE_NO_WINDOW (plugin code, Bun.$, hooks, pacote git prep).
 * Allocating a windowless console gives those children one to inherit instead.
 *
 * Returns the failing HRESULT, or undefined when the console was attached or is unsupported.
 */
export function attach(): number | undefined {
  if (process.platform !== "win32") return undefined
  // AllocConsoleWithOptions requires Windows 11 24H2 / Server 2025 (build 26100).
  const build = Number.parseInt(os.release().split(".")[2] ?? "", 10)
  if (!(build >= 26100)) return undefined
  // Out-params use "buffer" so Bun reads the address off the live TypedArray at call time; a ptr() number can go
  // stale when the engine moves a small TypedArray's storage. HANDLEs are not addresses, so they travel as u64.
  const kernel32 = dlopen("kernel32.dll", {
    AllocConsoleWithOptions: { args: ["buffer", "ptr"], returns: "i32" },
    GetConsoleProcessList: { args: ["buffer", "u32"], returns: "u32" },
    GetStdHandle: { args: ["i32"], returns: "u64" },
    SetStdHandle: { args: ["i32", "u64"], returns: "i32" },
  })
  try {
    // Keep an inherited console untouched when `serve --service` runs interactively in a terminal.
    const attached = new Uint32Array(1)
    if (kernel32.symbols.GetConsoleProcessList(attached, attached.length) > 0) return undefined
    // Allocation points the standard handles at the new console; keep the pipes the spawner reads.
    const handles = standardHandles.map((id) => [id, kernel32.symbols.GetStdHandle(id)] as const)
    // ALLOC_CONSOLE_OPTIONS { mode: ALLOC_CONSOLE_MODE_NO_WINDOW (2), useShowWindow: FALSE (0), showWindow: 0 }
    const options = new Int32Array([2, 0, 0])
    const status = kernel32.symbols.AllocConsoleWithOptions(options, null)
    if (status !== 0) return status
    handles.forEach(([id, handle]) => {
      if (handle !== invalidHandle) kernel32.symbols.SetStdHandle(id, handle)
    })
    return undefined
  } finally {
    kernel32.close()
  }
}
