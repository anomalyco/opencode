import type { BackgroundJob } from "@opencode-ai/core/background-job"
import type * as Model from "./model"

/**
 * A sparse observation of one current Task edge. Missing coordinates are allowed, but conflicting
 * observations invalidate the edge. Opaque lifetime tokens stay out of model data; invocation
 * sequences describe the edge and are not independent cancellation targets.
 */
export type EdgeObservation = {
  readonly id: Model.EdgeID
  readonly owner?: Model.SessionID
  readonly child?: Model.SessionID
  /** Optional because discovery knows the call but not its Part ID. */
  readonly taskPart?: Model.PartID
  /** Owning Message and tool call make the Task coordinate observable during discovery. */
  readonly taskMessage?: string
  readonly taskCall?: string
  readonly job?: Model.JobID
  readonly jobState?: BackgroundJob.LifetimeState
  readonly sequences?: readonly bigint[]
  readonly lease?: Model.LeaseID
  readonly participant?: Model.ParticipantID
  readonly instance?: Model.InstanceID
  readonly generation?: bigint
}

export type ValidatedEdge = {
  readonly id: Model.EdgeID
  readonly owner: Model.SessionID
  readonly child: Model.SessionID
  readonly taskPart?: Model.PartID
  readonly taskMessage?: string
  readonly taskCall?: string
  readonly job?: Model.JobID
  readonly jobState?: BackgroundJob.LifetimeState
  readonly sequences: readonly bigint[]
  readonly lease?: Model.LeaseID
  readonly participant?: Model.ParticipantID
  readonly instance?: Model.InstanceID
  readonly generation?: bigint
}

/** An edge whose observations disagreed. `coordinates` names every field that contradicted. */
export type EdgeMismatch = {
  readonly id: Model.EdgeID
  readonly coordinates: readonly string[]
  /** Every child value any observation claimed, so the walk can mark those nodes contradicted. */
  readonly children: readonly Model.SessionID[]
  /** Claimed owners help locate a contradiction but never grant authority. */
  readonly owners: readonly Model.SessionID[]
}

/** An observed edge with a missing endpoint; it proves existence but connects nothing by itself. */
export type PartialEdge = {
  readonly id: Model.EdgeID
  readonly owner?: Model.SessionID
  readonly child?: Model.SessionID
}

export type EdgeValidation = {
  readonly valid: readonly ValidatedEdge[]
  readonly mismatched: readonly EdgeMismatch[]
  /** Observations that agreed but never supplied both endpoints, so they connect nothing alone. */
  readonly incomplete: readonly PartialEdge[]
}

/** Every available identity coordinate must agree across observations of one edge. */
const IDENTITY = [
  "owner",
  "child",
  // Retained observations provide the second producer needed to expose coordinate conflicts.
  // `taskPart` remains available for callers that can supply the post-resolution coordinate.
  "taskPart",
  "taskMessage",
  "taskCall",
  "job",
  "jobState",
  "lease",
  "participant",
  "instance",
  "generation",
]

function distinct(values: readonly unknown[]) {
  return values.filter((item, index) => values.indexOf(item) === index)
}

function observed(items: readonly EdgeObservation[], key: string) {
  return distinct(items.map((item) => (item as unknown as Record<string, unknown>)[key]).filter((v) => v !== undefined))
}

/** Groups observations by edge. Invocation sequences are unioned because observers may see subsets. */
export function validateEdges(observations: readonly EdgeObservation[]): EdgeValidation {
  const ids = distinct(observations.map((item) => item.id)) as readonly Model.EdgeID[]
  const groups = ids.map((id) => ({ id, items: observations.filter((item) => item.id === id) }))
  const results = groups.map((group) => {
    const conflicts = IDENTITY.filter((key) => observed(group.items, key).length > 1)
    if (conflicts.length > 0)
      return {
        type: "mismatch" as const,
        value: {
          id: group.id,
          coordinates: conflicts,
          children: observed(group.items, "child") as readonly Model.SessionID[],
          owners: observed(group.items, "owner") as readonly Model.SessionID[],
        },
      }
    const pick = <T>(key: string) => observed(group.items, key)[0] as T | undefined
    const owner = pick<Model.SessionID>("owner")
    const child = pick<Model.SessionID>("child")
    if (owner === undefined || child === undefined)
      return { type: "incomplete" as const, value: { id: group.id, owner, child } }
    return {
      type: "valid" as const,
      value: {
        id: group.id,
        owner,
        child,
        taskPart: pick<Model.PartID>("taskPart"),
        taskMessage: pick<string>("taskMessage"),
        taskCall: pick<string>("taskCall"),
        job: pick<Model.JobID>("job"),
        jobState: pick<BackgroundJob.LifetimeState>("jobState"),
        sequences: distinct(group.items.flatMap((item) => item.sequences ?? [])) as readonly bigint[],
        lease: pick<Model.LeaseID>("lease"),
        participant: pick<Model.ParticipantID>("participant"),
        instance: pick<Model.InstanceID>("instance"),
        generation: pick<bigint>("generation"),
      },
    }
  })
  return {
    valid: results.filter((item) => item.type === "valid").map((item) => item.value as ValidatedEdge),
    mismatched: results.filter((item) => item.type === "mismatch").map((item) => item.value as EdgeMismatch),
    incomplete: results.filter((item) => item.type === "incomplete").map((item) => item.value as PartialEdge),
  }
}

export type ClassifyInput = {
  readonly root: Model.SessionID
  /** Only runtime work capable of continuation seeds a scan. */
  readonly leaves: readonly Model.SessionID[]
  readonly edges: readonly EdgeObservation[]
  /**
   * Durable lineage may fill an endpoint only for an already-observed incomplete edge, and only with
   * a parent already reachable over validated edges. It cannot create an edge or expand the branch.
   */
  readonly lineage?: readonly { readonly session: Model.SessionID; readonly parent: Model.SessionID }[]
}

