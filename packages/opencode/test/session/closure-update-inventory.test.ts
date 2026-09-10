import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { key, scan, scanEventServiceAcquisitions, TRACKED } from "./closure-update-inventory"
import { AUTHORITIES, EXCLUSIONS, REGISTRY, registryKey, type Authority } from "./closure-update-registry"

// CP-023 §7.7 / K106 — "Gate-0 full-symbol inventory finds every `Session.updateMessage` caller and
// fails the test/traceability check if any is unclassified."
//
// This is the traceability check. It is not a runtime guard and does not pretend to be one: its job
// is to make the §7.7 classification something that CANNOT silently rot as later gates touch this
// code. A caller added at Gate 5 or 6 fails here rather than passing unnoticed.
//
// The scan root is resolved from this file rather than from the process cwd, so the check behaves
// identically whether the suite is run from `packages/opencode`, from a filter, or from an IDE.
const SRC = join(import.meta.dir, "..", "..", "src")

const inventory = scan(SRC)

describe("CP-023 §7.7 K106 — update-caller inventory", () => {
  test("every production caller of the tracked symbols is classified", () => {
    const registered = new Set(REGISTRY.map(registryKey))
    const unclassified = inventory.sites.filter((site) => !registered.has(key(site)))

    // POSITIVE PRECONDITION. If the scanner silently found nothing — a broken glob, a moved `src`,
    // a regressed matcher — then "no unclassified callers" would be trivially true and this check
    // would certify the codebase while inspecting none of it. That is the exact false assurance
    // K106 exists to prevent, so the check refuses to pass on an empty or implausibly small scan.
    expect(inventory.sites.length).toBeGreaterThan(15)
    expect(inventory.sites.flatMap((site) => site.calls).length).toBeGreaterThan(50)
    // 3 since the `replace_part` lease moved into `Session.replacePart`: the guarded destructive
    // method is itself a part-write entry point, so leaving it untracked would let a future caller
    // of it ship unclassified — the exact hole this inventory closes for its two siblings.
    expect(TRACKED.length).toBe(3)

    expect(
      unclassified.map(
        (site) => `${key(site)} (${site.calls.map((call) => `${call.symbol}:${call.line}`).join(", ")})`,
      ),
    ).toEqual([])
  })

  test("no registry entry describes a caller that no longer exists", () => {
    // The other direction, and it matters as much. A stale entry is how a registry starts describing
    // code that was deleted or renamed — it keeps reading as authoritative while covering nothing,
    // and the next reader trusts it.
    const derived = new Set(inventory.sites.map(key))
    // The record writer is capability-only: it intentionally bypasses generic Session.updateMessage/
    // updatePart, so K107 owns it while K106's generic-caller AST scanner cannot derive it. Keep the
    // exception exact and named rather than weakening stale detection for any other registry row.
    const capabilityOnly = new Set(["session/closure/record.ts::write"])
    const stale = REGISTRY.filter(
      (entry) => !derived.has(registryKey(entry)) && !capabilityOnly.has(registryKey(entry)),
    ).map(registryKey)
    expect(REGISTRY.filter((entry) => capabilityOnly.has(registryKey(entry))).map(registryKey)).toEqual([
      "session/closure/record.ts::write",
    ])
    expect(derived.size).toBeGreaterThan(15)
    expect(stale).toEqual([])
  })

  test("every call form is either resolved to a classification unit or explicitly excluded", () => {
    // The scanner refuses to interpret aliased references, computed dispatch, and calls outside any
    // named binding. Those are surfaced rather than skipped, because a scanner that quietly ignores
    // what it cannot parse under-reports — and an under-reporting inventory is worse than none,
    // since three later gates will read a green result as "all callers classified".
    const excluded = new Set(EXCLUSIONS.map((item) => `${item.file}:${item.line}`))
    const unexplained = inventory.unresolved
      .filter((item) => !excluded.has(`${item.file}:${item.line}`))
      .map((item) => `${item.file}:${item.line} — ${item.reason} — ${item.text}`)

    expect(unexplained).toEqual([])
    // And an exclusion may not outlive the thing it excuses.
    const seen = new Set(inventory.unresolved.map((item) => `${item.file}:${item.line}`))
    expect(EXCLUSIONS.filter((item) => !seen.has(`${item.file}:${item.line}`)).map((item) => item.file)).toEqual([])
  })

  test("every classification carries evidence, and every open question names its owner", () => {
    const missingEvidence: string[] = []
    const ownerless: string[] = []
    const badAuthority: string[] = []

    for (const entry of REGISTRY) {
      if (entry.claims.length === 0) missingEvidence.push(`${registryKey(entry)}: no claims`)
      for (const claim of entry.claims) {
        // A label without reasoning is an assumption the registry would launder into a fact. The
        // file:line requirement is what keeps evidence checkable rather than merely plausible.
        if (claim.evidence.trim().length < 80)
          missingEvidence.push(`${registryKey(entry)}: evidence too thin for ${claim.authority}`)
        if (!/:\d+/.test(claim.evidence))
          missingEvidence.push(`${registryKey(entry)}: evidence for ${claim.authority} cites no file:line`)
        if (!AUTHORITIES.includes(claim.authority)) badAuthority.push(`${registryKey(entry)}: ${claim.authority}`)
      }
      // An open question with no owning gate is how a known gap becomes a permanent one.
      if (entry.uncertain && !entry.resolveBy) ownerless.push(registryKey(entry))
      if (entry.resolveBy && !entry.uncertain) ownerless.push(`${registryKey(entry)}: resolveBy without a question`)
    }

    expect(missingEvidence).toEqual([])
    expect(ownerless).toEqual([])
    expect(badAuthority).toEqual([])
  })

  test("explicit call partitions are disjoint and cover the discovered call count", () => {
    const partitionErrors = (partitions: readonly (readonly number[])[], discovered: number) => {
      const lines = partitions.flat()
      const distinct = new Set(lines)
      return [
        ...(distinct.size === lines.length ? [] : ["claims overlap"]),
        ...(lines.length === discovered ? [] : [`${lines.length} claimed / ${discovered} discovered`]),
      ]
    }

    // Calibrate the check itself: a valid partition passes, while overlap and omission remain
    // distinguishable even when the raw claim count happens to match the discovered count.
    expect(partitionErrors([[10], [20]], 2)).toEqual([])
    expect(partitionErrors([[10], [10]], 2)).toEqual(["claims overlap"])
    expect(partitionErrors([[10]], 2)).toEqual(["1 claimed / 2 discovered"])

    const sites = new Map(inventory.sites.map((site) => [key(site), site]))
    const issues = REGISTRY.flatMap((entry) => {
      const partitions = entry.claims.flatMap((claim) => (claim.lines ? [claim.lines] : []))
      if (partitions.length === 0) return []
      const id = registryKey(entry)
      if (partitions.length !== entry.claims.length) return [`${id}: mixes explicit and implicit call coverage`]
      const site = sites.get(id)
      if (!site) return [`${id}: explicit partition has no scanner-derived caller`]
      return partitionErrors(partitions, site.calls.length).map((issue) => `${id}: ${issue}`)
    })

    // This deliberately checks cardinality and disjointness rather than exact line membership.
    // `file::symbol` remains the stable authority key. The check prevents explicit claims from
    // overlapping or changing the number of partitioned tracked calls; human line citations may
    // still become stale and require review.
    expect(issues).toEqual([])
  })

  test("reports the classification distribution K107 will exercise", () => {
    const counts = new Map<Authority, number>()
    for (const entry of REGISTRY)
      for (const claim of entry.claims) counts.set(claim.authority, (counts.get(claim.authority) ?? 0) + 1)

    // Not a coverage assertion — a visibility one. K107 must exercise four named categories, and
    // this makes it a checkable fact which of them the current source actually populates rather
    // than something a later slice has to rediscover.
    expect(counts.get("pre_fence_leased_execution")).toBeGreaterThan(0)
    expect(counts.get("cancellation_owned_terminalization")).toBeGreaterThan(0)
    expect(counts.get("proven_non_destructive_update")).toBeGreaterThan(0)
    expect(counts.get("post_fence_reject")).toBeGreaterThan(0)

    // Gate 5 F1 adds the second and final §7.7 holder: ToolPart terminalization plus the closure
    // Message/Part writer. Pinned at two so a leak cannot hide behind a non-zero assertion.
    expect(counts.get("exact_closure_capability")).toBe(2)
  })
})

