import { describe, expect, test } from "bun:test"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosureProof as Proof } from "@/session/closure/proof"

const session = (name: string) => Model.id("session", name)
const edge = (name: string) => Model.id("edge", name)
const part = (name: string) => Model.id("part", name)
const job = (name: string) => Model.id("job", name)

const ROOT = session("ses_root")
const CHILD = session("ses_child")
const GRAND = session("ses_grand")
const HISTORIC = session("ses_historic")
const STRANGER = session("ses_stranger")
const FOREIGN = session("ses_foreign")
const MID = session("ses_mid")
const LEAF = session("ses_leaf")

const connected = (proofs: readonly Model.ProofInput[]) =>
  proofs.filter(
    (item): item is Extract<Model.ProofInput, { readonly value: "proven_connected" }> =>
      item.value === "proven_connected",
  )

/** Every session any proof grants authority over, which is what "never widen" is measured against. */
const touched = (proofs: readonly Model.ProofInput[]) =>
  connected(proofs).flatMap((item) => [item.active, ...item.path])

describe("closure.proof.validateEdges", () => {
  test("a sparse observation is valid - coordinates are required only WHERE AVAILABLE", () => {
    const result = Proof.validateEdges([{ id: edge("e1"), owner: ROOT, child: CHILD }])
    // The negative that matters: absence must not be read as disagreement.
    expect(result.mismatched).toHaveLength(0)
    expect(result.incomplete).toHaveLength(0)
    // Positive: the edge is genuinely usable, so the row is not passing on an empty result.
    expect(result.valid).toHaveLength(1)
    expect(result.valid[0]!.owner).toBe(ROOT)
    expect(result.valid[0]!.child).toBe(CHILD)
  })

  test("disagreeing observations are discarded, never resolved to the convenient side", () => {
    const result = Proof.validateEdges([
      // e1 contradicts itself about which session the edge even points at.
      { id: edge("e1"), owner: ROOT, child: CHILD },
      { id: edge("e1"), owner: ROOT, child: GRAND },
      // e2 is ALSO observed twice, but consistently. This is the positive control: an
      // implementation that simply distrusts any twice-observed edge fails here.
      { id: edge("e2"), owner: ROOT, child: STRANGER },
      { id: edge("e2"), owner: ROOT, child: STRANGER, taskPart: part("p1") },
    ])
    expect(result.mismatched).toHaveLength(1)
    expect(result.mismatched[0]!.id).toBe(edge("e1"))
    expect(result.mismatched[0]!.coordinates).toContain("child")
    // Both claimed children are retained so the walk can mark each node contradicted; neither is chosen.
    expect(result.mismatched[0]!.children).toContain(CHILD)
    expect(result.mismatched[0]!.children).toContain(GRAND)
    expect(result.valid.map((item) => item.id)).toEqual([edge("e2")])
    expect(result.valid[0]!.taskPart).toBe(part("p1"))
  })

  test("complementary observations merge, and sequences union rather than conflict", () => {
    const result = Proof.validateEdges([
      { id: edge("e1"), owner: ROOT, child: CHILD, taskPart: part("p1"), sequences: [0n] },
      { id: edge("e1"), child: CHILD, job: job("j1"), sequences: [1n] },
    ])
    // Two observers legitimately see different subsets of one edge's invocation sequences.
    // Requiring equality there would turn ordinary partial observation into a contradiction.
    expect(result.mismatched).toHaveLength(0)
    expect(result.valid).toHaveLength(1)
    expect(result.valid[0]!.taskPart).toBe(part("p1"))
    expect(result.valid[0]!.job).toBe(job("j1"))
    expect(result.valid[0]!.sequences).toEqual([0n, 1n])
  })

  test("an observation missing an endpoint connects nothing and is not a contradiction", () => {
    const result = Proof.validateEdges([
      { id: edge("e1"), owner: ROOT },
      { id: edge("e2"), owner: ROOT, child: CHILD },
    ])
    expect(result.incomplete).toHaveLength(1)
    expect(result.incomplete[0]!.id).toBe(edge("e1"))
    // The partial retains what it DID observe. That is not bookkeeping: the lineage bridge is only
    // admissible because current evidence already proved this edge exists and left one endpoint open.
    expect(result.incomplete[0]!.owner).toBe(ROOT)
    expect(result.incomplete[0]!.child).toBeUndefined()
    expect(result.mismatched).toHaveLength(0)
    // Positive control: the well-formed sibling still validates, so `incomplete` is a per-edge
    // disposition rather than a whole-batch rejection.
    expect(result.valid.map((item) => item.id)).toEqual([edge("e2")])
  })
})