type Walk =
  | { readonly type: "connected"; readonly path: readonly Model.SessionID[] }
  | { readonly type: "contradicted"; readonly at: Model.SessionID }
  | { readonly type: "exhausted" }

function step(
  current: Model.SessionID,
  root: Model.SessionID,
  seen: readonly Model.SessionID[],
  inbound: (child: Model.SessionID) => readonly ValidatedEdge[],
  contradicted: readonly Model.SessionID[],
): Walk {
  if (current === root) return { type: "connected", path: [...seen, current] }
  if (contradicted.includes(current)) return { type: "contradicted", at: current }
  const next = inbound(current)
  // Two distinct valid edges naming one child is contradictory lineage, not a choice to make.
  if (next.length > 1) return { type: "contradicted", at: current }
  // A clean stop proves only missing evidence, not disjointness.
  if (next.length === 0) return { type: "exhausted" }
  const owner = next[0]!.owner
  if (seen.includes(owner) || owner === current) return { type: "contradicted", at: current }
  return step(owner, root, [...seen, current], inbound, contradicted)
}

/**
 * Produces the root-relative values supported by current evidence. It cannot produce
 * `proven_disjoint`: a chain ending away from this root may reflect either another root or an
 * observation gap. Durable lineage cannot supply that missing positive evidence.
 */
export function classify(input: ClassifyInput): readonly Model.ProofInput[] {
  const validation = validateEdges(input.edges)

  // Compute reach before bridging so lineage cannot bootstrap itself across successive gaps.
  const reach = (from: readonly Model.SessionID[], acc: readonly Model.SessionID[]): readonly Model.SessionID[] => {
    const next = validation.valid
      .filter((item) => from.includes(item.owner) && !acc.includes(item.child))
      .map((item) => item.child)
    if (next.length === 0) return acc
    const seeds = distinct(next) as readonly Model.SessionID[]
    return reach(seeds, distinct([...acc, ...next]) as readonly Model.SessionID[])
  }
  const reachable = reach([input.root], [input.root])

  // A bridge fills only an existing edge with a parent independently reachable from this root.
  const bridged = validation.incomplete
    .filter((item) => item.child !== undefined && item.owner === undefined)
    .map((item) => ({ item, parent: (input.lineage ?? []).find((row) => row.session === item.child)?.parent }))
    .filter((row) => row.parent !== undefined && reachable.includes(row.parent))
    .map((row) => ({ id: row.item.id, owner: row.parent!, child: row.item.child!, sequences: [] as readonly bigint[] }))

  const edges = [...validation.valid, ...bridged]
  const inbound = (child: Model.SessionID) => edges.filter((item) => item.child === child)
  // Contradictions established while validating one edge's observations. The other
  // class - one child with two individually valid owners - is invisible here precisely because
  // neither edge is malformed, so the walk detects that locally at the node it reaches.
  const contradicted = distinct(validation.mismatched.flatMap((item) => item.children)) as readonly Model.SessionID[]

  // The proven prefix from this root down to `target`, over valid edges only. Returning the actual
  // chain - rather than just the endpoints - is what separates `root_anchored_incomplete` (evidence
  // starts at this root and breaks part way) from `unanchored_unknown` (nothing relates the break to
  // this root at all). `guard` makes a cyclic edge set terminate instead of recurring forever.
  const route = (
    target: Model.SessionID,
    guard: readonly Model.SessionID[],
  ): readonly Model.SessionID[] | undefined => {
    if (target === input.root) return [input.root]
    if (guard.includes(target)) return undefined
    const found = edges
      .filter((item) => item.child === target)
      .map((item) => route(item.owner, [...guard, target]))
      .find((item) => item !== undefined)
    return found === undefined ? undefined : [...found, target]
  }

  // Every owner any observation claimed for `child`, valid or contradicted. See `EdgeMismatch.owners`.
  const candidates = (child: Model.SessionID) =>
    distinct([
      ...edges.filter((item) => item.child === child).map((item) => item.owner),
      ...validation.mismatched.filter((item) => item.children.includes(child)).flatMap((item) => item.owners),
    ]) as readonly Model.SessionID[]

  const anchor = (at: Model.SessionID) => {
    const direct = route(at, [])
    if (direct !== undefined) return direct
    return candidates(at)
      .map((owner) => route(owner, []))
      .find((item) => item !== undefined)
  }

  return input.leaves.map((leaf) => {
    const walk = step(leaf, input.root, [], inbound, contradicted)
    if (walk.type === "connected") {
      const path = [...walk.path].reverse()
      const proven = edges
        .filter((item) => path.some((session, index) => session === item.owner && path[index + 1] === item.child))
        .map((item) => ({ id: item.id, owner: item.owner, child: item.child }))
      return { value: "proven_connected" as const, root: input.root, active: leaf, path, edges: proven }
    }
    // A reachable contradiction is root-anchored; an unrelated break establishes nothing here.
    const prefix = walk.type === "contradicted" ? anchor(walk.at) : undefined
    if (prefix !== undefined) {
      const proven = edges
        .filter((item) => prefix.some((at, index) => at === item.owner && prefix[index + 1] === item.child))
        .map((item) => ({ id: item.id, owner: item.owner, child: item.child }))
      return { value: "root_anchored_incomplete" as const, root: input.root, path: prefix, edges: proven }
    }
    return { value: "unanchored_unknown" as const, root: input.root }
  })
}

export * as SessionClosureProof from "./proof"
