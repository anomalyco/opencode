import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { PtyHandoff } from "../src/pty-handoff"

test("service startup reads its persisted ticket without an inherited launcher environment", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-handoff-ticket-"))
  const file = path.join(directory, "service.json")
  const source = { id: "previous", pid: 999999, url: "http://127.0.0.1:1" }
  const ticket = { directory, instanceID: "pty-owner", ticket: "private-canary", expiresAt: Date.now() + 60_000 }
  const record = { source, handoff: ticket, expiresAt: ticket.expiresAt }
  try {
    await writeFile(file, JSON.stringify(source))
    await writeFile(file + ".pty-handoff", JSON.stringify(record), { mode: 0o600 })
    expect(await PtyHandoff.ticket(file)).toEqual(ticket)
    await rm(file)
    expect(await PtyHandoff.ticket(file)).toEqual(ticket)
    await writeFile(file, JSON.stringify({ ...source, id: "different-owner" }))
    expect(await PtyHandoff.ticket(file)).toBeUndefined()
    await rm(file)
    for (const stale of [
      { ...record, expiresAt: Date.now() - 1 },
      { ...record, handoff: { ...ticket, expiresAt: Date.now() - 1 } },
      { ...record, handoff: null },
    ]) {
      await writeFile(file + ".pty-handoff", JSON.stringify(stale))
      expect(await PtyHandoff.ticket(file)).toBeUndefined()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
