import { describe, test, expect, spyOn, afterEach } from "bun:test"
import { AuditLog } from "../audit"
import { Config } from "../../config/config"
import { rm } from "fs/promises"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import path from "path"

describe("Audit Log — config-driven behavior", () => {
  let spy: ReturnType<typeof spyOn<typeof Config, "get">>
  afterEach(() => spy?.mockRestore())

  test("SEC-07: audit logging enabled by default (absent security key)", async () => {
    spy = spyOn(Config, "get").mockResolvedValue({} as any)
    const dir = mkdtempSync(path.join(tmpdir(), "audit-test-"))
    const log = new AuditLog(path.join(dir, "audit.log"))
    await log.log({ type: "test", data: { msg: "hello" } })
    const entries = await log.getEntries()
    expect(entries.length).toBe(1)
    expect(entries[0].type).toBe("test")
    await rm(dir, { recursive: true, force: true })
  })

  test("SEC-04: skips audit log when auditLog.enabled = false", async () => {
    spy = spyOn(Config, "get").mockResolvedValue({
      security: { auditLog: { enabled: false } },
    } as any)
    const dir = mkdtempSync(path.join(tmpdir(), "audit-test-"))
    const log = new AuditLog(path.join(dir, "audit.log"))
    await log.log({ type: "test", data: { msg: "hello" } })
    const entries = await log.getEntries()
    expect(entries.length).toBe(0)
    await rm(dir, { recursive: true, force: true })
  })

  test("SEC-04: writes audit log when auditLog.enabled = true", async () => {
    spy = spyOn(Config, "get").mockResolvedValue({
      security: { auditLog: { enabled: true } },
    } as any)
    const dir = mkdtempSync(path.join(tmpdir(), "audit-test-"))
    const log = new AuditLog(path.join(dir, "audit.log"))
    await log.log({ type: "write", data: { path: "/some/file" } })
    const entries = await log.getEntries()
    expect(entries.length).toBe(1)
    expect(entries[0].type).toBe("write")
    expect(entries[0].hash).toBeTruthy()
    await rm(dir, { recursive: true, force: true })
  })
})
