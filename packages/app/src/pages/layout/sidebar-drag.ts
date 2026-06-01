import type { LocalProject } from "@/context/layout"

export function dragOverlayProject(projects: LocalProject[], active?: string) {
  return projects.find((p) => p.worktree === active)
}
