import { Global } from "@opencode-ai/core/global"
import { InstanceLayer } from "@/project/instance-layer"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import type { ProjectV2 } from "@opencode-ai/core/project"
import * as Log from "@opencode-ai/core/util/log"
import { Slug } from "@opencode-ai/core/util/slug"
import { errorMessage } from "../util/error"
import { EventV2 } from "@opencode-ai/core/event"
import { GlobalBus } from "@/bus/global"
import { Git } from "@/git"
import { Cause, Effect, Layer, Path, Schema, Scope, Context } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { NodePath } from "@effect/platform-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { AppProcess } from "@opencode-ai/core/process"
import { InstanceState } from "@/effect/instance-state"

const log = Log.create({ service: "worktree" })

export const Event = {
  Ready: EventV2.define({
    type: "worktree.ready",
    schema: {
      name: Schema.String,
      branch: Schema.optional(Schema.String),
    },
  }),
  Failed: EventV2.define({
    type: "worktree.failed",
    schema: {
      message: Schema.String,
    },
  }),
}

export const Info = Schema.Struct({
  name: Schema.String,
  branch: Schema.optional(Schema.String),
  directory: Schema.String,
}).annotate({ identifier: "Worktree" })
export type Info = Schema.Schema.Type<typeof Info>

export const CreateInput = Schema.Struct({
  name: Schema.optional(Schema.String),
  startCommand: Schema.optional(
    Schema.String.annotate({ description: "Additional startup script to run after the project's start command" }),
  ),
}).annotate({ identifier: "WorktreeCreateInput" })
export type CreateInput = Schema.Schema.Type<typeof CreateInput>

export const RemoveInput = Schema.Struct({
  directory: Schema.String,
}).annotate({ identifier: "WorktreeRemoveInput" })
export type RemoveInput = Schema.Schema.Type<typeof RemoveInput>

export const RemoveResult = Schema.Struct({
  removed: Schema.Literal(true),
  cleanupDeferred: Schema.Boolean,
  warning: Schema.optional(Schema.String),
}).annotate({ identifier: "WorktreeRemoveResult" })
export type RemoveResult = Schema.Schema.Type<typeof RemoveResult>

export const ResetInput = Schema.Struct({
  directory: Schema.String,
}).annotate({ identifier: "WorktreeResetInput" })
export type ResetInput = Schema.Schema.Type<typeof ResetInput>

export class NotGitError extends Schema.TaggedErrorClass<NotGitError>()("WorktreeNotGitError", {
  message: Schema.String,
}) {}

export class NameGenerationFailedError extends Schema.TaggedErrorClass<NameGenerationFailedError>()(
  "WorktreeNameGenerationFailedError",
  {
    message: Schema.String,
  },
) {}

export class CreateFailedError extends Schema.TaggedErrorClass<CreateFailedError>()("WorktreeCreateFailedError", {
  message: Schema.String,
}) {}

export class StartCommandFailedError extends Schema.TaggedErrorClass<StartCommandFailedError>()(
  "WorktreeStartCommandFailedError",
  {
    message: Schema.String,
  },
) {}

export class RemoveFailedError extends Schema.TaggedErrorClass<RemoveFailedError>()("WorktreeRemoveFailedError", {
  message: Schema.String,
}) {}

export class ResetFailedError extends Schema.TaggedErrorClass<ResetFailedError>()("WorktreeResetFailedError", {
  message: Schema.String,
}) {}

export class ListFailedError extends Schema.TaggedErrorClass<ListFailedError>()("WorktreeListFailedError", {
  message: Schema.String,
}) {}

export type Error =
  | NotGitError
  | NameGenerationFailedError
  | CreateFailedError
  | StartCommandFailedError
  | RemoveFailedError
  | ResetFailedError
  | ListFailedError

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