describe("closure.proof.classify", () => {
  test("a validated chain to the root is proven_connected, root-first, with consumable edges", () => {
    const proofs = Proof.classify({
      root: ROOT,
      leaves: [GRAND],
      edges: [
        { id: edge("e1"), owner: ROOT, child: CHILD },
        { id: edge("e2"), owner: CHILD, child: GRAND },
      ],
    })
    expect(proofs).toHaveLength(1)
    const proof = connected(proofs)[0]!
    expect(proof.active).toBe(GRAND)
    // Order is a contract, not a detail: `model.ts` claim() keeps only edges whose owner/child are
    // CONSECUTIVE on the proof's own path. A leaf-first path still type-checks and still names the
    // right sessions, but every edge would be silently dropped downstream.
    expect(proof.path).toEqual([ROOT, CHILD, GRAND])
    const consumable = proof.edges.filter((item) =>
      proof.path.some((at, index) => at === item.owner && proof.path[index + 1] === item.child),
    )
    expect(proof.edges).toHaveLength(2)
    expect(consumable).toHaveLength(proof.edges.length)
  })

  test("a durable descendant with lineage but no active leaf and no edge receives no proof", () => {
    const proofs = Proof.classify({
      root: ROOT,
      leaves: [CHILD],
      edges: [{ id: edge("e1"), owner: ROOT, child: CHILD }],
      // HISTORIC really is a durable child of the requested root. Classification rejects parentID as a
      // seed, so supplying it here is what makes the absence below meaningful rather than vacuous:
      // an implementation that seeded from lineage would emit a proof naming HISTORIC.
      lineage: [
        { session: CHILD, parent: ROOT },
        { session: HISTORIC, parent: ROOT },
      ],
    })
    // Positive control: the classifier ran and produced real authority for the active leaf.
    expect(connected(proofs)).toHaveLength(1)
    expect(connected(proofs)[0]!.active).toBe(CHILD)
    // The historical descendant is untouched - no signal, no claim, no record subject.
    expect(touched(proofs)).not.toContain(HISTORIC)
    expect(proofs).toHaveLength(1)
  })

  test("contradictory metadata never widens authority while independent proof still closes", () => {
    const proofs = Proof.classify({
      root: ROOT,
      leaves: [CHILD, GRAND],
      edges: [
        { id: edge("e1"), owner: ROOT, child: CHILD },
        // The edge into GRAND contradicts itself about its Task ToolPart.
        { id: edge("e2"), owner: CHILD, child: GRAND, taskPart: part("p1") },
        { id: edge("e2"), owner: CHILD, child: GRAND, taskPart: part("p2") },
      ],
    })
    // "close independently proven work": CHILD is unaffected by the contradiction below it.
    expect(connected(proofs).map((item) => item.active)).toEqual([CHILD])
    // "never widen authority": GRAND is never claimed on the strength of contradicted evidence.
    expect(touched(proofs)).not.toContain(GRAND)
    // "error if completeness unprovable": evidence started at this root and broke, so this root's
    // view is scope-incomplete rather than silently successful.
    const incomplete = proofs.filter((item) => item.value === "root_anchored_incomplete")
    expect(incomplete).toHaveLength(1)
    expect(incomplete[0]!.root).toBe(ROOT)
  })

  test("work with no route from this root is unanchored_unknown, never this root's failure", () => {
    const proofs = Proof.classify({
      root: ROOT,
      leaves: [CHILD, STRANGER],
      edges: [
        { id: edge("e1"), owner: ROOT, child: CHILD },
        // STRANGER's own evidence is CONTRADICTORY, not merely foreign. That is what puts the
        // contamination guard under load: a contradiction is exactly the condition that reaches for
        // `root_anchored_incomplete`, and the only thing withholding it here is that no route runs
        // from this root to the break. A clean foreign chain would exit as `exhausted` instead and
        // could never exercise the guard at all.
        { id: edge("e2"), owner: FOREIGN, child: STRANGER, taskPart: part("p1") },
        { id: edge("e2"), owner: FOREIGN, child: STRANGER, taskPart: part("p2") },
      ],
    })
    // Positive control: unrelated work does not suppress this root's real authority.
    expect(connected(proofs).map((item) => item.active)).toEqual([CHILD])
    expect(proofs.filter((item) => item.value === "unanchored_unknown")).toHaveLength(1)
    // The contamination guard. `root_anchored_incomplete` FAILS the requested root's view, so
    // reaching for it on evidence that never touched this root would fail a healthy view.
    expect(proofs.filter((item) => item.value === "root_anchored_incomplete")).toHaveLength(0)
    expect(touched(proofs)).not.toContain(STRANGER)
  })

  test("two valid edges naming one child is contradictory lineage, not a choice to make", () => {
    const proofs = Proof.classify({
      root: ROOT,
      leaves: [GRAND],
      edges: [
        { id: edge("e1"), owner: ROOT, child: CHILD },
        { id: edge("e2"), owner: ROOT, child: GRAND },
        { id: edge("e3"), owner: CHILD, child: GRAND },
      ],
    })
    // Both edges are individually well-formed, so nothing is `mismatched`; the contradiction is that
    // GRAND has two owners. Picking either would be the convenient side.
    expect(connected(proofs)).toHaveLength(0)
    expect(proofs.filter((item) => item.value === "root_anchored_incomplete")).toHaveLength(1)
    expect(touched(proofs)).not.toContain(GRAND)
  })
})

