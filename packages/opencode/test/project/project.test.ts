import { describe, expect, test } from "bun:test"
import { Bus } from "@/bus"
import { Project } from "@/project/project"
import * as Log from "@opencode-ai/core/util/log"
import { $ } from "bun"
import path from "path"
import { tmpdirScoped } from "../fixture/fixture"
import { GlobalBus } from "../../src/bus/global"
import { ProjectID } from "../../src/project/schema"
import { Cause, Effect, Exit, Layer, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { NodePath } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const encoder = new TextEncoder()

const layer = Layer.mergeAll(Project.defaultLayer, CrossSpawnSpawner.defaultLayer)
const it = testEffect(layer)

function run<A>(fn: (svc: Project.Interface) => Effect.Effect<A>) {
  return Effect.gen(function* () {
    const svc = yield* Project.Service
    return yield* fn(svc)
  })
}

function gitTmpdir() {
  return Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.promise(() => $`git init`.cwd(tmp).quiet())
    yield* Effect.promise(() => $`git config core.fsmonitor false`.cwd(tmp).quiet())
    yield* Effect.promise(() => $`git config commit.gpgsign false`.cwd(tmp).quiet())
    yield* Effect.promise(() => $`git config user.email "test@opencode.test"`.cwd(tmp).quiet())
    yield* Effect.promise(() => $`git config user.name "Test"`.cwd(tmp).quiet())
    yield* Effect.promise(() => $`git commit --allow-empty -m ${`root commit ${tmp}`}`.cwd(tmp).quiet())
    return tmp
  })
}

/**
 * Creates a mock ChildProcessSpawner layer that intercepts git subcommands
 * matching `failArg` and returns exit code 128, while delegating everything
 * else to the real CrossSpawnSpawner.
 */
function mockGitFailure(failArg: string) {
  return Layer.effect(
    ChildProcessSpawner.ChildProcessSpawner,
    Effect.gen(function* () {
      const real = yield* ChildProcessSpawner.ChildProcessSpawner
      return ChildProcessSpawner.make(
        Effect.fnUntraced(function* (command) {
          const std = ChildProcess.isStandardCommand(command) ? command : undefined
          if (std?.command === "git" && std.args.some((a) => a === failArg)) {
            return ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(0),
              exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(128)),
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
              stdout: Stream.empty,
              stderr: Stream.make(encoder.encode("fatal: simulated failure\n")),
              all: Stream.empty,
              getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void),
            })
          }
          return yield* real.spawn(command)
        }),
      )
    }),
  ).pipe(Layer.provide(CrossSpawnSpawner.defaultLayer))
}

function projectLayerWithFailure(failArg: string) {
  return Project.layer.pipe(
    Layer.provide(mockGitFailure(failArg)),
    Layer.provide(Bus.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(NodePath.layer),
  )
}

const failureIt = (failArg: string) =>
  testEffect(Layer.mergeAll(projectLayerWithFailure(failArg), CrossSpawnSpawner.defaultLayer))

describe("Project.fromDirectory", () => {
  it.live("should handle git repository with no commits", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* Effect.promise(() => $`git init`.cwd(tmp).quiet())

      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      expect(project).toBeDefined()
      expect(project.id).toBe(ProjectID.global)
      expect(project.vcs).toBe("git")
      expect(project.worktree).toBe(tmp)

      const opencodeFile = path.join(tmp, ".git", "opencode")
      expect(yield* Effect.promise(() => Bun.file(opencodeFile).exists())).toBe(false)
    }),
  )

  it.live("should handle git repository with commits", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()

      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      expect(project).toBeDefined()
      expect(project.id).not.toBe(ProjectID.global)
      expect(project.vcs).toBe("git")
      expect(project.worktree).toBe(tmp)

      const opencodeFile = path.join(tmp, ".git", "opencode")
      expect(yield* Effect.promise(() => Bun.file(opencodeFile).exists())).toBe(true)
    }),
  )

  it.live("returns global for non-git directory", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))
      expect(project.id).toBe(ProjectID.global)
    }),
  )

  it.live("derives stable project ID from root commit", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project: a } = yield* run((svc) => svc.fromDirectory(tmp))
      const { project: b } = yield* run((svc) => svc.fromDirectory(tmp))
      expect(b.id).toBe(a.id)
    }),
  )
})

