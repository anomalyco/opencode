import { Ontology } from "./ontology.ts"
import type { LinkType, ObjectType } from "./types.ts"

/**
 * The daemoncode object model, mirroring the real domain types:
 * - Session   — `packages/core/src/session/*` (id, parentID, cost, title)
 * - Skill     — `packages/core/src/skill` + `SKILL.md` (name, description, body)
 * - Tool      — `packages/opencode/src/session/tools.ts` (name, description)
 * - Agent     — `packages/core/src/config` agent (name, model) referencing skills/tools
 *
 * Properties here are the subset the AIP pipeline reasons over; the ontology is
 * intentionally a projection, not a full mirror of every field.
 */
export const SESSION: ObjectType = {
  name: "Session",
  properties: ["title", "cost", "parentID", "status"],
  titleProperty: "title",
}

export const SKILL: ObjectType = {
  name: "Skill",
  properties: ["name", "description", "path", "passRate", "sizeBytes"],
  titleProperty: "name",
}

export const TOOL: ObjectType = {
  name: "Tool",
  properties: ["name", "description"],
  titleProperty: "name",
}

export const AGENT: ObjectType = {
  name: "Agent",
  properties: ["name", "model", "description"],
  titleProperty: "name",
}

export const LINK_RUNS: LinkType = { name: "runs", from: "Session", to: "Agent" }
export const LINK_HAS_SKILL: LinkType = { name: "has-skill", from: "Agent", to: "Skill" }
export const LINK_HAS_TOOL: LinkType = { name: "has-tool", from: "Agent", to: "Tool" }
export const LINK_SPAWNS: LinkType = { name: "spawns", from: "Session", to: "Session" }

export const OBJECT_TYPES = [SESSION, SKILL, TOOL, AGENT]
export const LINK_TYPES = [LINK_RUNS, LINK_HAS_SKILL, LINK_HAS_TOOL, LINK_SPAWNS]

/** A fresh ontology with the daemoncode object & link types registered. */
export function createOntology(): Ontology {
  const ontology = new Ontology()
  for (const t of OBJECT_TYPES) ontology.registerObjectType(t)
  for (const l of LINK_TYPES) ontology.registerLinkType(l)
  return ontology
}
