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
  test("propose defaults dry_run true", async () => {
    await using tmp = await workspace()
    const result = await DecisionVerbs.propose({ action: "note", cwd: tmp.path })
    expect(result.receipt.dry_run).toBe(true)
    expect(result.receipt.state).toBe("proposed")
    expect(result.receipt.verb).toBe("propose")
    expect(result.receipt.id.startsWith("dec_")).toBe(true)
    expect(result.receipt.adverse).toBe(false)
  })

  test("propose marks adverse actions", async () => {
    await using tmp = await workspace()
    const result = await DecisionVerbs.propose({ action: "reject", cwd: tmp.path, dry_run: false })
    expect(result.receipt.adverse).toBe(true)
    expect(result.receipt.dry_run).toBe(false)
  })

  test("apply adverse without confirm → needs_confirm", async () => {
    await using tmp = await workspace()
    const proposed = await DecisionVerbs.propose({ action: "offer", cwd: tmp.path })
    const result = await DecisionVerbs.apply({ proposal_id: proposed.receipt.id, cwd: tmp.path })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.code).toBe("needs_confirm")
    expect(result.receipt?.state).toBe("needs_confirm")
  })

  test("apply adverse with confirm → applied receipt", async () => {
    await using tmp = await workspace()
    const proposed = await DecisionVerbs.propose({ action: "hire", cwd: tmp.path })
    const result = await DecisionVerbs.apply({
      proposal_id: proposed.receipt.id,
      cwd: tmp.path,
      confirm: true,
      dry_run: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.receipt.state).toBe("applied")
    expect(result.receipt.proposal_id).toBe(proposed.receipt.id)
    expect(result.receipt.action).toBe("hire")
    expect(result.receipt.dry_run).toBe(true)
  })

  test("apply unknown proposal fails", async () => {
    await using tmp = await workspace()
    const result = await DecisionVerbs.apply({ proposal_id: "dec_missing", cwd: tmp.path })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.code).toBe("not_found")
  })

  test("apply already applied fails", async () => {
    await using tmp = await workspace()
    const proposed = await DecisionVerbs.propose({ action: "note", cwd: tmp.path })
    const first = await DecisionVerbs.apply({ proposal_id: proposed.receipt.id, cwd: tmp.path })
    expect(first.ok).toBe(true)
    const second = await DecisionVerbs.apply({ proposal_id: proposed.receipt.id, cwd: tmp.path })
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error("expected failure")
    expect(second.code).toBe("already_applied")
  })

  test("status open proposals logic", async () => {
    await using tmp = await workspace()
    const a = await DecisionVerbs.propose({ action: "note", cwd: tmp.path })
    const b = await DecisionVerbs.propose({ action: "reject", cwd: tmp.path })
    await DecisionVerbs.apply({ proposal_id: a.receipt.id, cwd: tmp.path })
    const st = await DecisionVerbs.status({ cwd: tmp.path, limit: 50 })
    expect(st.open.map((r) => r.id)).toEqual([b.receipt.id])
    expect(st.receipts.length).toBeGreaterThanOrEqual(3)
    expect(st.receipts[0].ts >= st.receipts[st.receipts.length - 1].ts).toBe(true)
  })

  test("status filters by id and proposal_id", async () => {
    await using tmp = await workspace()
    const a = await DecisionVerbs.propose({ action: "note", cwd: tmp.path })
    await DecisionVerbs.propose({ action: "note", cwd: tmp.path })
    const byId = await DecisionVerbs.status({ cwd: tmp.path, id: a.receipt.id })
    expect(byId.receipts).toHaveLength(1)
    expect(byId.receipts[0].id).toBe(a.receipt.id)
    await DecisionVerbs.apply({ proposal_id: a.receipt.id, cwd: tmp.path })
    const byProposal = await DecisionVerbs.status({ cwd: tmp.path, proposal_id: a.receipt.id })
    expect(byProposal.receipts.some((r) => r.verb === "apply")).toBe(true)
    expect(byProposal.receipts.every((r) => r.id === a.receipt.id || r.proposal_id === a.receipt.id)).toBe(true)
  })

  test("propose scrubs secrets from meta", async () => {
    await using tmp = await workspace()
    const result = await DecisionVerbs.propose({
      action: "note",
      cwd: tmp.path,
      meta: { note: "x", password: "nope" },
    })
    expect(result.receipt.meta).toEqual({ note: "x" })
  })
})
