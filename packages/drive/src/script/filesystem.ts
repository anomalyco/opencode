import { lstat, mkdir, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
import * as Effect from "effect/Effect"
import { FileSystemError, type ProjectFileSystem } from "../project.js"

interface FileSystemOptions {
  readonly git?: boolean
}

export function createScriptFileSystem(
  directory: string,
  options: FileSystemOptions = {},
): ProjectFileSystem {
  const root = resolve(directory)
  return {
    writeFile: (path, contents) =>
      Effect.tryPromise({
        try: async () => {
          const destination = await resolveFile(root, path, options)
          await mkdir(dirname(destination), { recursive: true })
          await writeFile(destination, contents)
        },
        catch: (cause) => new FileSystemError({
          path,
          cause,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      }),
  }
}

export async function writeScriptFiles(
  directory: string,
  files: Readonly<Record<string, string | Uint8Array>>,
  options: FileSystemOptions = {},
) {
  const root = resolve(directory)
  const entries = await Promise.all(
    Object.entries(files).map(async ([path, contents]) => ({
      contents,
      destination: await resolveFile(root, path, options),
    })),
  )
  const destinations = new Set<string>()
  for (const entry of entries) {
    const destination = entry.destination.toLowerCase()
    if (destinations.has(destination))
      throw new Error("project.files paths must resolve to unique files")
    destinations.add(destination)
  }
  for (const destination of destinations) {
    let parent = dirname(destination)
    while (parent !== dirname(parent)) {
      if (destinations.has(parent))
        throw new Error("project.files paths must not contain file and directory conflicts")
      parent = dirname(parent)
    }
  }
  await Promise.all(
    entries.map(async ({ contents, destination }) => {
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, contents)
    }),
  )
}

async function resolveFile(root: string, path: string, options: FileSystemOptions) {
  if (isAbsolute(path)) throw new Error("fs.writeFile path must be relative")
  const destination = resolve(root, path)
  const resolved = relative(root, destination)
  if (resolved === "") throw new Error("fs.writeFile path must name a file")
  if (resolved === ".." || resolved.startsWith(`..${sep}`))
    throw new Error("fs.writeFile path must stay inside the simulated project")
  if (options.git && resolved.split(sep)[0]?.toLowerCase() === ".git")
    throw new Error("fs.writeFile path must not modify Git metadata")
  await rejectSymlinks(root, destination)
  const stats = await lstat(destination).catch((error: unknown) => {
    if (isMissing(error)) return undefined
    throw error
  })
  if (stats?.isDirectory()) throw new Error("fs.writeFile path must not be a directory")
  return destination
}

async function rejectSymlinks(root: string, destination: string) {
  const parts = relative(root, destination).split(sep)
  let current = root
  for (const part of parts) {
    current = resolve(current, part)
    const stats = await lstat(current).catch((error: unknown) => {
      if (isMissing(error)) return undefined
      throw error
    })
    if (stats === undefined) return
    if (stats.isSymbolicLink())
      throw new Error("fs.writeFile path must not contain symbolic links")
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  )
}
