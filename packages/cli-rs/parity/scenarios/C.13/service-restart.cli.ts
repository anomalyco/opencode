// The root command with a background service of another version registered in its channel (O-167): "Restarting
// background server (version mismatch)..." on stderr, the old service stopped, then the replacement started, which
// fails as in `service-start.cli.ts`, and exit 1. Only the first stderr line is compared: what follows is the failed
// child's error, which differs as `service-start.cli.ts` says. Both sides run as channel `local`, the TS CLI from
// source's, and the old service is its own process, so stopping it signals no runner.
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { defineCli } from "../../cli/run"

export default defineCli({
  args: [],
  env: {
    PATH: `${path.join(import.meta.dir, "bin")}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    OPENCODE_CHANNEL: "local",
  },
  timeout: 30_000,
  stderrLines: 1,
  setup: async (root) => {
    const state = path.join(root, "home/.local/state/opencode")
    await mkdir(state, { recursive: true })
    const file = path.join(state, "service-local.json")
    Bun.spawn(["bun", path.join(import.meta.dir, "old-service.ts"), file], { stdio: ["ignore", "ignore", "inherit"] })
    for (let tries = 0; !(await Bun.file(file).exists()); tries++) {
      if (tries > 500) throw new Error("the old service did not register")
      await Bun.sleep(10)
    }
  },
})
