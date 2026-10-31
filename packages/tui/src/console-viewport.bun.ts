import { dlopen, FFIType, ptr } from "bun:ffi"

const STD_OUTPUT_HANDLE = -11

// conhost can leave `srWindow` inverted (Left past Right) after a maximize and a
// title-bar drag. The buffer width still matches the window, so it is the real size.
export function consoleViewport() {
  if (process.platform !== "win32") return undefined

  const kernel32 = dlopen("kernel32.dll", {
    GetStdHandle: { args: [FFIType.i32], returns: FFIType.ptr },
    GetConsoleScreenBufferInfo: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    SetConsoleWindowInfo: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  })
  const handle = kernel32.symbols.GetStdHandle(STD_OUTPUT_HANDLE)

  // CONSOLE_SCREEN_BUFFER_INFO: dwSize (0), srWindow (10: Left, Top, Right, Bottom).
  const read = () => {
    const buffer = new Uint8Array(32)
    if (!kernel32.symbols.GetConsoleScreenBufferInfo(handle, ptr(buffer))) return undefined
    const view = new DataView(buffer.buffer)
    return {
      bufferWidth: view.getInt16(0, true),
      left: view.getInt16(10, true),
      top: view.getInt16(12, true),
      right: view.getInt16(14, true),
      bottom: view.getInt16(16, true),
    }
  }

  if (!read()) return undefined

  const valid = () => {
    const view = read()
    return view !== undefined && view.right >= view.left && view.bottom >= view.top
  }

  return {
    valid,
    size() {
      const view = read()
      if (!view) return undefined
      return { width: view.bufferWidth, height: view.bottom - view.top + 1 }
    },
    repair() {
      const view = read()
      if (!view) return
      // Restore the horizontal extent to the buffer width; top and bottom are kept.
      const rect = new Uint8Array(8)
      const rectView = new DataView(rect.buffer)
      rectView.setInt16(0, 0, true)
      rectView.setInt16(2, view.top, true)
      rectView.setInt16(4, view.bufferWidth - 1, true)
      rectView.setInt16(6, view.bottom, true)
      kernel32.symbols.SetConsoleWindowInfo(handle, 1, ptr(rect))
    },
  }
}