describe("Project.fromDirectory git failure paths", () => {
  it.live("keeps vcs when rev-list exits non-zero (no commits)", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* Effect.promise(() => $`git init`.cwd(tmp).quiet())

      // rev-list fails because HEAD doesn't exist yet: this is the natural scenario.
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))
      expect(project.vcs).toBe("git")
      expect(project.id).toBe(ProjectID.global)
      expect(project.worktree).toBe(tmp)
    }),
  )

  failureIt("--show-toplevel").live("handles show-toplevel failure gracefully", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()

      const { project, sandbox } = yield* run((svc) => svc.fromDirectory(tmp))
      expect(project.worktree).toBe(tmp)
      expect(sandbox).toBe(tmp)
    }),
  )

  failureIt("--git-common-dir").live("handles git-common-dir failure gracefully", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()

      const { project, sandbox } = yield* run((svc) => svc.fromDirectory(tmp))
      expect(project.worktree).toBe(tmp)
      expect(sandbox).toBe(tmp)
    }),
  )
})

describe("Project.fromDirectory with worktrees", () => {
  it.live("should set worktree to root when called from root", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()

      const { project, sandbox } = yield* run((svc) => svc.fromDirectory(tmp))

      expect(project.worktree).toBe(tmp)
      expect(sandbox).toBe(tmp)
      expect(project.sandboxes).not.toContain(tmp)
    }),
  )

  it.live("should set worktree to root when called from a worktree", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()

      const worktreePath = path.join(tmp, "..", path.basename(tmp) + "-worktree")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          $`git worktree remove ${worktreePath}`
            .cwd(tmp)
            .quiet()
            .catch(() => {}),
        ),
      )
      yield* Effect.promise(() => $`git worktree add ${worktreePath} -b test-branch-${Date.now()}`.cwd(tmp).quiet())

      const { project, sandbox } = yield* run((svc) => svc.fromDirectory(worktreePath))

      expect(project.worktree).toBe(tmp)
      expect(sandbox).toBe(worktreePath)
      expect(project.sandboxes).toContain(worktreePath)
      expect(project.sandboxes).not.toContain(tmp)
    }),
  )

  it.live("worktree should share project ID with main repo", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()

      const { project: main } = yield* run((svc) => svc.fromDirectory(tmp))

      const worktreePath = path.join(tmp, "..", path.basename(tmp) + "-wt-shared")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          $`git worktree remove ${worktreePath}`
            .cwd(tmp)
            .quiet()
            .catch(() => {}),
        ),
      )
      yield* Effect.promise(() => $`git worktree add ${worktreePath} -b shared-${Date.now()}`.cwd(tmp).quiet())

      const { project: wt } = yield* run((svc) => svc.fromDirectory(worktreePath))

      expect(wt.id).toBe(main.id)

      // Cache should live in the common .git dir, not the worktree's .git file
      const cache = path.join(tmp, ".git", "opencode")
      const exists = yield* Effect.promise(() => Bun.file(cache).exists())
      expect(exists).toBe(true)
    }),
  )

  it.live("separate clones of the same repo should share project ID", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()

      // Create a bare remote, push, then clone into a second directory
      const bare = tmp + "-bare"
      const clone = tmp + "-clone"
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${bare} ${clone}`.quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git clone --bare ${tmp} ${bare}`.quiet())
      yield* Effect.promise(() => $`git clone ${bare} ${clone}`.quiet())

      const { project: a } = yield* run((svc) => svc.fromDirectory(tmp))
      const { project: b } = yield* run((svc) => svc.fromDirectory(clone))

      expect(b.id).toBe(a.id)
    }),
  )

  it.live("should accumulate multiple worktrees in sandboxes", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()

      const worktree1 = path.join(tmp, "..", path.basename(tmp) + "-wt1")
      const worktree2 = path.join(tmp, "..", path.basename(tmp) + "-wt2")
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            $`git worktree remove ${worktree1}`
              .cwd(tmp)
              .quiet()
              .catch(() => {}),
          )
          yield* Effect.promise(() =>
            $`git worktree remove ${worktree2}`
              .cwd(tmp)
              .quiet()
              .catch(() => {}),
          )
        }),
      )
      yield* Effect.promise(() => $`git worktree add ${worktree1} -b branch-${Date.now()}`.cwd(tmp).quiet())
      yield* Effect.promise(() => $`git worktree add ${worktree2} -b branch-${Date.now() + 1}`.cwd(tmp).quiet())

      yield* run((svc) => svc.fromDirectory(worktree1))
      const { project } = yield* run((svc) => svc.fromDirectory(worktree2))

      expect(project.worktree).toBe(tmp)
      expect(project.sandboxes).toContain(worktree1)
      expect(project.sandboxes).toContain(worktree2)
      expect(project.sandboxes).not.toContain(tmp)
    }),
  )
})

