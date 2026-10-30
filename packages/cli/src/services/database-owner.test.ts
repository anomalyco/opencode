import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { databaseOwnerIdentity } from "@opencode/util/database-owner"
import { checkDatabaseOwner } from "./database-owner"
import { databasePath } from "../database-path"

test("blocks unregistered ownership, but permits a registered service even while starting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-owner-cli-"))
  const file = join(dir, "db.sqlite")
  const registration = join(dir, "service.json")
  try {
    const db = new Database(file)
    db.run("CREATE TABLE _opencode_execution_owner (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
    db.query("INSERT INTO _opencode_execution_owner VALUES (1, ?)").run(
      JSON.stringify({ version: 1, ...databaseOwnerIdentity, refs: 1 }),
    )
    db.close()
    await expect(checkDatabaseOwner(file, registration)).rejects.toThrow("Refusing to start a second execution process")
    writeFileSync(registration, JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:1" }))
    // No health server listens on port 1. Registration identity, not readiness, controls this precheck.
    await checkDatabaseOwner(file, registration)
    await checkDatabaseOwner(":memory:", registration)
    await checkDatabaseOwner(join(dir, "not-created.sqlite"), registration)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("uses the service environment's database override without modifying the CLI environment", () => {
  const before = process.env.OPENCODE_DB
  const data = join(tmpdir(), "opencode-owner-data")
  expect(databasePath(data, { OPENCODE_DB: "configured.sqlite" })).toBe(join(data, "configured.sqlite"))
  expect(process.env.OPENCODE_DB).toBe(before)
})
