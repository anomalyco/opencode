import z from "zod"
import { WorktreeAdaptor, WorktreeConfig } from "./worktree"
import type { Adaptor } from "./types"

export const Config = z.discriminatedUnion("type", [WorktreeConfig])
export type Config = z.infer<typeof Config>

export function getAdaptor(type: Config["type"]): Adaptor<Config, unknown> {
  switch (type) {
    case "worktree":
      return WorktreeAdaptor
  }
}
