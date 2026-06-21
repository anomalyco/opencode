import fs from "fs"
import type { CliRenderer } from "@opentui/core"

function resetTerminalModes() {
  try {
    fs.writeSync(
      1,
      "\x1b[?1l" +     // DECCKM - Application Cursor Keys
      "\x1b[?1000l" +  // X11 mouse tracking
      "\x1b[?1002l" +  // Button-event tracking
      "\x1b[?1003l" +  // Any-event tracking
      "\x1b[?1004l" +  // Focus event tracking
      "\x1b[?1006l" +  // SGR extended mouse mode
      "\x1b[?2004l" +  // Bracketed paste mode
      "\x1b[<u" +     // Kitty keyboard protocol (pop)
      "\x1b[>4;0m" + // modifyOtherKeys reset
      "\x1b[?25h" +    // Show cursor
      "\x1b[0 q" +     // Default cursor shape
      "\x1b[0m",       // Reset SGR attributes
    )
  } catch {}
}

export function destroyRenderer(renderer: Pick<CliRenderer, "isDestroyed" | "setTerminalTitle" | "destroy">) {
  renderer.setTerminalTitle("")
  if (renderer.isDestroyed) return
  resetTerminalModes()
  renderer.destroy()
}
