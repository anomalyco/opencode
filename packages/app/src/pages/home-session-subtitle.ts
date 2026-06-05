import { getFilename } from "@opencode-ai/core/util/path"
import { pathKey } from "@/utils/path-key"

export function homeSessionSubtitle(input: {
  projectName: string
  projectWorktree: string
  sessionDirectory: string
  branch?: string
}) {
  if (pathKey(input.sessionDirectory) === pathKey(input.projectWorktree)) return input.projectName
  return `${input.projectName} - ${input.branch ?? getFilename(input.sessionDirectory)}`
}
