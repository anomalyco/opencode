import { describe, expect, test } from "bun:test"
import { Project } from "@/project/project"
import * as Log from "@opencode-ai/core/util/log"
import { $ } from "bun"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { GlobalBus } from "../../src/bus/global"
import { ProjectID } from "../../src/project/schema"
import { Effect, Layer, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { NodePath } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

void Log.init({ print: false })

const encoder = new TextEncoder()

function run<A>(fn: (svc: Project.Interface) => Effect.Effect<A>, layer = Project.defaultLayer) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* Project.Service
      return yield* fn(svc)
    }).pipe(Effect.provide(layer)),
  )
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
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(NodePath.layer),
  )
}

describe("Project.fromDirectory", () => {
  test("should handle git repository with no commits", async () => {
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    expect(project).toBeDefined()
    expect(project.id).toBe(ProjectID.global)
    expect(project.vcs).toBe("git")
    expect(project.worktree).toBe(tmp.path)

    const opencodeFile = path.join(tmp.path, ".git", "opencode")
    expect(await Bun.file(opencodeFile).exists()).toBe(false)
  })

  test("should handle git repository with commits", async () => {
    await using tmp = await tmpdir({ git: true })

    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    expect(project).toBeDefined()
    expect(project.id).not.toBe(ProjectID.global)
    expect(project.vcs).toBe("git")
    expect(project.worktree).toBe(tmp.path)

    const opencodeFile = path.join(tmp.path, ".git", "opencode")
    expect(await Bun.file(opencodeFile).exists()).toBe(true)
  })

  test("returns global for non-git directory", async () => {
    await using tmp = await tmpdir()
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(project.id).toBe(ProjectID.global)
  })

  test("derives stable project ID from root commit", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project: a } = await run((svc) => svc.fromDirectory(tmp.path))
    const { project: b } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(b.id).toBe(a.id)
  })
})

describe("Project.fromDirectory git failure paths", () => {
  test("keeps vcs when rev-list exits non-zero (no commits)", async () => {
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    // rev-list fails because HEAD doesn't exist yet — this is the natural scenario
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(project.vcs).toBe("git")
    expect(project.id).toBe(ProjectID.global)
    expect(project.worktree).toBe(tmp.path)
  })

  test("handles show-toplevel failure gracefully", async () => {
    await using tmp = await tmpdir({ git: true })
    const layer = projectLayerWithFailure("--show-toplevel")

    const { project, sandbox } = await run((svc) => svc.fromDirectory(tmp.path), layer)
    expect(project.worktree).toBe(tmp.path)
    expect(sandbox).toBe(tmp.path)
  })

  test("handles git-common-dir failure gracefully", async () => {
    await using tmp = await tmpdir({ git: true })
    const layer = projectLayerWithFailure("--git-common-dir")

    const { project, sandbox } = await run((svc) => svc.fromDirectory(tmp.path), layer)
    expect(project.worktree).toBe(tmp.path)
    expect(sandbox).toBe(tmp.path)
  })
})

