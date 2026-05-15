// IMPORTANT: Set env vars BEFORE any imports from src/ directory
// xdg-basedir reads env vars at import time, so we must set these first
import os from "os"
import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import { setTimeout as sleep } from "node:timers/promises"
import { afterAll, afterEach } from "bun:test"

// Set XDG env vars FIRST, before any src/ imports
const dir = path.join(os.tmpdir(), "opencode-test-data-" + process.pid)
await fs.mkdir(dir, { recursive: true })
afterAll(async () => {
  const { Database } = await import("../src/storage/db")
  Database.close()
  const busy = (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY"
  const rm = async (left: number): Promise<void> => {
    Bun.gc(true)
    await sleep(100)
    return fs.rm(dir, { recursive: true, force: true }).catch((error) => {
      if (!busy(error)) throw error
      if (left <= 1) throw error
      return rm(left - 1)
    })
  }

  // Windows can keep SQLite WAL handles alive until GC finalizers run, so we
  // force GC and retry teardown to avoid flaky EBUSY in test cleanup.
  await rm(30)
})

process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["XDG_STATE_HOME"] = path.join(dir, "state")
process.env["OPENCODE_MODELS_PATH"] = path.join(import.meta.dir, "tool", "fixtures", "models-api.json")
process.env["OPENCODE_EXPERIMENTAL_EVENT_SYSTEM"] = "true"
process.env["OPENCODE_EXPERIMENTAL_WORKSPACES"] = "true"

// Set test home directory to isolate tests from user's actual home directory
// This prevents tests from picking up real user configs/skills from ~/.claude/skills
const testHome = path.join(dir, "home")
await fs.mkdir(testHome, { recursive: true })
process.env["OPENCODE_TEST_HOME"] = testHome

// Set test managed config directory to isolate tests from system managed settings
const testManagedConfigDir = path.join(dir, "managed")
process.env["OPENCODE_TEST_MANAGED_CONFIG_DIR"] = testManagedConfigDir

// Write the cache version file to prevent global/index.ts from clearing the cache
const cacheDir = path.join(dir, "cache", "opencode")
await fs.mkdir(cacheDir, { recursive: true })
await fs.writeFile(path.join(cacheDir, "version"), "14")

// Clear provider/server auth env vars so a contributor's shell can never
// leak a real credential into a test's `connected[]` assertion. Sourced
// programmatically from the models-api fixture so this list grows with
// models.dev without manual maintenance. Augmented with non-fixture keys
// referenced by src/ (OPENCODE_CONSOLE_TOKEN, GITLAB_INSTANCE_URL,
// AICORE_DEPLOYMENT_ID/RESOURCE_GROUP, the AWS chain helpers) and the
// synthetic test keys used by overlay/provider tests.
const fixtureEnv: string[] = (() => {
  const fixturePath = process.env["OPENCODE_MODELS_PATH"]
  if (!fixturePath) return []
  const data: Record<string, { env?: string[] }> = JSON.parse(fsSync.readFileSync(fixturePath, "utf8"))
  const seen = new Set<string>()
  for (const provider of Object.values(data)) for (const key of provider.env ?? []) seen.add(key)
  return [...seen]
})()
const extraEnv = [
  "GOOGLE_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_ROLE_ARN",
  "AICORE_DEPLOYMENT_ID",
  "AICORE_RESOURCE_GROUP",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GCP_PROJECT",
  "GCLOUD_PROJECT",
  "VERTEX_LOCATION",
  "CF_AIG_TOKEN",
  "GITLAB_INSTANCE_URL",
  "OPENCODE_CONSOLE_TOKEN",
  "SINGLE_ENV_KEY",
  "MULTI_ENV_KEY_1",
  "MULTI_ENV_KEY_2",
  "PRIMARY_KEY",
  "FALLBACK_KEY",
  "CUSTOM_API_KEY",
  "OPENCODE_SERVER_PASSWORD",
  "OPENCODE_SERVER_USERNAME",
]
for (const key of fixtureEnv) delete process.env[key]
for (const key of extraEnv) delete process.env[key]

// Use in-memory sqlite
process.env["OPENCODE_DB"] = ":memory:"

// Now safe to import from src/
const { Log } = await import("@opencode-ai/core/util/log")
const { initProjectors } = await import("../src/server/projectors")

void Log.init({
  print: false,
  dev: true,
  level: "DEBUG",
})

initProjectors()

// Capture baseline AFTER all preload deletes/sets AND src/ side-effectful
// imports (Log.init, initProjectors) settle. With the env layer now writing
// through to `process.env` directly (see src/env/index.ts), tests that call
// `set()` mutate global state. Without a per-test reset, leaks would cross
// file boundaries (Bun runs all .test.ts files in one shared process per
// `bunfig.toml` defaults). This `afterEach` snapshot/restore makes test
// isolation automatic regardless of contributor discipline.
const ENV_BASELINE: Record<string, string | undefined> = { ...process.env }
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ENV_BASELINE)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(ENV_BASELINE) as [string, string | undefined][]) {
    if (value === undefined) {
      delete process.env[key]
      continue
    }
    if (process.env[key] !== value) process.env[key] = value
  }
})
