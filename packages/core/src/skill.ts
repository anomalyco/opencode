export * as Skill from "./skill"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import path from "path"
import { Context, Effect, Layer, Schema, Scope, Stream, Types } from "effect"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { Skill } from "@opencode-ai/schema/skill"
import { Agent } from "./agent"
import { ConfigMarkdown } from "./config/markdown"
import { Bus } from "./bus"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Permission } from "./permission"
import { AbsolutePath } from "./schema"
import { SkillDiscovery } from "./skill/discovery"
import { State } from "./state"
import { Watcher } from "./filesystem/watcher"

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

export { Event } from "@opencode-ai/schema/skill"

export const available = (skills: ReadonlyArray<Info>, agent: Agent.Info) =>
  skills.filter((skill) => Permission.evaluate("skill", skill.id, agent.permissions).effect !== "deny")

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

export class Service extends Context.Service<Service, Interface>()("@opencode/Skill") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* SkillDiscovery.Service
    const fs = yield* FSUtil.Service
    const bus = yield* Bus.Service
    const watcher = yield* Watcher.Service
    const scope = yield* Scope.Scope
    const cache = new Map<string, { skills: Info[]; paths: readonly string[] }>()
    const watched = new Set<string>()

    const invalidate = Effect.fn("Skill.invalidateFromWatcher")(function* (file: string) {
      const invalidated = Array.from(cache.entries()).filter(([, loaded]) =>
        loaded.paths.some((item) => FSUtil.overlaps(item, file)),
      )
      if (invalidated.length === 0) return
      for (const [key] of invalidated) cache.delete(key)
      yield* Effect.logInfo("skill cache invalidated", {
        file,
        sources: invalidated.map(([key]) => key),
        skills: invalidated.flatMap(([, loaded]) => loaded.skills.map((skill) => skill.id)),
      })
      yield* bus.publish(Skill.Event.Updated, {}).pipe(Effect.asVoid)
    })

    const watch = Effect.fn("Skill.watch")(function* (directory: string) {
      const target = path.resolve(directory)
      if (watched.has(target)) return
      watched.add(target)
      const updates = yield* watcher.subscribe({ path: target, type: "directory" })
      yield* updates.pipe(
        Stream.runForEach((update) => invalidate(update.path)),
        Effect.forkIn(scope, { startImmediately: true }),
      )
    })

    const watchDirectory = Effect.fn("Skill.watchDirectory")(function* (directory: string) {
      const target = path.resolve(directory)
      const resolved = yield* fs.realPath(directory).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (resolved) {
        yield* watch(resolved)
        if (resolved !== target) {
          yield* watch(path.dirname(target))
        }
        return resolved === target ? [target] : [target, resolved]
      }
      if (yield* fs.isDir(path.dirname(target))) {
        yield* watch(path.dirname(target))
      }
      return [target]
    })

    const state = State.create<Data, Draft>({
      name: "skill",
      initial: () => ({ sources: [] }),
      draft: (draft) => ({
        source: (source) => {
          if (draft.sources.some((item) => Source.equals(item, source))) return
          draft.sources.push(source as Types.DeepMutable<Source>)
        },
        list: () => draft.sources as Source[],
      }),
      finalize: () =>
        Effect.sync(() => cache.clear()).pipe(Effect.andThen(bus.publish(Skill.Event.Updated, {})), Effect.asVoid),
    })

    const load = Effect.fn("Skill.load")(function* (source: Source) {
      const skills: Info[] = []
      if (source.type === "embedded") {
        yield* Effect.logDebug("skill source loaded", {
          source: Source.key(source),
          type: source.type,
          directories: [],
          skills: [source.skill.id],
        })
        return { skills: [source.skill], paths: [] }
      }
      const directories = source.type === "directory" ? [source.path] : yield* discovery.pull(source.url)
      const roots = (yield* Effect.forEach(directories, watchDirectory)).flat()
      const paths = [...roots]
      for (const directory of directories) {
        const files = yield* fs
          .scan("{*.md,**/SKILL.md}", { cwd: directory, absolute: true, include: "file", symlink: true, dot: true })
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))
        for (const filepath of files.toSorted()) {
          const resolved = yield* fs.realPath(filepath).pipe(Effect.catch(() => Effect.succeed(filepath)))
          if (!roots.some((root) => FSUtil.contains(root, resolved))) {
            const external = path.dirname(resolved)
            paths.push(external)
            yield* watch(external)
          }
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
      return { skills, paths }
    })

    yield* bus.subscribe(FileSystem.Event.Changed).pipe(
      Stream.runForEach((event) => invalidate(event.data.file)),
      Effect.forkScoped({ startImmediately: true }),
    )

    const list = Effect.fn("Skill.list")(function* () {
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
      sources: Effect.fn("Skill.sources")(function* () {
        return state.get().sources
      }),
      list,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [SkillDiscovery.node, FSUtil.node, Bus.node, Watcher.node],
})
