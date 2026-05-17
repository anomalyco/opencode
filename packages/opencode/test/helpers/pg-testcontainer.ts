import { setTimeout as sleep } from "node:timers/promises"
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers"

export type PgTestContainer = {
  url: string
  stop: () => Promise<void>
}

/** Fresh Postgres (mapped host port). Caller sets `process.env.DATABASE_URL` and owns `Database` lifecycle. */
export async function startPgTestContainer(): Promise<PgTestContainer> {
  const u = "veritly"
  const p = "veritly"
  const d = "veritly"
  const c: StartedTestContainer = await new GenericContainer("postgres:16-alpine")
    .withEnvironment({
      POSTGRES_USER: u,
      POSTGRES_PASSWORD: p,
      POSTGRES_DB: d,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
    .withStartupTimeout(120_000)
    .start()

  const url = `postgresql://${u}:${p}@${c.getHost()}:${c.getMappedPort(5432)}/${d}`

  const { Pool } = await import("pg")
  const probe = new Pool({ connectionString: url })
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

  return {
    url,
    stop: async () => {
      await c.stop()
    },
  }
}
