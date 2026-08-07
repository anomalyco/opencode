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
  readonly create: (input: {
    name: string
    description?: string
    content: string
    scope: { type: "global" } | { type: "department"; departmentCode: string } | { type: "user"; userID: string }
    skillsRoot: string
  }) => Effect.Effect<Info>
  readonly update: (input: {
    name: string
    description?: string
    content?: string
  }) => Effect.Effect<Info, NotFoundError>
  readonly remove: (name: string) => Effect.Effect<void, NotFoundError>
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("SkillV2.NotFoundError", {
  name: Schema.String,
  message: Schema.String,
}) {}

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
        const dirs = entries.filter((e) => e.type === "directory")
        const scopeDirs = dirs.filter((e) => parseScopeDir(e.name) !== undefined)
        const flatDirs = dirs.filter((e) => parseScopeDir(e.name) === undefined)

        // Process scope-based directories (global/, dept_<code>/, user_<id>/)
        for (const scopeDir of scopeDirs) {
          const scope = parseScopeDir(scopeDir.name)
          if (!scope) continue
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

        // Process flat directories (migration compat: existing skills outside any scope dir)
        for (const flatDir of flatDirs) {
          const flatPath = path.join(directory, flatDir.name)
          const files = yield* fs
            .glob("{*.md,**/SKILL.md}", {
              cwd: flatPath,
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

        // Also handle top-level markdown files (completely flat structure with no subdirectories)
        if (dirs.length === 0) {
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

    function scopeDirName(scope: {
      type: "global" | "department" | "user"
      departmentCode: string
      userID: string
    }): string {
      switch (scope.type) {
        case "global": return "global"
        case "department": return `dept_${scope.departmentCode}`
        case "user": return `user_${scope.userID}`
      }
    }

    const cache = new Map<string, Info[]>()
    function invalidateCache() {
      cache.clear()
    }
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
      create: Effect.fn("SkillV2.create")(function* (input) {
        const scopePath = scopeDirName(input.scope)
        const dir = path.join(input.skillsRoot, scopePath, input.name)
        const filepath = path.join(dir, "SKILL.md")
        const frontmatter: Record<string, string | undefined> = { name: input.name }
        if (input.description) frontmatter.description = input.description
        const frontmatterStr = Object.entries(frontmatter)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
        const content = `---\n${frontmatterStr}\n---\n\n${input.content}`
        yield* fs.writeWithDirs(filepath, content).pipe(Effect.orDie)
        invalidateCache()
        const result: Info = {
          name: input.name,
          description: input.description,
          location: AbsolutePath.make(filepath),
          content: input.content,
          scope: input.scope.type === "global"
            ? { type: "global" }
            : input.scope.type === "department"
              ? { type: "department", departmentCode: input.scope.departmentCode }
              : { type: "user", userID: input.scope.userID },
        }
        return result
      }),
      update: Effect.fn("SkillV2.update")(function* (input) {
        const all = yield* list()
        const existing = all.find((s) => s.name === input.name)
        if (!existing) return yield* new NotFoundError({ name: input.name, message: `Skill not found: ${input.name}` })
        const content = yield* fs.readFileStringSafe(existing.location)
        if (!content) return yield* new NotFoundError({ name: input.name, message: `Skill file not found: ${input.name}` })
        const markdown = ConfigMarkdown.parseOption(content)
        if (!markdown) return yield* new NotFoundError({ name: input.name, message: `Invalid skill file: ${input.name}` })
        const updatedFrontmatter = { ...markdown.data }
        if (input.description !== undefined) updatedFrontmatter.description = input.description
        const frontmatterStr = Object.entries(updatedFrontmatter)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
        const newContent = input.content !== undefined ? input.content : markdown.content
        const fileContent = `---\n${frontmatterStr}\n---\n\n${newContent}`
        yield* fs.writeFileString(existing.location, fileContent).pipe(Effect.orDie)
        invalidateCache()
        return {
          ...existing,
          description: input.description ?? existing.description,
          content: newContent,
        }
      }),
      remove: Effect.fn("SkillV2.remove")(function* (name) {
        const all = yield* list()
        const existing = all.find((s) => s.name === name)
        if (!existing) return yield* new NotFoundError({ name, message: `Skill not found: ${name}` })
        const dir = path.dirname(existing.location)
        yield* fs.remove(dir, { recursive: true, force: true }).pipe(Effect.orDie)
        invalidateCache()
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [SkillDiscovery.node, FSUtil.node] })
