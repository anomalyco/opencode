// Shared env + teardown for Bun tests (no bun:test here).
//
// Postgres: Testcontainers `postgres:16-alpine` (same creds as local dev) plus migrations, once per
// `bun test` process — normal Testcontainers usage from the harness. Production code stays unaware.
import os from "os"
import path from "path"
import fs from "fs/promises"
import { setTimeout as sleep } from "node:timers/promises"
import { GenericContainer, Wait } from "testcontainers"

async function startDisposablePostgres(): Promise<{ stop: () => Promise<void> }> {
  const u = "veritly"
  const p = "veritly"
  const d = "veritly"
  const c = await new GenericContainer("postgres:16-alpine")
    .withEnvironment({
      POSTGRES_USER: u,
      POSTGRES_PASSWORD: p,
      POSTGRES_DB: d,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
    .withStartupTimeout(120_000)
    .start()
  const mapped = c.getMappedPort(5432)
  process.env.DATABASE_URL = `postgresql://${u}:${p}@127.0.0.1:${mapped}/${d}`

  const { Pool } = await import("pg")
  const probe = new Pool({ connectionString: process.env.DATABASE_URL })
  const deadline = Date.now() + 30_000
  let ok = false
  while (Date.now() < deadline) {
    try {
      await probe.query("SELECT 1")
      ok = true
      break
    } catch {
      await sleep(200)
    }
  }
  await probe.end()
  if (!ok) throw new Error("Postgres Testcontainer did not accept connections in time")

  return {
    stop: async () => {
      await c.stop()
    },
  }
}

export async function installTestEnv(): Promise<() => Promise<void>> {
  const dir = path.join(os.tmpdir(), "opencode-test-data-" + process.pid)
  await fs.mkdir(dir, { recursive: true })

  process.env["XDG_DATA_HOME"] = path.join(dir, "share")
  process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
  process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
  process.env["XDG_STATE_HOME"] = path.join(dir, "state")
  process.env["OPENCODE_MODELS_PATH"] = path.join(import.meta.dir, "tool", "fixtures", "models-api.json")

  const testHome = path.join(dir, "home")
  await fs.mkdir(testHome, { recursive: true })
  process.env["OPENCODE_TEST_HOME"] = testHome

  const testManagedConfigDir = path.join(dir, "managed")
  process.env["OPENCODE_TEST_MANAGED_CONFIG_DIR"] = testManagedConfigDir

  const cacheDir = path.join(dir, "cache", "opencode")
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.writeFile(path.join(cacheDir, "version"), "14")

  delete process.env["ANTHROPIC_API_KEY"]
  delete process.env["OPENAI_API_KEY"]
  delete process.env["GOOGLE_API_KEY"]
  delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"]
  delete process.env["AZURE_OPENAI_API_KEY"]
  delete process.env["AWS_ACCESS_KEY_ID"]
  delete process.env["AWS_PROFILE"]
  delete process.env["AWS_REGION"]
  delete process.env["AWS_BEARER_TOKEN_BEDROCK"]
  delete process.env["OPENROUTER_API_KEY"]
  delete process.env["GROQ_API_KEY"]
  delete process.env["MISTRAL_API_KEY"]
  delete process.env["PERPLEXITY_API_KEY"]
  delete process.env["TOGETHER_API_KEY"]
  delete process.env["XAI_API_KEY"]
  delete process.env["DEEPSEEK_API_KEY"]
  delete process.env["FIREWORKS_API_KEY"]
  delete process.env["CEREBRAS_API_KEY"]
  delete process.env["SAMBANOVA_API_KEY"]
  delete process.env["OPENCODE_SERVER_PASSWORD"]
  delete process.env["OPENCODE_SERVER_USERNAME"]

  let pg: { stop: () => Promise<void> } | undefined
  try {
    pg = await startDisposablePostgres()

    const { Database } = await import("../src/storage/db.pg")
    const { runPostgresMigrations } = await import("../src/storage/migrate-pg")
    await Database.initialize()
    await runPostgresMigrations()

    const { Log } = await import("../src/util/log")
    Log.init({
      print: false,
      dev: true,
      level: "DEBUG",
    })

    return async () => {
      const { Database: Db } = await import("../src/storage/db.pg")
      await Db.close()
      if (pg) await pg.stop()
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
      await rm(30)
    }
  } catch (e) {
    await pg?.stop()
    throw e
  }
}
