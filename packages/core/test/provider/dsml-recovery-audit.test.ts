import { expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, mkdir, writeFile, stat, chmod, symlink } from "node:fs/promises"
import path from "node:path"
import {
  createDSMLRecoveryAudit,
  queueDSMLRecoveryAudit,
  type DSMLRecoveryAuditInput,
  type DSMLRecoveryAuditNotice,
} from "../../src/provider/dsml-recovery-audit.js"

const input: DSMLRecoveryAuditInput = {
  providerID: "llmgw", modelID: "dsv4", sessionID: "ses_synthetic", messageID: "msg_synthetic",
  disposition: "recovered", reason: "recovered_complete_invoke", recoveredCount: 1, nativeCount: 0,
  candidateCount: 1, sourceHash: "a".repeat(64), gatewayRequestID: "0123456789abcdef", toolNames: ["probe"],
}
async function setup() {
  const root = await mkdtemp("/tmp/opencode-recovery-audit-")
  const directory = path.join(root, "private")
  const notices: DSMLRecoveryAuditNotice[] = []
  const audit = createDSMLRecoveryAudit({ enabled: true, directory, notifier: (notice) => notices.push(notice) })
  return { root, directory, notices, audit }
}
async function settle(audit: ReturnType<typeof createDSMLRecoveryAudit>) {
  for (let index = 0; index < 200 && audit.stats().running; index++) await Bun.sleep(5)
  expect(audit.stats().running).toBe(false)
}

test("import/default-off and exact scope have no writes or notifications", async () => {
  const s = await setup()
  const disabled = createDSMLRecoveryAudit({ enabled: false, directory: s.directory, notifier: s.notices.push.bind(s.notices) })
  expect(disabled.notice).toBe("disabled")
  disabled.queue(input)
  s.audit.queue({ ...input, providerID: "other" } as unknown as DSMLRecoveryAuditInput)
  s.audit.queue({ ...input, modelID: "dsv4c" } as unknown as DSMLRecoveryAuditInput)
  expect(await readdir(s.root)).toEqual([])
  expect(s.notices).toHaveLength(0)
  expect(s.audit.stats().slots).toBe(0)
  const previous = process.env.OPENCODE_DSV4_RECOVERY_ENABLED
  try {
    delete process.env.OPENCODE_DSV4_RECOVERY_ENABLED
    const d = createDSMLRecoveryAudit()
    expect(d.notice).toBe("disabled")
    expect(queueDSMLRecoveryAudit(input)).toBeUndefined()
    process.env.OPENCODE_DSV4_RECOVERY_ENABLED = "0"
    expect(d.notice).toBe("disabled")
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_DSV4_RECOVERY_ENABLED
    if (previous !== undefined) process.env.OPENCODE_DSV4_RECOVERY_ENABLED = previous
  }
})

test("private immutable metadata persists before notice; selected fields only and snapshot owned", async () => {
  const s = await setup()
  const supplied = { ...input, toolNames: ["probe"], reason: "SECRET arbitrary reason", arguments: "SECRET", reasoning: "SECRET", headers: { secret: "SECRET" } }
  s.audit.queue(supplied)
  supplied.toolNames[0] = "modified"
  expect(s.notices).toHaveLength(0)
  await settle(s.audit)
  const notice = s.notices[0]
  expect(notice.status).toBe("persisted")
  expect(notice.file).toBe(path.join(s.directory, "slot-00.json"))
  const original = await readFile(notice.file!, "utf8")
  const record = JSON.parse(original)
  expect(original).not.toContain("SECRET")
  expect(record.reason).toBe("unknown_reason")
  expect(record.toolNames).toEqual(["probe"])
  expect(record.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/)
  expect(record.sourceHash).toBe(input.sourceHash)
  expect((await stat(s.directory)).mode & 0o777).toBe(0o700)
  expect((await stat(notice.file!)).mode & 0o777).toBe(0o600)
  s.audit.queue(input)
  await settle(s.audit)
  expect(await readFile(notice.file!, "utf8")).toBe(original)
  expect(await readdir(s.directory)).toHaveLength(2)
  expect(s.audit.stats().bytes).toBe(0)
})

