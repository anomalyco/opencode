import { Project } from "@opencode-ai/schema/project"
import { Hash } from "@opencode-ai/util/hash"
import type { AbsolutePath } from "../schema.js"

export function directoryProjectID(directory: AbsolutePath) {
  return Project.ID.make(Hash.fast(`directory:${directory}`))
}
