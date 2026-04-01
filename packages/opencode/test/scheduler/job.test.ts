import { test, expect } from "bun:test"
import { Job } from "../../src/scheduler/job"

test("create a job with required fields", () => {
  const job = Job.create({
    cron: "0 9 * * *",
    prompt: "Run daily checks",
    agent: "build",
    projectID: "proj_123",
  })

  expect(job.id).toMatch(/^job_.+/)
  expect(job.cron).toBe("0 9 * * *")
  expect(job.prompt).toBe("Run daily checks")
  expect(job.agent).toBe("build")
  expect(job.projectID).toBe("proj_123")
  expect(job.tags).toEqual([])
  expect(job.enabled).toBe(true)
  expect(job.runCount).toBe(0)
  expect(job.nextRun).toBeTypeOf("number")
  expect(job.createdAt).toBeTypeOf("number")
})

test("create with custom tags", () => {
  const job = Job.create({
    cron: "*/5 * * * *",
    prompt: "Check status",
    agent: "build",
    projectID: "proj_456",
    tags: ["monitoring", "critical"],
  })

  expect(job.tags).toEqual(["monitoring", "critical"])
})

test("markRun updates run count and lastRun", () => {
  const job = Job.create({
    cron: "*/5 * * * *",
    prompt: "Run daily checks",
    agent: "build",
    projectID: "proj_123",
  })

  const initialRunCount = job.runCount

  // Wait a millisecond to ensure different nextRun
  const beforeMark = Date.now()
  const updated = Job.markRun(job, "success", "All checks passed")
  const afterMark = Date.now()

  expect(updated.runCount).toBe(initialRunCount + 1)
  expect(updated.lastRun).toBeGreaterThanOrEqual(beforeMark)
  expect(updated.lastRun).toBeLessThanOrEqual(afterMark)
  expect(updated.lastStatus).toBe("success")
  expect(updated.lastOutput).toBe("All checks passed")
  expect(updated.nextRun).toBeTypeOf("number")
  expect(updated.nextRun).toBeGreaterThan(updated.lastRun!)
})

test("disable and enable a job", () => {
  const job = Job.create({
    cron: "0 9 * * *",
    prompt: "Run daily checks",
    agent: "build",
    projectID: "proj_123",
  })

  expect(job.enabled).toBe(true)

  const disabled = Job.toggle(job)
  expect(disabled.enabled).toBe(false)

  const enabled = Job.toggle(disabled)
  expect(enabled.enabled).toBe(true)
})
