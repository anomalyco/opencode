export * as Skill from "./skill.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import path from "path"
import { Brand, Context, Effect, Layer, Schema, Types } from "effect"
import { Skill } from "@opencode/schema/skill"
import { Bus } from "./bus.js"
import { PermissionPolicy } from "./permission/policy.js"
import { State } from "./state.js"
import { SkillDiscovery } from "./skill/discovery.js"

export const DirectorySource = Skill.DirectorySource
export type DirectorySource = Skill.DirectorySource

export const UrlSource = Skill.UrlSource
export type UrlSource = Skill.UrlSource

export const EmbeddedSource = Skill.EmbeddedSource
export type EmbeddedSource = Skill.EmbeddedSource

export const Source = Skill.Source
export type Source = Skill.Source

export const Info = Skill.Info
export type Info = Skill.Info
export const ID = Skill.ID
export type ID = Skill.ID
export const Name = Skill.Name
export type Name = Skill.Name

export { Event } from "@opencode/schema/skill"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Skill.NotFoundError", {
  skill: Schema.String,
}) {}

export class FileNotFoundError extends Schema.TaggedError<FileNotFoundError>()("Skill.FileNotFoundError", {
  skill: Schema.String,
  file: Schema.String,
}) {}

/** Why a skill or one of its files couldn't be loaded. */
export const LoadReason = Schema.Union([
  /** The server failed or couldn't be reached. */
  Schema.TaggedStruct("Unavailable", { file: Schema.String, detail: Schema.String }),
  /** The file the server served doesn't match what it listed. */
  Schema.TaggedStruct("Mismatch", {
    file: Schema.String,
    check: Schema.Literals(["unlisted", "size", "digest", "frontmatter"]),
    detail: Schema.String,
  }),
  /** The server didn't confirm a skill named by address. */
  Schema.TaggedStruct("NotConfirmed", { server: Schema.String, uri: Schema.String, detail: Schema.String }),
])
export type LoadReason = typeof LoadReason.Type

export class LoadError extends Schema.TaggedError<LoadError>()("Skill.LoadError", {
  skill: Schema.String,
  reason: LoadReason,
}) {
  override get message() {
    switch (this.reason._tag) {
      case "Unavailable":
        return `Failed to load ${this.reason.file} of skill ${this.skill}: ${this.reason.detail}`
      case "Mismatch":
        return `Failed to load ${this.reason.file} of skill ${this.skill}: ${this.reason.detail}`
      case "NotConfirmed":
        return `MCP server "${this.reason.server}" did not confirm ${this.reason.uri}: ${this.reason.detail}`
    }
  }
}

/** A skill's SKILL.md body or one of its files: inline, or loaded the first time it's needed. */
export type Content = string | Effect.Effect<string, LoadError>
export type File = string | Uint8Array | Effect.Effect<string | Uint8Array, LoadError>
/**
 * Finds a skill no registered skill has the ID of, such as one a source looks up by address, registers it, and returns
 * the ID it registered. `undefined` when the ID isn't one this source can look up.
 */
export type Resolver = (id: string) => Effect.Effect<ID | undefined, LoadError>

/** Where a skill that didn't come from this machine came from. */
/** Where a skill not on this machine comes from. `version` changes whenever any of its files does. */
export type Origin = { readonly type: "mcp"; readonly server: string; readonly version: string }

export const available = (skills: ReadonlyArray<Info>, policy: PermissionPolicy.Policy) =>
  skills.filter((skill) => PermissionPolicy.evaluate(policy, "skill", skill.id).effect !== "deny")

export const uri = (id: string, file?: string) => (file ? `skill://${id}/${file}` : `skill://${id}`)

export const isUri = (value: string) => value.startsWith("skill://")

/** Where a skill's files live: a folder on disk, or only in the registry under `skill://<id>/`. */
export type Location = { readonly _tag: "disk"; readonly directory: string } | { readonly _tag: "virtual" }

export const locate = (skill: Pick<Info, "path">): Location =>
  isUri(skill.path) ? { _tag: "virtual" } : { _tag: "disk", directory: path.dirname(skill.path) }

/** A safe path relative to a skill's folder, such as `references/FORMS.md`. Only the parsers below produce one. */
export type FilePath = string & Brand.Brand<"Skill.FilePath">
const FilePath = Brand.nominal<FilePath>()

export const manifest = FilePath("SKILL.md")

