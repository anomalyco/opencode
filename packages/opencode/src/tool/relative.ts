import path from "path"
import type { InstanceContext } from "@/project/instance-context"

export function relative(instance: InstanceContext, file: string) {

  const root = instance.worktree === "/" ? instance.directory : instance.worktree
  return path.relative(root, file)
}
