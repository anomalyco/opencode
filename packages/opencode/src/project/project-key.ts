export * as ProjectKey from "./project-key"

import { stat } from "node:fs/promises"
import path from "path"

// One project can be reachable through several equally-real paths (symlinks, bind mounts) and
// realpath cannot unify bind mounts. The .git directory's device+inode is identical across every
// path variant, so project-scoped state keys on it when present, falling back to the path string
// for non-git directories.
export const key = (root: string): Promise<string> =>
  stat(path.join(root, ".git"))
    .then((info) => `${info.dev}:${info.ino}`)
    .catch(() => root)
