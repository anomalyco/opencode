// Pure resolution of a region's structure: the host's part tree plus plugin
// claims in, an ordered render list plus suppressions out. No solid, no I/O —
// every policy rule (takeover, hierarchy-beats-timeline, last-enabled-wins,
// missing-anchor degradation) is testable as a data transform.

// Mirrors the public RegionPlacement type (plugin package) with part ids
// erased to strings so the resolver stays independent of the region map.
// Keep the two unions' variants in sync.
export type Placement =
  | { readonly at: "start" | "end" }
  | { readonly before: string }
  | { readonly after: string }
  | { readonly replace: string }

// One plugin's registered slot, in enable order within the claims array.
export type Claim<Render> = {
  readonly key: string
  readonly plugin: string
  readonly placement: Placement
  readonly render: Render
}

// Host furniture: a leaf renders, a container groups — never both. Part ids
// are the stable anchor vocabulary and must be unique within a region.
export type Part<Render, Id extends string = string> =
  | { readonly id: Id; readonly render: Render; readonly parts?: never }
  | { readonly id: Id; readonly parts: ReadonlyArray<Part<Render, Id>>; readonly render?: never }

export type Entry<PartRender, ClaimRender> =
  | { readonly kind: "part"; readonly id: string; readonly render: PartRender }
  | { readonly kind: "claim"; readonly claim: Claim<ClaimRender> }

export function resolveStructure<PartRender extends {}, ClaimRender>(input: {
  readonly region: string
  readonly parts: ReadonlyArray<Part<PartRender>>
  readonly claims: ReadonlyArray<Claim<ClaimRender>>
}): {
  readonly entries: ReadonlyArray<Entry<PartRender, ClaimRender>>
  readonly suppressed: ReadonlyArray<{ readonly claim: Claim<ClaimRender>; readonly by: Claim<ClaimRender> }>
  readonly degraded: ReadonlyArray<Claim<ClaimRender>>
} {
  // Root takeover: the region's content is the winning claim, full stop.
  // Every other claim — including edge-anchored ones — is suppressed, so a
  // theme can never be silently decorated by chips it didn't plan for.
  const takeover = input.claims
    .filter((claim) => "replace" in claim.placement && claim.placement.replace === input.region)
    .at(-1)
  if (takeover)
    return {
      entries: [{ kind: "claim", claim: takeover }],
      suppressed: input.claims.filter((claim) => claim !== takeover).map((claim) => ({ claim, by: takeover })),
      degraded: [],
    }

  const known = new Set<string>()
  const register = (parts: ReadonlyArray<Part<PartRender>>) => {
    for (const part of parts) {
      known.add(part.id)
      if (part.parts !== undefined) register(part.parts)
    }
  }
  register(input.parts)

  const entries: Entry<PartRender, ClaimRender>[] = []
  const suppressed: { claim: Claim<ClaimRender>; by: Claim<ClaimRender> }[] = []

  // A container takeover orphans everything anchored to (or replacing) the
  // parts inside it. Recorded so the host can surface it (plugins dialog,
  // in a follow-up) — never silently dropped.
  const suppressSubtree = (parts: ReadonlyArray<Part<PartRender>>, by: Claim<ClaimRender>) => {
    for (const part of parts) {
      for (const claim of input.claims) if (anchor(claim.placement) === part.id) suppressed.push({ claim, by })
      if (part.parts !== undefined) suppressSubtree(part.parts, by)
    }
  }

  const walk = (parts: ReadonlyArray<Part<PartRender>>) => {
    for (const part of parts) {
      for (const claim of input.claims)
        if ("before" in claim.placement && claim.placement.before === part.id) entries.push({ kind: "claim", claim })
      // Replacing keeps the part's position: before/after anchors on the
      // replaced id stay valid, only the content (and subtree) changes hands.
      const replacers = input.claims.filter(
        (claim) => "replace" in claim.placement && claim.placement.replace === part.id,
      )
      const winner = replacers.at(-1)
      if (winner) {
        for (const loser of replacers.slice(0, -1)) suppressed.push({ claim: loser, by: winner })
        entries.push({ kind: "claim", claim: winner })
        // Hierarchy beats timeline: claims into the subtree lose to the
        // container's winner no matter when they were enabled.
        if (part.parts !== undefined) suppressSubtree(part.parts, winner)
      }
      if (!winner && part.parts !== undefined) walk(part.parts)
      if (!winner && part.render !== undefined) entries.push({ kind: "part", id: part.id, render: part.render })
      for (const claim of input.claims)
        if ("after" in claim.placement && claim.placement.after === part.id) entries.push({ kind: "claim", claim })
    }
  }

  for (const claim of input.claims)
    if ("at" in claim.placement && claim.placement.at === "start") entries.push({ kind: "claim", claim })
  walk(input.parts)
  for (const claim of input.claims)
    if ("at" in claim.placement && claim.placement.at === "end") entries.push({ kind: "claim", claim })

  // A claim aimed at a part the host no longer publishes degrades to the
  // region's end rather than vanishing: an anchor rename must never silently
  // cost a plugin its render. Degraded claims land after end-edge claims,
  // in enable order.
  const degraded = input.claims.filter((claim) => {
    const id = anchor(claim.placement)
    return id !== undefined && !known.has(id)
  })
  for (const claim of degraded) entries.push({ kind: "claim", claim })

  return { entries, suppressed, degraded }
}

function anchor(placement: Placement) {
  if ("before" in placement) return placement.before
  if ("after" in placement) return placement.after
  if ("replace" in placement) return placement.replace
  return undefined
}
