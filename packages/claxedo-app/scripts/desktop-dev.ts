#!/usr/bin/env bun
/**
 * Legacy entrypoint kept for `bun run desktop:dev` in this package.
 *
 * The canonical desktop dev scripts live in `packages/claxedo-desktop`.
 * This wrapper forwards all CLI args to that package.
 */

const args = Bun.argv.slice(2)

const proc = Bun.spawn({
  cmd: ["bun", "run", "--cwd", "../claxedo-desktop", "dev", ...args],
  cwd: new URL("..", import.meta.url).pathname,
  env: Bun.env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

process.exit(await proc.exited)
