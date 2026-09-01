import { Schema, SchemaGetter, Struct } from "effect"
import { Persistence } from "@/runtime/persistence/schema"

export const ServerKey = Schema.String.pipe(Schema.brand("ServerConnection.Key"))

export const ServerHttpBase = Schema.Struct({
  url: Schema.String,
  password: Schema.optional(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))

export const ServerHttp = Schema.Struct({
  type: Schema.Literal("http"),
  http: ServerHttpBase,
  authToken: Schema.optional(Schema.Boolean),
  displayName: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))

const StoredServer = Schema.Union([ServerHttp, ServerHttpBase, Schema.String]).pipe(
  Schema.decodeTo(ServerHttp, {
    decode: SchemaGetter.transform((value) => {
      if (typeof value === "string") return { type: "http", http: { url: value } }
      if ("http" in value) return value
      return { type: "http", http: value }
    }),
    encode: SchemaGetter.transform((value) => value),
  }),
)

const State = Schema.Struct({
  list: Persistence.array(StoredServer),
  hidden: Persistence.defaulted(Schema.Record(Schema.String, Schema.mutableKey(Schema.Boolean)), () => ({})),
  projects: Persistence.defaulted(
    Schema.Record(
      Schema.String,
      Schema.mutableKey(
        Persistence.array(
          Schema.Struct({
            worktree: Schema.String,
            expanded: Persistence.defaulted(Schema.Boolean, () => true),
          }).mapFields(Struct.map(Schema.mutableKey)),
        ),
      ),
    ),
    () => ({}),
  ),
  lastProject: Persistence.defaulted(Schema.Record(Schema.String, Schema.mutableKey(Schema.String)), () => ({})),
  recentlyClosed: Persistence.defaulted(
    Schema.Record(Schema.String, Schema.mutableKey(Persistence.array(Schema.String))),
    () => ({}),
  ),
}).mapFields(Struct.map(Schema.mutableKey))

export function serverState(canonicalLocalServer: () => string | undefined = () => undefined) {
  return State.pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => {
        const canonical = canonicalLocalServer()
        if (!canonical || canonical === "local") return value
        const previous = value.projects[canonical]
        const last = value.lastProject[canonical]
        if (!previous && last === undefined) return value

        const projects = { ...value.projects }
        if (previous) {
          const local = projects.local ?? []
          const worktrees = new Set(local.map((project) => project.worktree))
          projects.local = [
            ...local,
            ...previous.filter((project) => {
              if (worktrees.has(project.worktree)) return false
              worktrees.add(project.worktree)
              return true
            }),
          ]
          delete projects[canonical]
        }
        const lastProject = { ...value.lastProject }
        if (last !== undefined) {
          lastProject.local ??= last
          delete lastProject[canonical]
        }
        return { ...value, projects, lastProject }
      }),
      encode: SchemaGetter.transform((value) => value),
    }),
  )
}

export const ModelState = Schema.Struct({
  user: Persistence.array(
    Schema.Struct({
      providerID: Schema.String,
      modelID: Schema.String,
      visibility: Schema.Literals(["show", "hide"]),
      favorite: Schema.optional(Schema.Boolean),
    }).mapFields(Struct.map(Schema.mutableKey)),
  ),
  recent: Persistence.array(
    Schema.Struct({ providerID: Schema.String, modelID: Schema.String }).mapFields(Struct.map(Schema.mutableKey)),
  ),
  variant: Persistence.defaulted(
    Schema.Record(Schema.String, Schema.mutableKey(Schema.UndefinedOr(Schema.String))),
    () => ({}),
  ),
}).mapFields(Struct.map(Schema.mutableKey))

export const VcsState = Schema.Struct({
  value: Persistence.defaulted(
    Schema.UndefinedOr(
      Schema.Struct({
        branch: Schema.optional(Schema.String),
        default_branch: Schema.optional(Schema.String),
      }).mapFields(Struct.map(Schema.mutableKey)),
    ),
    () => undefined,
  ),
}).mapFields(Struct.map(Schema.mutableKey))

const ProjectMeta = Schema.Struct({
  name: Schema.optional(Schema.String),
  icon: Schema.optional(
    Schema.Struct({
      override: Schema.optional(Schema.String),
      color: Schema.optional(Schema.String),
    }).mapFields(Struct.map(Schema.mutableKey)),
  ),
  commands: Schema.optional(
    Schema.Struct({ start: Schema.optional(Schema.String) }).mapFields(Struct.map(Schema.mutableKey)),
  ),
}).mapFields(Struct.map(Schema.mutableKey))

export const ProjectState = Schema.Struct({
  value: Persistence.defaulted(Schema.UndefinedOr(ProjectMeta), () => undefined),
}).mapFields(Struct.map(Schema.mutableKey))

export const IconState = Schema.Struct({
  value: Persistence.defaulted(Schema.UndefinedOr(Schema.String), () => undefined),
}).mapFields(Struct.map(Schema.mutableKey))
