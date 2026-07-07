export * as SkillV2 from "./skill"

import { makeLocationNode } from "./effect/app-node"
import path from "path"
import { Context, Effect, Layer, Schema, Stream, Types } from "effect"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { Skill } from "@opencode-ai/schema/skill"
import { AgentV2 } from "./agent"
import { ConfigMarkdown } from "./config/markdown"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { PermissionV2 } from "./permission"
import { AbsolutePath } from "./schema"
import { SkillDiscovery } from "./skill/discovery"
import { State } from "./state"

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
export const ID = Skill.ID
export type ID = Skill.ID
export const Name = Skill.Name
export type Name = Skill.Name

export const Event = Skill.Event

export const available = (skills: ReadonlyArray<Info>, agent: AgentV2.Info) =>
  skills.filter((skill) => PermissionV2.evaluate("skill", skill.id, agent.permissions).effect !== "deny")

const Frontmatter = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  slash: Schema.Boolean.pipe(Schema.optional),
  metadata: Schema.Unknown.pipe(Schema.optional),
})
const decodeFrontmatter = Schema.decodeUnknownOption(Frontmatter)

const metadataBoolean = (metadata: unknown, key: string) => {
  if (metadata === undefined || metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined
  }
  const value = (metadata as { readonly [key: string]: unknown })[key]
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "true") return true
  if (normalized === "false") return false
  return undefined
}

export type Data = {
  sources: Types.DeepMutable<Source>[]
}

export type Draft = {
  source: (source: Source) => void
  list: () => readonly Source[]
}

export interface Interface extends State.Transformable<Draft> {
  readonly sources: () => Effect.Effect<Source[]>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Skill") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* SkillDiscovery.Service
    const fs = yield* FSUtil.Service
    const events = yield* EventV2.Service

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
        yield* Effect.logDebug("skill source loaded", {
          source: Source.key(source),
          type: source.type,
          directories: [],
          skills: [source.skill.id],
        })
        return { skills: [source.skill], directories: [] }
      }
      const directories = source.type === "directory" ? [source.path] : yield* discovery.pull(source.url)
      for (const directory of directories) {
        const files = yield* fs
          .glob("{*.md,**/SKILL.md}", { cwd: directory, absolute: true, include: "file", symlink: true, dot: true })
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))
        for (const filepath of files.toSorted()) {
          const content = yield* fs.readFileStringSafe(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!content) continue
          const markdown = ConfigMarkdown.parseOption(content)
          if (!markdown) continue
          const frontmatter = decodeFrontmatter(markdown.data).valueOrUndefined
          if (!frontmatter) continue
          const id =
            path.dirname(filepath) === directory
              ? path.basename(filepath, ".md")
              : path.basename(path.dirname(filepath))
          skills.push({
            id: ID.make(id),
            name: Name.make(frontmatter.name ?? id),
            description: frontmatter.description,
            slash: metadataBoolean(frontmatter.metadata, "opencode/slash") ?? frontmatter.slash,
            autoinvoke: metadataBoolean(frontmatter.metadata, "opencode/autoinvoke"),
            location: AbsolutePath.make(filepath),
            content: markdown.content,
          })
        }
      }
      yield* Effect.logDebug("skill source loaded", {
        source: Source.key(source),
        type: source.type,
        directories,
        skills: skills.map((skill) => skill.id),
      })
      return { skills, directories }
    })

    const cache = new Map<string, { skills: Info[]; directories: readonly string[] }>()
    const invalidate = Effect.fn("SkillV2.invalidateFromWatcher")(function* (file: string) {
      const invalidated = Array.from(cache.entries()).filter(([, loaded]) =>
        loaded.directories.some((directory) => FSUtil.contains(directory, file)),
      )
      if (invalidated.length === 0) return
      for (const [key] of invalidated) cache.delete(key)
      yield* Effect.logInfo("skill cache invalidated", {
        file,
        sources: invalidated.map(([key]) => key),
        skills: invalidated.flatMap(([, loaded]) => loaded.skills.map((skill) => skill.id)),
      })
      yield* events.publish(Event.Updated, {}).pipe(Effect.asVoid)
    })

    yield* events.subscribe(FileSystem.Event.Changed).pipe(
      Stream.runForEach((event) => invalidate(event.data.file)),
      Effect.forkScoped({ startImmediately: true }),
    )

    const list = Effect.fn("SkillV2.list")(function* () {
      const skills = new Map<ID, Info>()
      for (const source of state.get().sources) {
        const key = Source.key(source)
        const loaded = cache.get(key) ?? (yield* load(source))
        cache.set(key, loaded)
        for (const skill of loaded.skills) skills.set(skill.id, skill)
      }
      return Array.from(skills.values())
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

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [SkillDiscovery.node, FSUtil.node, EventV2.node],
})
