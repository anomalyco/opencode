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

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Skill.NotFoundError", {
  skill: Schema.String,
}) {}

export class FileNotFoundError extends Schema.TaggedError<FileNotFoundError>()("Skill.FileNotFoundError", {
  skill: Schema.String,
  file: Schema.String,
}) {}

export class LoadError extends Schema.TaggedError<LoadError>()("Skill.LoadError", {
  skill: Schema.String,
  message: Schema.String,
}) {}

/** A skill's SKILL.md body or one of its files: inline, or loaded the first time it's needed. */
export type Content = string | Effect.Effect<string, LoadError>
export type File = string | Uint8Array | Effect.Effect<string | Uint8Array, LoadError>
/** Where a skill that didn't come from this machine came from. */
export type Origin = { readonly type: "mcp"; readonly server: string }

export const available = (skills: ReadonlyArray<Info>, policy: PermissionPolicy.Policy) =>
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
  skills: Map<ID, Types.DeepMutable<Info>>
  files: Map<ID, ReadonlyMap<string, File>>
  loaders: Map<ID, Effect.Effect<string, LoadError>>
  origins: Map<ID, Origin>
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
}

export interface Interface extends State.Transformable<Editor> {
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /** The skill's SKILL.md body, loaded when the skill doesn't have it inline. */
  readonly content: (id: ID) => Effect.Effect<string, LoadError>
  /** Paths of the skill's virtual files besides SKILL.md. */
  readonly files: (id: ID) => Effect.Effect<ReadonlyArray<string> | undefined>
  /**
   * One file of a skill by its path relative to the skill's folder, loaded when it isn't inline. `SKILL.md` is the
   * body without frontmatter. Any path that isn't one of the skill's files, unsafe ones included, is not found.
   */
  readonly read: (id: ID, file: string) => Effect.Effect<Uint8Array, NotFoundError | FileNotFoundError | LoadError>
  readonly list: () => Effect.Effect<Info[]>
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
      initial: () => ({ skills: new Map(), files: new Map(), loaders: new Map(), origins: new Map() }),
      editor: (editor) => ({
        list: () => Array.from(editor.skills.values()),
        get: (id) => editor.skills.get(ID.make(id)),
        add: (skill, files, origin) => {
          const content = skill.content
          editor.skills.set(skill.id, { ...skill, content: typeof content === "string" ? content : "" })
          editor.loaders.delete(skill.id)
          if (typeof content !== "string") editor.loaders.set(skill.id, content)
          editor.origins.delete(skill.id)
          if (origin) editor.origins.set(skill.id, origin)
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
        update: (id, update) => {
          const key = ID.make(id)
          const current = editor.skills.get(key)
          if (!current) return
          update(current)
          current.id = key
        },
        remove: (id) => {
          const key = ID.make(id)
          editor.skills.delete(key)
          editor.files.delete(key)
          editor.loaders.delete(key)
          editor.origins.delete(key)
        },
      }),
      notify: State.changes(
        (data) => [
          Array.from(data.skills.values()),
          Array.from(data.files, ([id, entries]) => [
            id,
            Array.from(entries, ([file, value]) => [file, Effect.isEffect(value) ? null : value]),
          ]),
        ],
        () => bus.publish(Skill.Event.Updated, {}).pipe(Effect.asVoid),
      ),
    })

    const content = Effect.fn("Skill.content")(function* (id: ID) {
      const current = state.get()
      const loader = current.loaders.get(id)
      const inline = current.skills.get(id)?.content ?? ""
      if (inline || !loader) return inline
      return yield* loader
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      get: Effect.fn("Skill.get")(function* (id) {
        return state.get().skills.get(id)
      }),
      content,
      files: Effect.fn("Skill.files")(function* (id) {
        const current = state.get()
        if (!current.skills.has(id)) return undefined
        return Array.from(current.files.get(id)?.keys() ?? [])
      }),
      read: Effect.fn("Skill.read")(function* (id, file) {
        const current = state.get()
        if (!current.skills.has(id)) return yield* new NotFoundError({ skill: id })
        const value = file === "SKILL.md" ? yield* content(id) : current.files.get(id)?.get(file)
        if (value === undefined) return yield* new FileNotFoundError({ skill: id, file })
        const loaded = typeof value === "string" || value instanceof Uint8Array ? value : yield* value
        return typeof loaded === "string" ? new TextEncoder().encode(loaded) : loaded
      }),
      list: Effect.fn("Skill.list")(function* () {
        return Array.from(state.get().skills.values())
      }),
      instructions: Effect.fn("Skill.instructions")(function* (id) {
        const body = yield* content(id)
        const origin = state.get().origins.get(id)
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
