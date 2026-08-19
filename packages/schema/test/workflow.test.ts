import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Agent } from "../src/agent"
import { Model } from "../src/model"
import { Project } from "../src/project"
import { Workflow } from "../src/workflow"

const role = {
  agent: Agent.ID.make("build"),
  model: {
    providerID: "opencode",
    id: Model.ID.make("gpt-5.6-terra"),
    variant: Model.VariantID.make("thinking"),
  },
}

describe("Workflow schema", () => {
  test("decodes and encodes workflow info", () => {
    const input = {
      id: Workflow.ID.create(),
      projectID: Project.ID.make("project"),
      story: "Build workflow orchestration",
      status: "running" as const,
      architect: role,
      coder: role,
      concurrency: 2,
      tasks: [
        {
          id: "TASK-001",
          title: "Add workflow state",
          status: "ready" as const,
          dependencies: [],
          attempts: 0,
        },
      ],
      attempts: [
        {
          id: "TASK-001:1:submitted",
          taskID: "TASK-001",
          status: "submitted" as const,
          sessionID: "ses_architect",
          summary: "Ready for audit",
          findings: [],
          time: { created: Date.now() },
        },
      ],
      sessions: {
        architect: ["ses_architect"],
        coder: ["ses_coder"],
      },
      branch: "workflow/test",
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }

    const decoded = Schema.decodeUnknownSync(Workflow.Info)(input)

    expect(decoded.story).toBe(input.story)
    expect(String(decoded.architect.model?.variant)).toBe("thinking")
    expect(Schema.encodeSync(Workflow.Info)(decoded)).toEqual(input)
  })

  test("rejects malformed structured model outputs", () => {
    expect(() =>
      Schema.decodeUnknownSync(Workflow.ArchitectPlanOutput)({
        schemaVersion: "1.0",
        kind: "ARCHITECT_WORKFLOW_PLAN",
        status: "COMPLETE",
        summary: "missing task arrays are rejected",
      }),
    ).toThrow()

    expect(() =>
      Schema.decodeUnknownSync(Workflow.CoderResultOutput)({
        schemaVersion: "1.0",
        kind: "CODER_WORKFLOW_RESULT",
        status: "DONE",
        taskID: "TASK-001",
        attemptID: "TASK-001:1",
        summary: "invalid status",
        filesChanged: [],
        validation: [],
        blockers: [],
      }),
    ).toThrow()
  })
})
