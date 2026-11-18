import type { ServerCtx } from "@/runtime/server/runtime"

export async function addProjects(context: ServerCtx, directories: string[]) {
  const projects = await Promise.all(directories.map((directory) => context.projects.add(directory)))
  const directory = directories[0]
  const project = projects[0]

  // The server reports one project per canonical checkout; keep the directory the user chose with its identity.
  if (!directory || !project) return project

  context.projects.touch(directory)

  return { ...project, worktree: directory }
}
