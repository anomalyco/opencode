export * as Skill from "./skill.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { AbsolutePath } from "./schema.js"
import { ephemeral, inventory } from "./event.js"

export const ID = Schema.String.pipe(Schema.brand("Skill.ID"))
export type ID = typeof ID.Type

export const Name = Schema.String.pipe(Schema.brand("Skill.Name"))
export type Name = typeof Name.Type

export interface DirectorySource extends Schema.Schema.Type<typeof DirectorySource> {}
export const DirectorySource = Schema.Struct({
  type: Schema.tag("directory"),
  path: AbsolutePath,
}).annotate({ identifier: "Skill.DirectorySource" })

export interface UrlSource extends Schema.Schema.Type<typeof UrlSource> {}
export const UrlSource = Schema.Struct({
  type: Schema.tag("url"),
  url: Schema.String,
}).annotate({ identifier: "Skill.UrlSource" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  name: Name,
  description: Schema.String.pipe(optional),
  slash: Schema.Boolean.pipe(optional),
  autoinvoke: Schema.Boolean.pipe(optional),
  location: AbsolutePath,
  content: Schema.String,
}).annotate({ identifier: "Skill.Info" })

const Updated = ephemeral({ type: "skill.updated", schema: {} })
export const Event = { Updated, Definitions: inventory(Updated) }

export interface EmbeddedSource extends Schema.Schema.Type<typeof EmbeddedSource> {}
export const EmbeddedSource = Schema.Struct({
  type: Schema.tag("embedded"),
  skill: Schema.suspend(() => Info),
}).annotate({ identifier: "Skill.EmbeddedSource" })

export type Source = DirectorySource | UrlSource | EmbeddedSource
export const Source = Object.assign(
  Schema.Union([DirectorySource, UrlSource, EmbeddedSource]).pipe(
    Schema.toTaggedUnion("type"),
    Schema.annotate({ identifier: "Skill.Source" }),
  ),
  {
    equals: (a: Source, b: Source) => {
      if (a.type !== b.type) return false
      if (a.type === "directory" && b.type === "directory") return a.path === b.path
      if (a.type === "url" && b.type === "url") return a.url === b.url
      if (a.type === "embedded" && b.type === "embedded") return a.skill.id === b.skill.id
      return false
    },
    key: (source: Source) =>
      source.type === "directory"
        ? `directory:${source.path}`
        : source.type === "url"
          ? `url:${source.url}`
          : `embedded:${source.skill.id}`,
  },
)
