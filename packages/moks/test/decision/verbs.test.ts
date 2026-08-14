import { describe, expect, test } from "bun:test"
import path from "path"
import { CandidateCard } from "../../src/product/candidate-card"
import { DecisionAts } from "../../src/decision/ats"
import { DecisionGit } from "../../src/decision/git"
import { DecisionVerbs } from "../../src/decision/verbs"
import { tmpdir } from "../fixture/fixture"

const SHA = /^[0-9a-f]{7,64}$/

async function workspace() {
  return tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
      await CandidateCard.write(dir, {
        id: "cand_ada",
        stage: "sourced",
        extra: { name: "Ada" },
        body: "# Ada\n",
      })
    },
  })
}

describe("decision/verbs", () => {
  test("commit writes a git sha and is never dry-run", async () => {
    await using tmp = await workspace()
    const result = await DecisionVerbs.commit({ action: "note", cwd: tmp.path })
    expect(result.receipt.dry_run).toBe(false)
    expect(result.receipt.state).toBe("committed")
    expect(result.receipt.verb).toBe("commit")
    expect(result.receipt.id).toMatch(SHA)
    expect(result.receipt.adverse).toBe(false)
  })

  test("commit marks adverse actions", async () => {
    await using tmp = await workspace()
    const result = await DecisionVerbs.commit({ action: "reject", cwd: tmp.path })
    expect(result.receipt.adverse).toBe(true)
    expect(result.receipt.dry_run).toBe(false)
  })

  test("commit with target-id creates a card when the tree is clean", async () => {
    await using tmp = await tmpdir({ git: true })
    const result = await DecisionVerbs.commit({
      action: "reject",
      target: { kind: "candidate", id: "cand_new" },
      cwd: tmp.path,
    })
    expect(result.receipt.id).toMatch(SHA)
    const card = await CandidateCard.read(tmp.path, "cand_new")
    expect(card?.stage).toBe("reject")
  })

  test("commit fails when there is nothing to commit", async () => {
    await using tmp = await tmpdir({ git: true })
    await expect(DecisionVerbs.commit({ action: "note", cwd: tmp.path })).rejects.toThrow("nothing to commit")
  })

  test("push adverse without confirm → needs_confirm", async () => {
    await using tmp = await workspace()
    const committed = await DecisionVerbs.commit({ action: "offer", cwd: tmp.path })
    const result = await DecisionVerbs.push({ commit_id: committed.receipt.id, cwd: tmp.path })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.code).toBe("needs_confirm")
    expect(result.receipt?.state).toBe("needs_confirm")
    expect(await DecisionGit.revParse(tmp.path, DecisionGit.ATS_REF)).toBeUndefined()
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
    expect(await DecisionGit.revParse(tmp.path, DecisionGit.ATS_REF)).toBeUndefined()
  })

  test("push unknown commit fails", async () => {
    await using tmp = await workspace()
    const result = await DecisionVerbs.push({ commit_id: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", cwd: tmp.path })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.code).toBe("not_found")
  })

  test("push already pushed fails after execute", async () => {
    await using tmp = await workspace()
    const committed = await DecisionVerbs.commit({ action: "note", cwd: tmp.path })
    const first = await DecisionVerbs.push({ commit_id: committed.receipt.id, cwd: tmp.path, dry_run: false })
    expect(first.ok).toBe(true)
    const second = await DecisionVerbs.push({ commit_id: committed.receipt.id, cwd: tmp.path })
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error("expected failure")
    expect(second.code).toBe("already_pushed")
  })

  test("status open commits logic", async () => {
    await using tmp = await workspace()
    const a = await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_ada" },
      cwd: tmp.path,
    })
    const b = await DecisionVerbs.commit({
      action: "reject",
      target: { kind: "candidate", id: "cand_ada" },
      cwd: tmp.path,
    })
    await DecisionVerbs.push({ commit_id: a.receipt.id, cwd: tmp.path, dry_run: false })
    const st = await DecisionVerbs.status({ cwd: tmp.path, limit: 50 })
    expect(st.open.map((r) => r.id)).toEqual([b.receipt.id])
    expect(st.receipts.length).toBeGreaterThanOrEqual(2)
    expect(st.receipts[0].ts >= st.receipts[st.receipts.length - 1].ts).toBe(true)
  })

  test("status filters by id and commit_id", async () => {
    await using tmp = await workspace()
    const a = await DecisionVerbs.commit({
      action: "note",
      target: { kind: "candidate", id: "cand_ada" },
      cwd: tmp.path,
    })
    await DecisionVerbs.commit({
      action: "reject",
      target: { kind: "candidate", id: "cand_ada" },
      cwd: tmp.path,
    })
    const byId = await DecisionVerbs.status({ cwd: tmp.path, id: a.receipt.id })
    expect(byId.receipts).toHaveLength(1)
    expect(byId.receipts[0].id).toBe(a.receipt.id)
    await DecisionVerbs.push({ commit_id: a.receipt.id, cwd: tmp.path, dry_run: false })
    const byCommit = await DecisionVerbs.status({ cwd: tmp.path, commit_id: a.receipt.id })
    expect(byCommit.receipts.every((r) => r.id === a.receipt.id || r.commit_id === a.receipt.id)).toBe(true)
    expect(byCommit.open.some((r) => r.id === a.receipt.id)).toBe(false)
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

  test("execute push plans card diffs and writes ats cache", async () => {
    await using tmp = await workspace()
    const committed = await DecisionVerbs.commit({
      action: "advance",
      target: { kind: "candidate", id: "cand_ada" },
      reason: "next round",
      cwd: tmp.path,
    })
    const result = await DecisionVerbs.push({
      commit_id: committed.receipt.id,
      cwd: tmp.path,
      dry_run: false,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    const writes = result.receipt.meta?.writes as { tool: string; stage?: string }[]
    expect(writes.some((write) => write.tool === "change_stage" && write.stage === "screen")).toBe(true)
    expect(writes.some((write) => write.tool === "create_note")).toBe(true)
    const cache = await DecisionAts.loadCache(tmp.path)
    expect(cache.candidates.some((item) => item.id === "cand_ada" && item.stage === "screen")).toBe(true)
    expect(await DecisionGit.revParse(tmp.path, DecisionGit.ATS_REF)).toBe(committed.receipt.id)
  })
})
