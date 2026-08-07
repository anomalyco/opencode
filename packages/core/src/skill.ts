export * as SkillV2 from "./skill"

import { makeLocationNode } from "./effect/app-node"
import path from "path"
import { Context, Effect, Layer, Schema, Types } from "effect"
import { Skill } from "@opencode-ai/schema/skill"
import { AgentV2 } from "./agent"
import { ConfigMarkdown } from "./config/markdown"
import { FSUtil } from "./fs-util"
import { PermissionV2 } from "./permission"
import { AbsolutePath } from "./schema"
import { SkillDiscovery } from "./skill/discovery"
import { State } from "./state"
import type { UserContext } from "@opencode-ai/schema/user-context"

export const DirectorySource = Skill.DirectorySource
export type DirectorySource = Skill.DirectorySource

export const UrlSource = Skill.UrlSource
export type UrlSource = Skill.UrlSource

export const EmbeddedSource = Skill.EmbeddedSource
export type EmbeddedSource = Skill.EmbeddedSource

export const Source = Skill.Source
export type Source = typeof Source.Type

export const Info = Skill.Info
export type Info = Skill.Info

export const available = (skills: ReadonlyArray<Info>, agent: AgentV2.Info) =>
  skills.filter((skill) => PermissionV2.evaluate("skill", skill.name, agent.permissions).effect !== "deny")

// ─── Scope parsing ────────────────────────────────────────────────

const SCOPE_GLOBAL = "global"

function parseScopeDir(dirname: string): { type: "global" | "department" | "user"; owner?: string } | undefined {
  if (dirname === SCOPE_GLOBAL) return { type: "global" }
  const deptMatch = dirname.match(/^dept_(.+)$/)
  if (deptMatch) return { type: "department", owner: deptMatch[1] }
  const userMatch = dirname.match(/^user_(.+)$/)
  if (userMatch) return { type: "user", owner: userMatch[1] }
  return undefined
}

function parseScope(info: Skill.Info): Skill.Info {
  const dir = path.dirname(info.location)
  const parent = path.dirname(dir)
  const grandparent = path.dirname(parent)

  // Check: /skills_root/<scope>/<name>/SKILL.md
  const scope = parseScopeDir(path.basename(parent))
  if (scope) {
    if (scope.type === "department") {
      return { ...info, scope: { type: "department", departmentCode: scope.owner } }
    }
    if (scope.type === "user") {
      return { ...info, scope: { type: "user", userID: scope.owner } }
    }
    return { ...info, scope: { type: "global" } }
  }

  // Legacy: no scope directory, default to global
  return { ...info, scope: { type: "global" } }
}

const Frontmatter = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  slash: Schema.Boolean.pipe(Schema.optional),
})
const decodeFrontmatter = Schema.decodeUnknownOption(Frontmatter)

export type Data = {
  sources: Types.DeepMutable<Source>[]
}

export type Draft = {
  source: (source: Source) => void
  list: () => readonly Source[]
}

export interface Interface extends State.Transformable<Draft> {
  readonly sources: () => Effect.Effect<Source[]>
  readonly list: (userContext?: UserContext.Info) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Skill") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* SkillDiscovery.Service
    const fs = yield* FSUtil.Service

    const state = State.create<Data, Draft>({
      initial: () => ({ sources: [] }),
      draft: (draft) => ({
        source: (source) => {
          if (draft.sources.some((item) => Source.equals(item, source))) return
          draft.sources.push(source as Types.DeepMutable<Source>)
        },
        list: () => draft.sources as Source[],
      }),
    })

    const load = Effect.fn("SkillV2.load")(function* (source: Source) {
      const skills: Info[] = []
      if (source.type === "embedded") {
        const skill = { ...source.skill, scope: { type: "global" } as const }
        return [skill]
      }
      const directories =
        source.type === "directory" ? [source.path] : yield* discovery.pull(source.url)
      for (const directory of directories) {
        // First, check if this directory has scope subdirectories
        const entries = yield* fs
          .readDirectoryEntries(directory)
          .pipe(Effect.catch(() => Effect.succeed([] as {name: string; type: string}[])))
        const scopeDirs = entries.filter((e) => e.type === "directory")
        const hasScopeStructure = scopeDirs.some((e) => parseScopeDir(e.name) !== undefined)

        if (hasScopeStructure) {
          // Scope-based structure: each scope subdirectory contains skills
          for (const scopeDir of scopeDirs) {
            const scope = parseScopeDir(scopeDir.name)
            if (!scope) continue // skip non-scope dirs
            const scopePath = path.join(directory, scopeDir.name)
            const files = yield* fs
              .glob("{*.md,**/SKILL.md}", {
                cwd: scopePath,
                absolute: true,
                include: "file",
                symlink: true,
                dot: true,
              })
              .pipe(Effect.catch(() => Effect.succeed([] as string[])))
            for (const filepath of files.toSorted()) {
              const skill = yield* loadSkillFile(fs, filepath, directory)
              if (!skill) continue
              if (scope.type === "department") {
                skills.push({ ...skill, scope: { type: "department", departmentCode: scope.owner } })
              } else if (scope.type === "user") {
                skills.push({ ...skill, scope: { type: "user", userID: scope.owner } })
              } else {
                skills.push({ ...skill, scope: { type: "global" } })
              }
            }
          }
        } else {
          // Legacy flat structure: all files are global skills
          const files = yield* fs
            .glob("{*.md,**/SKILL.md}", {
              cwd: directory,
              absolute: true,
              include: "file",
              symlink: true,
              dot: true,
            })
            .pipe(Effect.catch(() => Effect.succeed([] as string[])))
          for (const filepath of files.toSorted()) {
            const skill = yield* loadSkillFile(fs, filepath, directory)
            if (skill) skills.push({ ...skill, scope: { type: "global" } })
          }
        }
      }
      return skills
    })

    function* loadSkillFile(
      fs: FSUtil.Interface,
      filepath: string,
      directory: string,
    ): Generator<Effect.Effect<never, never, any>, Info | undefined, any> {
      const content = yield* fs.readFileStringSafe(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!content) return undefined
      const markdown = ConfigMarkdown.parseOption(content)
      if (!markdown) return undefined
      const frontmatter = decodeFrontmatter(markdown.data).valueOrUndefined
      if (!frontmatter) return undefined
      const name =
        frontmatter.name !== undefined
          ? frontmatter.name
          : path.dirname(filepath) === directory
            ? path.basename(filepath, ".md")
            : path.basename(path.dirname(filepath))
      if (!name) return undefined
      return {
        name,
        description: frontmatter.description,
        slash: frontmatter.slash,
        location: AbsolutePath.make(filepath),
        content: markdown.content,
      }
    }

    const cache = new Map<string, Info[]>()
    const list = Effect.fn("SkillV2.list")(function* (userContext?: UserContext.Info) {
      const skills = new Map<string, Info>()
      for (const source of state.get().sources) {
        const key = Source.key(source)
        const loaded = cache.get(key) ?? (yield* load(source))
        cache.set(key, loaded)
        for (const skill of loaded) skills.set(skill.name, skill)
      }
      const all = Array.from(skills.values())

      // Filter by user context if provided
      if (!userContext) return all
      return all.filter((skill) => {
        const scope = skill.scope
        if (!scope || scope.type === "global") return true
        if (scope.type === "department") return scope.departmentCode === userContext.departmentCode
        if (scope.type === "user") return scope.userID === userContext.userID
        return true
      })
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      sources: Effect.fn("SkillV2.sources")(function* () {
        return state.get().sources
      }),
      list,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [SkillDiscovery.node, FSUtil.node] })
