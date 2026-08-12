import { readdir, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { artifactDirectory } from "../instance/instance.js"
import { listManifests, validateName } from "../instance/registry.js"

export async function prune(options: { readonly name?: string; readonly force?: boolean } = {}) {
  if (options.name !== undefined) validateName(options.name)
  const directory = artifactDirectory()
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return []
    throw error
  })
  const manifests = await listManifests()
  const active = new Set(manifests.map((manifest) => resolve(manifest.artifacts)))
  const manifestNames = new Map(
    manifests.map((manifest) => [resolve(manifest.artifacts), manifest.name]),
  )
  const artifacts = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
    .map((entry) => join(directory, entry.name))
  const matched = await Promise.all(
    artifacts.map(async (artifacts) => {
      if (options.name === undefined) return artifacts
      const storedName = await Bun.file(join(artifacts, "drive", "name"))
        .text()
        .then((value) => value.trim())
        .catch(() => undefined)
      return storedName === options.name || manifestNames.get(resolve(artifacts)) === options.name
        ? artifacts
        : undefined
    }),
  )
  const pruned = matched
    .filter((artifacts): artifacts is string => artifacts !== undefined)
    .filter((artifacts) => options.force || !active.has(resolve(artifacts)))

  await Promise.all(pruned.map((artifacts) => rm(artifacts, { recursive: true, force: true })))
  console.log(pruned.length)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
