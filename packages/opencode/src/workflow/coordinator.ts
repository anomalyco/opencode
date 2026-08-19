export * as WorkflowCoordinator from "./coordinator"

import path from "path"
import { Effect, Layer, Schema } from "effect"
import { Workflow } from "@opencode-ai/core/workflow"
import { WorkflowCoordinator as CoreWorkflowCoordinator } from "@opencode-ai/core/workflow/coordinator"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { Global } from "@opencode-ai/core/global"
import { SessionV2 } from "@opencode-ai/core/session"
import { Model } from "@opencode-ai/schema/model"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Workflow as WorkflowSchema } from "@opencode-ai/schema/workflow"
import { Git } from "@/git"
import { WorkflowPrompt } from "./prompt"

const MaxWaitPolls = 3_600
const MaxStartPolls = 10

const decodeArchitectPlan = Schema.decodeUnknownEffect(WorkflowSchema.ArchitectPlanOutput)
const decodeArchitectAudit = Schema.decodeUnknownEffect(WorkflowSchema.ArchitectAuditOutput)
const decodeCoderResult = Schema.decodeUnknownEffect(WorkflowSchema.CoderResultOutput)

const layer = Layer.effect(
  CoreWorkflowCoordinator.Service,
  Effect.gen(function* () {
    const workflows = yield* Workflow.Service
    const sessions = yield* SessionV2.Service
    const locations = yield* LocationServiceMap.Service
    const git = yield* Git.Service

    const run = Effect.fn("WorkflowCoordinator.run")(function* (input: CoreWorkflowCoordinator.StartInput) {
      const workflow = yield* workflows.get(input.workflowID)
      const dirty = yield* git.status(input.location.directory)
      if (dirty.length) {
        yield* workflows.transitionStatus(input.workflowID, "needs_human")
        return
      }

      const planningSession = yield* createSession({
        location: input.location,
        agent: workflow.architect.agent,
        model: workflow.architect.model,
      })
      yield* workflows.appendSession(input.workflowID, { role: "architect", sessionID: planningSession.id })
      yield* prompt(planningSession.id, planningPrompt(workflow))
      yield* waitForIdle(planningSession.id)
      const plan = yield* readJson(planningSession.id, decodeArchitectPlan)

      if (plan.status !== "COMPLETE") {
        yield* workflows.transitionStatus(input.workflowID, "needs_human")
        return
      }

      const planned = yield* workflows.setTasks(input.workflowID, {
        tasks: plan.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          dependencies: [...task.dependencies],
          conflictsWith: [...task.conflictsWith],
          parallelEligible: task.parallelEligible,
          allowedPaths: [...task.allowedPaths],
          acceptanceCriteria: [...task.acceptanceCriteria],
          validation: [...task.validation],
          summary: task.summary,
        })),
      })
      yield* dispatch(input.location, planned)
    })

    const dispatch: (location: Location.Ref, workflow: Workflow.Info) => Effect.Effect<void, unknown> = Effect.fn(
      "WorkflowCoordinator.dispatch",
    )(function* (location: Location.Ref, workflow: Workflow.Info) {
      const ready = workflow.tasks
        .filter((task) => task.status === "ready" || task.status === "remediation_ready")
        .slice(0, workflow.concurrency)
      if (!ready.length) {
        if (workflow.status === "final_audit") yield* finalAudit(location, workflow)
        return
      }
      yield* Effect.forEach(ready, (task) => runTask(location, workflow, task), { concurrency: workflow.concurrency })
      const next = yield* workflows.get(workflow.id)
      if (["running", "final_audit"].includes(next.status)) yield* dispatch(location, next)
    })

    const runTask = Effect.fn("WorkflowCoordinator.runTask")(function* (
      location: Location.Ref,
      workflow: Workflow.Info,
      task: WorkflowSchema.Task,
    ) {
      const taskWorktree = yield* createTaskWorktree(location, workflow, task)
      const rescue = task.status === "remediation_ready" && task.attempts >= 3
      const coding = yield* workflows.transitionTask(workflow.id, { taskID: task.id, status: "coding" })
      const attempt = (coding.tasks.find((item) => item.id === task.id)?.attempts ?? task.attempts) + 1
      const coderSession = yield* createSession({
        location: Location.Ref.make({ directory: taskWorktree.directory }),
        agent: workflow.coder.agent,
        model: rescue ? thinkingModel(workflow.coder.model) : workflow.coder.model,
      })
      yield* workflows.appendSession(workflow.id, { role: "coder", sessionID: coderSession.id })
      yield* prompt(
        coderSession.id,
        task.attempts > 0
          ? remediationPrompt(workflow, task, taskWorktree.directory, attempt, rescue)
          : coderPrompt(workflow, task, taskWorktree.directory, attempt),
      )
      yield* waitForIdle(coderSession.id)
      const coderResult = yield* readJson(coderSession.id, decodeCoderResult)

      if (coderResult.status !== "READY_FOR_ARCHITECT_AUDIT") {
        yield* workflows.recordAttempt(workflow.id, {
          taskID: task.id,
          status: "failed",
          sessionID: coderSession.id,
          summary: coderResult.summary,
          feedback: coderResult.blockers.join("\n"),
        })
        return
      }

      yield* workflows.recordAttempt(workflow.id, {
        taskID: task.id,
        status: "submitted",
        sessionID: coderSession.id,
        summary: coderResult.summary,
      })

      const auditSession = yield* createSession({
        location,
        agent: workflow.architect.agent,
        model: rescue ? thinkingModel(workflow.architect.model) : workflow.architect.model,
      })
      yield* workflows.appendSession(workflow.id, { role: "architect", sessionID: auditSession.id })
      yield* prompt(auditSession.id, auditPrompt(workflow, task, coderResult))
      yield* waitForIdle(auditSession.id)
      const audit = yield* readJson(auditSession.id, decodeArchitectAudit)

      if (audit.status === "APPROVED") {
        yield* workflows.recordAttempt(workflow.id, {
          taskID: task.id,
          status: "approved",
          sessionID: auditSession.id,
          summary: audit.summary,
          findings: audit.findings.map((finding) => ({ ...finding })),
        })
        yield* integrateTask(location, taskWorktree.directory, workflow, task)
        return
      }

      yield* workflows.recordAttempt(workflow.id, {
        taskID: task.id,
        status: audit.status === "REJECTED" ? "rejected" : "failed",
        sessionID: auditSession.id,
        summary: audit.summary,
        feedback: audit.remediation.instructions.join("\n"),
        findings: audit.findings.map((finding) => ({ ...finding })),
      })
    })

    const finalAudit = Effect.fn("WorkflowCoordinator.finalAudit")(function* (
      location: Location.Ref,
      workflow: Workflow.Info,
    ) {
      const auditSession = yield* createSession({
        location,
        agent: workflow.architect.agent,
        model: workflow.architect.model,
      })
      yield* workflows.appendSession(workflow.id, { role: "architect", sessionID: auditSession.id })
      yield* prompt(auditSession.id, finalAuditPrompt(workflow))
      yield* waitForIdle(auditSession.id)
      const audit = yield* readJson(auditSession.id, decodeArchitectAudit)
      yield* workflows.transitionStatus(workflow.id, audit.status === "APPROVED" ? "completed" : "needs_human")
    })

    const createSession = Effect.fnUntraced(function* (input: {
      location: Location.Ref
      agent: WorkflowSchema.RoleSelection["agent"]
      model?: WorkflowSchema.RoleSelection["model"]
    }) {
      return yield* sessions.create({
        location: input.location,
        agent: input.agent,
        model: input.model,
      })
    })

    const prompt = Effect.fnUntraced(function* (sessionID: SessionV2.ID, text: string) {
      yield* sessions.prompt({
        sessionID,
        prompt: { text },
      })
    })

    const waitForIdle = Effect.fnUntraced(function* (sessionID: SessionV2.ID) {
      yield* waitUntilActive(sessionID, 0)
      yield* waitUntilInactive(sessionID, 0)
    })

    const waitUntilActive: (sessionID: SessionV2.ID, count: number) => Effect.Effect<void> = Effect.fnUntraced(function* (
      sessionID: SessionV2.ID,
      count: number,
    ) {
      const active = yield* sessions.active
      if (active.has(sessionID)) return
      if (count >= MaxStartPolls) return
      yield* Effect.sleep("1 second")
      return yield* waitUntilActive(sessionID, count + 1)
    })

    const waitUntilInactive: (sessionID: SessionV2.ID, count: number) => Effect.Effect<void> = Effect.fnUntraced(function* (
      sessionID: SessionV2.ID,
      count: number,
    ) {
      const active = yield* sessions.active
      if (!active.has(sessionID)) return
      if (count >= MaxWaitPolls) return yield* Effect.die(new Error("Workflow session wait timed out"))
      yield* Effect.sleep("1 second")
      return yield* waitUntilInactive(sessionID, count + 1)
    })

    const readJson = Effect.fnUntraced(function* <A>(
      sessionID: SessionV2.ID,
      decode: (input: unknown) => Effect.Effect<A, unknown>,
    ) {
      const messages = yield* sessions.messages({ sessionID, order: "desc", limit: 25 })
      const text = messages
        .filter((message): message is SessionMessage.Assistant => message.type === "assistant")
        .flatMap((message) => message.content)
        .filter((part): part is SessionMessage.AssistantText => part.type === "text")
        .map((part) => part.text)
        .find((content) => content.trim().length > 0)
      if (!text) return yield* Effect.die(new Error("Workflow session produced no JSON text"))
      const json = extractJson(text)
      const parsed = yield* Effect.try({
        try: () => JSON.parse(json) as unknown,
        catch: (error) => error,
      })
      return yield* decode(parsed)
    })

    const createTaskWorktree = Effect.fnUntraced(function* (
      location: Location.Ref,
      workflow: Workflow.Info,
      task: WorkflowSchema.Task,
    ) {
      const copy = yield* ProjectCopy.Service.use((copies) =>
        copies.create({
          projectID: workflow.projectID,
          strategy: ProjectCopy.StrategyID.make("git_worktree"),
          sourceDirectory: location.directory,
          directory: AbsolutePath.make(path.join(Global.Path.data, "workflow", workflow.id)),
          name: task.id.toLowerCase(),
        }),
      ).pipe(Effect.provide(locations.get(location)))
      return copy
    })

    const integrateTask = Effect.fnUntraced(function* (
      location: Location.Ref,
      taskDirectory: AbsolutePath,
      workflow: Workflow.Info,
      task: WorkflowSchema.Task,
    ) {
      const patch = yield* git.patchAll(taskDirectory, "HEAD", { maxOutputBytes: 4_000_000 })
      if (!patch.text.trim()) {
        yield* workflows.transitionTask(workflow.id, { taskID: task.id, status: "integrating" })
        yield* workflows.transitionTask(workflow.id, { taskID: task.id, status: "integrated" })
        return
      }
      const result = yield* git.applyPatch(location.directory, patch.text)
      if (result.exitCode !== 0) {
        yield* workflows.recordAttempt(workflow.id, {
          taskID: task.id,
          status: "failed",
          feedback: result.stderr.toString("utf8") || result.text(),
        })
        return
      }
      yield* workflows.transitionTask(workflow.id, { taskID: task.id, status: "integrating" })
      yield* workflows.transitionTask(workflow.id, { taskID: task.id, status: "integrated" })
    })

    return CoreWorkflowCoordinator.Service.of({
      start: Effect.fn("WorkflowCoordinator.start")(function* (input) {
        yield* run(input).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("workflow coordinator failed", { workflowID: input.workflowID, cause }).pipe(
              Effect.andThen(workflows.transitionStatus(input.workflowID, "failed").pipe(Effect.ignore)),
            ),
          ),
          Effect.forkDetach,
          Effect.asVoid,
        )
      }),
    })
  }),
)

