import { WorktreeAdaptor } from "./worktree"
import type { Config } from "../config"
import type { Adaptor } from "./types"

export function getAdaptor(config: Config): Adaptor {
  switch (config.type) {
    case "worktree":
      return WorktreeAdaptor
  }
}