describe("Project.discover", () => {
  it.live("should discover favicon.png in root", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      yield* Effect.promise(() => Bun.write(path.join(tmp, "favicon.png"), pngData))

      yield* run((svc) => svc.discover(project))

      const updated = Project.get(project.id)
      expect(updated).toBeDefined()
      expect(updated!.icon).toBeDefined()
      expect(updated!.icon?.url).toStartWith("data:")
      expect(updated!.icon?.url).toContain("base64")
      expect(updated!.icon?.color).toBeUndefined()
    }),
  )

  it.live("should not discover non-image files", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      yield* Effect.promise(() => Bun.write(path.join(tmp, "favicon.txt"), "not an image"))

      yield* run((svc) => svc.discover(project))

      const updated = Project.get(project.id)
      expect(updated).toBeDefined()
      expect(updated!.icon).toBeUndefined()
    }),
  )

  it.live("should not discover favicon when override is set", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      yield* run((svc) =>
        svc.update({
          projectID: project.id,
          icon: { override: "data:image/png;base64,override" },
        }),
      )

      const updatedProject = yield* run((svc) => svc.get(project.id))
      if (!updatedProject) throw new Error("Project not found")

      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      yield* Effect.promise(() => Bun.write(path.join(tmp, "favicon.png"), pngData))

      yield* run((svc) => svc.discover(updatedProject))

      const updated = Project.get(project.id)
      expect(updated).toBeDefined()
      expect(updated!.icon?.override).toBe("data:image/png;base64,override")
      expect(updated!.icon?.url).toBeUndefined()
    }),
  )
})

