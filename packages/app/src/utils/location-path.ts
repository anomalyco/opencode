import { Location } from "@opencode-ai/schema/location"
import type { Path } from "@opencode-ai/sdk/v2/client"
import { Schema } from "effect"

export function locationPath(input: unknown): Path {
  const location = Schema.decodeUnknownSync(Location.Details)(input)
  return {
    state: "",
    config: "",
    worktree: location.project.directory,
    directory: location.directory,
    home: location.home,
  }
}
