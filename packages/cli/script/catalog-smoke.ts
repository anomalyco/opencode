#!/usr/bin/env bun

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const catalog = process.env.OPENCODE_MODELS_SNAPSHOT
// Resolved before spawning: the binary runs from a temporary directory.
const binary = process.argv[2] && path.resolve(process.argv[2])
if (!catalog || !binary) throw new Error("Usage: OPENCODE_MODELS_SNAPSHOT=<catalog> catalog-smoke.ts <binary>")

const providers: Record<string, { env?: string[] }> = await Bun.file(catalog).json()
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-catalog-smoke-")))
// Credentials for every provider make the model list cover the whole catalog.
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENCODE_MODELS"))),
  ...Object.fromEntries(
    Object.values(providers).flatMap((provider) => (provider.env ?? []).map((key) => [key, "smoke"])),
  ),
  HOME: root,
  USERPROFILE: root,
  OPENCODE_DB: path.join(root, "opencode.db"),
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  XDG_CACHE_HOME: path.join(root, "cache"),
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_STATE_HOME: path.join(root, "state"),
}

const bundled = models({})
const fetched = models({ OPENCODE_MODELS_PATH: path.resolve(catalog) })
await fs.rm(root, { recursive: true, force: true })
if (bundled.length === 0) throw new Error(`${binary} listed no models`)
if (bundled.join("\n") !== fetched.join("\n")) {
  const missing = fetched.filter((model) => !bundled.includes(model))
  const extra = bundled.filter((model) => !fetched.includes(model))
  throw new Error(
    `${binary} bundles a different models.dev catalog than ${catalog}: missing ${missing.slice(0, 5).join(", ")}; extra ${extra.slice(0, 5).join(", ")}`,
  )
}
console.log(`${binary} bundles ${catalog} (${bundled.length} models)`)

function models(extra: Record<string, string>) {
  const result = Bun.spawnSync([binary, "models", "--standalone"], { cwd: root, env: { ...env, ...extra } })
  if (result.exitCode !== 0) throw new Error(`${binary} models exited with ${result.exitCode}: ${result.stderr}`)
  return result.stdout.toString().trim().split(/\r?\n/)
}
