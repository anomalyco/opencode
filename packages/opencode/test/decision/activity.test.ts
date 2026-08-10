import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { DecisionActivity } from "../../src/decision/activity"
import { appendReceipt, createId, type Receipt } from "../../src/decision/receipt"
import { DecisionVerbs } from "../../src/decision/verbs"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../fixture/fixture"

const entry = path.join(import.meta.dir, "../../src/index.ts")

async function workspace() {
  const tmp = await tmpdir()
  await fs.mkdir(path.join(tmp.path, ".moks"))
  return tmp
}

function receipt(partial: Partial<Receipt> & Pick<Receipt, "verb" | "action" | "state">): Receipt {
  return {
    id: createId(),
    ts: new Date().toISOString(),
    dry_run: true,
    adverse: false,
    ...partial,
  }
}

async function moks(args: string[], cwd: string) {
  const proc = Bun.spawn([process.execPath, entry, ...args, "--json", "--cwd", cwd], {
    cwd,
    env: {
      ...process.env,
      OPENCODE_PURE: "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_TEST_HOME: Global.Path.home,
      HOME: Global.Path.home,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    json = undefined
  }
  return { code, stdout, json }
}

describe("decision/activity", () => {
  test("empty → quiet", async () => {
    await using tmp = await workspace()
    const summary = await DecisionActivity.summarizeActivity({ cwd: tmp.path, days: 7 })
    expect(summary.signal).toBe("quiet")
    expect(summary.proposes).toBe(0)
    expect(summary.applies).toBe(0)
    expect(summary.active_days).toBe(0)
    expect(summary.open_proposals).toBe(0)
    expect(summary.days).toBe(7)
    expect(summary.path).toContain("decisions.jsonl")
    expect(summary.real_req_note.length).toBeGreaterThan(0)
  })

  test("propose in window → active", async () => {
    await using tmp = await workspace()
    await DecisionVerbs.propose({ action: "advance", cwd: tmp.path })
    const summary = await DecisionActivity.summarizeActivity({ cwd: tmp.path, days: 7 })
    expect(summary.signal).toBe("active")
    expect(summary.proposes).toBe(1)
    expect(summary.active_days).toBe(1)
    expect(summary.open_proposals).toBe(1)
  })

  test("old receipts outside window ignored", async () => {
    await using tmp = await workspace()
    const now = new Date("2026-08-10T12:00:00.000Z")
    await appendReceipt(
      receipt({
        verb: "propose",
        action: "note",
        state: "proposed",
        ts: "2026-07-01T12:00:00.000Z",
      }),
      tmp.path,
    )
    await appendReceipt(
      receipt({
        verb: "propose",
        action: "advance",
        state: "proposed",
        ts: "2026-08-09T12:00:00.000Z",
      }),
      tmp.path,
    )
    const summary = await DecisionActivity.summarizeActivity({ cwd: tmp.path, days: 7, now })
    expect(summary.signal).toBe("active")
    expect(summary.proposes).toBe(1)
    expect(summary.active_days).toBe(1)
  })

  test("counts applies and needs_confirm in window", async () => {
    await using tmp = await workspace()
    const proposed = await DecisionVerbs.propose({ action: "note", cwd: tmp.path })
    await DecisionVerbs.apply({ proposal_id: proposed.receipt.id, cwd: tmp.path })
    const adverse = await DecisionVerbs.propose({ action: "reject", cwd: tmp.path })
    await DecisionVerbs.apply({ proposal_id: adverse.receipt.id, cwd: tmp.path })
    const summary = await DecisionActivity.summarizeActivity({ cwd: tmp.path, days: 7 })
    expect(summary.proposes).toBe(2)
    expect(summary.applies).toBe(1)
    expect(summary.needs_confirm).toBe(1)
    expect(summary.adverse_proposes).toBe(1)
    expect(summary.open_proposals).toBe(1)
    expect(summary.signal).toBe("active")
  })

  test("activity --json CLI smoke", async () => {
    await using tmp = await workspace()
    await DecisionVerbs.propose({ action: "note", cwd: tmp.path })
    const result = await moks(["activity", "--days", "7"], tmp.path)
    expect(result.code).toBe(0)
    const json = result.json as {
      days: number
      proposes: number
      signal: string
      path: string
      real_req_note: string
    }
    expect(json.days).toBe(7)
    expect(json.proposes).toBe(1)
    expect(json.signal).toBe("active")
    expect(json.path).toContain("decisions.jsonl")
    expect(json.real_req_note).toContain("real req")
  })
})
