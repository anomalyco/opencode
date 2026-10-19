import { writeSync } from "node:fs"

// Set once when the footer starts. A module value avoids threading the flag through every menu.
export const screenReader = {
  enabled: false,
  // Written to the terminal directly: stdout is captured into scrollback while the footer runs.
  bell: () => writeSync(1, "\x07"),
}

export function ringBell() {
  if (screenReader.enabled) screenReader.bell()
}
