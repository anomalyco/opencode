export const logo = {
  left: ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"],
  right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"

// Mammouth Code wordmark — a flat block-letter "MAMMOUTH" used by the CLI banner
// and the TUI <Logo> component (replaces the upstream shadow/shimmer art).
export const wordmark = [
  "███    ███  █████  ███    ███ ███    ███  ██████  ██    ██ ████████ ██   ██",
  "████  ████ ██   ██ ████  ████ ████  ████ ██    ██ ██    ██    ██    ██   ██",
  "██ ████ ██ ███████ ██ ████ ██ ██ ████ ██ ██    ██ ██    ██    ██    ███████",
  "██  ██  ██ ██   ██ ██  ██  ██ ██  ██  ██ ██    ██ ██    ██    ██    ██   ██",
  "██      ██ ██   ██ ██      ██ ██      ██  ██████   ██████     ██    ██   ██",
]

// Per-line vertical gradient for the wordmark (top → bottom), one color per wordmark line.
export const wordmarkGradient: Record<"dark" | "light", string[]> = {
  dark: ["#9F6C45", "#B88557", "#C8A37C", "#DDC7AB", "#EDE3D4"],
  light: ["#56332D", "#633B30", "#754533", "#915B3D", "#9F6C45"],
}