function extractJson(input: string) {
  const trimmed = input.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return trimmed
}

function planningPrompt(workflow: Workflow.Info) {
  return [
    WorkflowPrompt.architectPlanning.text,
    "Workflow input:",
    JSON.stringify(
      {
        workflowID: workflow.id,
        projectID: workflow.projectID,
        story: workflow.story,
        concurrency: workflow.concurrency,
      },
      null,
      2,
    ),
  ].join("\n\n")
}

function coderPrompt(
  workflow: Workflow.Info,
  task: WorkflowSchema.Task,
  directory: AbsolutePath,
  attempt: number,
) {
  return [
    WorkflowPrompt.coderTask.text,
    "Coder assignment:",
    JSON.stringify(
      {
        workflowID: workflow.id,
        projectID: workflow.projectID,
        task,
        attemptID: `${task.id}:${attempt}`,
        worktree: directory,
      },
      null,
      2,
    ),
  ].join("\n\n")
}

function remediationPrompt(
  workflow: Workflow.Info,
  task: WorkflowSchema.Task,
  directory: AbsolutePath,
  attempt: number,
  rescue: boolean,
) {
  return [
    WorkflowPrompt.coderRemediation.text,
    rescue
      ? "This is the final Thinking-model rescue pass after three unsuccessful coder loops. Attempt to meet every original acceptance criterion and every audit remediation instruction. If this attempt cannot satisfy the task, return FAILED, BLOCKED, or NEEDS_HUMAN honestly."
      : "This is a bounded remediation pass after Architect audit feedback.",
    "Remediation assignment:",
    JSON.stringify(
      {
        workflowID: workflow.id,
        projectID: workflow.projectID,
        task,
        attemptID: `${task.id}:${attempt}`,
        worktree: directory,
        rescue,
        previousAttempts: workflow.attempts.filter((item) => item.taskID === task.id),
      },
      null,
      2,
    ),
  ].join("\n\n")
}

function auditPrompt(workflow: Workflow.Info, task: WorkflowSchema.Task, result: WorkflowSchema.CoderResultOutput) {
  return [
    WorkflowPrompt.architectAudit.text,
    "Audit package:",
    JSON.stringify(
      {
        workflowID: workflow.id,
        projectID: workflow.projectID,
        task,
        coderResult: result,
      },
      null,
      2,
    ),
  ].join("\n\n")
}

function finalAuditPrompt(workflow: Workflow.Info) {
  return [
    WorkflowPrompt.architectAudit.text,
    "Final integrated workflow audit package:",
    JSON.stringify(
      {
        workflowID: workflow.id,
        projectID: workflow.projectID,
        story: workflow.story,
        tasks: workflow.tasks,
        attempts: workflow.attempts,
      },
      null,
      2,
    ),
  ].join("\n\n")
}

function thinkingModel(model?: WorkflowSchema.RoleSelection["model"]) {
  if (!model) return undefined
  return {
    ...model,
    variant: Model.VariantID.make("thinking"),
  }
}

export const node = makeGlobalNode({
  service: CoreWorkflowCoordinator.Service,
  layer,
  deps: [Workflow.node, SessionV2.node, LocationServiceMap.node, Git.node],
})
