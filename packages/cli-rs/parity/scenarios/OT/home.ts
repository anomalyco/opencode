// The TUI home against the fake server, as E.20/copy runs it, for the OpenTUI deviation scenarios.
const config = JSON.stringify({ experimental: { "new-designs": true }, debug: { devtools: false } })

export const home = {
  env: { OPENCODE_CLI_CONFIG_CONTENT: config },
  server: { fallback: "tui" as const },
}

export const homeMasks = [
  {
    pattern: /(<root>|\/)\S*(\s+shift\+tab agents.*)?$/,
    reason: "the prompt footer: the location (the server's default in TS, the launch directory in Rust) and E.14's hints",
  },
  { pattern: /Ask anything… ".*"$/, reason: "the placeholder example: random in TS and Rust" },
]

export const paste = (text: string) => `\x1b[200~${text}\x1b[201~`

// SGR mouse reports, 1-based cells.
export const press = (x: number, y: number) => `\x1b[<0;${x};${y}M`
export const release = (x: number, y: number) => `\x1b[<0;${x};${y}m`
export const move = (x: number, y: number) => `\x1b[<32;${x};${y}M`
export const wheelUp = (x: number, y: number) => `\x1b[<64;${x};${y}M`
