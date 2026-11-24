export * as Skill from "./skill.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import path from "path"
import { Context, Effect, Layer, Schema, Types } from "effect"
import { Skill } from "@opencode/schema/skill"
import { Bus } from "./bus.js"
import { PermissionPolicy } from "./permission/policy.js"
import { State } from "./state.js"

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

export type Summary = Omit<Info, "content"> & {
  /** The MCP server that serves the skill, for a skill listed through MCP Skills. */
  readonly server?: string
}
/** A skill's `SKILL.md` body, inline or loaded when the skill is. */
export type Content = string | Effect.Effect<string, unknown>
/** A supporting file, inline or read when it is. */
export type FileInput = string | Uint8Array | Effect.Effect<string | Uint8Array, unknown>
export type Entry = Summary & { readonly content: Content }
/** `revision` changes whenever lazy content would, so updates are published without loading it. */
export type Input = Entry & { readonly revision?: string }
export type Draft = Types.DeepMutable<Summary> & { content: Content }

export class LoadError extends Schema.TaggedError<LoadError>()("Skill.LoadError", {
  skill: ID,
  path: Schema.optional(Schema.String),
  message: Schema.String,
}) {}

export const available = <T extends Summary>(skills: ReadonlyArray<T>, policy: PermissionPolicy.Policy) =>
  skills.filter((skill) => PermissionPolicy.evaluate(policy, "skill", skill.id).effect !== "deny")

export const uri = (id: string, file?: string) => (file ? `skill://${id}/${file}` : `skill://${id}`)

export const isUri = (value: string) => value.startsWith("skill://")