describe("Project.fromDirectory with worktrees", () => {
  test("should set worktree to root when called from root", async () => {
    await using tmp = await tmpdir({ git: true })

    const { project, sandbox } = await run((svc) => svc.fromDirectory(tmp.path))

    expect(project.worktree).toBe(tmp.path)
    expect(sandbox).toBe(tmp.path)
    expect(project.sandboxes).not.toContain(tmp.path)
  })

  test("should set worktree to root when called from a worktree", async () => {
    await using tmp = await tmpdir({ git: true })

    const worktreePath = path.join(tmp.path, "..", path.basename(tmp.path) + "-worktree")
    try {
      await $`git worktree add ${worktreePath} -b test-branch-${Date.now()}`.cwd(tmp.path).quiet()

      const { project, sandbox } = await run((svc) => svc.fromDirectory(worktreePath))

      expect(project.worktree).toBe(tmp.path)
      expect(sandbox).toBe(worktreePath)
      expect(project.sandboxes).toContain(worktreePath)
      expect(project.sandboxes).not.toContain(tmp.path)
    } finally {
      await $`git worktree remove ${worktreePath}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
    }
  })

  test("worktree should share project ID with main repo", async () => {
    await using tmp = await tmpdir({ git: true })

    const { project: main } = await run((svc) => svc.fromDirectory(tmp.path))

    const worktreePath = path.join(tmp.path, "..", path.basename(tmp.path) + "-wt-shared")
    try {
      await $`git worktree add ${worktreePath} -b shared-${Date.now()}`.cwd(tmp.path).quiet()

      const { project: wt } = await run((svc) => svc.fromDirectory(worktreePath))

      expect(wt.id).toBe(main.id)

      // Cache should live in the common .git dir, not the worktree's .git file
      const cache = path.join(tmp.path, ".git", "opencode")
      const exists = await Bun.file(cache).exists()
      expect(exists).toBe(true)
    } finally {
      await $`git worktree remove ${worktreePath}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
    }
  })

  test("separate clones of the same repo should share project ID", async () => {
    await using tmp = await tmpdir({ git: true })

    // Create a bare remote, push, then clone into a second directory
    const bare = tmp.path + "-bare"
    const clone = tmp.path + "-clone"
    try {
      await $`git clone --bare ${tmp.path} ${bare}`.quiet()
      await $`git clone ${bare} ${clone}`.quiet()

      const { project: a } = await run((svc) => svc.fromDirectory(tmp.path))
      const { project: b } = await run((svc) => svc.fromDirectory(clone))

      expect(b.id).toBe(a.id)
    } finally {
      await $`rm -rf ${bare} ${clone}`.quiet().nothrow()
    }
  })

  test("should accumulate multiple worktrees in sandboxes", async () => {
    await using tmp = await tmpdir({ git: true })

    const worktree1 = path.join(tmp.path, "..", path.basename(tmp.path) + "-wt1")
    const worktree2 = path.join(tmp.path, "..", path.basename(tmp.path) + "-wt2")
    try {
      await $`git worktree add ${worktree1} -b branch-${Date.now()}`.cwd(tmp.path).quiet()
      await $`git worktree add ${worktree2} -b branch-${Date.now() + 1}`.cwd(tmp.path).quiet()

      await run((svc) => svc.fromDirectory(worktree1))
      const { project } = await run((svc) => svc.fromDirectory(worktree2))

      expect(project.worktree).toBe(tmp.path)
      expect(project.sandboxes).toContain(worktree1)
      expect(project.sandboxes).toContain(worktree2)
      expect(project.sandboxes).not.toContain(tmp.path)
    } finally {
      await $`git worktree remove ${worktree1}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
      await $`git worktree remove ${worktree2}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
    }
  })
})

describe("Project.discover", () => {
  test("should discover favicon.png in root", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await Bun.write(path.join(tmp.path, "favicon.png"), pngData)

    await run((svc) => svc.discover(project))

    const updated = Project.get(project.id)
    expect(updated).toBeDefined()
    expect(updated!.icon).toBeDefined()
    expect(updated!.icon?.url).toStartWith("data:")
    expect(updated!.icon?.url).toContain("base64")
    expect(updated!.icon?.color).toBeUndefined()
  })

  test("should not discover non-image files", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    await Bun.write(path.join(tmp.path, "favicon.txt"), "not an image")

    await run((svc) => svc.discover(project))

    const updated = Project.get(project.id)
    expect(updated).toBeDefined()
    expect(updated!.icon).toBeUndefined()
  })

  test("should not discover favicon when override is set", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    await run((svc) =>
      svc.update({
        projectID: project.id,
        icon: { override: "data:image/png;base64,override" },
      }),
    )

    const updatedProject = await run((svc) => svc.get(project.id))
    if (!updatedProject) throw new Error("Project not found")

    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await Bun.write(path.join(tmp.path, "favicon.png"), pngData)

    await run((svc) => svc.discover(updatedProject))

    const updated = Project.get(project.id)
    expect(updated).toBeDefined()
    expect(updated!.icon?.override).toBe("data:image/png;base64,override")
    expect(updated!.icon?.url).toBeUndefined()
  })
})