test("eight queued/active slots bound stalled disk without delaying caller", async () => {
  const notices: DSMLRecoveryAuditNotice[] = []
  const pending: { release?: (file: string) => void } = {}
  const audit = createDSMLRecoveryAudit({ enabled: true, notifier: (n) => notices.push(n), writer: () => new Promise((resolve) => { pending.release = resolve }) })
  for (let index = 0; index < 8; index++) audit.queue(input)
  expect(audit.stats().slots).toBe(8)
  expect(audit.stats().bytes).toBeLessThanOrEqual(8 * 65536)
  audit.queue(input)
  expect(notices[0]).toMatchObject({ status: "not_persisted", reason: "queue_capacity" })
  expect(notices[0].file).toBeUndefined()
  for (let index = 0; index < 8; index++) {
    await Promise.resolve()
    await Promise.resolve()
    pending.release!("/tmp/synthetic-persisted.json")
    await Promise.resolve()
    await Promise.resolve()
  }
  await settle(audit)
  expect(audit.stats().slots).toBe(0)
})

test("invalid identities/counts/hashes/IDs/names reject without privacy leaks", async () => {
  const s = await setup()
  for (const patch of [
    { sessionID: "SECRET / unsafe" }, { messageID: "../invalid" }, { recoveredCount: -1 },
    { nativeCount: Infinity }, { candidateCount: 0.1 }, { sourceHash: "SECRET" },
    { gatewayRequestID: "SECRET" }, { toolNames: ["SECRET command / argument"] },
    { toolNames: Array.from({ length: 257 }, () => "probe") }, { disposition: "SECRET" },
  ]) s.audit.queue({ ...input, ...patch } as DSMLRecoveryAuditInput)
  expect(await readdir(s.root)).toEqual([])
  expect(s.notices).toHaveLength(10)
  expect(JSON.stringify(s.notices)).not.toContain("SECRET")
  expect(s.notices.every((n) => n.status === "not_persisted" && !n.file)).toBe(true)
})

test("unknown, unsafe, oversized, malformed, symlink and orphan state fail closed", async () => {
  for (const variant of ["unknown", "mode", "directory-mode", "oversized", "empty", "malformed", "symlink", "foreign-metadata"]) {
    const s = await setup()
    await mkdir(s.directory, { mode: 0o700 })
    const file = path.join(s.directory, "slot-00.json")
    if (variant === "unknown") await writeFile(path.join(s.directory, "unknown"), "", { mode: 0o600 })
    if (variant === "mode") await writeFile(file, "{}", { mode: 0o644 })
    if (variant === "directory-mode") await chmod(s.directory, 0o755)
    if (variant === "oversized") await writeFile(file, "x".repeat(65537), { mode: 0o600 })
    if (variant === "empty") await writeFile(file, "", { mode: 0o600 })
    if (variant === "malformed") await writeFile(file, "{", { mode: 0o600 })
    if (variant === "symlink") await symlink("/tmp/no-such-audit-target", file)
    if (variant === "foreign-metadata") await writeFile(file, JSON.stringify({ ...input, source: "opencode-dsml-recovery-audit-v1-20261005", createdAt: new Date().toISOString(), prompt: "SECRET" }), { mode: 0o600 })
    const before = await readdir(s.directory)
    s.audit.queue(input)
    await settle(s.audit)
    expect(await readdir(s.directory)).toEqual(before)
    expect(s.notices[0]).toMatchObject({ status: "not_persisted", reason: "storage_failure" })
    expect(s.notices[0].file).toBeUndefined()
  }
})

test("shared immutable slot cap holds across writers with no overwrite or deletion", async () => {
  const s = await setup()
  const other = createDSMLRecoveryAudit({ enabled: true, directory: s.directory, notifier: (n) => s.notices.push(n) })
  for (let index = 0; index < 64; index += 2) {
    s.audit.queue(input)
    other.queue({ ...input, sessionID: "ses_second" })
    await Promise.all([settle(s.audit), settle(other)])
  }
  const names = await readdir(s.directory)
  expect(names).toHaveLength(64)
  const sizes = await Promise.all(names.map((name) => stat(path.join(s.directory, name))))
  expect(sizes.reduce((sum, info) => sum + info.size, 0)).toBeLessThanOrEqual(4 * 1024 * 1024)
  s.audit.queue(input)
  await settle(s.audit)
  expect(s.notices.at(-1)).toMatchObject({ status: "not_persisted", reason: "storage_failure" })
  expect(await readdir(s.directory)).toEqual(names)
})

test("notifier and disk failure never throw or claim retained metadata", async () => {
  const notices: DSMLRecoveryAuditNotice[] = []
  const audit = createDSMLRecoveryAudit({ enabled: true, writer: async () => { throw new Error("SECRET disk details") }, notifier: (n) => { notices.push(n); throw new Error("notifier failed") } })
  expect(() => audit.queue(input)).not.toThrow()
  await settle(audit)
  expect(notices[0]).toMatchObject({ status: "not_persisted", reason: "storage_failure" })
  expect(JSON.stringify(notices)).not.toContain("SECRET")
  expect(notices[0].file).toBeUndefined()
  expect(audit.stats().slots).toBe(0)
})

