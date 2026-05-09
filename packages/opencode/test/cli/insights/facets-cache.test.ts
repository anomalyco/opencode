import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { loadCachedFacet, saveCachedFacet } from "@/insights/facets"
import type { SessionFacets } from "@/insights/schema"

const sample: SessionFacets = {
  session_id: "deadbeef0000",
  underlying_goal: "test",
  goal_categories: { feature_implementation: 1 },
  outcome: "fully_achieved",
  user_satisfaction_counts: { satisfied: 1 },
  claude_helpfulness: "very_helpful",
  session_type: "single_task",
  friction_counts: {},
  friction_detail: "",
  primary_success: "correct_code_edits",
  brief_summary: "Sample brief.",
}

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "opencode-insights-"))
  process.env["OPENCODE_INSIGHTS_DIR"] = tmp
})

afterEach(() => {
  delete process.env["OPENCODE_INSIGHTS_DIR"]
  rmSync(tmp, { recursive: true, force: true })
})

describe("facet cache", () => {
  test("miss returns null when no file exists", async () => {
    const result = await loadCachedFacet(sample.session_id, 1000)
    expect(result).toBeNull()
  })

  test("save then load returns the same facet on matching end_time", async () => {
    await saveCachedFacet(sample, 1000)
    const result = await loadCachedFacet(sample.session_id, 1000)
    expect(result).toEqual(sample)
  })

  test("stale end_time returns null", async () => {
    await saveCachedFacet(sample, 1000)
    const result = await loadCachedFacet(sample.session_id, 2000)
    expect(result).toBeNull()
  })

  test("schema mismatch returns null and deletes the file", async () => {
    const file = path.join(tmp, "facets", `${sample.session_id}.json`)
    await Bun.write(
      file,
      JSON.stringify({ _v: 1, _end_time: 1000, facets: { not: "a real facet" } }),
    )
    const result = await loadCachedFacet(sample.session_id, 1000)
    expect(result).toBeNull()
    expect(await Bun.file(file).exists()).toBe(false)
  })

  test("missing version field is treated as miss and deletes the file", async () => {
    // Pre-versioning cache file: present in users' caches before this PR
    // shipped. It must not be returned (the schema/prompt may have drifted)
    // and must be removed so the next run starts clean.
    const file = path.join(tmp, "facets", `${sample.session_id}.json`)
    await Bun.write(file, JSON.stringify({ _end_time: 1000, facets: sample }))
    const result = await loadCachedFacet(sample.session_id, 1000)
    expect(result).toBeNull()
    expect(await Bun.file(file).exists()).toBe(false)
  })

  test("corrupted JSON is treated as miss and deletes the file", async () => {
    const file = path.join(tmp, "facets", `${sample.session_id}.json`)
    await Bun.write(file, "{ this is not valid JSON")
    const result = await loadCachedFacet(sample.session_id, 1000)
    expect(result).toBeNull()
    expect(await Bun.file(file).exists()).toBe(false)
  })
})
