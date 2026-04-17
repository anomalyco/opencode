// @ts-expect-error — CJS module with default export only
import Config from "@npmcli/config"
// @ts-expect-error — CJS submodule, no types
import defs from "@npmcli/config/lib/definitions/index.js"

type Flat = Record<string, unknown>

// @npmcli/config requires an npmPath for loadBuiltinConfig(), which reads
// <npmPath>/npmrc and silently ignores missing files. We don't ship a builtin
// npmrc, so any path works — use cwd to keep it simple and bundler-friendly.
export async function load(cwd = process.cwd()) {
  const cfg = new Config({
    definitions: defs.definitions,
    shorthands: defs.shorthands,
    flatten: defs.flatten,
    nerfDarts: defs.nerfDarts,
    npmPath: cwd,
    env: { ...process.env },
    argv: [process.argv0 || process.execPath, process.argv[1] || "opencode"],
    cwd,
    warn: false,
  })
  await cfg.load()
  const flat = cfg.flat as Flat
  // cfg.flat.npmBin is derived from npmPath as `<npmPath>/bin/npm-cli.js`, which doesn't
  // exist in our bundled binary. Override to plain "npm" so any consumer (pacote's git
  // prepare step) that spawns it picks up the system npm from PATH.
  flat.npmBin = "npm"
  return flat
}
