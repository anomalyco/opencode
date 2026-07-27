import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { sql } from "drizzle-orm"
import { CronJobTable } from "@opencode-ai/core/cron/cron-job.sql"

function createTestDb() {
  const sqlite = new Database(":memory:")
  const db = drizzle(sqlite)

  db.run(sql`
    CREATE TABLE cron_job (
      id text PRIMARY KEY,
      name text,
      prompt text NOT NULL,
      schedule_kind text NOT NULL,
      schedule_expr text NOT NULL,
      enabled integer NOT NULL DEFAULT 1,
      state text NOT NULL DEFAULT 'scheduled',
      next_run_at integer,
      last_run_at integer,
      last_status text,
      last_error text,
      model text,
      skills text,
      workdir text,
      repeat_times integer,
      repeat_done integer NOT NULL DEFAULT 0,
      time_created integer NOT NULL,
      time_updated integer NOT NULL
    )
  `)

  return db
}

describe("cron_job schema", () => {
  test("inserts and reads a row with all fields", () => {
    const db = createTestDb()
    const id = crypto.randomUUID()
    const now = Date.now()

    db.insert(CronJobTable)
      .values({
        id,
        prompt: "test prompt",
        schedule_kind: "cron",
        schedule_expr: "0 9 * * 1-5",
        time_created: now,
        time_updated: now,
      })
      .run()

    const row = db.select().from(CronJobTable).where(sql`id = ${id}`).get()
    expect(row).not.toBeUndefined()
    expect(row!.prompt).toBe("test prompt")
    expect(row!.schedule_kind).toBe("cron")
    expect(row!.schedule_expr).toBe("0 9 * * 1-5")
    expect(row!.enabled).toBe(1)
    expect(row!.state).toBe("scheduled")
    expect(row!.repeat_done).toBe(0)
  })

  test("applies default values when not explicitly set", () => {
    const db = createTestDb()
    const id = crypto.randomUUID()
    const now = Date.now()

    db.insert(CronJobTable)
      .values({
        id,
        prompt: "defaults test",
        schedule_kind: "interval",
        schedule_expr: "30m",
        time_created: now,
        time_updated: now,
      })
      .run()

    const row = db.select().from(CronJobTable).where(sql`id = ${id}`).get()
    expect(row).not.toBeUndefined()
    expect(row!.enabled).toBe(1)
    expect(row!.state).toBe("scheduled")
    expect(row!.repeat_done).toBe(0)
    expect(row!.name).toBeNull()
    expect(row!.next_run_at).toBeNull()
    expect(row!.last_status).toBeNull()
    expect(row!.model).toBeNull()
    expect(row!.workdir).toBeNull()
  })

  test("updates a row", () => {
    const db = createTestDb()
    const id = crypto.randomUUID()
    const now = Date.now()

    db.insert(CronJobTable)
      .values({
        id,
        prompt: "update test",
        schedule_kind: "once",
        schedule_expr: "2026-12-01T00:00:00.000Z",
        time_created: now,
        time_updated: now,
      })
      .run()

    const updatedNow = Date.now()
    db.update(CronJobTable)
      .set({ name: "updated name", enabled: 0, state: "error", last_status: "error", last_error: "timeout" })
      .where(sql`id = ${id}`)
      .run()

    const row = db.select().from(CronJobTable).where(sql`id = ${id}`).get()
    expect(row).not.toBeUndefined()
    expect(row!.name).toBe("updated name")
    expect(row!.enabled).toBe(0)
    expect(row!.state).toBe("error")
    expect(row!.last_status).toBe("error")
    expect(row!.last_error).toBe("timeout")
  })

  test("deletes a row", () => {
    const db = createTestDb()
    const id = crypto.randomUUID()
    const now = Date.now()

    db.insert(CronJobTable)
      .values({
        id,
        prompt: "delete test",
        schedule_kind: "interval",
        schedule_expr: "10m",
        time_created: now,
        time_updated: now,
      })
      .run()

    db.delete(CronJobTable).where(sql`id = ${id}`).run()

    const row = db.select().from(CronJobTable).where(sql`id = ${id}`).get()
    expect(row).toBeUndefined()
  })

  test("inserts row with optional fields populated", () => {
    const db = createTestDb()
    const id = crypto.randomUUID()
    const now = Date.now()

    db.insert(CronJobTable)
      .values({
        id,
        name: "my-job",
        prompt: "full row test",
        schedule_kind: "cron",
        schedule_expr: "0 9 * * 1-5",
        enabled: 1,
        state: "scheduled",
        next_run_at: now + 3600000,
        last_run_at: now - 3600000,
        last_status: "completed",
        model: "gpt-4",
        skills: '["python","bash"]',
        workdir: "/home/project",
        repeat_times: 5,
        repeat_done: 2,
        time_created: now,
        time_updated: now,
      })
      .run()

    const row = db.select().from(CronJobTable).where(sql`id = ${id}`).get()
    expect(row).not.toBeUndefined()
    expect(row!.name).toBe("my-job")
    expect(row!.enabled).toBe(1)
    expect(row!.state).toBe("scheduled")
    expect(row!.next_run_at).toBe(now + 3600000)
    expect(row!.last_run_at).toBe(now - 3600000)
    expect(row!.last_status).toBe("completed")
    expect(row!.model).toBe("gpt-4")
    expect(row!.skills).toBe('["python","bash"]')
    expect(row!.workdir).toBe("/home/project")
    expect(row!.repeat_times).toBe(5)
    expect(row!.repeat_done).toBe(2)
  })
})