function failedRemoves(...chunks: string[]) {
  return chunks.filter(Boolean).flatMap((chunk) =>
    chunk
      .split("\n")
      .map((line) => line.trim())
      .flatMap((line) => {
        const match = line.match(/^warning:\s+failed to remove\s+(.+):\s+/i)
        if (!match) return []
        const value = match[1]?.trim().replace(/^['"]|['"]$/g, "")
        if (!value) return []
        return [value]
      }),
  )
}

// ---------------------------------------------------------------------------
// Effect service
// ---------------------------------------------------------------------------

export interface Interface {
  readonly makeWorktreeInfo: (options?: { name?: string; detached?: boolean }) => Effect.Effect<Info, Error>
  readonly createFromInfo: (info: Info, startCommand?: string) => Effect.Effect<void, Error>
  readonly create: (input?: CreateInput) => Effect.Effect<Info, Error>
  readonly list: () => Effect.Effect<(Omit<Info, "branch"> & { branch?: string })[], Error>
  readonly remove: (input: RemoveInput) => Effect.Effect<RemoveResult, Error>
  readonly reset: (input: ResetInput) => Effect.Effect<boolean, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Worktree") {}

type GitResult = { code: number; text: string; stderr: string }
type DirectoryCleanupResult = { cleanupDeferred: false } | { cleanupDeferred: true; warning: string }

const cleanupDeferredCodes = new Set(["EBUSY", "EPERM", "ENOTEMPTY"])

export function isCleanupDeferredError(error: unknown, platform = process.platform) {
  if (platform !== "win32") return false
  const code = (error as { code?: unknown } | undefined)?.code
  return typeof code === "string" && cleanupDeferredCodes.has(code)
}

function scheduleDeferredDirectoryCleanup(target: string) {
  const delays = [1_000, 3_000, 10_000]
  const retry = (attempt: number) => {
    const timer = setTimeout(() => {
      import("fs/promises")
        .then((fsp) => fsp.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
        .catch((error) => {
          if (!isCleanupDeferredError(error) || attempt >= delays.length - 1) {
            log.warn("worktree deferred directory cleanup failed", { directory: target, message: errorMessage(error) })
            return
          }
          retry(attempt + 1)
        })
    }, delays[attempt])
    timer.unref?.()
  }
  retry(0)
}

export function removePhysicalDirectory(
  target: string,
  rm: () => Promise<void> = () =>
    import("fs/promises").then((fsp) =>
      fsp.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
    ),
) {
  return Effect.tryPromise({
    try: rm,
    catch: (error) => error,
  }).pipe(
    Effect.as({ cleanupDeferred: false } satisfies DirectoryCleanupResult),
    Effect.catch((error) => {
      if (isCleanupDeferredError(error)) {
        const warning = errorMessage(error) || "Worktree directory cleanup deferred"
        log.warn("worktree directory cleanup deferred", { directory: target, message: warning })
        scheduleDeferredDirectoryCleanup(target)
        return Effect.succeed({ cleanupDeferred: true, warning } satisfies DirectoryCleanupResult)
      }
      return Effect.fail(
        new RemoveFailedError({ message: errorMessage(error) || "Failed to remove git worktree directory" }),
      )
    }),
  )
}

export const layer: Layer.Layer<
  Service,
  never,
  | FSUtil.Service
  | Path.Path
  | AppProcess.Service
  | Git.Service
  | Project.Service
  | InstanceStore.Service
  | Database.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const scope = yield* Scope.Scope
    const fs = yield* FSUtil.Service
    const pathSvc = yield* Path.Path
    const appProcess = yield* AppProcess.Service
    const { db } = yield* Database.Service
    const gitSvc = yield* Git.Service
    const project = yield* Project.Service
    const store = yield* InstanceStore.Service

    const git = Effect.fnUntraced(
      function* (args: string[], opts?: { cwd?: string }) {
        const result = yield* appProcess.run(
          ChildProcess.make("git", args, { cwd: opts?.cwd, extendEnv: true, stdin: "ignore" }),
        )
        return {
          code: result.exitCode,
          text: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        } satisfies GitResult
      },
      Effect.catch((e) =>
        Effect.succeed({
          code: 1,
          text: "",
          stderr: e instanceof Error ? e.message : String(e),
        } satisfies GitResult),
      ),
    )

    const MAX_NAME_ATTEMPTS = 26
    const candidate = Effect.fn("Worktree.candidate")(function* (input: {
      root: string
      name?: string
      detached?: boolean
    }) {
      const ctx = yield* InstanceState.context
      for (const attempt of Array.from({ length: MAX_NAME_ATTEMPTS }, (_, i) => i)) {
        const name = input.name ? (attempt === 0 ? input.name : `${input.name}-${Slug.create()}`) : Slug.create()
        const branch = input.detached ? undefined : `opencode/${name}`
        const directory = pathSvc.join(input.root, name)

        if (yield* fs.exists(directory).pipe(Effect.orDie)) continue

        if (branch) {
          const ref = `refs/heads/${branch}`
          const branchCheck = yield* git(["show-ref", "--verify", "--quiet", ref], { cwd: ctx.worktree })
          if (branchCheck.code === 0) continue
        }

        return { name, directory, ...(branch ? { branch } : {}) }
      }
      return yield* new NameGenerationFailedError({ message: "Failed to generate a unique worktree name" })
    })

    const makeWorktreeInfo = Effect.fn("Worktree.makeWorktreeInfo")(function* (input?: {
      name?: string
      detached?: boolean
    }) {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") {
        return yield* new NotGitError({ message: "Worktrees are only supported for git projects" })
      }

      const root = pathSvc.join(Global.Path.data, "worktree", ctx.project.id)
      yield* fs.makeDirectory(root, { recursive: true }).pipe(Effect.orDie)

      return yield* candidate({ root, name: input?.name ? slugify(input.name) : "", detached: input?.detached })
    })

    const setup = Effect.fnUntraced(function* (info: Info) {
      const ctx = yield* InstanceState.context
      const created = yield* git(
        info.branch
          ? ["worktree", "add", "--no-checkout", "-b", info.branch, info.directory]
          : ["worktree", "add", "--no-checkout", "--detach", info.directory, "HEAD"],
        { cwd: ctx.worktree },
      )
      if (created.code !== 0) {
        return yield* new CreateFailedError({
          message: created.stderr || created.text || "Failed to create git worktree",
        })
      }

      yield* project.addSandbox(ctx.project.id, info.directory).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* git(["worktree", "remove", "--force", info.directory], { cwd: ctx.worktree }).pipe(Effect.ignore)
            if (info.branch) yield* git(["branch", "-D", info.branch], { cwd: ctx.worktree }).pipe(Effect.ignore)
            return yield* new CreateFailedError({
              message: `Failed to record worktree sandbox: ${Cause.pretty(cause)}`,
            })
          }),
        ),
      )
    })

    const boot = Effect.fnUntraced(function* (info: Info, startCommand?: string) {
      const ctx = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      const projectID = ctx.project.id
      const extra = startCommand?.trim()

      const populated = yield* git(["reset", "--hard"], { cwd: info.directory })
      if (populated.code !== 0) {
        const message = populated.stderr || populated.text || "Failed to populate worktree"
        log.error("worktree checkout failed", { directory: info.directory, message })
        GlobalBus.emit("event", {
          directory: info.directory,
          project: ctx.project.id,
          workspace: workspaceID,
          payload: { type: Event.Failed.type, properties: { message } },
        })
        return
      }

      const booted = yield* store.load({ directory: info.directory }).pipe(
        Effect.as(true),
        Effect.catch((error) =>
          Effect.sync(() => {
            const message = errorMessage(error)
            log.error("worktree bootstrap failed", { directory: info.directory, message })
            GlobalBus.emit("event", {
              directory: info.directory,
              project: ctx.project.id,
              workspace: workspaceID,
              payload: { type: Event.Failed.type, properties: { message } },
            })
            return false
          }),
        ),
      )
      if (!booted) return

      GlobalBus.emit("event", {
        directory: info.directory,
        project: ctx.project.id,
        workspace: workspaceID,
        payload: {
          type: Event.Ready.type,
          properties: { name: info.name, ...(info.branch ? { branch: info.branch } : {}) },
        },
      })

      yield* runStartScripts(info.directory, { projectID, extra })
    })

    const createFromInfo = Effect.fn("Worktree.createFromInfo")(function* (info: Info, startCommand?: string) {
      yield* setup(info)
      yield* boot(info, startCommand).pipe(
        Effect.catchCause((cause) => Effect.sync(() => log.error("worktree bootstrap failed", { cause }))),
        Effect.forkIn(scope),
      )
    })

    const create = Effect.fn("Worktree.create")(function* (input?: CreateInput) {
      const info = yield* makeWorktreeInfo({ name: input?.name })
      yield* createFromInfo(info, input?.startCommand)
      return info
    })

    const canonical = Effect.fnUntraced(function* (input: string) {
      const abs = pathSvc.resolve(input)
      const real = yield* fs.realPath(abs).pipe(Effect.catch(() => Effect.succeed(abs)))
      const normalized = pathSvc.normalize(real)
      return process.platform === "win32" ? normalized.replaceAll("/", "\\").toLowerCase() : normalized
    })

    function parseWorktreeList(text: string) {
      return text
        .split("\n")
        .map((line) => line.trim())
        .reduce<{ path?: string; branch?: string }[]>((acc, line) => {
          if (!line) return acc
          if (line.startsWith("worktree ")) {
            acc.push({ path: line.slice("worktree ".length).trim() })
            return acc
          }
          const current = acc[acc.length - 1]
          if (!current) return acc
          if (line.startsWith("branch ")) {
            current.branch = line.slice("branch ".length).trim()
          }
          return acc
        }, [])
    }

    const locateWorktree = Effect.fnUntraced(function* (
      entries: { path?: string; branch?: string }[],
      directory: string,
    ) {
      for (const item of entries) {
        if (!item.path) continue
        const key = yield* canonical(item.path)
        if (key === directory) return item
      }
      return undefined
    })

    function locateWorktreeByBranch(entries: { path?: string; branch?: string }[], branch?: string) {
      if (!branch) return undefined
      return entries.find((item) => item.branch?.replace(/^refs\/heads\//, "") === branch)
    }

    const gitTopLevel = Effect.fnUntraced(function* (directory: string) {
      const result = yield* git(["rev-parse", "--show-toplevel"], { cwd: directory })
      if (result.code !== 0) return
      const top = result.text.trim()
      if (!top) return
      return yield* canonical(top)
    })

    const list = Effect.fn("Worktree.list")(function* () {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") {
        return []
      }

      const result = yield* git(["worktree", "list", "--porcelain"], { cwd: ctx.worktree })
      if (result.code !== 0) {
        return yield* new ListFailedError({ message: result.stderr || result.text || "Failed to read git worktrees" })
      }

      const primary = yield* canonical(ctx.project.worktree)
      const primaryName = pathSvc.basename(primary).toLowerCase()
      return yield* Effect.forEach(parseWorktreeList(result.text), (entry) =>
        Effect.gen(function* () {
          if (!entry.path) return undefined
          const directory = yield* canonical(entry.path)
          if (directory === primary) return undefined
          const name = pathSvc.basename(directory).toLowerCase()
          return {
            name: name === primaryName ? pathSvc.basename(pathSvc.dirname(directory)) : name,
            directory,
            ...(entry.branch ? { branch: entry.branch.replace(/^refs\/heads\//, "") } : {}),
          }
        }),
      ).pipe(Effect.map((items) => items.filter((item) => item !== undefined)))
    })

    function stopFsmonitor(target: string) {
      return fs.exists(target).pipe(
        Effect.catch(() => Effect.succeed(false)),
        Effect.flatMap((exists) => (exists ? git(["fsmonitor--daemon", "stop"], { cwd: target }) : Effect.void)),
        Effect.ignore,
      )
    }

    function cleanDirectory(target: string) {
      return removePhysicalDirectory(target)
    }

    function removed(cleanup: DirectoryCleanupResult = { cleanupDeferred: false }): RemoveResult {
      return {
        removed: true,
        cleanupDeferred: cleanup.cleanupDeferred,
        ...(cleanup.cleanupDeferred ? { warning: cleanup.warning } : {}),
      }
    }

    function successMessage(result: GitResult, fallback: string) {
      return result.stderr || result.text || fallback
    }

    function hasWindowsProjectWorktreeShape(target: string, projectID: string) {
      if (process.platform !== "win32") return false
      const projectRoot = pathSvc.dirname(target)
      const worktreeRoot = pathSvc.dirname(projectRoot)
      const opencodeRoot = pathSvc.dirname(worktreeRoot)
      const dataRoot = pathSvc.dirname(opencodeRoot)
      return (
        pathSvc.basename(projectRoot).toLowerCase() === projectID.toLowerCase() &&
        pathSvc.basename(worktreeRoot).toLowerCase() === "worktree" &&
        pathSvc.basename(opencodeRoot).toLowerCase() === "opencode" &&
        pathSvc.basename(dataRoot).toLowerCase() === "data"
      )
    }

    function ensureSandboxTarget(target: string, root: string, primary: string, projectID: string) {
      if (target === primary) {
        return new RemoveFailedError({ message: "Cannot remove the primary workspace" })
      }
      if (target === root || (!target.startsWith(`${root}${pathSvc.sep}`) && !hasWindowsProjectWorktreeShape(target, projectID))) {
        return new RemoveFailedError({ message: "Worktree path is outside the OpenCode worktree root" })
      }
      return undefined
    }

    function isSandboxTarget(target: string, root: string, primary: string, projectID: string) {
      return (
        target !== primary &&
        target !== root &&
        (target.startsWith(`${root}${pathSvc.sep}`) || hasWindowsProjectWorktreeShape(target, projectID))
      )
    }

    const removeSandboxRecords = Effect.fnUntraced(function* (directories: string[]) {
      const ctx = yield* InstanceState.context
      yield* Effect.forEach(
        [...new Set(directories)],
        (directory) => project.removeSandbox(ctx.project.id, directory).pipe(Effect.catch(() => Effect.void)),
        { discard: true },
      )
    })

    const deleteBranch = Effect.fnUntraced(function* (branchRef?: string) {
      const ctx = yield* InstanceState.context
      const branch = branchRef?.replace(/^refs\/heads\//, "")
      if (!branch) return
      if (!branch.startsWith("opencode/")) {
        return yield* new RemoveFailedError({ message: `Refusing to delete non-opencode worktree branch: ${branch}` })
      }

      const ref = `refs/heads/${branch}`
      const before = yield* git(["show-ref", "--verify", "--quiet", ref], { cwd: ctx.worktree })
      if (before.code !== 0) return

      const deleted = yield* git(["branch", "-D", branch], { cwd: ctx.worktree })
      if (deleted.code === 0) return

      const after = yield* git(["show-ref", "--verify", "--quiet", ref], { cwd: ctx.worktree })
      if (after.code !== 0) return

      return yield* new RemoveFailedError({
        message: successMessage(deleted, "Failed to delete worktree branch"),
      })
    })

    const worktreeBranch = Effect.fnUntraced(function* (target: string, branchRef?: string) {
      const branch = branchRef?.replace(/^refs\/heads\//, "")
      if (branch) return branch
      const result = yield* git(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: target })
      if (result.code !== 0) return `opencode/${pathSvc.basename(target)}`
      const current = result.text.trim()
      if (current) return current
      return `opencode/${pathSvc.basename(target)}`
    })

    const currentBranch = Effect.fnUntraced(function* (target: string) {
      const result = yield* git(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: target })
      if (result.code !== 0) return
      const current = result.text.trim()
      return current || undefined
    })

    const remove = Effect.fn("Worktree.remove")(function* (input: RemoveInput) {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") {
        return yield* new NotGitError({ message: "Worktrees are only supported for git projects" })
      }

      const directory = yield* canonical(input.directory)
      const lookupDirectory = (yield* gitTopLevel(input.directory)) ?? directory
      const root = yield* canonical(pathSvc.join(Global.Path.data, "worktree", ctx.project.id))
      const primary = yield* canonical(ctx.project.worktree)
      const safetyDirectory = isSandboxTarget(lookupDirectory, root, primary, ctx.project.id) ? lookupDirectory : directory
      const unsafe = ensureSandboxTarget(safetyDirectory, root, primary, ctx.project.id)
      if (unsafe) return yield* unsafe

      // Preserve the loaded path casing for the store cache; `directory` is lowercased on Windows.
      if (directory !== (yield* canonical(ctx.worktree))) yield* store.disposeDirectory(input.directory)

      const list = yield* git(["worktree", "list", "--porcelain"], { cwd: ctx.worktree })
      if (list.code !== 0) {
        return yield* new RemoveFailedError({ message: list.stderr || list.text || "Failed to read git worktrees" })
      }

      const entries = parseWorktreeList(list.text)
      let entry = yield* locateWorktree(entries, lookupDirectory)
      const inputBranch = entry?.path ? undefined : yield* currentBranch(input.directory)
      entry = entry ?? locateWorktreeByBranch(entries, inputBranch)

      if (!entry?.path) {
        const directoryExists = yield* fs.exists(directory).pipe(Effect.orDie)
        if (directoryExists) {
          if (inputBranch && !inputBranch.startsWith("opencode/")) {
            return yield* new RemoveFailedError({
              message: `Refusing to remove worktree with non-opencode branch: ${inputBranch}`,
            })
          }
          if (inputBranch?.startsWith("opencode/")) {
            return yield* new RemoveFailedError({
              message: "Worktree is still checked out but was not found in the git worktree registry",
            })
          }
          yield* stopFsmonitor(directory)
          const cleanup = yield* cleanDirectory(directory)
          yield* removeSandboxRecords([input.directory, directory])
          return removed(cleanup)
        }
        yield* removeSandboxRecords([input.directory, directory])
        return removed()
      }

      const branch = yield* worktreeBranch(entry.path, entry.branch)
      if (branch && !branch.startsWith("opencode/")) {
        return yield* new RemoveFailedError({
          message: `Refusing to remove worktree with non-opencode branch: ${branch}`,
        })
      }

      yield* store
        .dispose({ directory: entry.path, worktree: entry.path, project: ctx.project })
        .pipe(Effect.catchCause(() => Effect.void))
      yield* stopFsmonitor(entry.path)
      const gitRemoved = yield* git(["worktree", "remove", "--force", entry.path], { cwd: ctx.worktree })
      if (gitRemoved.code !== 0) {
        const next = yield* git(["worktree", "list", "--porcelain"], { cwd: ctx.worktree })
        if (next.code !== 0) {
          return yield* new RemoveFailedError({
            message: successMessage(gitRemoved, successMessage(next, "Failed to remove git worktree")),
          })
        }

        const nextEntries = parseWorktreeList(next.text)
        const stale =
          (yield* locateWorktree(nextEntries, lookupDirectory)) ?? locateWorktreeByBranch(nextEntries, branch)
        if (stale?.path) {
          return yield* new RemoveFailedError({
            message: successMessage(gitRemoved, "Failed to remove git worktree"),
          })
        }
      }

      const next = yield* git(["worktree", "list", "--porcelain"], { cwd: ctx.worktree })
      if (next.code !== 0) {
        return yield* new RemoveFailedError({
          message: successMessage(next, "Failed to verify git worktree removal"),
        })
      }
      const nextEntries = parseWorktreeList(next.text)
      const stale = (yield* locateWorktree(nextEntries, lookupDirectory)) ?? locateWorktreeByBranch(nextEntries, branch)
      if (stale?.path) {
        return yield* new RemoveFailedError({ message: "Git worktree remains registered after removal" })
      }

      yield* deleteBranch(branch)

      const cleanup = yield* cleanDirectory(entry.path)
      yield* removeSandboxRecords([input.directory, directory, entry.path])
      return removed(cleanup)
    })

    const gitExpect = Effect.fnUntraced(function* (
      args: string[],
      opts: { cwd: string },
      error: (r: GitResult) => Error,
    ) {
      const result = yield* git(args, opts)
      if (result.code !== 0) return yield* error(result)
      return result
    })

    const runStartCommand = Effect.fnUntraced(
      function* (directory: string, cmd: string) {
        const [shell, args] = process.platform === "win32" ? ["cmd", ["/c", cmd]] : ["bash", ["-lc", cmd]]
        const result = yield* appProcess.run(
          ChildProcess.make(shell, args as string[], { cwd: directory, extendEnv: true, stdin: "ignore" }),
        )
        return { code: result.exitCode, stderr: result.stderr.toString("utf8") }
      },
      Effect.catch(() => Effect.succeed({ code: 1, stderr: "" })),
    )

    const runStartScript = Effect.fnUntraced(function* (directory: string, cmd: string, kind: string) {
      const text = cmd.trim()
      if (!text) return true
      const result = yield* runStartCommand(directory, text)
      if (result.code === 0) return true
      log.error("worktree start command failed", { kind, directory, message: result.stderr })
      return false
    })

    const runStartScripts = Effect.fnUntraced(function* (
      directory: string,
      input: { projectID: ProjectV2.ID; extra?: string },
    ) {
      const row = yield* db
        .select()
        .from(ProjectTable)
        .where(eq(ProjectTable.id, input.projectID))
        .get()
        .pipe(Effect.orDie)
      const project = row ? Project.fromRow(row) : undefined
      const startup = project?.commands?.start?.trim() ?? ""
      const ok = yield* runStartScript(directory, startup, "project")
      if (!ok) return false
      yield* runStartScript(directory, input.extra ?? "", "worktree")
      return true
    })

    const prune = Effect.fnUntraced(function* (root: string, entries: string[]) {
      const base = yield* canonical(root)
      yield* Effect.forEach(
        entries,
        (entry) =>
          Effect.gen(function* () {
            const target = yield* canonical(pathSvc.resolve(root, entry))
            if (target === base) return
            if (!target.startsWith(`${base}${pathSvc.sep}`)) return
            yield* fs.remove(target, { recursive: true }).pipe(Effect.ignore)
          }),
        { concurrency: "unbounded" },
      )
    })

    const sweep = Effect.fnUntraced(function* (root: string) {
      const first = yield* git(["clean", "-ffdx"], { cwd: root })
      if (first.code === 0) return first

      const entries = failedRemoves(first.stderr, first.text)
      if (!entries.length) return first

      yield* prune(root, entries)
      return yield* git(["clean", "-ffdx"], { cwd: root })
    })

    const reset = Effect.fn("Worktree.reset")(function* (input: ResetInput) {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") {
        return yield* new NotGitError({ message: "Worktrees are only supported for git projects" })
      }

      const inputDirectory = yield* canonical(input.directory)
      const directory = (yield* gitTopLevel(input.directory)) ?? inputDirectory
      const primary = yield* canonical(ctx.worktree)
      if (directory === primary) {
        return yield* new ResetFailedError({ message: "Cannot reset the primary workspace" })
      }

      const list = yield* git(["worktree", "list", "--porcelain"], { cwd: ctx.worktree })
      if (list.code !== 0) {
        return yield* new ResetFailedError({ message: list.stderr || list.text || "Failed to read git worktrees" })
      }

      const entry = yield* locateWorktree(parseWorktreeList(list.text), directory)
      if (!entry?.path) {
        return yield* new ResetFailedError({ message: "Worktree not found" })
      }

      const worktreePath = entry.path

      const base = yield* gitSvc.defaultBranch(ctx.worktree)
      if (!base) {
        return yield* new ResetFailedError({ message: "Default branch not found" })
      }

      const sep = base.ref.indexOf("/")
      if (base.ref !== base.name && sep > 0) {
        const remote = base.ref.slice(0, sep)
        const branch = base.ref.slice(sep + 1)
        yield* gitExpect(
          ["fetch", remote, branch],
          { cwd: ctx.worktree },
          (r) => new ResetFailedError({ message: r.stderr || r.text || `Failed to fetch ${base.ref}` }),
        )
      }

      yield* gitExpect(
        ["reset", "--hard", base.ref],
        { cwd: worktreePath },
        (r) => new ResetFailedError({ message: r.stderr || r.text || "Failed to reset worktree to target" }),
      )

      const cleanResult = yield* sweep(worktreePath)
      if (cleanResult.code !== 0) {
        return yield* new ResetFailedError({
          message: cleanResult.stderr || cleanResult.text || "Failed to clean worktree",
        })
      }

      yield* gitExpect(
        ["submodule", "update", "--init", "--recursive", "--force"],
        { cwd: worktreePath },
        (r) => new ResetFailedError({ message: r.stderr || r.text || "Failed to update submodules" }),
      )

      yield* gitExpect(
        ["submodule", "foreach", "--recursive", "git", "reset", "--hard"],
        { cwd: worktreePath },
        (r) => new ResetFailedError({ message: r.stderr || r.text || "Failed to reset submodules" }),
      )

      yield* gitExpect(
        ["submodule", "foreach", "--recursive", "git", "clean", "-fdx"],
        { cwd: worktreePath },
        (r) => new ResetFailedError({ message: r.stderr || r.text || "Failed to clean submodules" }),
      )

      const status = yield* git(["-c", "core.fsmonitor=false", "status", "--porcelain=v1"], { cwd: worktreePath })
      if (status.code !== 0) {
        return yield* new ResetFailedError({ message: status.stderr || status.text || "Failed to read git status" })
      }

      if (status.text.trim()) {
        return yield* new ResetFailedError({ message: `Worktree reset left local changes:\n${status.text.trim()}` })
      }

      yield* runStartScripts(worktreePath, { projectID: ctx.project.id }).pipe(
        Effect.catchCause((cause) => Effect.sync(() => log.error("worktree start task failed", { cause }))),
        Effect.forkIn(scope),
      )

      return true
    })

    return Service.of({ makeWorktreeInfo, createFromInfo, create, list, remove, reset })
  }),
)

export const appLayer = layer.pipe(
  Layer.provide(Git.defaultLayer),
  Layer.provide(AppProcess.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(NodePath.layer),
)

export const defaultLayer = appLayer.pipe(Layer.provide(InstanceLayer.layer))

export * as Worktree from "."
