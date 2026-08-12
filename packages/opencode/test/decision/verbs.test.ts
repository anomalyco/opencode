import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { DecisionVerbs } from "../../src/decision/verbs"
import { tmpdir } from "../fixture/fixture"

async function workspace() {
  const tmp = await tmpdir()
  await fs.mkdir(path.join(tmp.path, ".moks"))
  return tmp
}

describe("decision/verbs", () => {
  test("commit defaults dry_run true", async () => {
    await using tmp = await workspace()
    const result = await DecisionVerbs.commit({ action: "note", cwd: tmp.path })
    expect(result.receipt.dry_run).toBe(true)
    expect(result.receipt.state).toBe("committed")
    expect(result.receipt.verb).toBe("commit")
    expect(result.receipt.id.startsWith("dec_")).toBe(true)
    expect(result.receipt.adverse).toBe(false)
  })

  test("commit marks adverse actions", async () => {
    await using tmp = await workspace()
    const result = await DecisionVerbs.commit({ action: "reject", cwd: tmp.path, dry_run: false })
    expect(result.receipt.adverse).toBe(true)
    expect(result.receipt.dry_run).toBe(false)
  })

  test("push adverse without confirm → needs_confirm", async () => {
    await using tmp = await workspace()
    const committed = await DecisionVerbs.commit({ action: "offer", cwd: tmp.path })
    const result = await DecisionVerbs.push({ commit_id: committed.receipt.id, cwd: tmp.path })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.code).toBe("needs_confirm")
    expect(result.receipt?.state).toBe("needs_confirm")
  })

  test("push adverse with confirm → pushed receipt", async () => {
    await using tmp = await workspace()
    const committed = await DecisionVerbs.commit({ action: "hire", cwd: tmp.path })
    const result = await DecisionVerbs.push({
      commit_id: committed.receipt.id,
      cwd: tmp.path,
      confirm: true,
      dry_run: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.receipt.state).toBe("pushed")
    expect(result.receipt.commit_id).toBe(committed.receipt.id)
    expect(result.receipt.action).toBe("hire")
    expect(result.receipt.dry_run).toBe(true)
  })

  test("push unknown commit fails", async () => {
    await using tmp = await workspace()
    const result = await DecisionVerbs.push({ commit_id: "dec_missing", cwd: tmp.path })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.code).toBe("not_found")
  })

  test("push already pushed fails", async () => {
    await using tmp = await workspace()
    const committed = await DecisionVerbs.commit({ action: "note", cwd: tmp.path })
    const first = await DecisionVerbs.push({ commit_id: committed.receipt.id, cwd: tmp.path })
    expect(first.ok).toBe(true)
    const second = await DecisionVerbs.push({ commit_id: committed.receipt.id, cwd: tmp.path })
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error("expected failure")
    expect(second.code).toBe("already_pushed")
  })

  test("status open commits logic", async () => {
    await using tmp = await workspace()
    const a = await DecisionVerbs.commit({ action: "note", cwd: tmp.path })
    const b = await DecisionVerbs.commit({ action: "reject", cwd: tmp.path })
    await DecisionVerbs.push({ commit_id: a.receipt.id, cwd: tmp.path })
    const st = await DecisionVerbs.status({ cwd: tmp.path, limit: 50 })
    expect(st.open.map((r) => r.id)).toEqual([b.receipt.id])
    expect(st.receipts.length).toBeGreaterThanOrEqual(3)
    expect(st.receipts[0].ts >= st.receipts[st.receipts.length - 1].ts).toBe(true)
  })

  test("status filters by id and commit_id", async () => {
    await using tmp = await workspace()
    const a = await DecisionVerbs.commit({ action: "note", cwd: tmp.path })
    await DecisionVerbs.commit({ action: "note", cwd: tmp.path })
    const byId = await DecisionVerbs.status({ cwd: tmp.path, id: a.receipt.id })
    expect(byId.receipts).toHaveLength(1)
    expect(byId.receipts[0].id).toBe(a.receipt.id)
    await DecisionVerbs.push({ commit_id: a.receipt.id, cwd: tmp.path })
    const byCommit = await DecisionVerbs.status({ cwd: tmp.path, commit_id: a.receipt.id })
    expect(byCommit.receipts.some((r) => r.verb === "push")).toBe(true)
    expect(byCommit.receipts.every((r) => r.id === a.receipt.id || r.commit_id === a.receipt.id)).toBe(true)
  })

  test("commit scrubs secrets from meta", async () => {
    await using tmp = await workspace()
    const result = await DecisionVerbs.commit({
      action: "note",
      cwd: tmp.path,
      meta: { note: "x", password: "nope" },
    })
    expect(result.receipt.meta).toEqual({ note: "x" })
  })

  test("commit in a .moks workspace writes/appends ledger.md and mentions the action", async () => {
    await using tmp = await workspace()
    await DecisionVerbs.commit({ action: "note", cwd: tmp.path })
    await DecisionVerbs.commit({ action: "advance", cwd: tmp.path })
    const text = await Bun.file(path.join(tmp.path, ".moks/req/ledger.md")).text()
    expect(text).toContain("Local receipts only")
    expect(text).toContain("does not write to an ATS")
    expect(text).toContain("note")
    expect(text).toContain("advance")
  })

  test("push success appends a pushed line", async () => {
    await using tmp = await workspace()
    const committed = await DecisionVerbs.commit({ action: "note", cwd: tmp.path })
    const result = await DecisionVerbs.push({ commit_id: committed.receipt.id, cwd: tmp.path })
    expect(result.ok).toBe(true)
    const text = await Bun.file(path.join(tmp.path, ".moks/req/ledger.md")).text()
    expect(text).toContain("pushed")
  })

  test("commit without .moks does not create a ledger at cwd root", async () => {
    await using tmp = await tmpdir()
    await DecisionVerbs.commit({ action: "note", cwd: tmp.path })
    expect(await Bun.file(path.join(tmp.path, "ledger.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(tmp.path, ".moks/req/ledger.md")).exists()).toBe(false)
  })
})
