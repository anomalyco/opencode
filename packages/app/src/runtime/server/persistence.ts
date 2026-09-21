import { Codec } from "@/runtime/persistence/codec"
import { ServerKey } from "./key"

export { ServerKey }

export const ServerHttpBase = Codec.struct({
  url: Codec.string,
  password: Codec.optional(Codec.string),
})

export const ServerHttp = Codec.struct({
  type: Codec.literal("http"),
  http: ServerHttpBase,
  authToken: Codec.optional(Codec.boolean),
  displayName: Codec.optional(Codec.string),
  label: Codec.optional(Codec.string),
})

// Servers were stored as a URL string, then as the HTTP block alone, before the current shape.
const StoredServer = Codec.decodeTo(Codec.union([ServerHttp, ServerHttpBase, Codec.string]), ServerHttp, {
  decode: (value) => {
    if (typeof value === "string") return { type: "http" as const, http: { url: value } }
    if ("http" in value) return value
    return { type: "http" as const, http: value }
  },
  encode: (value) => value,
})

const ProjectList = Codec.lenientArray(
  Codec.struct({
    worktree: Codec.string,
    expanded: Codec.fallback(Codec.boolean, () => true),
  }),
)
const Projects = Codec.lenientRecord(ProjectList)
const LastProject = Codec.fallback(Codec.sparseRecord(Codec.string), () => ({}))

const State = Codec.struct({
  list: Codec.lenientArray(StoredServer),
  hidden: Codec.sparseRecord(Codec.boolean),
  projects: Codec.record(ProjectList),
  lastProject: Codec.sparseRecord(Codec.string),
  recentlyClosed: Codec.record(Codec.lenientArray(Codec.string)),
})

const StoredState = Codec.struct({ projects: Projects, lastProject: LastProject })

// Projects and last-opened entries recorded under the canonical local server's URL move under
// "local" when that URL is known, so they survive the server changing address.
export function serverState(canonicalLocalServer: () => string | undefined = () => undefined) {
  return Codec.migrate(
    State,
    Codec.transform(StoredState, {
      decode: (value) => {
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
      },
      encode: (value) => value,
    }),
  )
}

export const ModelState = Codec.struct({
  user: Codec.lenientArray(
    Codec.struct({
      providerID: Codec.string,
      modelID: Codec.string,
      visibility: Codec.literals(["show", "hide"]),
      favorite: Codec.optional(Codec.boolean),
    }),
  ),
  recent: Codec.lenientArray(Codec.struct({ providerID: Codec.string, modelID: Codec.string })),
  variant: Codec.sparseRecord(Codec.undefinedOr(Codec.string)),
})

export const VcsState = Codec.struct({
  value: Codec.optional(
    Codec.struct({
      branch: Codec.optional(Codec.string),
      default_branch: Codec.optional(Codec.string),
    }),
  ),
})

const ProjectMeta = Codec.struct({
  name: Codec.optional(Codec.string),
  icon: Codec.optional(
    Codec.struct({
      override: Codec.optional(Codec.string),
      color: Codec.optional(Codec.string),
    }),
  ),
  commands: Codec.optional(Codec.struct({ start: Codec.optional(Codec.string) })),
})

export const ProjectState = Codec.struct({
  value: Codec.optional(ProjectMeta),
})

export const IconState = Codec.struct({
  value: Codec.optional(Codec.string),
})
