import { dlopen, ptr } from "bun:ffi"

if (process.platform === "win32") {
  try {
    const k = dlopen("kernel32.dll", {
      GetStdHandle: { args: ["i32"], returns: "ptr" },
      GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
      SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
    })

    const STD_OUTPUT_HANDLE = -11
    const ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004

    const handle = k.symbols.GetStdHandle(STD_OUTPUT_HANDLE)
    if (handle !== null) {
      const buf = new Uint32Array(1)
      if (k.symbols.GetConsoleMode(handle, ptr(buf))) {
        k.symbols.SetConsoleMode(handle, buf[0] | ENABLE_VIRTUAL_TERMINAL_PROCESSING)
      }
    }
  } catch {
    // silently ignore
  }
}