describe("Project.update", () => {
  test("should update name", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    const updated = await run((svc) =>
      svc.update({
        projectID: project.id,
        name: "New Project Name",
      }),
    )

    expect(updated.name).toBe("New Project Name")

    const fromDb = Project.get(project.id)
    expect(fromDb?.name).toBe("New Project Name")
  })

  test("should update icon url", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    const updated = await run((svc) =>
      svc.update({
        projectID: project.id,
        icon: { url: "https://example.com/icon.png" },
      }),
    )

    expect(updated.icon?.url).toBe("https://example.com/icon.png")

    const fromDb = Project.get(project.id)
    expect(fromDb?.icon?.url).toBe("https://example.com/icon.png")
  })

  test("should update icon color", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    const updated = await run((svc) =>
      svc.update({
        projectID: project.id,
        icon: { color: "#ff0000" },
      }),
    )

    expect(updated.icon?.color).toBe("#ff0000")

    const fromDb = Project.get(project.id)
    expect(fromDb?.icon?.color).toBe("#ff0000")
  })

  test("should update icon override", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    const updated = await run((svc) =>
      svc.update({
        projectID: project.id,
        icon: { override: "data:image/png;base64,abc123" },
      }),
    )

    expect(updated.icon?.override).toBe("data:image/png;base64,abc123")

    const fromDb = Project.get(project.id)
    expect(fromDb?.icon?.override).toBe("data:image/png;base64,abc123")
  })

  test("should update commands", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    const updated = await run((svc) =>
      svc.update({
        projectID: project.id,
        commands: { start: "npm run dev" },
      }),
    )

    expect(updated.commands?.start).toBe("npm run dev")

    const fromDb = Project.get(project.id)
    expect(fromDb?.commands?.start).toBe("npm run dev")
  })

  test("should throw error when project not found", async () => {
    await expect(
      run((svc) =>
        svc.update({
          projectID: ProjectID.make("nonexistent-project-id"),
          name: "Should Fail",
        }),
      ),
    ).rejects.toThrow("Project not found: nonexistent-project-id")
  })

  test("should emit GlobalBus event on update", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    let eventPayload: any = null
    const on = (data: any) => {
      eventPayload = data
    }
    GlobalBus.on("event", on)

    try {
      await run((svc) => svc.update({ projectID: project.id, name: "Updated Name" }))

      expect(eventPayload).not.toBeNull()
      expect(eventPayload.payload.type).toBe("project.updated")
      expect(eventPayload.payload.properties.name).toBe("Updated Name")
    } finally {
      GlobalBus.off("event", on)
    }
  })

  test("should update multiple fields at once", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    const updated = await run((svc) =>
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
  })
})

describe("Project.list and Project.get", () => {
  test("list returns all projects", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    const all = Project.list()
    expect(all.length).toBeGreaterThan(0)
    expect(all.find((p) => p.id === project.id)).toBeDefined()
  })

  test("get returns project by id", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    const found = Project.get(project.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(project.id)
  })

  test("get returns undefined for unknown id", () => {
    const found = Project.get(ProjectID.make("nonexistent"))
    expect(found).toBeUndefined()
  })
})

describe("Project.setInitialized", () => {
  test("sets time_initialized on project", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))

    expect(project.time.initialized).toBeUndefined()

    Project.setInitialized(project.id)

    const updated = Project.get(project.id)
    expect(updated?.time.initialized).toBeDefined()
  })
})

describe("Project.addSandbox and Project.removeSandbox", () => {
  test("addSandbox adds directory and removeSandbox removes it", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    const sandboxDir = path.join(tmp.path, "sandbox-test")

    await run((svc) => svc.addSandbox(project.id, sandboxDir))

    let found = Project.get(project.id)
    expect(found?.sandboxes).toContain(sandboxDir)

    await run((svc) => svc.removeSandbox(project.id, sandboxDir))

    found = Project.get(project.id)
    expect(found?.sandboxes).not.toContain(sandboxDir)
  })

  test("addSandbox emits GlobalBus event", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    const sandboxDir = path.join(tmp.path, "sandbox-event")

    const events: any[] = []
    const on = (evt: any) => events.push(evt)
    GlobalBus.on("event", on)

    await run((svc) => svc.addSandbox(project.id, sandboxDir))

    GlobalBus.off("event", on)
    expect(events.some((e) => e.payload.type === Project.Event.Updated.type)).toBe(true)
  })
})

