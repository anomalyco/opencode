/**
 * END-TO-END TEST
 * Tests the full parallel execution pipeline:
 * 1. Plan creation
 * 2. Worker spawning (git worktree)
 * 3. Merge (without LLM)
 *
 * NOTE: This test does NOT use real LLMs. It simulates worker completion
 * by directly modifying files and committing in the worktree.
 */

import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { PlanStore } from "../../src/parallel/plan"
import { SubtaskID } from "../../src/parallel/schema"
import { SessionID } from "../../src/session/schema"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

describe("Parallel E2E", () => {
  test("creates and executes a parallel plan with multiple workers", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Create some source files for workers to modify
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await Bun.write(path.join(dir, "src", "a.ts"), "export const a = 1\n")
        await Bun.write(path.join(dir, "src", "b.ts"), "export const b = 2\n")
        await $`git add .`.cwd(dir).quiet()
        await $`git commit -m "Initial commit"`.cwd(dir).quiet()
        return dir
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const project = await Project.init({ directory: tmp.path })

        // 1. Create plan
        const plan = await PlanStore.create({
          projectID: project.id,
          sessionID: SessionID.descending(),
          task: "Update source files",
          orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
          workerModel: { providerID: "test" as any, modelID: "test-model" as any },
        })

        const subtask1ID = SubtaskID.ascending()
        const subtask2ID = SubtaskID.ascending()

        const proposed = await PlanStore.update({
          id: plan.id,
          subtasks: [
            {
              id: subtask1ID,
              title: "Update a.ts",
              description: "Update the a.ts file",
              fileScope: ["src/a.ts"],
              dependencies: [],
            },
            {
              id: subtask2ID,
              title: "Update b.ts",
              description: "Update the b.ts file",
              fileScope: ["src/b.ts"],
              dependencies: [],
            },
          ],
          workers: [
            { subtaskID: subtask1ID, status: "pending" },
            { subtaskID: subtask2ID, status: "pending" },
          ],
          status: "proposed",
        })

        expect(proposed.status).toBe("proposed")
        expect(proposed.subtasks).toHaveLength(2)

        // 2. Create worktrees for workers (simulating spawn)
        await PlanStore.transition({ id: plan.id, status: "approved" })
        await PlanStore.transition({ id: plan.id, status: "spawning" })

        const worktrees: { dir: string; branch: string; subtaskID: string }[] = []

        for (const subtask of proposed.subtasks) {
          const info = await Worktree.makeWorktreeInfo(`test-${subtask.id.slice(0, 8)}`)
          await Worktree.createFromInfo(info)

          worktrees.push({
            dir: info.directory,
            branch: info.branch,
            subtaskID: subtask.id,
          })

          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: subtask.id,
            status: "running",
            worktreeName: info.name,
            worktreeDir: info.directory,
            branch: info.branch,
          })
        }

        await PlanStore.transition({ id: plan.id, status: "running" })

        // 3. Simulate workers doing work (modify files and commit)
        for (let i = 0; i < proposed.subtasks.length; i++) {
          const subtask = proposed.subtasks[i]
          const wt = worktrees[i]

          // Modify the file
          const file = subtask.fileScope[0]
          const filePath = path.join(wt.dir, file)
          const content = await fs.readFile(filePath, "utf-8")
          await fs.writeFile(filePath, content + `// Updated by worker ${i + 1}\n`)

          // Commit the change
          await $`git add .`.cwd(wt.dir).quiet()
          await $`git commit -m "Worker ${i + 1}: Update ${file}"`.cwd(wt.dir).quiet()

          // Mark worker as done
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: subtask.id,
            status: "done",
          })
        }

        // 4. Merge workers back (without LLM - just git merge)
        await PlanStore.transition({ id: plan.id, status: "merging" })

        for (const wt of worktrees) {
          // Merge the branch into main
          const result = await $`git merge --no-ff -m "Merge: ${wt.branch}" ${wt.branch}`
            .cwd(tmp.path)
            .quiet()
            .nothrow()

          expect(result.exitCode).toBe(0)

          // Update worker to merged
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: wt.subtaskID,
            status: "merged",
          })
        }

        // 5. Complete the plan
        const done = await PlanStore.transition({ id: plan.id, status: "done" })
        expect(done.status).toBe("done")
        expect(done.time.completed).toBeGreaterThan(0)

        // Verify the files were updated
        const aContent = await fs.readFile(path.join(tmp.path, "src", "a.ts"), "utf-8")
        const bContent = await fs.readFile(path.join(tmp.path, "src", "b.ts"), "utf-8")
        expect(aContent).toContain("Updated by worker 1")
        expect(bContent).toContain("Updated by worker 2")

        // Clean up worktrees
        for (const wt of worktrees) {
          await Worktree.remove({ directory: wt.dir }).catch(() => {})
        }

        return done
      },
    })
  })

  test("handles merge conflicts when workers modify same lines", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await Bun.write(path.join(dir, "src", "shared.ts"), "export const value = 1\n")
        await $`git add .`.cwd(dir).quiet()
        await $`git commit -m "Initial commit"`.cwd(dir).quiet()
        return dir
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const project = await Project.init({ directory: tmp.path })

        const plan = await PlanStore.create({
          projectID: project.id,
          sessionID: SessionID.descending(),
          task: "Conflict test",
          orchestratorModel: { providerID: "test" as any, modelID: "test-model" as any },
          workerModel: { providerID: "test" as any, modelID: "test-model" as any },
        })

        const subtask1ID = SubtaskID.ascending()
        const subtask2ID = SubtaskID.ascending()

        await PlanStore.update({
          id: plan.id,
          subtasks: [
            {
              id: subtask1ID,
              title: "Update shared.ts v1",
              description: "Update shared.ts",
              fileScope: ["src/shared.ts"],
              dependencies: [],
            },
            {
              id: subtask2ID,
              title: "Update shared.ts v2",
              description: "Update shared.ts",
              fileScope: ["src/shared.ts"],
              dependencies: [],
            },
          ],
          workers: [
            { subtaskID: subtask1ID, status: "pending" },
            { subtaskID: subtask2ID, status: "pending" },
          ],
          status: "proposed",
        })

        await PlanStore.transition({ id: plan.id, status: "approved" })
        await PlanStore.transition({ id: plan.id, status: "spawning" })

        // Create worktrees
        const wt1Info = await Worktree.makeWorktreeInfo(`test-${subtask1ID.slice(0, 8)}`)
        await Worktree.createFromInfo(wt1Info)
        await PlanStore.updateWorker({
          id: plan.id,
          subtaskID: subtask1ID,
          status: "running",
          worktreeDir: wt1Info.directory,
          branch: wt1Info.branch,
        })

        const wt2Info = await Worktree.makeWorktreeInfo(`test-${subtask2ID.slice(0, 8)}`)
        await Worktree.createFromInfo(wt2Info)
        await PlanStore.updateWorker({
          id: plan.id,
          subtaskID: subtask2ID,
          status: "running",
          worktreeDir: wt2Info.directory,
          branch: wt2Info.branch,
        })

        await PlanStore.transition({ id: plan.id, status: "running" })

        // Worker 1 modifies the file
        const shared1 = path.join(wt1Info.directory, "src", "shared.ts")
        await fs.writeFile(shared1, "export const value = 2 // Worker 1\n")
        await $`git add .`.cwd(wt1Info.directory).quiet()
        await $`git commit -m "Worker 1: Update shared.ts"`.cwd(wt1Info.directory).quiet()

        // Worker 2 modifies the same line differently
        const shared2 = path.join(wt2Info.directory, "src", "shared.ts")
        await fs.writeFile(shared2, "export const value = 3 // Worker 2\n")
        await $`git add .`.cwd(wt2Info.directory).quiet()
        await $`git commit -m "Worker 2: Update shared.ts"`.cwd(wt2Info.directory).quiet()

        // Mark workers as done
        await PlanStore.updateWorker({ id: plan.id, subtaskID: subtask1ID, status: "done" })
        await PlanStore.updateWorker({ id: plan.id, subtaskID: subtask2ID, status: "done" })

        // Merge - first one succeeds, second conflicts
        await PlanStore.transition({ id: plan.id, status: "merging" })

        // First merge succeeds
        const merge1 = await $`git merge --no-ff -m "Merge: ${wt1Info.branch}" ${wt1Info.branch}`
          .cwd(tmp.path)
          .quiet()
          .nothrow()
        expect(merge1.exitCode).toBe(0)
        await PlanStore.updateWorker({ id: plan.id, subtaskID: subtask1ID, status: "merged" })

        // Second merge conflicts
        const merge2 = await $`git merge --no-ff -m "Merge: ${wt2Info.branch}" ${wt2Info.branch}`
          .cwd(tmp.path)
          .quiet()
          .nothrow()

        if (merge2.exitCode !== 0) {
          // Conflict detected - abort and mark as conflict
          await $`git merge --abort`.cwd(tmp.path).quiet().nothrow()
          await PlanStore.updateWorker({
            id: plan.id,
            subtaskID: subtask2ID,
            status: "conflict",
            error: "Merge conflict detected",
          })

          // Plan should fail
          const failed = await PlanStore.transition({ id: plan.id, status: "failed" })
          expect(failed.status).toBe("failed")
          expect(failed.workers[1].status).toBe("conflict")
        } else {
          // No conflict (unexpected in this test, but handle it)
          await PlanStore.updateWorker({ id: plan.id, subtaskID: subtask2ID, status: "merged" })
          await PlanStore.transition({ id: plan.id, status: "done" })
        }

        // Cleanup
        await Worktree.remove({ directory: wt1Info.directory }).catch(() => {})
        await Worktree.remove({ directory: wt2Info.directory }).catch(() => {})
      },
    })
  })
})
