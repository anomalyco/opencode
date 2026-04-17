import path from "path"
import { mkdir } from "fs/promises"
import { Arborist } from "@npmcli/arborist"
// @ts-expect-error — CJS module with no bundled types
import pacote from "pacote"

type Flat = Record<string, unknown>

export async function preResolveGitSubdir(spec: string, cacheRoot: string, cfg: Flat) {
  const dir = path.join(cacheRoot, "packages", sanitize(spec))
  const file = path.join(dir, "git-subdir.tgz")
  if (await Bun.file(file).exists()) return file

  await mkdir(dir, { recursive: true })
  await pacote.tarball.file(spec, file, { ...cfg, Arborist })
  return file
}

function sanitize(spec: string) {
  return `git-subdir-${spec}`.replace(/[^a-zA-Z0-9_.-]/g, "_")
}