// CP-023 §7.7's EventV2 row — "direct unguarded core Session replay is forbidden".
//
// Gate 7 addition, and it closes no defect: `EventV2.Service` is acquired in exactly one place and
// every production replay site is lexically inside `SessionMutation.replayLeased`. The rule holds by
// CONVENTION, and §7.7 says "forbidden" rather than "discouraged". A rule enforced by nobody
// survives until the next author who has not read it, so this makes it construction instead.
describe("CP-023 §7.7 — core EventV2.Service is acquired only by the closure-aware bridge", () => {
  test("exactly one module holds the raw service, and it is the bridge", () => {
    const { acquisitions, unresolved } = scanEventServiceAcquisitions(SRC)

    // POSITIVE PRECONDITION, for the same reason the inventory scan carries one. A broken walker, a
    // moved `src`, or a regressed matcher would make "no unauthorized holder" trivially true and
    // certify the codebase while inspecting none of it.
    expect(acquisitions.length).toBeGreaterThan(0)
    expect(acquisitions.some((item) => item.form === "qualified")).toBe(true)

    // An ALIASED import of this module is refused rather than skipped, and an unrefused alias would
    // mean the file list below is describing less than the whole surface. Gate 7's third audit
    // defeated the previous scanner with exactly that shape, so the empty-refusal assertion is what
    // makes the file list mean what it says.
    expect(unresolved.map((item) => `${item.file}:${item.line} — ${item.reason}`)).toEqual([])

    expect([...new Set(acquisitions.map((item) => item.file))]).toEqual(["event-v2-bridge.ts"])

    // The bridge is the only holder AND the only thing that can reach `SessionReplayPermit`'s check,
    // so this pins the whole path rather than one spelling of it. `control-plane/workspace.ts` and
    // `handlers/sync.ts` do replay, but through `EventV2Bridge.Service` — a different tag, and the
    // guarded one.
    expect(acquisitions.filter((item) => item.form === "imported")).toEqual([])
    expect(acquisitions.filter((item) => item.form === "computed")).toEqual([])
  })
})