describe("closure.proof.classify - restrained lineage bridging", () => {
  test("bridges a metadata gap where current evidence proved the edge and lineage only names its owner", () => {
    const proofs = Proof.classify({
      root: ROOT,
      leaves: [LEAF],
      edges: [
        { id: edge("e1"), owner: ROOT, child: MID },
        // Current evidence PROVES this edge exists and left the owner open. That is a gap in
        // identity, not a gap in existence, which is the only thing lineage may close.
        { id: edge("e2"), child: LEAF },
      ],
      lineage: [{ session: LEAF, parent: MID }],
    })
    expect(connected(proofs)).toHaveLength(1)
    const proof = connected(proofs)[0]!
    expect(proof.active).toBe(LEAF)
    expect(proof.path).toEqual([ROOT, MID, LEAF])
    // The bridged edge is emitted and survives claim()'s consecutive-pair filter, so the completed
    // edge reaches the operation's edge set rather than being dropped downstream.
    expect(proof.edges.map((item) => item.id)).toEqual([edge("e1"), edge("e2")])
  })

  test("lineage never attaches an active leaf on its own, because it cannot create an edge", () => {
    const proofs = Proof.classify({
      root: ROOT,
      leaves: [MID, LEAF],
      edges: [{ id: edge("e1"), owner: ROOT, child: MID }],
      // LEAF really is durable-parented under MID, and MID really is inside this root's validated
      // reach - so gate 2 would pass. The only missing thing is ANY current edge observation for
      // LEAF, which makes this an absence rather than a gap. Bridging it would be seeding.
      lineage: [{ session: LEAF, parent: MID }],
    })
    // Positive control: the classifier ran and produced real authority for the evidenced leaf.
    expect(connected(proofs).map((item) => item.active)).toEqual([MID])
    expect(touched(proofs)).not.toContain(LEAF)
    expect(proofs.filter((item) => item.value === "unanchored_unknown")).toHaveLength(1)
  })

  test("a lineage parent outside this root's validated reach never bridges", () => {
    const proofs = Proof.classify({
      root: ROOT,
      leaves: [MID, LEAF],
      edges: [
        { id: edge("e1"), owner: ROOT, child: MID },
        { id: edge("e2"), child: LEAF },
      ],
      // The gap is real and current evidence proved the edge exists - but the owner lineage names is
      // not reachable from this root over validated edges, so honouring it would EXPAND the branch
      // onto a node this root never proved it owns.
      lineage: [{ session: LEAF, parent: FOREIGN }],
    })
    expect(connected(proofs).map((item) => item.active)).toEqual([MID])
    expect(touched(proofs)).not.toContain(LEAF)
    expect(touched(proofs)).not.toContain(FOREIGN)
  })

  test("a bridge never enables another bridge", () => {
    const proofs = Proof.classify({
      root: ROOT,
      leaves: [MID, LEAF],
      edges: [
        { id: edge("e1"), owner: ROOT, child: CHILD },
        { id: edge("e2"), child: MID },
        { id: edge("e3"), child: LEAF },
      ],
      lineage: [
        { session: MID, parent: CHILD },
        { session: LEAF, parent: MID },
      ],
    })
    // MID bridges, because CHILD is in the pre-bridge validated reach.
    expect(connected(proofs).map((item) => item.active)).toEqual([MID])
    // LEAF does not. MID entered the graph THROUGH a bridge, and the gate set is computed once over
    // validated edges before any bridge exists, so lineage cannot walk itself outward hop by hop.
    // That chaining is precisely how durable lineage would widen cancellation, and the enforcement
    // is the ordering rather than a rule the walk has to remember to apply.
    expect(touched(proofs)).not.toContain(LEAF)
  })

  test("K5: an active grandchild below an idle intermediate is reached, and a historical sibling is not", () => {
    const proofs = Proof.classify({
      root: ROOT,
      // CHILD has no activity of its own, so it is not an active leaf. Classification admits it only as
      // a connector on the proven path.
      leaves: [GRAND],
      edges: [
        { id: edge("e1"), owner: ROOT, child: CHILD },
        { id: edge("e2"), owner: CHILD, child: GRAND },
      ],
      lineage: [
        { session: CHILD, parent: ROOT },
        { session: GRAND, parent: CHILD },
        { session: HISTORIC, parent: ROOT },
      ],
    })
    expect(connected(proofs)).toHaveLength(1)
    const proof = connected(proofs)[0]!
    // Reached even though the intermediate between it and the root is idle.
    expect(proof.active).toBe(GRAND)
    expect(proof.path).toEqual([ROOT, CHILD, GRAND])
    // Connector, not subject: CHILD is claimed on the path but is never the active work.
    expect(proof.path).toContain(CHILD)
    expect(connected(proofs).map((item) => item.active)).not.toContain(CHILD)
    // The historical sibling stays untouched, though lineage names it a real durable child here.
    expect(touched(proofs)).not.toContain(HISTORIC)
  })
})
