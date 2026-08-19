import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { Agent } from "@opencode-ai/schema/agent"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Workflow } from "@opencode-ai/core/workflow"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Workflow.node])))

const project = {
  id: ProjectV2.ID.make("workflow-test"),
  directory: AbsolutePath.make("/tmp/workflow-test"),
}

const architect = {
  agent: Agent.ID.make("architect"),
  model: {
    providerID: Provider.ID.make("opencode"),
    id: Model.ID.make("gpt-5.6-terra"),
    variant: Model.VariantID.make("high"),
  },
}

const coder = {
  agent: Agent.ID.make("coder"),
  model: {
    providerID: Provider.ID.make("opencode"),
    id: Model.ID.make("gpt-5.6-luna"),
  },
}

const tasks = [
  {
    id: "TASK-001",
    title: "Foundation",
    dependencies: [],
    conflictsWith: [],
    parallelEligible: true,
    allowedPaths: ["packages/core/**"],
    acceptanceCriteria: ["State is persisted"],
    validation: ["bun typecheck"],
  },
  {
    id: "TASK-002",
    title: "Dependent work",
    dependencies: ["TASK-001"],
    conflictsWith: [],
    parallelEligible: true,
    allowedPaths: ["packages/opencode/**"],
    acceptanceCriteria: ["Uses foundation"],
    validation: ["bun typecheck"],
  },
]

function createWorkflow() {
  return Workflow.Service.use((workflow) =>
    workflow.create(project, {
      story: "Build a tested workflow",
      architect,
      coder,
      concurrency: 3,
    }),
  )
}

describe("Workflow service", () => {
  it.effect("persists preferences and snapshots workflow role selections", () =>
    Effect.gen(function* () {
      const workflow = yield* Workflow.Service

      const preferences = yield* workflow.preferences.update(project, {
        architect,
        coder,
        concurrency: 4,
      })
      const created = yield* workflow.create(project, { story: "Use saved preferences" })

      expect(preferences.architect).toEqual(architect)
      expect(preferences.coder).toEqual(coder)
      expect(created.architect).toEqual(architect)
      expect(created.coder).toEqual(coder)
      expect(created.concurrency).toBe(4)
      expect((yield* workflow.get(created.id)).story).toBe("Use saved preferences")
      expect((yield* workflow.list(project)).map((item) => item.id)).toContain(created.id)
    }),
  )

  it.effect("requires both role selections before creating a workflow", () =>
    Effect.gen(function* () {
      const exit = yield* Workflow.Service.use((workflow) =>
        workflow.create(project, { story: "Missing roles" }),
      ).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect("sets a task DAG and unblocks dependencies after integration", () =>
    Effect.gen(function* () {
      const workflow = yield* Workflow.Service
      const created = yield* createWorkflow()
      const planned = yield* workflow.setTasks(created.id, { tasks })

      expect(planned.status).toBe("running")
      expect(planned.tasks.map((task) => [task.id, task.status])).toEqual([
        ["TASK-001", "ready"],
        ["TASK-002", "blocked"],
      ])

      yield* workflow.transitionTask(created.id, { taskID: "TASK-001", status: "coding" })
      yield* workflow.recordAttempt(created.id, { taskID: "TASK-001", status: "submitted", findings: [] })
      yield* workflow.recordAttempt(created.id, { taskID: "TASK-001", status: "approved", findings: [] })
      yield* workflow.transitionTask(created.id, { taskID: "TASK-001", status: "integrating" })
      const integrated = yield* workflow.transitionTask(created.id, { taskID: "TASK-001", status: "integrated" })

      expect(integrated.tasks.map((task) => [task.id, task.status])).toEqual([
        ["TASK-001", "integrated"],
        ["TASK-002", "ready"],
      ])
    }),
  )

  it.effect("rejects invalid task DAGs and invalid transitions", () =>
    Effect.gen(function* () {
      const workflow = yield* Workflow.Service
      const created = yield* createWorkflow()

      const invalidDependency = yield* workflow
        .setTasks(created.id, {
          tasks: [{ ...tasks[0], dependencies: ["missing"] }],
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(invalidDependency)).toBe(true)

      yield* workflow.setTasks(created.id, { tasks: [tasks[0]] })
      const invalidTransition = yield* workflow
        .transitionTask(created.id, { taskID: "TASK-001", status: "integrated" })
        .pipe(Effect.exit)
      expect(Exit.isFailure(invalidTransition)).toBe(true)
    }),
  )

  it.effect("allows a Thinking rescue after three terminal failures before needing a human", () =>
    Effect.gen(function* () {
      const workflow = yield* Workflow.Service
      const created = yield* createWorkflow()
      yield* workflow.setTasks(created.id, { tasks: [tasks[0]] })

      yield* workflow.transitionTask(created.id, { taskID: "TASK-001", status: "coding" })
      const first = yield* workflow.recordAttempt(created.id, {
        taskID: "TASK-001",
        status: "rejected",
        feedback: "First rejection",
      })
      expect(first.status).toBe("running")
      expect(first.tasks[0].status).toBe("remediation_ready")
      expect(first.tasks[0].attempts).toBe(1)

      yield* workflow.transitionTask(created.id, { taskID: "TASK-001", status: "coding" })
      yield* workflow.recordAttempt(created.id, {
        taskID: "TASK-001",
        status: "failed",
        feedback: "Second failure",
      })
      yield* workflow.transitionTask(created.id, { taskID: "TASK-001", status: "coding" })
      const rescueReady = yield* workflow.recordAttempt(created.id, {
        taskID: "TASK-001",
        status: "rejected",
        feedback: "Third rejection",
      })

      expect(rescueReady.status).toBe("running")
      expect(rescueReady.tasks[0].status).toBe("remediation_ready")
      expect(rescueReady.tasks[0].attempts).toBe(3)

      yield* workflow.transitionTask(created.id, { taskID: "TASK-001", status: "coding" })
      const exhausted = yield* workflow.recordAttempt(created.id, {
        taskID: "TASK-001",
        status: "failed",
        feedback: "Thinking rescue failed",
      })

      expect(exhausted.status).toBe("needs_human")
      expect(exhausted.tasks[0].status).toBe("needs_human")
      expect(exhausted.tasks[0].attempts).toBe(4)
    }),
  )
})
