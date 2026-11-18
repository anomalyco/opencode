// `/plugins` with more server plugins than the list has rows for (`plugins.pty.ts`, `plugins-release.pty.ts`).
import type { PtyCase } from "../../pty/run"

const location = { directory: "/work", project: { id: "proj_test", directory: "/work", canonical: "/work" } }
const names = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma".split(" ")

export function plugins(config: object): PtyCase {
  return {
    args: [],
    cols: 120,
    rows: 44,
    env: { OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ ...config, debug: { devtools: false } }) },
    server: {
      fallback: "tui",
      routes: [
        {
          path: "/api/plugin",
          json: {
            location,
            data: names.map((name, index) => ({
              id: name,
              source: { type: "package", target: `${name}-plugin`, version: `1.0.${index}` },
              features: { server: true },
              state: { status: "active" },
            })),
          },
        },
      ],
    },
    steps: [
      { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
      { keys: "/plugins", until: { screen: "/plugins" }, settle: 300 },
      { keys: "\r", until: { screen: "alpha" }, settle: 500, checkpoint: "plugins" },
      // Up from the top shows the end of the list.
      { keys: "\x1b[A", settle: 300, checkpoint: "end" },
      // Escape waits for the list to close, and the one Ctrl+C on the empty prompt for the exit.
      { keys: "\x1b", until: { gone: "check for updates" }, settle: 300 },
      { keys: "\x03", until: { exit: true } },
    ],
    exits: true,
  }
}
