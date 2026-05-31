export const EntityType = {
  Tool: "tool",
  Skill: "skill",
  Note: "note",
} as const

export type EntityType = (typeof EntityType)[keyof typeof EntityType]

export const RelationType = {
  DependsOn: "depends_on",
  Contains: "contains",
  References: "references",
} as const

export type RelationType = (typeof RelationType)[keyof typeof RelationType]
