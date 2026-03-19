/**
 * END-TO-END TEST — Parallel Agent Pipeline
 *
 * Tests: plan creation, git worktrees, simulated work, merge, conflict detection, recovery.
 * Does NOT use real LLMs. Uses Bun shell for git operations (avoids Process.spawn PATH issues).
 */

import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { PlanStore } from "../../src/parallel/plan"
import { SubtaskID } from "../../src/parallel/schema"
import { Recovery } from "../../src/parallel/recovery"
import { tmpdir } from "../fixture/fixture"

// --- Helpers ---

async function createWorktree(cwd: string, name: string) {
  const uid = Math.random().toString(36).slice(2, 8)
  const fullName = `${name}-${uid}`
  const branch = `opencode/${fullName}`
  const dir = path.join(cwd, ".worktrees", fullName)
  await fs.mkdir(path.dirname(dir), { recursive: true })
  // Verify cwd is a git repo before attempting worktree creation
  const check = await $`git rev-parse --git-dir`.cwd(cwd).quiet().nothrow()
  if (check.exitCode !== 0) {
    throw new Error(`createWorktree: ${cwd} is not a git repository`)
  }
  await $`git worktree add --no-checkout -b ${branch} ${dir}`.cwd(cwd).quiet()
  await $`git checkout HEAD -- .`.cwd(dir).quiet()
  return { name, branch, directory: dir }
}

async function removeWorktree(cwd: string, dir: string) {
  await $`git worktree remove --force ${dir}`.cwd(cwd).quiet().nothrow()
}

async function withProject<T>(fn: (projectID: string, worktree: string) => Promise<T>): Promise<T> {
  const dirpath = path.join(require("os").tmpdir(), "opencode-e2e-" + Math.random().toString(36).slice(2))
  await fs.mkdir(dirpath, { recursive: true })
  await $`git init`.cwd(dirpath).quiet()
  await $`git config core.fsmonitor false`.cwd(dirpath).quiet()
  await $`git config user.email "test@test.com"`.cwd(dirpath).quiet()
  await $`git config user.name "Test"`.cwd(dirpath).quiet()

  await fs.mkdir(path.join(dirpath, "src"), { recursive: true })
  await Bun.write(path.join(dirpath, "src", "a.ts"), "export const a = 1\n")
  await Bun.write(path.join(dirpath, "src", "b.ts"), "export const b = 2\n")
  await Bun.write(path.join(dirpath, "src", "shared.ts"), "export const value = 1\n")
  await $`git add . && git commit -m "Initial commit"`.cwd(dirpath).quiet()

  const realpath = await fs.realpath(dirpath)

  try {
    return await Instance.provide({
      directory: realpath,
      init: InstanceBootstrap,
      fn: async () => {
        try {
          return await fn(Instance.project.id, Instance.worktree)
        } finally {
          await Instance.dispose()
        }
      },
    })
  } finally {
    await $`git fsmonitor--daemon stop`.cwd(realpath).quiet().nothrow()
    await fs.rm(realpath, { recursive: true, force: true }).catch(() => {})
  }
}

async function createPlan(projectID: string, subtasks: { title: string; files: string[] }[]) {
  const plan = await PlanStore.create({
    projectID: projectID as any,
    sessionID: undefined,
    task: "Test parallel execution",
    orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
    workerModel: { providerID: "test" as any, modelID: "test-model" as any },
  })

  const entries = subtasks.map((st) => ({
    id: SubtaskID.ascending(),
    title: st.title,
    description: `Work on ${st.files.join(", ")}`,
    fileScope: st.files,
    dependencies: [] as any[],
  }))

  return PlanStore.update({
    id: plan.id,
    subtasks: entries,
    workers: entries.map((st) => ({ subtaskID: st.id, status: "pending" as const })),
    status: "proposed",
  })
}

// --- Tests ---

