import { afterEach, describe, expect, test } from "bun:test"
import { analyzeStrategy, selectExecutionMode } from "../../src/parallel/strategy"
import { SubtaskID } from "../../src/parallel/schema"
import type { Plan } from "../../src/parallel/schema"
import { ProjectID } from "../../src/project/schema"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { tmpdir } from "../fixture/fixture"

function plan(input: { count: number; kind?: "semantic" | "structural"; overlap?: boolean }): Pick<Plan, "task" | "subtasks" | "workers"> {
  const ids = Array.from({ length: input.count }, () => SubtaskID.ascending())
  return {
    task: "Test strategy",
    subtasks: ids.map((id, index) => ({
      id,
      title: `Task ${index + 1}`,
      description: `Work ${index + 1}`,
      fileScope: input.overlap ? ["src/shared.ts"] : [`src/file-${index + 1}.ts`],
      dependencies: [],
      kind: input.kind,
    })),
    workers: ids.map((subtaskID) => ({ subtaskID, status: "pending" as const })),
  }
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("Parallel Strategy", () => {
  test("recommends task agents when git is not verified", () => {
    const result = analyzeStrategy(plan({ count: 3 }), {
      id: ProjectID.global,
      worktree: "/",
      sandboxes: [],
      time: { created: 0, updated: 0 },
    })

    expect(result.recommended).toBe("task-agent")
    expect(result.confidence).toBe("high")
    expect(result.requiresConfirmation).toBe(true)
  })

  test("recommends a single agent for a single subtask", () => {
    const result = analyzeStrategy(plan({ count: 1 }), {
      id: ProjectID.global,
      vcs: "git",
      worktree: "/tmp/repo",
      sandboxes: [],
      time: { created: 0, updated: 0 },
    })

    expect(result.recommended).toBe("single-agent")
    expect(result.requiresConfirmation).toBe(false)
  })

  test("recommends worktrees for git-backed independent subtasks", () => {
    const result = analyzeStrategy(plan({ count: 4 }), {
      id: ProjectID.global,
      vcs: "git",
      worktree: "/tmp/repo",
      sandboxes: [],
      time: { created: 0, updated: 0 },
    })

    expect(result.recommended).toBe("worktree")
    expect(result.confidence).toBe("high")
  })

  test("recommends task agents for bootstrap repos", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const result = analyzeStrategy(plan({ count: 4 }), Instance.project)

        expect(result.recommended).toBe("task-agent")
        expect(result.confidence).toBe("high")
        expect(result.reasons.join(" ")).toContain("bootstrap")
      },
    })
  })

  test("recommends task agents for overlap-heavy plans", () => {
    const result = analyzeStrategy(plan({ count: 3, overlap: true }), {
      id: ProjectID.global,
      vcs: "git",
      worktree: "/tmp/repo",
      sandboxes: [],
      time: { created: 0, updated: 0 },
    })

    expect(result.recommended).toBe("task-agent")
    expect(result.risks.length).toBeGreaterThan(0)
  })

  test("maps single-agent recommendations to task-agent execution mode", () => {
    const result = selectExecutionMode(
      {
        ...plan({ count: 1 }),
        executionMode: undefined,
      },
      {
        id: ProjectID.global,
        vcs: "git",
        worktree: "/tmp/repo",
        sandboxes: [],
        time: { created: 0, updated: 0 },
      },
    )

    expect(result).toBe("task-agent")
  })
})
