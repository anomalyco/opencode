export * as SkillV2 from "./skill"

import { makeLocationNode } from "./effect/app-node"
import path from "path"
import { Context, Effect, Exit, Layer, Schedule, Scope, Schema, Stream, Types } from "effect"
import { Skill } from "@opencode-ai/schema/skill"
import { AgentV2 } from "./agent"
import { ConfigMarkdown } from "./config/markdown"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { PermissionV2 } from "./permission"
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

export const available = (skills: ReadonlyArray<Info>, agent: AgentV2.Info) =>
  skills.filter((skill) => PermissionV2.evaluate("skill", skill.name, agent.permissions).effect !== "deny")

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
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Skill") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* SkillDiscovery.Service
    const fs = yield* FSUtil.Service
    const scope = yield* Scope.Scope

    const watcher = yield* Watcher.Service
    const cache = new Map<string, Info[]>()
    const watches = new Map<string, Scope.Closeable>()
    // Directory sources are watched by their real path (parcel-watcher/native
    // backends report events using the resolved path), so a symlinked source
    // (e.g. a dotfiles-managed ~/.claude) still matches on invalidation.
    const realPaths = new Map<string, string>()
    // Bumped on every reconcile so an in-flight list() load started before a
    // reconcile doesn't resurrect a cache entry that reconcile just cleared.
    let generation = 0

    const invalidate = (source: Source) => {
      cache.delete(Source.key(source))
    }

    const invalidateDirectory = (file: string) => {
      for (const source of state.get().sources) {
        if (source.type !== "directory") continue
        const real = realPaths.get(source.path) ?? source.path
        if (!file.startsWith(real + path.sep)) continue
        invalidate(source)
      }
    }

    const syncWatches = (sources: ReadonlyArray<Source>) =>
      Effect.gen(function* () {
        const directories = new Set(sources.filter((s) => s.type === "directory").map((s) => s.path as string))
        for (const [directory, childScope] of watches) {
          if (directories.has(directory)) continue
          watches.delete(directory)
          realPaths.delete(directory)
          // Closing the child scope detaches it from the parent `scope`, so
          // this doesn't leave a stale finalizer behind on repeated
          // add/remove cycles the way manually running `unsubscribe` did.
          yield* Scope.close(childScope, Exit.void)
        }
        for (const directory of directories) {
          if (watches.has(directory)) continue
          const real = yield* fs.realPath(directory).pipe(Effect.catch(() => Effect.succeed(directory)))
          realPaths.set(directory, real)
          const childScope = yield* Scope.fork(scope)
          yield* watcher.watch(directory).pipe(Scope.provide(childScope))
          watches.set(directory, childScope)
        }
      })

    const reconcile = (sources: ReadonlyArray<Source>) =>
      Effect.gen(function* () {
        generation++
        const keys = new Set(sources.map(Source.key))
        for (const key of cache.keys()) {
          if (!keys.has(key)) cache.delete(key)
        }
        yield* syncWatches(sources)
      })

    const state = State.create<Data, Draft>({
      initial: () => ({ sources: [] }),
      draft: (draft) => ({
        source: (source) => {
          if (draft.sources.some((item) => Source.equals(item, source))) return
          draft.sources.push(source as Types.DeepMutable<Source>)
        },
        list: () => draft.sources as Source[],
      }),
      finalize: (draft) => reconcile(draft.list()),
    })

    const events = yield* EventV2.Service

    yield* events.subscribe(Watcher.Event.Updated).pipe(
      Stream.runForEach((event) => Effect.sync(() => invalidateDirectory(event.data.file))),
      Effect.forkScoped({ startImmediately: true }),
    )

    // HTTP/URL sources have no push-based change notification, so this is the
    // only automatic way to observe a changed remote catalog while running.
    yield* Effect.repeat(
      Effect.sync(() => {
        for (const source of state.get().sources) {
          if (source.type === "url") cache.delete(Source.key(source))
        }
      }),
      Schedule.spaced("60 minutes"),
    ).pipe(Effect.forkScoped({ startImmediately: true }))

    const load = Effect.fn("SkillV2.load")(function* (source: Source) {
      const skills: Info[] = []
      if (source.type === "embedded") return [source.skill]
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
          const name =
            frontmatter.name !== undefined
              ? frontmatter.name
              : path.dirname(filepath) === directory
                ? path.basename(filepath, ".md")
                : undefined
          if (!name) continue
          skills.push({
            name,
            description: frontmatter.description,
            slash: frontmatter.slash,
            location: AbsolutePath.make(filepath),
            content: markdown.content,
          })
        }
      }
      return skills
    })

    const list = Effect.fn("SkillV2.list")(function* () {
      const skills = new Map<string, Info>()
      const startGeneration = generation
      for (const source of state.get().sources) {
        const key = Source.key(source)
        const loaded = cache.get(key) ?? (yield* load(source))
        // Only cache the result if no reconcile ran while this load was in
        // flight; otherwise a stale load could resurrect a cache entry that
        // reconcile just invalidated for a removed/changed source.
        if (generation === startGeneration) cache.set(key, loaded)
        for (const skill of loaded) skills.set(skill.name, skill)
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

export const node = makeLocationNode({ service: Service, layer, deps: [SkillDiscovery.node, FSUtil.node, EventV2.node, Watcher.node] })