describe("Project.update", () => {
  it.live("should update name", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      const updated = yield* run((svc) =>
        svc.update({
          projectID: project.id,
          name: "New Project Name",
        }),
      )

      expect(updated.name).toBe("New Project Name")

      const fromDb = Project.get(project.id)
      expect(fromDb?.name).toBe("New Project Name")
    }),
  )

  it.live("should update icon url", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      const updated = yield* run((svc) =>
        svc.update({
          projectID: project.id,
          icon: { url: "https://example.com/icon.png" },
        }),
      )

      expect(updated.icon?.url).toBe("https://example.com/icon.png")

      const fromDb = Project.get(project.id)
      expect(fromDb?.icon?.url).toBe("https://example.com/icon.png")
    }),
  )

  it.live("should update icon color", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      const updated = yield* run((svc) =>
        svc.update({
          projectID: project.id,
          icon: { color: "#ff0000" },
        }),
      )

      expect(updated.icon?.color).toBe("#ff0000")

      const fromDb = Project.get(project.id)
      expect(fromDb?.icon?.color).toBe("#ff0000")
    }),
  )

  it.live("should update icon override", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      const updated = yield* run((svc) =>
        svc.update({
          projectID: project.id,
          icon: { override: "data:image/png;base64,abc123" },
        }),
      )

      expect(updated.icon?.override).toBe("data:image/png;base64,abc123")

      const fromDb = Project.get(project.id)
      expect(fromDb?.icon?.override).toBe("data:image/png;base64,abc123")
    }),
  )

  it.live("should update commands", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      const updated = yield* run((svc) =>
        svc.update({
          projectID: project.id,
          commands: { start: "npm run dev" },
        }),
      )

      expect(updated.commands?.start).toBe("npm run dev")

      const fromDb = Project.get(project.id)
      expect(fromDb?.commands?.start).toBe("npm run dev")
    }),
  )

  it.live("should throw error when project not found", () =>
    Effect.gen(function* () {
      const exit = yield* run((svc) =>
        svc.update({
          projectID: ProjectID.make("nonexistent-project-id"),
          name: "Should Fail",
        }),
      ).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error instanceof Error ? error.message : String(error)).toContain(
          "Project not found: nonexistent-project-id",
        )
      }
    }),
  )

  it.live("should emit GlobalBus event on update", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      let eventPayload: any = null
      const on = (data: any) => {
        eventPayload = data
      }
      GlobalBus.on("event", on)
      yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", on)))

      yield* run((svc) => svc.update({ projectID: project.id, name: "Updated Name" }))

      expect(eventPayload).not.toBeNull()
      expect(eventPayload.payload.type).toBe("project.updated")
      expect(eventPayload.payload.properties.name).toBe("Updated Name")
    }),
  )

  it.live("should update multiple fields at once", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      const updated = yield* run((svc) =>
        svc.update({
          projectID: project.id,
          name: "Multi Update",
          icon: { url: "https://example.com/favicon.ico", override: "data:image/png;base64,abc123", color: "#00ff00" },
          commands: { start: "make start" },
        }),
      )

      expect(updated.name).toBe("Multi Update")
      expect(updated.icon?.url).toBe("https://example.com/favicon.ico")
      expect(updated.icon?.override).toBe("data:image/png;base64,abc123")
      expect(updated.icon?.color).toBe("#00ff00")
      expect(updated.commands?.start).toBe("make start")
    }),
  )
})

describe("Project.list and Project.get", () => {
  it.live("list returns all projects", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      const all = Project.list()
      expect(all.length).toBeGreaterThan(0)
      expect(all.find((p) => p.id === project.id)).toBeDefined()
    }),
  )

  it.live("get returns project by id", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      const found = Project.get(project.id)
      expect(found).toBeDefined()
      expect(found!.id).toBe(project.id)
    }),
  )

  test("get returns undefined for unknown id", () => {
    const found = Project.get(ProjectID.make("nonexistent"))
    expect(found).toBeUndefined()
  })
})

describe("Project.setInitialized", () => {
  it.live("sets time_initialized on project", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))

      expect(project.time.initialized).toBeUndefined()

      Project.setInitialized(project.id)

      const updated = Project.get(project.id)
      expect(updated?.time.initialized).toBeDefined()
    }),
  )
})

describe("Project.addSandbox and Project.removeSandbox", () => {
  it.live("addSandbox adds directory and removeSandbox removes it", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))
      const sandboxDir = path.join(tmp, "sandbox-test")

      yield* run((svc) => svc.addSandbox(project.id, sandboxDir))

      let found = Project.get(project.id)
      expect(found?.sandboxes).toContain(sandboxDir)

      yield* run((svc) => svc.removeSandbox(project.id, sandboxDir))

      found = Project.get(project.id)
      expect(found?.sandboxes).not.toContain(sandboxDir)
    }),
  )

  it.live("addSandbox emits GlobalBus event", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()
      const { project } = yield* run((svc) => svc.fromDirectory(tmp))
      const sandboxDir = path.join(tmp, "sandbox-event")

      const events: any[] = []
      const on = (evt: any) => events.push(evt)
      GlobalBus.on("event", on)
      yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", on)))

      yield* run((svc) => svc.addSandbox(project.id, sandboxDir))

      expect(events.some((e) => e.payload.type === Project.Event.Updated.type)).toBe(true)
    }),
  )
})