test("unsafe directory symlink and coercible request ID refuse persistence", async () => {
  const s = await setup()
  const target = path.join(s.root, "target")
  await mkdir(target, { mode: 0o700 })
  await symlink(target, s.directory)
  s.audit.queue(input)
  await settle(s.audit)
  expect(await readdir(target)).toEqual([])
  expect(s.notices[0]).toMatchObject({ status: "not_persisted", reason: "storage_failure" })
  s.audit.queue({ ...input, gatewayRequestID: 1234567890123456 } as unknown as DSMLRecoveryAuditInput)
  expect(s.notices.at(-1)).toMatchObject({ status: "not_persisted", reason: "invalid_metadata" })
})

test("notice includes explicit session, count, disposition and real persisted path", async () => {
  const root = await mkdtemp("/tmp/opencode-recovery-notice-")
  const notices: DSMLRecoveryAuditNotice[] = []
  const audit = createDSMLRecoveryAudit({ enabled: true, directory: path.join(root, "private"), notifier: (n) => notices.push(n) })
  audit.queue(input)
  await settle(audit)
  expect(notices).toHaveLength(1)
  expect(notices[0].sessionID).toBe("ses_synthetic")
  expect(notices[0].recoveredCount).toBe(1)
  expect(notices[0].file).toBe(path.join(root, "private", "slot-00.json"))
  expect(await readdir(path.join(root, "private"))).toEqual(["slot-00.json"])
})

test("native-preservation notice is nonfatal and truthful with persisted or failed audit storage", async () => {
  const root = await mkdtemp("/tmp/opencode-native-preserved-")
  const notices: DSMLRecoveryAuditNotice[] = []
  const native = { ...input, disposition: "rejected" as const, reason: "native_preserved", recoveredCount: 0, nativeCount: 1 }
  const good = createDSMLRecoveryAudit({ enabled: true, directory: path.join(root, "private"), notifier: (n) => notices.push(n) })
  good.queue(native)
  await settle(good)
  const file = path.join(root, "private", "slot-00.json")
  const stored = JSON.parse(await readFile(file, "utf8"))
  expect(stored).toMatchObject({ reason: "native_preserved", nativeCount: 1, recoveredCount: 0 })
  expect(notices[0]).toMatchObject({ status: "persisted", nativePreservedCount: 1, file })
  const failed = createDSMLRecoveryAudit({ enabled: true, writer: async () => { throw new Error("fixture storage failure") }, notifier: (n) => notices.push(n) })
  expect(() => failed.queue(native)).not.toThrow()
  await settle(failed)
  expect(notices[1]).toMatchObject({ status: "not_persisted", reason: "storage_failure", nativePreservedCount: 1 })
  expect(notices[1].file).toBeUndefined()
})

test("empty vetting loop notice is distinct and acknowledges earlier native calls", async () => {
  const s = await setup()
  s.audit.queue({ ...input, disposition: "rejected", reason: "empty_vetting_loop", recoveredCount: 0, nativeCount: 1 })
  await settle(s.audit)
  expect(s.notices[0]).toMatchObject({ status: "persisted", outputLoop: true })
  expect(JSON.parse(await readFile(s.notices[0].file!, "utf8"))).toMatchObject({ reason: "empty_vetting_loop", nativeCount: 1, recoveredCount: 0 })
})

test("buffering notice is content-free, bounded and handles notifier failure", async () => {
  const { notifyDSMLBuffering } = await import("../../src/provider/dsml-recovery-audit.js")
  expect(() => notifyDSMLBuffering("ses_synthetic")).not.toThrow()
  expect(() => notifyDSMLBuffering("SECRET / unsafe")).not.toThrow()
})

test("legacy immutable audit reasons do not block current native-only records", async () => {
  const s = await setup()
  await mkdir(s.directory, { mode: 0o700 })
  const legacy = JSON.stringify({
    ...input, reason: "schema_invalid",
    source: "opencode-dsml-recovery-audit-v1-20261005", createdAt: "2026-10-05T00:00:00.000Z",
  })
  const file = path.join(s.directory, "slot-00.json")
  await writeFile(file, legacy, { mode: 0o600 })
  s.audit.queue({ ...input, disposition: "rejected", reason: "native_preserved", recoveredCount: 0, nativeCount: 1 })
  await settle(s.audit)
  expect(s.notices[0]).toMatchObject({ status: "persisted", nativePreservedCount: 1 })
  expect(await readFile(file, "utf8")).toBe(legacy)
  expect(JSON.parse(await readFile(s.notices[0].file!, "utf8"))).toMatchObject({ reason: "native_preserved", recoveredCount: 0 })
})
