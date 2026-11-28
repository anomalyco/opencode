export * as SandboxHostPolicy from "./host-policy.js"

import fs from "node:fs/promises"
import path from "node:path"
import type { SandboxPolicy } from "./policy.js"

export type Host = { directory: string; scratch: string; home: string; config: string; data: string; state: string }

export async function roots(values: readonly string[]) {
  return [
    ...new Set(
      await Promise.all(
        values.map(async (value) => {
          if (!path.isAbsolute(value) || value.includes("\0"))
            throw new Error(`Sandbox root must be absolute: ${value}`)
          return fs.realpath(value)
        }),
      ),
    ),
  ].sort()
}

export async function policy(
  host: Host,
  options: SandboxPolicy.Options,
  runtimeRoots: readonly string[],
  databasePath?: string,
): Promise<SandboxPolicy.Policy> {
  const directory = await fs.realpath(host.directory)
  if (directory === path.parse(directory).root || directory === (await fs.realpath(host.home)))
    throw new Error("Select a project directory; the filesystem root and home directory cannot be sandbox workspaces.")
  // Host settings pass canonical paths. Refuse changed aliases after Location eviction,
  // rather than resolving a pinned grant to a different directory.
  await Promise.all(
    [...(options.readableRoots ?? []), ...(options.writableRoots ?? [])].map(async (value) => {
      if ((await fs.realpath(value)) !== value) throw new Error(`Configured sandbox root changed: ${value}`)
    }),
  )
  const writableRoots = await roots([directory, host.scratch, ...(options.writableRoots ?? [])])
  const readableRoots = [...new Set([...runtimeRoots, ...(await roots(options.readableRoots ?? []))])].sort()
  const hostPaths = await roots([host.config, host.data, host.state])
  if (writableRoots.some((root) => hostPaths.some((value) => contains(root, value))))
    throw new Error("Writable sandbox roots must not contain OpenCode's configuration or state directories.")
  const scratch = await fs.realpath(host.scratch)
  const databaseTarget = databasePath ? await canonicalPath(databasePath) : undefined
  const databasePaths = databasePath
    ? [...new Set([databasePath, databaseTarget!])].flatMap((file) => [
        file,
        `${file}-wal`,
        `${file}-shm`,
        `${file}-journal`,
      ])
    : []
  const protectedPaths = [
    path.join(scratch, ".runtime"),
    ...writableRoots.flatMap((root) => [
      ...(options.allowGitWrites && contains(directory, root) ? [] : [path.join(root, ".git")]),
      ...[".opencode", ".agents", ".codex", ".aws", ".ssh"].map((name) => path.join(root, name)),
      ...["opencode.json", "opencode.jsonc"].map((name) => path.join(root, name)),
    ]),
    ...hostPaths,
    ...databasePaths,
    ...readableRoots,
  ]
  const unreadablePaths = [
    ...hostPaths,
    ...databasePaths,
    ...[host.home, ...writableRoots].flatMap((root) => [path.join(root, ".aws"), path.join(root, ".ssh")]),
  ]
  // Protect both a metadata symlink and its existing target. Missing paths remain protected
  // so a command cannot create a new plugin/config directory to be loaded by the host.
  const aliases = await Promise.all(protectedPaths.map((value) => fs.realpath(value).catch(() => value)))
  const unreadableAliases = await Promise.all(unreadablePaths.map((value) => fs.realpath(value).catch(() => value)))
  return {
    directory,
    fullDiskRead: options.fullDiskRead ?? false,
    ...(options.allowGitWrites ? { allowGitWrites: true } : {}),
    readableRoots,
    writableRoots,
    protectedPaths: [...new Set([...protectedPaths, ...aliases])],
    unreadablePaths: [...new Set([...unreadablePaths, ...unreadableAliases])],
    scratch,
  }
}

export function contains(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

// The server may start the policy before SQLite creates its database. Resolve existing
// symlinks, including a dangling leaf, without losing protection for the future file.
export async function canonicalPath(value: string, depth = 0): Promise<string> {
  if (depth > 40) throw new Error(`Too many database path aliases: ${value}`)
  try {
    return await fs.realpath(value)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    const entry = await fs.lstat(value).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return undefined
      throw cause
    })
    if (entry?.isSymbolicLink())
      return canonicalPath(path.resolve(path.dirname(value), await fs.readlink(value)), depth + 1)
    const parent = path.dirname(value)
    if (parent === value) throw error
    return path.join(await canonicalPath(parent, depth + 1), path.basename(value))
  }
}
