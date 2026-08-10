export * as Skill from "./skill"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import path from "path"
import { Context, Effect, Layer, Types } from "effect"
import { Skill } from "@opencode-ai/schema/skill"
import { Agent } from "./agent"
import { Bus } from "./bus"
import { Permission } from "./permission"
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

export { Event } from "@opencode-ai/schema/skill"

export const available = (skills: ReadonlyArray<Info>, agent: Agent.Info) =>
  skills.filter((skill) => Permission.evaluate("skill", skill.id, agent.permissions).effect !== "deny")

export const toModelOutput = (skill: Info, files: ReadonlyArray<string>) => {
  const directory = path.dirname(skill.location)
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

export type Data = {
  skills: Map<ID, Types.DeepMutable<Info>>
}

export type Draft = {
  list: () => readonly Types.DeepMutable<Info>[]
  add: (skill: Info) => void
  update: (id: string, update: (skill: Types.DeepMutable<Info>) => void) => void
  remove: (id: string) => void
}

export interface Interface extends State.Transformable<Draft> {
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Skill") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const state = State.create<Data, Draft>({
      name: "skill",
      initial: () => ({ skills: new Map() }),
      draft: (draft) => ({
        list: () => Array.from(draft.skills.values()),
        add: (skill) => {
          draft.skills.set(skill.id, { ...skill } as Types.DeepMutable<Info>)
        },
        update: (id, update) => {
          const current = draft.skills.get(ID.make(id))
          if (!current) return
          update(current)
          current.id = ID.make(id)
        },
        remove: (id) => {
          draft.skills.delete(ID.make(id))
        },
      }),
      finalize: () => bus.publish(Skill.Event.Updated, {}).pipe(Effect.asVoid),
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      list: Effect.fn("Skill.list")(function* () {
        return Array.from(state.get().skills.values())
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node],
})
