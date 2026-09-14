import { Effect, Option, Schema, SchemaGetter } from "effect"
import { Persistence } from "@/runtime/persistence/schema"

export const ServerKey = Schema.String.pipe(Schema.brand("ServerConnection.Key"))

export const ServerHttpBase = Persistence.struct({
  url: Schema.String,
  password: Schema.optional(Schema.String),
})

export const ServerHttp = Persistence.struct({
  type: Schema.Literal("http"),
  http: ServerHttpBase,
  authToken: Schema.optional(Schema.Boolean),
  displayName: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
})

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

const ProjectList = Persistence.array(
  Persistence.struct({
    worktree: Schema.String,
    expanded: Persistence.fallback(Schema.Boolean, () => true),
  }),
)
const Projects = Persistence.record(ProjectList)
const LastProject = Persistence.record(Schema.String.pipe(Schema.catchDecoding(() => Effect.succeed(Option.none()))))

const State = Persistence.struct({
  list: Persistence.array(StoredServer),
  hidden: Schema.Record(
    Schema.String,
    Schema.mutableKey(Schema.Boolean.pipe(Schema.catchDecoding(() => Effect.succeed(Option.none())))),
  ),
  projects: Schema.Record(Schema.String, Schema.mutableKey(ProjectList)),
  lastProject: Schema.Record(
    Schema.String,
    Schema.mutableKey(Schema.String.pipe(Schema.catchDecoding(() => Effect.succeed(Option.none())))),
  ),
  recentlyClosed: Schema.Record(Schema.String, Schema.mutableKey(Persistence.array(Schema.String))),
})

export function serverState(canonicalLocalServer: () => string | undefined = () => undefined) {
  return Persistence.migrate(
    State,
    Schema.Struct({ projects: Projects, lastProject: LastProject }).pipe(
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
    ),
  )
}

export const ModelState = Persistence.struct({
  user: Persistence.array(
    Persistence.struct({
      providerID: Schema.String,
      modelID: Schema.String,
      visibility: Schema.Literals(["show", "hide"]),
      favorite: Schema.optional(Schema.Boolean),
    }),
  ),
  recent: Persistence.array(Persistence.struct({ providerID: Schema.String, modelID: Schema.String })),
  variant: Schema.Record(
    Schema.String,
    Schema.mutableKey(
      Schema.UndefinedOr(Schema.String).pipe(Schema.catchDecoding(() => Effect.succeed(Option.none()))),
    ),
  ),
})

export const VcsState = Persistence.struct({
  value: Schema.optional(
    Persistence.struct({
      branch: Schema.optional(Schema.String),
      default_branch: Schema.optional(Schema.String),
    }),
  ),
})

const ProjectMeta = Persistence.struct({
  name: Schema.optional(Schema.String),
  icon: Schema.optional(
    Persistence.struct({
      override: Schema.optional(Schema.String),
      color: Schema.optional(Schema.String),
    }),
  ),
  commands: Schema.optional(Persistence.struct({ start: Schema.optional(Schema.String) })),
})

export const ProjectState = Persistence.struct({
  value: Schema.optional(ProjectMeta),
})

export const IconState = Persistence.struct({
  value: Schema.optional(Schema.String),
})
