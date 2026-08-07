import { describe, expect, test } from "bun:test"
import { hostRankFor, shouldAttemptPlacement } from "@/local/placement"

describe("shouldAttemptPlacement", () => {
  // The default that must not change: a cloud parent's subagents are not moved
  // onto local weights unasked, because the user deliberately chose that model.
  test("a cloud parent is left alone when nobody asked", () => {
    expect(shouldAttemptPlacement({ parentIsLocal: false })).toBe(false)
    expect(shouldAttemptPlacement({ parentIsLocal: false, prefer: "inherit" })).toBe(false)
  })

  test("a local parent places as it always did", () => {
    expect(shouldAttemptPlacement({ parentIsLocal: true })).toBe(true)
    expect(shouldAttemptPlacement({ parentIsLocal: true, prefer: "inherit" })).toBe(true)
  })

  // The whole point of the change: "cloud plans, local implements" only works
  // if a declared role survives a cloud parent.
  test("a role that says where it wants to run survives a cloud parent", () => {
    expect(shouldAttemptPlacement({ parentIsLocal: false, prefer: "local" })).toBe(true)
    expect(shouldAttemptPlacement({ parentIsLocal: false, prefer: ["rocky"] })).toBe(true)
  })

  test("an explicit host is honoured from anywhere", () => {
    expect(shouldAttemptPlacement({ parentIsLocal: false, target: "rocky" })).toBe(true)
    expect(shouldAttemptPlacement({ parentIsLocal: false, target: "rocky", prefer: "inherit" })).toBe(true)
  })

  // An empty list is a declaration that names nothing. Treating it as "asked"
  // would place a cloud parent's subagents locally on the strength of a typo.
  test("an empty host list names nothing, so it authorizes nothing", () => {
    expect(shouldAttemptPlacement({ parentIsLocal: false, prefer: [] })).toBe(false)
    expect(shouldAttemptPlacement({ parentIsLocal: true, prefer: [] })).toBe(true)
  })
})

describe("hostRankFor", () => {
  test("earlier in the list outranks later, and both outrank unnamed", () => {
    const prefer = ["rocky", "m3"]
    expect(hostRankFor(prefer, "rocky")).toBeGreaterThan(hostRankFor(prefer, "m3"))
    expect(hostRankFor(prefer, "m3")).toBeGreaterThan(hostRankFor(prefer, "z4"))
    expect(hostRankFor(prefer, "z4")).toBe(0)
  })

  test("`local` and `inherit` express no host preference", () => {
    expect(hostRankFor("local", "rocky")).toBe(0)
    expect(hostRankFor("inherit", "rocky")).toBe(0)
    expect(hostRankFor(undefined, "rocky")).toBe(0)
  })

  // Ranking rather than filtering is what makes a preference unable to fail a
  // run: a named host that is unreachable never reaches the scoring loop, and
  // every other candidate is still eligible rather than excluded.
  test("a preference outranks the ordinary tie-breakers", () => {
    const prefer = ["rocky"]
    // Must beat the recent-placement penalty (3_000) and the free-VRAM term
    // (~65) so naming a host actually decides an ordinary tie.
    expect(hostRankFor(prefer, "rocky")).toBeGreaterThan(3_000)
    expect(hostRankFor(prefer, "anything-else")).toBe(0)
  })

  // Interaction with HOST_PACED_PENALTY (200_000), added concurrently by another
  // session working the same scorer. A model running its expert layers out of
  // system RAM was measured at 0.81 tok/s against 70 for a full-GPU model on the
  // same host. If a host preference could outweigh that penalty, naming a host
  // whose only resident model is hybrid would land a subagent on the slow one —
  // defeating the very reason someone names a fast host.
  test("a preference never outweighs the host-paced penalty", () => {
    const prefer = ["rocky", "m3", "z4", "proxmox", "m5"]
    for (const host of prefer) {
      expect(hostRankFor(prefer, host)).toBeLessThan(200_000)
    }
  })
})
