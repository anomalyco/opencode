import { dlopen, ptr } from "bun:ffi"
import os from "node:os"

// STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE
const standardHandles = [-10, -11, -12]

/**
 * A detached service starts without a console, so Windows opens a visible window for every
 * console child spawned without CREATE_NO_WINDOW (plugin code, hooks, npm's git). Allocating a
 * windowless console gives those children one to inherit instead.
 *
 * Returns the failing HRESULT, or undefined when the console was attached or is unsupported.
 */
export function attach() {
  if (process.platform !== "win32") return
  // AllocConsoleWithOptions requires Windows 11 24H2 / Server 2025 (build 26100).
  if (Number(os.release().split(".")[2]) < 26100) return
  const kernel32 = dlopen("kernel32.dll", {
    AllocConsoleWithOptions: { args: ["ptr", "ptr"], returns: "i32" },
    GetStdHandle: { args: ["i32"], returns: "i64" },
    SetStdHandle: { args: ["i32", "i64"], returns: "i32" },
  })
  // Allocation may point the standard handles at the new console; keep the pipes the spawner reads.
  const handles = standardHandles.map((id) => [id, kernel32.symbols.GetStdHandle(id)] as const)
  // ALLOC_CONSOLE_OPTIONS { mode: ALLOC_CONSOLE_MODE_NO_WINDOW, useShowWindow: FALSE, showWindow: 0 }
  const status = kernel32.symbols.AllocConsoleWithOptions(ptr(new Int32Array([2, 0, 0])), null)
  handles.forEach(([id, handle]) => kernel32.symbols.SetStdHandle(id, handle))
  kernel32.close()
  return status === 0 ? undefined : status
}
