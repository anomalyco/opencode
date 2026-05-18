import { setTimeout as sleep } from "node:timers/promises"
import { afterAll, beforeAll } from "vitest"
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers"

const u = "veritly"
const p = "veritly"
const d = "veritly"

/** File-scoped Postgres (Testcontainers): registers `beforeAll` / `afterAll` and sets `process.env.DATABASE_URL`. */
export function useIsolatedDatabase(opts?: { reuse?: boolean }) {
  const reuse = opts?.reuse === true
  let c: StartedTestContainer | undefined
  const cfg = { url: "" }

  beforeAll(async () => {
    let g = new GenericContainer("postgres:16-alpine")
      .withEnvironment({
        POSTGRES_USER: u,
        POSTGRES_PASSWORD: p,
        POSTGRES_DB: d,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
      .withStartupTimeout(120_000)
    if (reuse) g = g.withReuse()
    c = await g.start()

    cfg.url = `postgresql://${u}:${p}@${c.getHost()}:${c.getMappedPort(5432)}/${d}`

    const { Pool } = await import("pg")
    const probe = new Pool({ connectionString: cfg.url })
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
    if (!ok) throw new Error("Postgres testcontainer did not accept connections in time")

    process.env.DATABASE_URL = cfg.url
  }, 120_000)

  afterAll(async () => {
    if (c) await c.stop()
    delete process.env.DATABASE_URL
  }, 30_000)

  return cfg
}
