import { test, expect } from "bun:test"
import { Question } from "../../src/question"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

// Nested session question propagation tests
// Validates that Question.ask/list/reply work across parent/child session boundaries

test("list - returns questions from multiple sessions (parent + child)", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Parent session asks a question
      Question.ask({
        sessionID: SessionID.make("ses_parent"),
        questions: [
          {
            question: "Parent question?",
            header: "Parent",
            options: [{ label: "A", description: "Option A" }],
          },
        ],
      })

      // Child session asks a question
      Question.ask({
        sessionID: SessionID.make("ses_child"),
        questions: [
          {
            question: "Child question?",
            header: "Child",
            options: [{ label: "B", description: "Option B" }],
          },
        ],
      })

      // list() returns ALL pending questions regardless of session
      const pending = await Question.list()
      expect(pending.length).toBe(2)
      const ids = pending.map((p) => p.sessionID)
      expect(ids).toContain(SessionID.make("ses_parent"))
      expect(ids).toContain(SessionID.make("ses_child"))
    },
  })
})

test("reply - can answer child session question from parent context", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Child session asks
      const ask = Question.ask({
        sessionID: SessionID.make("ses_child"),
        questions: [
          {
            question: "Child needs input",
            header: "Input",
            options: [{ label: "Yes", description: "Confirm" }],
          },
        ],
      })

      // Parent context can see and reply
      const pending = await Question.list()
      expect(pending.length).toBe(1)
      expect(pending[0].sessionID).toBe(SessionID.make("ses_child"))

      await Question.reply({
        requestID: pending[0].id,
        answers: [["Yes"]],
      })

      const answers = await ask
      expect(answers).toEqual([["Yes"]])
    },
  })
})

test("reject - can reject child session question from parent context", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const ask = Question.ask({
        sessionID: SessionID.make("ses_child"),
        questions: [
          {
            question: "Child needs input",
            header: "Input",
            options: [{ label: "Yes", description: "Confirm" }],
          },
        ],
      })

      const pending = await Question.list()
      await Question.reject(pending[0].id)

      await expect(ask).rejects.toBeInstanceOf(Question.RejectedError)
    },
  })
})

test("list - returns questions from deeply nested sessions", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Simulate 3 levels: parent -> child -> grandchild
      Question.ask({
        sessionID: SessionID.make("ses_parent"),
        questions: [
          {
            question: "Level 0?",
            header: "L0",
            options: [{ label: "A", description: "A" }],
          },
        ],
      })

      Question.ask({
        sessionID: SessionID.make("ses_child"),
        questions: [
          {
            question: "Level 1?",
            header: "L1",
            options: [{ label: "B", description: "B" }],
          },
        ],
      })

      Question.ask({
        sessionID: SessionID.make("ses_grandchild"),
        questions: [
          {
            question: "Level 2?",
            header: "L2",
            options: [{ label: "C", description: "C" }],
          },
        ],
      })

      const pending = await Question.list()
      expect(pending.length).toBe(3)
    },
  })
})

test("rejectSession - only rejects questions for the specified session", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const child = Question.ask({
        sessionID: SessionID.make("ses_child"),
        questions: [
          {
            question: "Child?",
            header: "C",
            options: [{ label: "X", description: "X" }],
          },
        ],
      })

      Question.ask({
        sessionID: SessionID.make("ses_other"),
        questions: [
          {
            question: "Other?",
            header: "O",
            options: [{ label: "Y", description: "Y" }],
          },
        ],
      })

      // Reject only child session
      await Question.rejectSession(SessionID.make("ses_child"))

      await expect(child).rejects.toBeInstanceOf(Question.RejectedError)

      // Other session's question should still be pending
      const pending = await Question.list()
      expect(pending.length).toBe(1)
      expect(pending[0].sessionID).toBe(SessionID.make("ses_other"))
    },
  })
})

test("reply - resolving parent question does not affect child questions", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const parent = Question.ask({
        sessionID: SessionID.make("ses_parent"),
        questions: [
          {
            question: "Parent?",
            header: "P",
            options: [{ label: "A", description: "A" }],
          },
        ],
      })

      Question.ask({
        sessionID: SessionID.make("ses_child"),
        questions: [
          {
            question: "Child?",
            header: "C",
            options: [{ label: "B", description: "B" }],
          },
        ],
      })

      // Reply to parent only
      const pending = await Question.list()
      const req = pending.find((p) => p.sessionID === SessionID.make("ses_parent"))!
      await Question.reply({
        requestID: req.id,
        answers: [["A"]],
      })

      await expect(parent).resolves.toEqual([["A"]])

      // Child question should still be pending
      const remaining = await Question.list()
      expect(remaining.length).toBe(1)
      expect(remaining[0].sessionID).toBe(SessionID.make("ses_child"))
    },
  })
})
