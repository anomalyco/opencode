import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { AutomationQueue, calculateSlaScore, type QueuedJob } from "@opencode-ai/core/automation/queue"
import { NaturalLanguageAutomation } from "@opencode-ai/core/automation/nl-builder"
import { AgentSwarm } from "@opencode-ai/core/automation/swarm"
import { PRAutopilot } from "@opencode-ai/core/teamjules/autopilot"

describe("SLA-Aware Scheduling (Feature 7)", () => {
  const now = 1_000_000

  test("calculateSlaScore boosts priority as deadline approaches", () => {
    const normalJob: QueuedJob = {
      id: "j1",
      prompt: "normal task",
      complexity: "medium",
      priority: 5,
      createdAt: now,
      sessionID: "s1",
      triggerID: "t1",
      classification: { complexity: "medium", taskType: "refactor", reason: "test" },
    }

    const urgentJob: QueuedJob = {
      ...normalJob,
      id: "j2",
      priority: 1, // lower base priority
      deadline: now + 40_000, // deadline in 40s (within 1 min slack)
      estimatedDurationMs: 10_000,
    }

    const scoreNormal = calculateSlaScore(normalJob, now)
    const scoreUrgent = calculateSlaScore(urgentJob, now)

    // Urgent job with approaching deadline should score significantly higher than standard priority 5 job
    expect(scoreUrgent).toBeGreaterThan(scoreNormal)
    expect(scoreUrgent).toBeGreaterThanOrEqual(5_000)
  })

  test("calculateSlaScore gives maximum boost to breached deadlines", () => {
    const breachedJob: QueuedJob = {
      id: "j3",
      prompt: "breached task",
      complexity: "medium",
      priority: 0,
      createdAt: now - 50_000,
      deadline: now - 5_000, // already 5 seconds past deadline
      sessionID: "s1",
      triggerID: "t1",
      classification: { complexity: "medium", taskType: "refactor", reason: "test" },
    }

    const score = calculateSlaScore(breachedJob, now)
    expect(score).toBeGreaterThanOrEqual(10_000)
  })
})

describe("Natural-Language Automation Builder (Feature 8)", () => {
  test("parses natural language intervals into cron expressions", () => {
    expect(NaturalLanguageAutomation.parseNaturalLanguageSchedule("Every 15 minutes check deploy status").cron).toBe("*/15 * * * *")
    expect(NaturalLanguageAutomation.parseNaturalLanguageSchedule("Run health check every hour").cron).toBe("0 * * * *")
    expect(NaturalLanguageAutomation.parseNaturalLanguageSchedule("Run nightly security scans at midnight").cron).toBe("0 0 * * *")
    expect(NaturalLanguageAutomation.parseNaturalLanguageSchedule("Every weekday at 9am run the test suite").cron).toBe("0 9 * * 1-5")
    expect(NaturalLanguageAutomation.parseNaturalLanguageSchedule("Every day at 2pm send report").cron).toBe("0 14 * * *")
  })

  test("parses notification requirements and channels", () => {
    const spec1 = NaturalLanguageAutomation.parseNotificationSpec("Run tests and alert on failure")
    expect(spec1.channel).toBe("alert")
    expect(spec1.condition).toBe("on_failure")

    const spec2 = NaturalLanguageAutomation.parseNotificationSpec("Post to Slack webhook https://hooks.slack.com/services/123 on success")
    expect(spec2.channel).toBe("webhook")
    expect(spec2.target).toBe("https://hooks.slack.com/services/123")
    expect(spec2.condition).toBe("on_success")
  })
})

describe("Agent Swarm Pipeline (Feature 5)", () => {
  const sessionID = "ses_swarm_test" as SessionSchema.ID

  test("chains dispatcher -> worker -> reviewer with branch isolation", () => {
    const task = AgentSwarm.createSwarmTask({
      prompt: "Implement OAuth2 login with GitHub",
      baseBranch: "main",
      sessionID,
      classification: { complexity: "high", taskType: "build", reason: "new feature" },
    })

    expect(task.stage).toBe("dispatching")
    expect(task.taskBranch).toMatch(/^task\/implement-oauth2-login-/)

    // 1. Dispatch
    Effect.runSync(AgentSwarm.dispatchTask(task, process.cwd()))
    expect(task.stage).toBe("working")
    expect(task.handoffs.length).toBe(1)
    expect(task.handoffs[0].fromRole).toBe("dispatcher")
    expect(task.handoffs[0].toRole).toBe("worker")

    // 2. Worker submits for review
    AgentSwarm.submitForReview(task, "Add OAuth callback handler and session tokens")
    expect(task.stage).toBe("reviewing")
    expect(task.handoffs.length).toBe(2)
    expect(task.handoffs[1].fromRole).toBe("worker")
    expect(task.handoffs[1].toRole).toBe("reviewer")

    // 3. Reviewer requests changes (round 1)
    const rev1 = AgentSwarm.reviewTask(task, { passed: false, feedback: "Add CSRF state parameter" })
    expect(task.stage).toBe("revising")
    expect(task.revisionsCount).toBe(1)

    // 4. Worker fixes and re-submits
    AgentSwarm.submitForReview(task, "Add CSRF state validation")
    expect(task.stage).toBe("reviewing")

    // 5. Reviewer approves
    const rev2 = AgentSwarm.reviewTask(task, { passed: true })
    expect(task.stage).toBe("completed")
    expect(task.reviewVerdict).toBe("approved")
  })

  test("escalates if review cycles exceed max revisions", () => {
    const task = AgentSwarm.createSwarmTask({
      prompt: "Complex database migration",
      baseBranch: "main",
      sessionID,
      classification: { complexity: "high", taskType: "refactor", reason: "db" },
      maxRevisions: 1,
    })

    AgentSwarm.submitForReview(task)
    AgentSwarm.reviewTask(task, { passed: false, feedback: "Missing rollback" }) // round 1
    expect(task.stage).toBe("revising")

    AgentSwarm.submitForReview(task)
    AgentSwarm.reviewTask(task, { passed: false, feedback: "Rollback fails" }) // round 2 > maxRevisions(1)
    expect(task.stage).toBe("escalated")
    expect(task.reviewVerdict).toBe("escalated")
  })
})

describe("PR Lifecycle Autopilot (Feature 6)", () => {
  test("runs self-fix loop when CI fails until passed or max attempts", () => {
    const state = PRAutopilot.createAutopilotState({
      repo: "anomalyco/opencode",
      branch: "feat/auth-service",
      title: "Add Auth Service",
      body: "Implements JWT auth",
      maxFixAttempts: 2,
    })

    expect(state.status).toBe("opening")

    // Step 1: Open PR -> changes to watching_ci
    Effect.runSync(PRAutopilot.runAutopilotStep(state, { status: "running" }, process.cwd()))
    expect(state.status).toBe("watching_ci")
    expect(state.prUrl).toBeDefined()

    // Step 2: CI fails -> triggers self-fix attempt 1
    Effect.runSync(PRAutopilot.runAutopilotStep(state, { status: "failed", logs: "TypeError: Cannot read properties of undefined" }, process.cwd()))
    expect(state.attemptCount).toBe(1)
    expect(state.fixHistory.length).toBe(1)
    expect(state.fixHistory[0].errorSummary).toContain("TypeError")

    // Step 3: CI passes on fix -> completed!
    Effect.runSync(PRAutopilot.runAutopilotStep(state, { status: "passed" }, process.cwd()))
    expect(state.status).toBe("completed")
    expect(state.ciStatus).toBe("passed")
  })
})
