export * as WorktreeStrategies from "./strategies.js"

import { Context, Effect, Layer } from "effect"
import path from "path"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Worktree } from "@opencode/schema/worktree"
import { AbsolutePath } from "../schema.js"
import { Git } from "../git.js"
import { Location } from "../location.js"
import { State } from "../state.js"
import { WorktreeGit } from "./git.js"
import { FSUtil } from "@opencode/util/fs-util"

export interface Strategy {
  readonly id: Worktree.StrategyID
  readonly create: (input: {
    sourceDirectory: AbsolutePath
    directory: AbsolutePath
    branch?: string
  }) => Effect.Effect<Worktree.Info, unknown>
  readonly remove: (input: { directory: AbsolutePath; force: boolean }) => Effect.Effect<void, unknown>
  readonly list: (directory: AbsolutePath) => Effect.Effect<readonly Worktree.ListEntry[], unknown>
}

export interface Editor {
  readonly add: (strategy: Strategy) => void
  readonly configure: (settings: { readonly directory: AbsolutePath }) => void
}

export interface Interface extends State.Transformable<Editor> {
  readonly directory: AbsolutePath
  readonly get: () => {
    readonly directory: AbsolutePath
    readonly strategies: ReadonlyMap<Worktree.StrategyID, Strategy>
    readonly selected: Worktree.StrategyID
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WorktreeStrategies") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const global = yield* Global.Service
    const git = yield* WorktreeGit.make
    const state = State.create({
      name: "worktree",
      initial: () => ({
        directory: AbsolutePath.make(path.join(global.data, "worktree", location.project.id.slice(0, 6))),
        strategies: new Map<Worktree.StrategyID, Strategy>([[git.id, git]]),
        selected: git.id,
      }),
      editor: (value): Editor => ({
        configure: (settings) => {
          value.directory = settings.directory
        },
        add: (strategy) => {
          value.strategies.delete(strategy.id)
          value.strategies.set(strategy.id, strategy)
          value.selected = strategy.id
        },
      }),
    })
    return Service.of({ ...state, directory: location.directory })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, Global.node, Git.node, FSUtil.node],
})