describe("Project.fromDirectory with bare repos", () => {
  it.live("worktree from bare repo should cache in bare repo, not parent", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()

      const parentDir = path.dirname(tmp)
      const barePath = path.join(parentDir, `bare-${Date.now()}.git`)
      const worktreePath = path.join(parentDir, `worktree-${Date.now()}`)
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${barePath} ${worktreePath}`.quiet().nothrow()).pipe(Effect.ignore),
      )

      yield* Effect.promise(() => $`git clone --bare ${tmp} ${barePath}`.quiet())
      yield* Effect.promise(() => $`git worktree add ${worktreePath} HEAD`.cwd(barePath).quiet())

      const { project } = yield* run((svc) => svc.fromDirectory(worktreePath))

      expect(project.id).not.toBe(ProjectID.global)
      expect(project.worktree).toBe(barePath)

      const correctCache = path.join(barePath, "opencode")
      const wrongCache = path.join(parentDir, ".git", "opencode")

      expect(yield* Effect.promise(() => Bun.file(correctCache).exists())).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(wrongCache).exists())).toBe(false)
    }),
  )

  it.live("different bare repos under same parent should not share project ID", () =>
    Effect.gen(function* () {
      const tmp1 = yield* gitTmpdir()
      const tmp2 = yield* gitTmpdir()

      const parentDir = path.dirname(tmp1)
      const bareA = path.join(parentDir, `bare-a-${Date.now()}.git`)
      const bareB = path.join(parentDir, `bare-b-${Date.now()}.git`)
      const worktreeA = path.join(parentDir, `wt-a-${Date.now()}`)
      const worktreeB = path.join(parentDir, `wt-b-${Date.now()}`)
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${bareA} ${bareB} ${worktreeA} ${worktreeB}`.quiet().nothrow()).pipe(
          Effect.ignore,
        ),
      )

      yield* Effect.promise(() => $`git clone --bare ${tmp1} ${bareA}`.quiet())
      yield* Effect.promise(() => $`git clone --bare ${tmp2} ${bareB}`.quiet())
      yield* Effect.promise(() => $`git worktree add ${worktreeA} HEAD`.cwd(bareA).quiet())
      yield* Effect.promise(() => $`git worktree add ${worktreeB} HEAD`.cwd(bareB).quiet())

      const { project: projA } = yield* run((svc) => svc.fromDirectory(worktreeA))
      const { project: projB } = yield* run((svc) => svc.fromDirectory(worktreeB))

      expect(projA.id).not.toBe(projB.id)

      const cacheA = path.join(bareA, "opencode")
      const cacheB = path.join(bareB, "opencode")
      const wrongCache = path.join(parentDir, ".git", "opencode")

      expect(yield* Effect.promise(() => Bun.file(cacheA).exists())).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(cacheB).exists())).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(wrongCache).exists())).toBe(false)
    }),
  )

  it.live("bare repo without .git suffix is still detected via core.bare", () =>
    Effect.gen(function* () {
      const tmp = yield* gitTmpdir()

      const parentDir = path.dirname(tmp)
      const barePath = path.join(parentDir, `bare-no-suffix-${Date.now()}`)
      const worktreePath = path.join(parentDir, `worktree-${Date.now()}`)
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${barePath} ${worktreePath}`.quiet().nothrow()).pipe(Effect.ignore),
      )

      yield* Effect.promise(() => $`git clone --bare ${tmp} ${barePath}`.quiet())
      yield* Effect.promise(() => $`git worktree add ${worktreePath} HEAD`.cwd(barePath).quiet())

      const { project } = yield* run((svc) => svc.fromDirectory(worktreePath))

      expect(project.id).not.toBe(ProjectID.global)
      expect(project.worktree).toBe(barePath)

      const correctCache = path.join(barePath, "opencode")
      expect(yield* Effect.promise(() => Bun.file(correctCache).exists())).toBe(true)
    }),
  )
})