export const toModelOutput = (skill: Info, files: ReadonlyArray<string>) => {
  const directory = isUri(skill.path) ? uri(skill.id) : path.dirname(skill.path)
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
  virtualFiles?: ReadonlyArray<string>,
) {
  if (isUri(skill.path)) {
    const directory = uri(skill.id)
    const files = (virtualFiles ?? [])
      .filter((file) => file !== "SKILL.md")
      .toSorted()
      .slice(0, 10)
      .map((file) => uri(skill.id, file))
    return {
      directory,
      output: toModelOutput(skill, files),
    }
  }
  const directory = path.dirname(skill.path)
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

export type Data = {
  skills: Map<ID, Draft>
  files: Map<ID, ReadonlyMap<string, FileInput>>
  revisions: Map<ID, string>
}

type ContentOption = { readonly content?: true }
type SummaryOption = { readonly content: false }
type ListingOption = { readonly content: "eager" }

export type Editor = {
  /** Skills whose content is inline; `{ content: false }` lists every skill. */
  list: {
    (options?: ContentOption): readonly Types.DeepMutable<Info>[]
    (options: SummaryOption): readonly Summary[]
  }
  get: {
    (id: string, options?: ContentOption): Types.DeepMutable<Info> | undefined
    (id: string, options: SummaryOption): Summary | undefined
  }
  add: (skill: Input, files?: Readonly<Record<string, FileInput>>) => void
  /** Updates a skill whose content is inline. */
  update: (id: string, update: (skill: Types.DeepMutable<Info>) => void) => void
  remove: (id: string) => void
}

export interface Interface extends State.Transformable<Editor> {
  /** Loads lazy content; `{ content: false }` loads nothing. */
  readonly get: {
    (id: ID): Effect.Effect<Info | undefined, LoadError>
    (id: ID, options: SummaryOption): Effect.Effect<Summary | undefined>
  }
  /**
   * Supporting file paths relative to the skill directory, without `SKILL.md`, read from nothing. With a path, reads
   * exactly that file, `SKILL.md` included.
   */
  readonly files: {
    (id: ID): Effect.Effect<ReadonlyArray<string> | undefined>
    (id: ID, path: string): Effect.Effect<Uint8Array | undefined, LoadError>
  }
  /**
   * Skills whose content is inline; `{ content: false }` lists every skill and loads nothing. `{ content: "eager" }`
   * lists every skill for the public listing, with an empty `content` for a skill whose content loads on demand.
   */
  readonly list: {
    (options?: ContentOption): Effect.Effect<Info[]>
    (options: SummaryOption): Effect.Effect<Summary[]>
    (options: ListingOption): Effect.Effect<Info[]>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Skill") {}

const encoder = new TextEncoder()

const inline = (skill: Draft): skill is Types.DeepMutable<Info> => typeof skill.content === "string"

const summarize = (skill: Entry): Summary => {
  const { content: _, ...summary } = skill
  return summary
}

// The public listing's shape: a lazy skill's content stays unloaded and `server` is internal.
const listing = (skill: Draft): Info => {
  if (inline(skill)) return skill
  const { content: _, server: __, ...info } = skill
  return { ...info, content: "" }
}

const failed = (skill: ID, path?: string) => (error: unknown) =>
  error instanceof LoadError
    ? error
    : new LoadError({ skill, path, message: error instanceof Error ? error.message : String(error) })

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const state = State.create<Data, Editor>({
      name: "skill",
      initial: () => ({ skills: new Map(), files: new Map(), revisions: new Map() }),
      editor: (editor) => {
        function list(options?: ContentOption): readonly Types.DeepMutable<Info>[]
        function list(options: SummaryOption): readonly Summary[]
        function list(
          options?: ContentOption | SummaryOption,
        ): readonly Types.DeepMutable<Info>[] | readonly Summary[] {
          const skills = Array.from(editor.skills.values())
          return options?.content === false ? skills.map(summarize) : skills.filter(inline)
        }
        function get(id: string, options?: ContentOption): Types.DeepMutable<Info> | undefined
        function get(id: string, options: SummaryOption): Summary | undefined
        function get(id: string, options?: ContentOption | SummaryOption) {
          const skill = editor.skills.get(ID.make(id))
          if (!skill) return undefined
          if (options?.content === false) return summarize(skill)
          return inline(skill) ? skill : undefined
        }
        return {
          list,
          get,
          update: (id, update) => {
            const key = ID.make(id)
            const current = editor.skills.get(key)
            if (!current || !inline(current)) return
            update(current)
            current.id = key
          },
          add: (skill, files) => {
            const { revision, ...entry } = skill
            editor.skills.set(skill.id, entry)
            if (revision === undefined) editor.revisions.delete(skill.id)
            else editor.revisions.set(skill.id, revision)
            const entries = files
              ? Object.entries(files)
                  .filter(([file]) => file !== "SKILL.md")
                  .toSorted(([a], [b]) => a.localeCompare(b))
              : []
            if (entries.length === 0) {
              editor.files.delete(skill.id)
              return
            }
            editor.files.set(skill.id, new Map(entries))
          },
          remove: (id) => {
            const key = ID.make(id)
            editor.skills.delete(key)
            editor.files.delete(key)
            editor.revisions.delete(key)
          },
        }
      },
      // Lazy content and files are compared by revision; loading them here would fetch them.
      notify: State.changes(
        (data) => [
          Array.from(data.skills.values(), (skill) =>
            inline(skill) ? skill : [summarize(skill), data.revisions.get(skill.id) ?? null],
          ),
          Array.from(data.files, ([id, entries]) => [
            id,
            Array.from(entries, ([file, value]) => [
              file,
              typeof value === "string"
                ? value
                : value instanceof Uint8Array
                  ? Buffer.from(value).toString("base64")
                  : null,
            ]),
          ]),
        ],
        () => bus.publish(Skill.Event.Updated, {}).pipe(Effect.asVoid),
      ),
    })

    const load = Effect.fn("Skill.get")(function* (id: ID) {
      const skill = state.get().skills.get(id)
      if (!skill) return undefined
      if (inline(skill)) return skill
      const content = skill.content
      return {
        ...summarize(skill),
        content: typeof content === "string" ? content : yield* content.pipe(Effect.mapError(failed(id))),
      }
    })

    const read = Effect.fn("Skill.files")(function* (id: ID, file: string) {
      const current = state.get()
      const skill = current.skills.get(id)
      if (!skill) return undefined
      const input = file === "SKILL.md" ? skill.content : current.files.get(id)?.get(file)
      if (input === undefined) return undefined
      const value =
        typeof input === "string" || input instanceof Uint8Array
          ? input
          : yield* input.pipe(Effect.mapError(failed(id, file)))
      return typeof value === "string" ? encoder.encode(value) : value
    })

    function get(id: ID): Effect.Effect<Info | undefined, LoadError>
    function get(id: ID, options: SummaryOption): Effect.Effect<Summary | undefined>
    function get(id: ID, options?: SummaryOption) {
      if (!options) return load(id)
      return Effect.sync(() => {
        const skill = state.get().skills.get(id)
        return skill ? summarize(skill) : undefined
      })
    }

    function files(id: ID): Effect.Effect<ReadonlyArray<string> | undefined>
    function files(id: ID, path: string): Effect.Effect<Uint8Array | undefined, LoadError>
    function files(
      id: ID,
      path?: string,
    ): Effect.Effect<ReadonlyArray<string> | undefined> | Effect.Effect<Uint8Array | undefined, LoadError> {
      if (path !== undefined) return read(id, path)
      return Effect.sync(() => {
        const current = state.get()
        if (!current.skills.has(id)) return undefined
        return Array.from(current.files.get(id)?.keys() ?? [])
      })
    }

    function list(options?: ContentOption): Effect.Effect<Info[]>
    function list(options: SummaryOption): Effect.Effect<Summary[]>
    function list(options: ListingOption): Effect.Effect<Info[]>
    function list(options?: ContentOption | SummaryOption | ListingOption) {
      return Effect.sync(() => {
        const skills = Array.from(state.get().skills.values())
        if (options?.content === false) return skills.map(summarize)
        if (options?.content === "eager") return skills.map(listing)
        return skills.filter(inline)
      })
    }

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      get,
      files,
      list,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node],
})
