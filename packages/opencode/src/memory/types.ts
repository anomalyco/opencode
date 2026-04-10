export namespace Memory {
  // CC-compatible 4 types (migrated from: error-solution, build-command, preference, decision, config-pattern, general)
  export const TYPES = ["user", "feedback", "project", "reference"] as const
  export type Type = (typeof TYPES)[number]

  // Legacy types for backward compatibility in file parsing
  export const LEGACY_TYPES = ["error-solution", "build-command", "preference", "decision", "config-pattern", "general"] as const
  export type LegacyType = (typeof LEGACY_TYPES)[number]

  export const LEGACY_TYPE_MAP: Record<LegacyType, Type> = {
    "error-solution": "project",
    "build-command": "project",
    "preference": "user",
    "decision": "feedback",
    "config-pattern": "project",
    "general": "project",
  }

  // Three-tier scope
  export const SCOPES = ["personal", "project", "global"] as const
  export type Scope = (typeof SCOPES)[number]

  export type Info = {
    id: string
    projectPath: string
    name: string
    description?: string
    type: Type
    scope: Scope
    content: string
    agent?: string
    sessionID?: string
    accessCount: number
    relevanceScore: number
    timeCreated: number
    timeUpdated: number
    timeLastVerified?: number
    promotedFrom?: string
  }

  export type Create = {
    projectPath: string
    name: string
    type: Type
    content: string
    description?: string
    scope?: Scope
    agent?: string
    sessionID?: string
  }

  export type Update = {
    id: string
    name?: string
    description?: string
    type?: Type
    scope?: Scope
    content?: string
    relevanceScore?: number
    timeLastVerified?: number
  }

  export type Frontmatter = {
    name: string
    description?: string
    type: Type
    scope?: Scope
    agent?: string
  }

  // Legacy frontmatter for backward-compatible parsing
  export type LegacyFrontmatter = {
    topic: string
    type: string
  }

  export type FileEntry = {
    filename: string
    frontmatter: Frontmatter
    content: string
  }
}
