// The root command with no background service (G06): "Starting background server..." on stderr, then the
// error of the `serve --service` child that fails, and exit 1. Only the first two stderr lines are compared:
// the TS CLI from source spawns itself and adds a JS stack trace (C40-handler-errors), while Rust spawns the
// `opencode` on PATH, here `bin/opencode`, and prints that child's stderr tail.
import path from "node:path"
import { defineCli } from "../../cli/run"

export default defineCli({
  args: [],
  env: { PATH: `${path.join(import.meta.dir, "bin")}:${process.env.PATH ?? "/usr/bin:/bin"}` },
  timeout: 20_000,
  stderrLines: 2,
})
