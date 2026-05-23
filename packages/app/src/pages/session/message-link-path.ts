import { getFilename } from "@opencode-ai/core/util/path"

export function resolveLinkedPath(path: string, list: string[]) {
  const name = getFilename(path)
  if (!name) return path

  const exact = list.find((item) => item === path)
  if (exact) return exact

  // Message links often carry a path relative to a task subdir rather than the
  // project root, so prefer a suffix match within the current project scope.
  const suffix = list.find((item) => item.endsWith(`/${path}`) || item.endsWith(`\\${path}`))
  if (suffix) return suffix

  const tail = list.find((item) => item.endsWith(`/${name}`) || item.endsWith(`\\${name}`))
  if (tail) return tail

  return path
}