describe("Project.fromDirectory with bare repos", () => {
  test("worktree from bare repo should cache in bare repo, not parent", async () => {
    await using tmp = await tmpdir({ git: true })

    const parentDir = path.dirname(tmp.path)
    const barePath = path.join(parentDir, `bare-${Date.now()}.git`)
    const worktreePath = path.join(parentDir, `worktree-${Date.now()}`)

    try {
      await $`git clone --bare ${tmp.path} ${barePath}`.quiet()
      await $`git worktree add ${worktreePath} HEAD`.cwd(barePath).quiet()

      const { project } = await run((svc) => svc.fromDirectory(worktreePath))

      expect(project.id).not.toBe(ProjectID.global)
      expect(project.worktree).toBe(barePath)

      const correctCache = path.join(barePath, "opencode")
      const wrongCache = path.join(parentDir, ".git", "opencode")

      expect(await Bun.file(correctCache).exists()).toBe(true)
      expect(await Bun.file(wrongCache).exists()).toBe(false)
    } finally {
      await $`rm -rf ${barePath} ${worktreePath}`.quiet().nothrow()
    }
  })

  test("different bare repos under same parent should not share project ID", async () => {
    await using tmp1 = await tmpdir({ git: true })
    await using tmp2 = await tmpdir({ git: true })

    const parentDir = path.dirname(tmp1.path)
    const bareA = path.join(parentDir, `bare-a-${Date.now()}.git`)
    const bareB = path.join(parentDir, `bare-b-${Date.now()}.git`)
    const worktreeA = path.join(parentDir, `wt-a-${Date.now()}`)
    const worktreeB = path.join(parentDir, `wt-b-${Date.now()}`)

    try {
      await $`git clone --bare ${tmp1.path} ${bareA}`.quiet()
      await $`git clone --bare ${tmp2.path} ${bareB}`.quiet()
      await $`git worktree add ${worktreeA} HEAD`.cwd(bareA).quiet()
      await $`git worktree add ${worktreeB} HEAD`.cwd(bareB).quiet()

      const { project: projA } = await run((svc) => svc.fromDirectory(worktreeA))
      const { project: projB } = await run((svc) => svc.fromDirectory(worktreeB))

      expect(projA.id).not.toBe(projB.id)

      const cacheA = path.join(bareA, "opencode")
      const cacheB = path.join(bareB, "opencode")
      const wrongCache = path.join(parentDir, ".git", "opencode")

      expect(await Bun.file(cacheA).exists()).toBe(true)
      expect(await Bun.file(cacheB).exists()).toBe(true)
      expect(await Bun.file(wrongCache).exists()).toBe(false)
    } finally {
      await $`rm -rf ${bareA} ${bareB} ${worktreeA} ${worktreeB}`.quiet().nothrow()
    }
  })

  test("bare repo without .git suffix is still detected via core.bare", async () => {
    await using tmp = await tmpdir({ git: true })

    const parentDir = path.dirname(tmp.path)
    const barePath = path.join(parentDir, `bare-no-suffix-${Date.now()}`)
    const worktreePath = path.join(parentDir, `worktree-${Date.now()}`)

    try {
      await $`git clone --bare ${tmp.path} ${barePath}`.quiet()
      await $`git worktree add ${worktreePath} HEAD`.cwd(barePath).quiet()

      const { project } = await run((svc) => svc.fromDirectory(worktreePath))

      expect(project.id).not.toBe(ProjectID.global)
      expect(project.worktree).toBe(barePath)

      const correctCache = path.join(barePath, "opencode")
      expect(await Bun.file(correctCache).exists()).toBe(true)
    } finally {
      await $`rm -rf ${barePath} ${worktreePath}`.quiet().nothrow()
    }
  })
})