export const parseFilePath = (value: string): FilePath | undefined =>
  SkillDiscovery.isSafeRelativePath(value) ? FilePath(value) : undefined

/** A `skill://<id>/<file>` path, parsed. `file` is absent for the skill's folder. */
export interface Address {
  readonly id: ID
  readonly file?: FilePath
  /** The canonical form, so `skill://id/file/` can't slip past a rule for `skill://id/file`. */
  readonly uri: string
}

export const parseAddress = (value: string): Address | undefined => {
  if (!isUri(value)) return undefined
  const trimmed = value.slice("skill://".length).replace(/\/+$/, "")
  const slash = trimmed.indexOf("/")
  const id = slash === -1 ? trimmed : trimmed.slice(0, slash)
  if (!SkillDiscovery.isSafeSegment(id)) return undefined
  if (slash === -1) return { id: ID.make(id), uri: uri(id) }
  const file = parseFilePath(trimmed.slice(slash + 1))
  return file && { id: ID.make(id), file, uri: uri(id, file) }
}

export const toModelOutput = (skill: Info, files: ReadonlyArray<string>) => {
  const location = locate(skill)
  const directory = location._tag === "virtual" ? uri(skill.id) : location.directory
  return [
    `<skill_content name="${skill.name}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.content.trim(),
    "",
    `Base directory for this skill: ${directory}`,
    "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
    "Note: file list is sampled.",
    "",
    "<skill_files>",
    ...files.map((file) => `<file>${file}</file>`),
    "</skill_files>",
    "</skill_content>",
  ].join("\n")
}

export const prepare = Effect.fn("Skill.prepare")(function* (
  fs: FSUtil.Interface,
  skill: Info,
  virtualFiles?: ReadonlyArray<FilePath>,
) {
  const location = locate(skill)
  if (location._tag === "virtual") {
    const directory = uri(skill.id)
    const files = (virtualFiles ?? [])
      .filter((file) => file !== manifest)
      .toSorted()
      .slice(0, 10)
      .map((file) => uri(skill.id, file))
    return {
      directory,
      output: toModelOutput(skill, files),
    }
  }
  const directory = location.directory
  const files =
    path.basename(skill.path) === "SKILL.md"
      ? (yield* fs.scan("**/*", {
          cwd: directory,
          absolute: true,
          include: "file",
          dot: true,
          ignore: FSUtil.ignoreGlobs,
        }))
          .filter((file) => path.basename(file) !== "SKILL.md")
          .toSorted()
          .slice(0, 10)
      : []
  return {
    directory,
    output: toModelOutput(skill, files),
  }
})

type Entry = {
  readonly info: Types.DeepMutable<Info>
  /** Loads the SKILL.md body on first use while `info.content` is empty. */
  readonly load?: Effect.Effect<string, LoadError>
  /** Virtual files besides SKILL.md. */
  readonly files: ReadonlyMap<FilePath, File>
  readonly origin?: Origin
}

export type Data = {
  entries: Map<ID, Entry>
  resolvers: Resolver[]
}

export type Editor = {
  list: () => readonly Types.DeepMutable<Info>[]
  get: (id: string) => Types.DeepMutable<Info> | undefined
  /** A skill whose content is an effect is listed with `content: ""` until it's loaded. */
  add: (
    skill: Omit<Info, "content"> & { readonly content: Content },
    files?: Readonly<Record<string, File>>,
    origin?: Origin,
  ) => void
  update: (id: string, update: (skill: Types.DeepMutable<Info>) => void) => void
  remove: (id: string) => void
  resolve: (resolver: Resolver) => void
}

export interface Interface extends State.Transformable<Editor> {
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /** The skill's SKILL.md body, loaded when the skill doesn't have it inline. */
  readonly content: (id: ID) => Effect.Effect<string, LoadError>
  /** Paths of the skill's virtual files besides SKILL.md. */
  readonly files: (id: ID) => Effect.Effect<ReadonlyArray<FilePath> | undefined>
  /**
   * One file of a skill by its path relative to the skill's folder, loaded when it isn't inline. `SKILL.md` is the
   * body without frontmatter. Any path that isn't one of the skill's files is not found.
   */
  readonly read: (id: ID, file: FilePath) => Effect.Effect<Uint8Array, NotFoundError | FileNotFoundError | LoadError>
  readonly list: () => Effect.Effect<Info[]>
  /** The skill with this ID, or the one a resolver finds for it. */
  readonly resolve: (id: string) => Effect.Effect<Info | undefined, LoadError>
  /**
   * What the `skill` permission is checked against: the ID, or `<id>@<version>` for a skill that has a version. A rule
   * for the ID covers every version, while approving saves the exact one, so a changed skill is asked about again.
   */
  readonly approval: (id: ID) => Effect.Effect<{ resources: string[]; save: string[] }>
  /** The body as the model is given it: `content`, led by where the skill came from when that isn't this machine. */
  readonly instructions: (id: ID) => Effect.Effect<string, LoadError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Skill") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const state = State.create<Data, Editor>({
      name: "skill",
      initial: () => ({ entries: new Map(), resolvers: [] }),
      editor: (editor) => ({
        list: () => Array.from(editor.entries.values(), (entry) => entry.info),
        get: (id) => editor.entries.get(ID.make(id))?.info,
        add: (skill, files, origin) => {
          const content = skill.content
          editor.entries.set(skill.id, {
            info: { ...skill, content: typeof content === "string" ? content : "" },
            ...(typeof content === "string" ? {} : { load: content }),
            // Files are named by whoever adds the skill, so unsafe paths are dropped here.
            files: new Map(
              Object.entries(files ?? {})
                .flatMap(([file, value]) => {
                  const parsed = parseFilePath(file)
                  return parsed && parsed !== manifest ? [[parsed, value] as const] : []
                })
                .toSorted(([a], [b]) => a.localeCompare(b)),
            ),
            origin,
          })
        },
        update: (id, update) => {
          const key = ID.make(id)
          const entry = editor.entries.get(key)
          if (!entry) return
          update(entry.info)
          entry.info.id = key
        },
        remove: (id) => {
          editor.entries.delete(ID.make(id))
        },
        resolve: (resolver) => {
          editor.resolvers.push(resolver)
        },
      }),
      notify: State.changes(
        (data) =>
          Array.from(data.entries.values(), (entry) => [
            entry.info,
            Array.from(entry.files, ([file, value]) => [file, Effect.isEffect(value) ? null : value]),
          ]),
        () => bus.publish(Skill.Event.Updated, {}).pipe(Effect.asVoid),
      ),
    })

    const content = Effect.fn("Skill.content")(function* (id: ID) {
      const entry = state.get().entries.get(id)
      if (!entry) return ""
      // A plugin can set `content` on a lazy skill, and what it set wins.
      if (!entry.load || entry.info.content) return entry.info.content
      return yield* entry.load
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      get: Effect.fn("Skill.get")(function* (id) {
        return state.get().entries.get(id)?.info
      }),
      content,
      files: Effect.fn("Skill.files")(function* (id) {
        const entry = state.get().entries.get(id)
        return entry && Array.from(entry.files.keys())
      }),
      read: Effect.fn("Skill.read")(function* (id, file) {
        const entry = state.get().entries.get(id)
        if (!entry) return yield* new NotFoundError({ skill: id })
        const value = file === manifest ? yield* content(id) : entry.files.get(file)
        if (value === undefined) return yield* new FileNotFoundError({ skill: id, file })
        const loaded = typeof value === "string" || value instanceof Uint8Array ? value : yield* value
        return typeof loaded === "string" ? new TextEncoder().encode(loaded) : loaded
      }),
      list: Effect.fn("Skill.list")(function* () {
        return Array.from(state.get().entries.values(), (entry) => entry.info)
      }),
      resolve: Effect.fn("Skill.resolve")(function* (id) {
        const known = state.get().entries.get(ID.make(id))
        if (known) return known.info
        for (const resolver of state.get().resolvers) {
          const found = yield* resolver(id)
          if (found) return state.get().entries.get(found)?.info
        }
        return undefined
      }),
      approval: Effect.fn("Skill.approval")(function* (id) {
        const origin = state.get().entries.get(id)?.origin
        if (!origin) return { resources: [id], save: [id] }
        const versioned = `${id}@${origin.version}`
        return { resources: [versioned], save: [versioned] }
      }),
      instructions: Effect.fn("Skill.instructions")(function* (id) {
        const body = yield* content(id)
        const origin = state.get().entries.get(id)?.origin
        if (!origin) return body
        return `This skill comes from MCP server "${origin.server}", not from this machine.\n\n${body}`
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node],
})
