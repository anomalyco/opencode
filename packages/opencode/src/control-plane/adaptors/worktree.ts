import { Worktree } from "@/worktree"
import type { Config } from "../config"
import type { Adaptor } from "./types"

type WorktreeConfig = Extract<Config, { type: "worktree" }>

export const WorktreeAdaptor: Adaptor<WorktreeConfig> = {
  async create(_from: WorktreeConfig, _branch: string) {
    const next = await Worktree.create(undefined)
    return {
      config: {
        type: "worktree",
        directory: next.directory,
      },
      // Hack for now: `Worktree.create` puts all its async code in a
      // `setTimeout` so it doesn't use this, but we should change that
      init: async () => {},
    }
  },
  async remove(config: WorktreeConfig) {
    await Worktree.remove({ directory: config.directory })
  },
  async request(_from: WorktreeConfig, _method: string, _url: string, _data?: BodyInit, _signal?: AbortSignal) {
    throw new Error("worktree does not support request")
  },
}
