#!/usr/bin/env bun
/**
 * Legacy entrypoint kept for `bun run desktop:dev:local` in this package.
 *
 * Canonical scripts live in `packages/claxedo-desktop`.
 */

const args = Bun.argv.slice(2)

const proc = Bun.spawn({
  cmd: ["bun", "run", "--cwd", "../claxedo-desktop", "dev:local", ...args],
  cwd: new URL("..", import.meta.url).pathname,
  env: Bun.env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

process.exit(await proc.exited)
