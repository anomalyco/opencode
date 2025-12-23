import { describe, expect, test } from "bun:test"
import { SessionRunner } from "../../src/session/runner"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("SessionRunner", () => {
  describe("Options schema", () => {
    test("validates valid options", () => {
      const valid = {
        model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
        agent: "code",
      }
      expect(SessionRunner.Options.safeParse(valid).success).toBe(true)
    })

    test("validates options with tools", () => {
      const opts = {
        model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
        agent: "code",
        tools: { bash: true, read: true, write: false },
      }
      expect(SessionRunner.Options.safeParse(opts).success).toBe(true)
    })

    test("validates options with timeout", () => {
      const opts = {
        model: { providerID: "openai", modelID: "gpt-4" },
        agent: "general",
        timeoutMs: 30000,
        maxSteps: 10,
      }
      expect(SessionRunner.Options.safeParse(opts).success).toBe(true)
    })

    test("rejects missing model", () => {
      expect(SessionRunner.Options.safeParse({ agent: "code" }).success).toBe(false)
    })

    test("rejects missing agent", () => {
      const opts = { model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" } }
      expect(SessionRunner.Options.safeParse(opts).success).toBe(false)
    })

    test("rejects invalid model structure", () => {
      const opts = { model: { providerID: "anthropic" }, agent: "code" }
      expect(SessionRunner.Options.safeParse(opts).success).toBe(false)
    })
  })

  describe("Job schema", () => {
    test("validates job with required fields", () => {
      const job = {
        id: "job_123",
        kind: "session.loop",
        targetSessionID: "ses_abc",
        createdAt: Date.now(),
        status: "queued",
      }
      expect(SessionRunner.Job.safeParse(job).success).toBe(true)
    })

    test("validates job with all fields", () => {
      const job = {
        id: "job_123",
        kind: "task.child_session",
        targetSessionID: "ses_abc",
        parentSessionID: "ses_parent",
        toolCallID: "call_xyz",
        createdAt: Date.now(),
        startedAt: Date.now(),
        finishedAt: Date.now(),
        timeoutMs: 30000,
        status: "completed",
        error: { name: "Error", message: "failed" },
      }
      expect(SessionRunner.Job.safeParse(job).success).toBe(true)
    })

    test("validates all job kinds", () => {
      for (const kind of ["session.loop", "session.prompt_async", "task.child_session"]) {
        const job = { id: "j", kind, targetSessionID: "s", createdAt: 0, status: "queued" }
        expect(SessionRunner.Job.safeParse(job).success).toBe(true)
      }
    })

    test("validates all job statuses", () => {
      for (const status of ["queued", "running", "completed", "failed", "canceled", "timed_out"]) {
        const job = { id: "j", kind: "session.loop", targetSessionID: "s", createdAt: 0, status }
        expect(SessionRunner.Job.safeParse(job).success).toBe(true)
      }
    })
  })

  describe("EnqueueOptions schema", () => {
    test("validates empty options", () => {
      expect(SessionRunner.EnqueueOptions.safeParse({}).success).toBe(true)
    })

    test("validates full options", () => {
      const opts = {
        timeoutMs: 60000,
        parentSessionID: "ses_parent",
        toolCallID: "call_123",
        dedupeKey: "my-key",
      }
      expect(SessionRunner.EnqueueOptions.safeParse(opts).success).toBe(true)
    })
  })

  describe("LoopBackgroundInput schema", () => {
    test("validates minimal input", () => {
      const input = { sessionID: "session_123" }
      expect(SessionRunner.LoopBackgroundInput.safeParse(input).success).toBe(true)
    })

    test("validates full input", () => {
      const input = {
        sessionID: "session_123",
        kind: "session.loop" as const,
        parentSessionID: "session_parent",
        toolCallID: "tool_123",
        timeoutMs: 30000,
        dedupeKey: "my-key",
      }
      expect(SessionRunner.LoopBackgroundInput.safeParse(input).success).toBe(true)
    })
  })

  describe("PromptBackgroundInput schema", () => {
    test("validates minimal input", () => {
      const input = {
        sessionID: "session_123",
        parts: [{ type: "text" as const, text: "hello" }],
      }
      expect(SessionRunner.PromptBackgroundInput.safeParse(input).success).toBe(true)
    })

    test("validates full input with job options", () => {
      const input = {
        sessionID: "session_123",
        parts: [{ type: "text" as const, text: "hello" }],
        model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
        agent: "build",
        kind: "session.prompt_async" as const,
        parentSessionID: "session_parent",
        timeoutMs: 60000,
      }
      expect(SessionRunner.PromptBackgroundInput.safeParse(input).success).toBe(true)
    })
  })

  describe("helper functions", () => {
    test("cancelBySession returns false for unknown session", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: () => {
          expect(SessionRunner.cancelBySession("unknown_session")).toBe(false)
        },
      })
    })

    test("getBySession returns undefined for unknown session", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: () => {
          expect(SessionRunner.getBySession("unknown_session")).toBeUndefined()
        },
      })
    })

    test("getBySession finds active job", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let resolve: () => void
          const blocker = new Promise<void>((r) => {
            resolve = r
          })

          const jobPromise = SessionRunner.enqueue("session.loop", "ses_target", async () => {
            await blocker
          })

          await new Promise((r) => setTimeout(r, 10))

          const found = SessionRunner.getBySession("ses_target")
          expect(found).toBeDefined()
          expect(found?.targetSessionID).toBe("ses_target")
          expect(["queued", "running"]).toContain(found!.status)

          resolve!()
          await jobPromise
        },
      })
    })

    test("cancelBySession cancels running job", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let started = false
          const jobPromise = SessionRunner.enqueue("session.loop", "ses_cancel", async () => {
            started = true
            await new Promise((r) => setTimeout(r, 5000))
          })

          while (!started) {
            await new Promise((r) => setTimeout(r, 5))
          }

          const cancelled = SessionRunner.cancelBySession("ses_cancel")
          expect(cancelled).toBe(true)

          const job = await jobPromise
          expect(job.status).toBe("canceled")
        },
      })
    })
  })

  describe("job management", () => {
    test("get returns undefined for unknown job", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: () => {
          expect(SessionRunner.get("nonexistent")).toBeUndefined()
        },
      })
    })

    test("list returns empty array initially", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: () => {
          expect(SessionRunner.list()).toEqual([])
        },
      })
    })

    test("cancel returns false for unknown job", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: () => {
          expect(SessionRunner.cancel("nonexistent")).toBe(false)
        },
      })
    })

    test("isRunning returns false for unknown job", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: () => {
          expect(SessionRunner.isRunning("nonexistent")).toBe(false)
        },
      })
    })

    test("enqueue creates job and runs it", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let executed = false
          const job = await SessionRunner.enqueue(
            "session.loop",
            "ses_test",
            async () => {
              executed = true
            },
          )

          expect(job.id).toMatch(/^job_/)
          expect(job.kind).toBe("session.loop")
          expect(job.targetSessionID).toBe("ses_test")
          expect(job.status).toBe("completed")
          expect(executed).toBe(true)
        },
      })
    })

    test("enqueue with dedupeKey reuses existing job", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let count = 0
          const run = async () => {
            count++
            await new Promise((r) => setTimeout(r, 50))
          }

          const [job1, job2] = await Promise.all([
            SessionRunner.enqueue("session.loop", "ses_test", run, { dedupeKey: "same" }),
            SessionRunner.enqueue("session.loop", "ses_test", run, { dedupeKey: "same" }),
          ])

          expect(job1.id).toBe(job2.id)
          expect(count).toBe(1)
        },
      })
    })

    test("cancel stops queued job", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let executed = false

          const blocker = SessionRunner.enqueue("session.loop", "ses_blocker", async () => {
            await new Promise((r) => setTimeout(r, 100))
          })
          const blocker2 = SessionRunner.enqueue("session.loop", "ses_blocker2", async () => {
            await new Promise((r) => setTimeout(r, 100))
          })

          const jobPromise = SessionRunner.enqueue("session.loop", "ses_test", async () => {
            executed = true
          })

          await new Promise((r) => setTimeout(r, 10))

          const queued = SessionRunner.listQueued()
          if (queued.length > 0) {
            const cancelled = SessionRunner.cancel(queued[0].id)
            expect(cancelled).toBe(true)
          }

          await Promise.all([blocker, blocker2, jobPromise])
        },
      })
    })

    test("job times out", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const job = await SessionRunner.enqueue(
            "session.loop",
            "ses_test",
            async () => {
              await new Promise((r) => setTimeout(r, 500))
            },
            { timeoutMs: 50 },
          )

          expect(job.status).toBe("timed_out")
          expect(job.error?.message).toBe("Job timed out")
        },
      })
    })

    test("job fails on error", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const job = await SessionRunner.enqueue("session.loop", "ses_test", async () => {
            throw new Error("test error")
          })

          expect(job.status).toBe("failed")
          expect(job.error?.message).toBe("test error")
        },
      })
    })

    test("respects concurrency limit", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let maxConcurrent = 0
          let current = 0

          const jobs = Array.from({ length: 5 }, (_, i) =>
            SessionRunner.enqueue("session.loop", `ses_${i}`, async () => {
              current++
              maxConcurrent = Math.max(maxConcurrent, current)
              await new Promise((r) => setTimeout(r, 30))
              current--
            }),
          )

          await Promise.all(jobs)
          expect(maxConcurrent).toBeLessThanOrEqual(2)
        },
      })
    })
  })
})
