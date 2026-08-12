// Pure resolution of the slot tree: the mounted slot paths plus plugin claims
// in, per-path placement buckets plus diagnostics out. No solid, no I/O —
// every policy rule (replacement takeover, hierarchy-beats-timeline,
// last-enabled-wins, missing-target degradation) is testable as a data
// transform.

export type PlacementKind = "prepend" | "append" | "before" | "after" | "replace"

// Normalized from the public SlotClaim shape by the plugin API: exactly one
// placement kind, the target path erased to a string so the resolver stays
// independent of the slot map.
export type Placement = { readonly kind: PlacementKind; readonly target: string }

// One plugin's registered slot claim, in enable order within the claims array.
export type Claim<Render> = {
  readonly key: string
  readonly plugin: string
  readonly placement: Placement
  readonly render: Render
}

// Everything one mounted slot renders besides its own children: siblings
// around the boundary, contributions inside it, and at most one takeover.
export type Slotted<Render> = {
  readonly before: ReadonlyArray<Claim<Render>>
  readonly prepend: ReadonlyArray<Claim<Render>>
  readonly append: ReadonlyArray<Claim<Render>>
  readonly after: ReadonlyArray<Claim<Render>>
  readonly replace?: Claim<Render>
}

export type Suppressed<Render> = {
  readonly claim: Claim<Render>
  // The winning claim for a conflict or boundary suppression; absent when a
  // replacement's target no longer exists (missing replacements never degrade).
  readonly by?: Claim<Render>
}

export type Degraded<Render> = {
  readonly claim: Claim<Render>
  // The surviving ancestor path the claim was appended to.
  readonly to: string
}

const EMPTY: Slotted<never> = { before: [], prepend: [], append: [], after: [] }

export function emptySlotted<Render>(): Slotted<Render> {
  return EMPTY
}

// The tree's one containment rule: a path contains every path it prefixes.
// Shared with the <Slot> mount assertion so the spellings cannot drift.
export function contains(ancestor: string, path: string) {
  return path.startsWith(ancestor + ".")
}

// `paths` is the set of currently mounted slot paths; `claims` is every
// active claim in plugin enable order. The result maps each targeted path to
// its placement buckets — untargeted paths are absent and render as empty.
export function resolveSlots<Render>(input: {
  readonly paths: ReadonlySet<string>
  readonly claims: ReadonlyArray<Claim<Render>>
}): {
  readonly slotted: ReadonlyMap<string, Slotted<Render>>
  readonly suppressed: ReadonlyArray<Suppressed<Render>>
  readonly degraded: ReadonlyArray<Degraded<Render>>
} {
  const suppressed: Suppressed<Render>[] = []
  const degraded: Degraded<Render>[] = []

  // Pass 1 — replacement boundaries. Per target the last-enabled claim wins;
  // then an accepted boundary swallows every replacement strictly inside it,
  // regardless of enable order (hierarchy beats timeline).
  const winners = new Map<string, Claim<Render>>()
  for (const claim of input.claims) {
    if (claim.placement.kind !== "replace") continue
    if (!input.paths.has(claim.placement.target)) {
      suppressed.push({ claim })
      continue
    }
    const prior = winners.get(claim.placement.target)
    if (prior) suppressed.push({ claim: prior, by: claim })
    winners.set(claim.placement.target, claim)
  }
  const boundaries = new Map<string, Claim<Render>>()
  const containing = (path: string) => {
    for (const [boundary, winner] of boundaries) if (contains(boundary, path)) return winner
    return undefined
  }
  // Shallow boundaries first, so a nested replacement meets its container.
  for (const [path, winner] of [...winners].sort((a, b) => depth(a[0]) - depth(b[0]))) {
    const outer = containing(path)
    if (outer) {
      suppressed.push({ claim: winner, by: outer })
      continue
    }
    boundaries.set(path, winner)
  }

  // Pass 2 — additive claims, in enable order. A claim whose target sits
  // inside a replaced boundary is suppressed; a claim whose target is gone
  // degrades to appending on the nearest surviving ancestor.
  const buckets = new Map<
    string,
    { before: Claim<Render>[]; prepend: Claim<Render>[]; append: Claim<Render>[]; after: Claim<Render>[] }
  >()
  const bucket = (path: string) => {
    const existing = buckets.get(path)
    if (existing) return existing
    const fresh = { before: [], prepend: [], append: [], after: [] }
    buckets.set(path, fresh)
    return fresh
  }
  for (const claim of input.claims) {
    const kind = claim.placement.kind
    if (kind === "replace") continue
    const target = claim.placement.target
    // Inside placements targeting a replaced boundary are part of its
    // contents; sibling placements on the boundary itself stay outside it.
    const inside = kind === "prepend" || kind === "append" ? boundaries.get(target) : undefined
    const outer = inside ?? containing(target)
    if (outer) {
      suppressed.push({ claim, by: outer })
      continue
    }
    if (input.paths.has(target)) {
      bucket(target)[kind].push(claim)
      continue
    }
    const ancestor = survivingAncestor(target, input.paths)
    if (ancestor === undefined) {
      suppressed.push({ claim })
      continue
    }
    // The ancestor is never a replaced boundary (containing() caught that).
    // Appending is load-bearing: a parent slot registers before its children
    // and <Slot> renders append after them, so the transient degradation
    // during a nested mount never instantiates anything.
    degraded.push({ claim, to: ancestor })
    bucket(ancestor).append.push(claim)
  }

  const slotted = new Map<string, Slotted<Render>>()
  for (const [path, lists] of buckets) slotted.set(path, lists)
  for (const [path, winner] of boundaries) slotted.set(path, { ...(buckets.get(path) ?? EMPTY), replace: winner })
  return { slotted, suppressed, degraded }
}

function depth(path: string) {
  return path.split(".").length
}

function survivingAncestor(path: string, paths: ReadonlySet<string>) {
  for (let index = path.lastIndexOf("."); index !== -1; index = path.lastIndexOf(".", index - 1)) {
    const ancestor = path.slice(0, index)
    if (paths.has(ancestor)) return ancestor
  }
  return undefined
}
