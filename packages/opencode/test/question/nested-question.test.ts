import { test, expect } from "bun:test"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

test("nested sessions - grandchild question appears in list", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Create root session
      const root = await Session.create({})

      // Create child session
      const child = await Session.create({ parentID: root.id })

      // Create grandchild session
      const grandchild = await Session.create({ parentID: child.id })

      // Ask a question from the grandchild session
      const questions = [
        {
          question: "What would you like to do?",
          header: "Grandchild Action",
          options: [
            { label: "Option A", description: "First option from grandchild" },
            { label: "Option B", description: "Second option from grandchild" },
          ],
        },
      ]

      Question.ask({
        sessionID: grandchild.id,
        questions,
      })

      // Verify the question appears in the list
      const pending = await Question.list()
      expect(pending.length).toBe(1)
      expect(pending[0].sessionID).toBe(grandchild.id)
      expect(pending[0].questions).toEqual(questions)

      // Cleanup
      await Session.remove(grandchild.id)
      await Session.remove(child.id)
      await Session.remove(root.id)
    },
  })
})

test("nested sessions - questions from multiple levels", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Create session hierarchy: root -> child -> grandchild
      const root = await Session.create({})
      const child = await Session.create({ parentID: root.id })
      const grandchild = await Session.create({ parentID: child.id })

      // Ask question from root
      const rootQuestions = [
        {
          question: "Root question?",
          header: "Root",
          options: [{ label: "Root A", description: "Root option" }],
        },
      ]

      Question.ask({
        sessionID: root.id,
        questions: rootQuestions,
      })

      // Ask question from child
      const childQuestions = [
        {
          question: "Child question?",
          header: "Child",
          options: [{ label: "Child A", description: "Child option" }],
        },
      ]

      Question.ask({
        sessionID: child.id,
        questions: childQuestions,
      })

      // Ask question from grandchild
      const grandchildQuestions = [
        {
          question: "Grandchild question?",
          header: "Grandchild",
          options: [{ label: "Grandchild A", description: "Grandchild option" }],
        },
      ]

      Question.ask({
        sessionID: grandchild.id,
        questions: grandchildQuestions,
      })

      // Verify all questions appear in the list
      const pending = await Question.list()
      expect(pending.length).toBe(3)

      // Verify each session has its question
      const rootPending = pending.find((p) => p.sessionID === root.id)
      expect(rootPending).toBeDefined()
      expect(rootPending?.questions).toEqual(rootQuestions)

      const childPending = pending.find((p) => p.sessionID === child.id)
      expect(childPending).toBeDefined()
      expect(childPending?.questions).toEqual(childQuestions)

      const grandchildPending = pending.find((p) => p.sessionID === grandchild.id)
      expect(grandchildPending).toBeDefined()
      expect(grandchildPending?.questions).toEqual(grandchildQuestions)

      // Cleanup - reply to questions first to remove them from pending
      await Question.reply({
        requestID: rootPending!.id,
        answers: [["Root A"]],
      })

      await Question.reply({
        requestID: childPending!.id,
        answers: [["Child A"]],
      })

      await Question.reply({
        requestID: grandchildPending!.id,
        answers: [["Grandchild A"]],
      })

      await Session.remove(grandchild.id)
      await Session.remove(child.id)
      await Session.remove(root.id)
    },
  })
})

test("nested sessions - deep hierarchy (4 levels)", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Create deep hierarchy: root -> child -> grandchild -> great-grandchild
      const root = await Session.create({})
      const child = await Session.create({ parentID: root.id })
      const grandchild = await Session.create({ parentID: child.id })
      const greatGrandchild = await Session.create({ parentID: grandchild.id })

      // Ask question from the deepest level
      const questions = [
        {
          question: "Question from great-grandchild?",
          header: "Deep Question",
          options: [{ label: "Deep Option", description: "From 4th level" }],
        },
      ]

      Question.ask({
        sessionID: greatGrandchild.id,
        questions,
      })

      // Verify the question appears in the list
      const pending = await Question.list()
      expect(pending.length).toBe(1)
      expect(pending[0].sessionID).toBe(greatGrandchild.id)
      expect(pending[0].questions).toEqual(questions)

      // Cleanup
      await Question.reply({
        requestID: pending[0].id,
        answers: [["Deep Option"]],
      })

      await Session.remove(greatGrandchild.id)
      await Session.remove(grandchild.id)
      await Session.remove(child.id)
      await Session.remove(root.id)
    },
  })
})

test("nested sessions - verify session parent-child relationships", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Create session hierarchy
      const root = await Session.create({})
      const child = await Session.create({ parentID: root.id })
      const grandchild = await Session.create({ parentID: child.id })

      // Verify the parent-child relationships are set correctly
      const rootInfo = await Session.get(root.id)
      expect(rootInfo.parentID).toBeUndefined()

      const childInfo = await Session.get(child.id)
      expect(childInfo.parentID).toBe(root.id)

      const grandchildInfo = await Session.get(grandchild.id)
      expect(grandchildInfo.parentID).toBe(child.id)

      // Cleanup
      await Session.remove(grandchild.id)
      await Session.remove(child.id)
      await Session.remove(root.id)
    },
  })
})
