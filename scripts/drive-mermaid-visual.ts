import { mkdir } from "node:fs/promises"
import { defineScript, Effect, Llm } from "opencode-drive"

const theme = Bun.env.DRIVE_THEME ?? "opencode"
const output = Bun.env.DRIVE_SCREENSHOT ?? `artifacts/mermaid-${theme}.png`
const animate = Bun.env.DRIVE_ANIMATE === "1"
const cycleThemes = Bun.env.DRIVE_CYCLE_THEMES === "1"

const response = `\`\`\`mermaid
sequenceDiagram
  participant B as Browser
  participant S as Server
  participant T as Ticket store
  participant P as PTY
  B->>S: GET /
  S-->>B: 401 WWW-Auth
  Note over B,S: native browser Basic prompt
  B->>S: GET / · Basic
  S-->>B: 200 web UI
  Note over B,S: user opens terminal
  B->>S: POST connect-token<br/>· Basic (cached by browser)<br/>· X-OpenCode-Ticket: 1
  S->>T: issue { ptyID, … }
  S-->>B: { ticket }
  B->>S: WS …?ticket=…<br/>Upgrade: websocket
  S->>T: consume(token,scope)
  T-->>S: ok, delete
  S->>P: attach
  P-->>B: WS frames
\`\`\``

export default defineScript({
  config: {
    autoupdate: false,
  },
  tuiConfig: {
    theme: {
      name: theme,
      mode: "dark",
    },
  },
  tui: {
    viewport: { cols: 180, rows: 64 },
  },
  run: ({ ui, llm }) =>
    Effect.gen(function* () {
      yield* ui.submit("Show the connection flow as a Mermaid sequence diagram")
      yield* llm.send(
        Llm.text(response, animate ? { delay: 80, chunkSize: 20 } : { delay: 0, chunkSize: response.length }),
      )
      yield* ui.waitFor("WS frames", { timeout: 10_000 })
      if (cycleThemes) {
        yield* Effect.sleep(800)
        yield* Effect.forEach(
          ["everforest", "synthwave84", "matrix", "opencode"],
          (next) =>
            Effect.gen(function* () {
              yield* ui.press("x", { ctrl: true })
              yield* ui.press("t")
              yield* ui.waitFor("Themes")
              yield* ui.type(next)
              yield* Effect.sleep(700)
              yield* ui.enter()
              yield* Effect.sleep(1_200)
            }),
          { discard: true },
        )
      }
      const screenshot = yield* ui.screenshot(`mermaid-${theme}`)
      yield* Effect.promise(async () => {
        await mkdir("artifacts", { recursive: true })
        await Bun.write(output, Bun.file(screenshot))
      })
      yield* Effect.log(`Saved ${output}`)
    }),
})