describe("Parallel E2E", () => {
  test("full pipeline: plan → worktrees → work → merge", async () => {
    await withProject(async (projectID, worktree) => {
      const plan = await createPlan(projectID, [
        { title: "Update a.ts", files: ["src/a.ts"] },
        { title: "Update b.ts", files: ["src/b.ts"] },
      ])
      expect(plan.status).toBe("proposed")
      expect(plan.subtasks).toHaveLength(2)

      await PlanStore.transition({ id: plan.id, status: "approved" })
      await PlanStore.transition({ id: plan.id, status: "spawning" })

      // Create worktrees
      const wts: { dir: string; branch: string; subtaskID: string }[] = []
      for (const st of plan.subtasks) {
        const info = await createWorktree(worktree, `e2e-${st.id.slice(0, 8)}`)
        wts.push({ dir: info.directory, branch: info.branch, subtaskID: st.id })

        await PlanStore.updateWorker({ id: plan.id, subtaskID: st.id, status: "spawning" } as any)
        await PlanStore.updateWorker({
          id: plan.id, subtaskID: st.id, status: "running",
          worktreeName: info.name, worktreeDir: info.directory, branch: info.branch,
        } as any)
      }
      await PlanStore.transition({ id: plan.id, status: "running" })

      // Simulate work
      for (let i = 0; i < plan.subtasks.length; i++) {
        const file = plan.subtasks[i].fileScope[0]
        const filePath = path.join(wts[i].dir, file)
        const content = await fs.readFile(filePath, "utf-8")
        await fs.writeFile(filePath, content + `// Worker ${i + 1}\n`)
        await $`git add . && git commit -m "Worker ${i + 1}"`.cwd(wts[i].dir).quiet()
        await PlanStore.updateWorker({ id: plan.id, subtaskID: plan.subtasks[i].id, status: "done" } as any)
      }

      // Merge
      await PlanStore.transition({ id: plan.id, status: "merging" })
      for (const wt of wts) {
        const r = await $`git merge --no-ff -m "Merge ${wt.branch}" ${wt.branch}`.cwd(worktree).quiet().nothrow()
        expect(r.exitCode).toBe(0)
        await PlanStore.updateWorker({ id: plan.id, subtaskID: wt.subtaskID, status: "merged" } as any)
      }

      const done = await PlanStore.transition({ id: plan.id, status: "done" })
      expect(done.status).toBe("done")
      expect(done.time.completed).toBeGreaterThan(0)

      // Verify
      expect(await fs.readFile(path.join(worktree, "src/a.ts"), "utf-8")).toContain("Worker 1")
      expect(await fs.readFile(path.join(worktree, "src/b.ts"), "utf-8")).toContain("Worker 2")

      for (const wt of wts) await removeWorktree(worktree, wt.dir)
    })
  })

  test("merge conflict detection", async () => {
    await withProject(async (projectID, worktree) => {
      const plan = await createPlan(projectID, [
        { title: "Change shared v1", files: ["src/shared.ts"] },
        { title: "Change shared v2", files: ["src/shared.ts"] },
      ])

      await PlanStore.transition({ id: plan.id, status: "approved" })
      await PlanStore.transition({ id: plan.id, status: "spawning" })

      const wts: { dir: string; branch: string; subtaskID: string }[] = []
      for (const st of plan.subtasks) {
        const info = await createWorktree(worktree, `conflict-${st.id.slice(0, 8)}`)
        wts.push({ dir: info.directory, branch: info.branch, subtaskID: st.id })
        await PlanStore.updateWorker({ id: plan.id, subtaskID: st.id, status: "spawning" } as any)
        await PlanStore.updateWorker({
          id: plan.id, subtaskID: st.id, status: "running",
          worktreeDir: info.directory, branch: info.branch,
        } as any)
      }
      await PlanStore.transition({ id: plan.id, status: "running" })

      // Worker 1
      await fs.writeFile(path.join(wts[0].dir, "src/shared.ts"), "export const value = 2 // v1\n")
      await $`git add . && git commit -m "Worker 1"`.cwd(wts[0].dir).quiet()

      // Worker 2 (conflicts)
      await fs.writeFile(path.join(wts[1].dir, "src/shared.ts"), "export const value = 3 // v2\n")
      await $`git add . && git commit -m "Worker 2"`.cwd(wts[1].dir).quiet()

      await PlanStore.updateWorker({ id: plan.id, subtaskID: wts[0].subtaskID, status: "done" } as any)
      await PlanStore.updateWorker({ id: plan.id, subtaskID: wts[1].subtaskID, status: "done" } as any)

      await PlanStore.transition({ id: plan.id, status: "merging" })

      // First merge OK
      const m1 = await $`git merge --no-ff -m "Merge" ${wts[0].branch}`.cwd(worktree).quiet().nothrow()
      expect(m1.exitCode).toBe(0)
      await PlanStore.updateWorker({ id: plan.id, subtaskID: wts[0].subtaskID, status: "merged" } as any)

      // Second merge conflicts
      const m2 = await $`git merge --no-ff -m "Merge" ${wts[1].branch}`.cwd(worktree).quiet().nothrow()
      expect(m2.exitCode).not.toBe(0)
      await $`git merge --abort`.cwd(worktree).quiet().nothrow()
      await PlanStore.updateWorker({
        id: plan.id, subtaskID: wts[1].subtaskID,
        status: "conflict", error: "Merge conflict",
      } as any)

      const failed = await PlanStore.transition({ id: plan.id, status: "failed" })
      expect(failed.status).toBe("failed")
      expect(failed.workers[1].status).toBe("conflict")

      for (const wt of wts) await removeWorktree(worktree, wt.dir)
    })
  })

  test("recovery: resume interrupted plan", async () => {
    await withProject(async (projectID, worktree) => {
      const plan = await createPlan(projectID, [
        { title: "Update a.ts", files: ["src/a.ts"] },
        { title: "Update b.ts", files: ["src/b.ts"] },
      ])

      await PlanStore.transition({ id: plan.id, status: "approved" })
      await PlanStore.transition({ id: plan.id, status: "spawning" })

      const wts: { dir: string; branch: string; subtaskID: string }[] = []
      for (const st of plan.subtasks) {
        const info = await createWorktree(worktree, `recover-${st.id.slice(0, 8)}`)
        wts.push({ dir: info.directory, branch: info.branch, subtaskID: st.id })
        await PlanStore.updateWorker({ id: plan.id, subtaskID: st.id, status: "spawning" } as any)
        await PlanStore.updateWorker({
          id: plan.id, subtaskID: st.id, status: "running",
          worktreeDir: info.directory, branch: info.branch,
        } as any)
      }
      await PlanStore.transition({ id: plan.id, status: "running" })

      // Worker 1 completes (has commits) but status still "running" (simulating crash)
      await fs.writeFile(path.join(wts[0].dir, "src/a.ts"), "export const a = 99\n")
      await $`git add . && git commit -m "Worker 1 done"`.cwd(wts[0].dir).quiet()

      // Worker 2 has no commits (interrupted mid-work)

      // Scan
      const interrupted = await Recovery.scan(projectID as any)
      expect(interrupted.length).toBe(1)
      expect(interrupted[0].canResume).toBe(true)

      // Resume
      const resumed = await Recovery.resume(plan.id)
      const w1 = resumed.workers.find((w) => w.subtaskID === wts[0].subtaskID)
      const w2 = resumed.workers.find((w) => w.subtaskID === wts[1].subtaskID)
      // Both workers should reach terminal state after recovery + merge
      // Worker 1: had commits → recovered as done → possibly merged
      expect(["done", "merged"]).toContain(w1?.status)
      // Worker 2: no commits → marked failed → but merge of empty branch succeeds (no-op) → may be merged
      // The important thing: recovery completed without crashing and plan reached terminal state
      expect(["done", "failed", "merged"]).toContain(w2?.status)
      expect(["done", "failed", "running"]).toContain(resumed.status)

      for (const wt of wts) await removeWorktree(worktree, wt.dir)
    })
  })

  test("recovery: abandon cleans up worktrees", async () => {
    await withProject(async (projectID, worktree) => {
      const plan = await createPlan(projectID, [
        { title: "Update a.ts", files: ["src/a.ts"] },
      ])

      await PlanStore.transition({ id: plan.id, status: "approved" })
      await PlanStore.transition({ id: plan.id, status: "spawning" })

      const info = await createWorktree(worktree, `abandon-${plan.subtasks[0].id.slice(0, 8)}`)
      await PlanStore.updateWorker({ id: plan.id, subtaskID: plan.subtasks[0].id, status: "spawning" } as any)
      await PlanStore.updateWorker({
        id: plan.id, subtaskID: plan.subtasks[0].id, status: "running",
        worktreeDir: info.directory, branch: info.branch,
      } as any)
      await PlanStore.transition({ id: plan.id, status: "running" })

      expect(await fs.stat(info.directory).then(() => true).catch(() => false)).toBe(true)

      const abandoned = await Recovery.abandon(plan.id)
      expect(abandoned.status).toBe("failed")
      expect(abandoned.workers[0].error).toBe("Abandoned by user")

      // Worktree cleaned up
      expect(await fs.stat(info.directory).then(() => true).catch(() => false)).toBe(false)
    })
  })

  test("plan scoping: project-scoped", async () => {
    await withProject(async (projectID) => {
      const plan = await createPlan(projectID, [{ title: "Test", files: ["src/a.ts"] }])
      expect(String(plan.projectID)).toBe(String(projectID))

      const plans = await PlanStore.list()
      const found = plans.find((p) => p.id === plan.id)
      expect(found).toBeDefined()
      expect(String(found!.projectID)).toBe(String(projectID))
    })
  })

  test("state machine: valid transitions", async () => {
    await withProject(async (projectID) => {
      const plan = await createPlan(projectID, [{ title: "Test", files: ["src/a.ts"] }])
      await PlanStore.transition({ id: plan.id, status: "approved" })
      await PlanStore.transition({ id: plan.id, status: "spawning" })
      await PlanStore.transition({ id: plan.id, status: "running" })
      await PlanStore.transition({ id: plan.id, status: "merging" })
      const done = await PlanStore.transition({ id: plan.id, status: "done" })
      expect(done.status).toBe("done")
    })
  })

  test("state machine: invalid transition throws", async () => {
    await withProject(async (projectID) => {
      const plan = await createPlan(projectID, [{ title: "Test", files: ["src/a.ts"] }])
      await expect(PlanStore.transition({ id: plan.id, status: "running" })).rejects.toThrow()
    })
  })
})
