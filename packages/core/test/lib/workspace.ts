import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "fs/promises"
import nodePath from "path"
import { Effect, Layer } from "effect"
import { make } from "effect/unstable/process/ChildProcessSpawner"
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Workspace } from "@opencode-ai/core/workspace"
import { WorkspaceEnvironment } from "@opencode-ai/core/workspace/environment"

export const ROOT = "/workspace"

export const workspaceID = Workspace.ID.make("wrk_test")

/** A hosted Location at the workspace root, as hostedBoundNode would state it. */
export const hostedLocationLayer = (root: string = ROOT) =>
  Layer.succeed(
    Location.Service,
    Location.Service.of({
      directory: AbsolutePath.make(root),
      workspaceID,
      project: Project.hostedGlobal(root),
    }),
  )

export interface MemoryEnvironment {
  readonly environment: WorkspaceEnvironment.Interface
  /** Live view of stored file contents by absolute path. */
  readonly contents: (path: string) => string | undefined
}
/**
 * Environment backed by a real host directory and spawner: the honest fake
 * for end-to-end tests. Files go through fs/promises, commands actually run
 * with the given spawner, so bash output is visible to reads.
 */
export const directoryEnvironment = (
  root: string,
  spawn: ChildProcessSpawner["Service"]["spawn"],
): WorkspaceEnvironment.Interface => {
  const wrap = <A>(operation: string, path: string, run: () => Promise<A>) =>
    WorkspaceEnvironment.tryOperation({
      operation,
      path,
      run,
      isNotFound: (cause) => (cause as NodeJS.ErrnoException).code === "ENOENT",
    })
  return WorkspaceEnvironment.make({
    directory: root,
    files: {
      stat: (path) =>
        wrap("stat", path, async () => {
          const info = await stat(path)
          return {
            type: info.isFile()
              ? ("File" as const)
              : info.isDirectory()
                ? ("Directory" as const)
                : ("Unknown" as const),
          }
        }),
      realPath: (path) => wrap("realPath", path, () => realpath(path)),
      read: (path) => wrap("read", path, async () => Uint8Array.from(await readFile(path))),
      list: (path) =>
        wrap("list", path, async () => {
          const entries = await readdir(path, { withFileTypes: true })
          return entries.map((entry) => ({
            name: entry.name,
            type: entry.isFile()
              ? ("file" as const)
              : entry.isDirectory()
                ? ("directory" as const)
                : entry.isSymbolicLink()
                  ? ("symlink" as const)
                  : ("other" as const),
          }))
        }),
      write: (path, content) =>
        Effect.tryPromise({
          try: async () => {
            await mkdir(nodePath.dirname(path), { recursive: true })
            await writeFile(path, content)
          },
          catch: (cause) => new WorkspaceEnvironment.Error({ operation: "write", path, cause }),
        }),
      remove: (path) => wrap("remove", path, () => rm(path)),
    },
    process: make(spawn),
    shell: {
      executable: "/bin/bash",
      args: (command) => ["-c", command],
      // Real commands need PATH; nothing else from the host environment leaks.
      environmentOverrides: { PATH: process.env.PATH ?? "" },
      detached: false,
    },
  })
}

/**
 * In-memory workspace environment rooted at /workspace: file paths to
 * contents, directories implied by keys, no symlinks, no processes. Type
 * mismatches (read a directory, list a file) fail with Error per the Files
 * contract.
 */
export const memoryEnvironment = (files: Record<string, string>): MemoryEnvironment => {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const store = new Map(Object.entries(files).map(([key, value]) => [key, Uint8Array.from(encoder.encode(value))]))
  const isDirectory = (path: string) =>
    path === ROOT || Array.from(store.keys()).some((key) => key.startsWith(path + "/"))
  const exists = (path: string) => store.has(path) || isDirectory(path)
  const notFound = (path: string) => Effect.fail(new WorkspaceEnvironment.NotFoundError({ path }))
  const wrongType = (operation: string, path: string) =>
    Effect.fail(new WorkspaceEnvironment.Error({ operation, path }))
  const environment = WorkspaceEnvironment.make({
    directory: ROOT,
    files: {
      stat: (path) =>
        store.has(path)
          ? Effect.succeed({ type: "File" as const })
          : isDirectory(path)
            ? Effect.succeed({ type: "Directory" as const })
            : notFound(path),
      realPath: (path) => (exists(path) ? Effect.succeed(path) : notFound(path)),
      read: (path) => {
        const content = store.get(path)
        if (content) return Effect.succeed(content)
        return isDirectory(path) ? wrongType("read", path) : notFound(path)
      },
      list: (path) => {
        if (store.has(path)) return wrongType("list", path)
        if (!isDirectory(path)) return notFound(path)
        const names = new Map<string, "file" | "directory">()
        for (const key of store.keys()) {
          if (!key.startsWith(path + "/")) continue
          const rest = key.slice(path.length + 1)
          const [head] = rest.split("/")
          if (head) names.set(head, rest.includes("/") ? "directory" : "file")
        }
        return Effect.succeed(Array.from(names, ([name, type]) => ({ name, type })))
      },
      write: (path, content) =>
        Effect.sync(() => {
          store.set(path, Uint8Array.from(content))
        }),
      remove: (path) => {
        if (store.delete(path)) return Effect.void
        return isDirectory(path) ? wrongType("remove", path) : notFound(path)
      },
    },
    process: make(() => Effect.die(new Error("no processes in the memory environment"))),
    shell: WorkspaceEnvironment.linuxShell,
  })
  return {
    environment,
    contents: (path) => {
      const stored = store.get(path)
      return stored ? decoder.decode(stored) : undefined
    },
  }
}
