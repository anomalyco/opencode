import type { Ontology } from "./ontology.ts"
import type { Link, ObjectInstance } from "./types.ts"

/** Outgoing neighbors of an object, optionally filtered to one link type. */
export function neighbors(ontology: Ontology, id: string, linkType?: string): ObjectInstance[] {
  return ontology
    .allLinks()
    .filter((l) => l.from === id && (linkType === undefined || l.type === linkType))
    .map((l) => ontology.get(l.to))
    .filter((o): o is ObjectInstance => o !== undefined)
}

/** Incoming neighbors (edges pointing at `id`). */
export function incoming(ontology: Ontology, id: string, linkType?: string): ObjectInstance[] {
  return ontology
    .allLinks()
    .filter((l) => l.to === id && (linkType === undefined || l.type === linkType))
    .map((l) => ontology.get(l.from))
    .filter((o): o is ObjectInstance => o !== undefined)
}

/**
 * Traverse a chain of link types from a starting object, e.g.
 * `traverse(ont, sessionId, ["runs", "has-skill"])` walks Session→Agent→Skill.
 * Returns the deduplicated objects reached at the end of the path.
 */
export function traverse(ontology: Ontology, startId: string, path: string[]): ObjectInstance[] {
  let frontier = [startId]
  for (const linkType of path) {
    const next = new Set<string>()
    for (const id of frontier) {
      for (const n of neighbors(ontology, id, linkType)) next.add(n.id)
    }
    frontier = [...next]
  }
  return frontier.map((id) => ontology.get(id)).filter((o): o is ObjectInstance => o !== undefined)
}

export interface Subgraph {
  objects: ObjectInstance[]
  links: Link[]
}

/** The induced subgraph over a set of object ids (links with both ends inside). */
export function subgraph(ontology: Ontology, ids: string[]): Subgraph {
  const set = new Set(ids)
  const objects = ontology.allObjects().filter((o) => set.has(o.id))
  const links = ontology.allLinks().filter((l) => set.has(l.from) && set.has(l.to))
  return { objects, links }
}

/**
 * Breadth-first expansion from a root up to `depth` hops in either direction —
 * the "relevant subgraph" handed to the LLM for a query.
 */
export function expand(ontology: Ontology, rootId: string, depth = 2): Subgraph {
  const visited = new Set<string>([rootId])
  let frontier = [rootId]
  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const n of [...neighbors(ontology, id), ...incoming(ontology, id)]) {
        if (!visited.has(n.id)) {
          visited.add(n.id)
          next.push(n.id)
        }
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }
  return subgraph(ontology, [...visited])
}

/** Render a subgraph as compact text for an LLM prompt or a CLI trace. */
export function describeSubgraph(graph: Subgraph): string {
  const objs = graph.objects
    .map((o) => `- ${o.type} ${o.id}${o.properties.name ? ` (${o.properties.name})` : ""}`)
    .join("\n")
  const links = graph.links.map((l) => `- ${l.from} —${l.type}→ ${l.to}`).join("\n")
  return `Objects:\n${objs || "  (none)"}\n\nLinks:\n${links || "  (none)"}`
}
