import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import type { FileContextItem, MessageContextItem } from "./prompt"

let createPromptSessionForTest: typeof import("./prompt").createPromptSessionForTest

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useParams: () => ({}),
  }))
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: () => ({
      use: () => undefined,
      provider: () => undefined,
    }),
  }))
  const mod = await import("./prompt")
  createPromptSessionForTest = mod.createPromptSessionForTest
})

const file = (id: string, comment = id): FileContextItem => ({
  type: "file",
  path: `src/${id}.ts`,
  selection: { startLine: 1, startChar: 0, endLine: 2, endChar: 0 },
  comment,
  commentID: id,
  commentOrigin: "review",
  preview: `file ${id}`,
})

const msg = (id: string, comment = id): MessageContextItem => ({
  type: "message",
  annotationID: id,
  messageID: `msg_${id}`,
  role: "assistant",
  quote: `quote ${id}`,
  comment,
  preview: `preview ${id}`,
})

describe("prompt context messages", () => {
  test("context.add deduplicates message annotations by annotationID", () => {
    createRoot((dispose) => {
      const prompt = createPromptSessionForTest()

      prompt.context.add(msg("a1", "first"))
      prompt.context.add({
        ...msg("a1", "second"),
        messageID: "msg_other",
        quote: "other quote",
      })

      expect(prompt.context.items()).toHaveLength(1)
      expect(prompt.context.items()[0]).toMatchObject({
        type: "message",
        annotationID: "a1",
        messageID: "msg_a1",
        comment: "first",
        key: "message:a1",
      })

      dispose()
    })
  })

  test("updateMessage changes only the targeted annotation", () => {
    createRoot((dispose) => {
      const prompt = createPromptSessionForTest({
        items: [msg("a1", "first"), msg("a2", "second"), file("c1", "file")],
      })

      prompt.context.updateMessage("a2", {
        messageID: "msg_next",
        role: "user",
        quote: "updated quote",
        comment: "updated comment",
        preview: "updated preview",
      })

      expect(prompt.context.items()).toMatchObject([
        {
          type: "message",
          annotationID: "a1",
          messageID: "msg_a1",
          role: "assistant",
          quote: "quote a1",
          comment: "first",
          preview: "preview a1",
          key: "message:a1",
        },
        {
          type: "message",
          annotationID: "a2",
          messageID: "msg_next",
          role: "user",
          quote: "updated quote",
          comment: "updated comment",
          preview: "updated preview",
          key: "message:a2",
        },
        {
          type: "file",
          path: "src/c1.ts",
          comment: "file",
          commentID: "c1",
        },
      ])

      dispose()
    })
  })

  test("removeMessage removes only the targeted annotation", () => {
    createRoot((dispose) => {
      const prompt = createPromptSessionForTest({
        items: [msg("a1"), msg("a2"), file("c1")],
      })

      prompt.context.removeMessage("a1")

      expect(prompt.context.items()).toMatchObject([
        {
          type: "message",
          annotationID: "a2",
          key: "message:a2",
        },
        {
          type: "file",
          path: "src/c1.ts",
          commentID: "c1",
        },
      ])

      dispose()
    })
  })

  test("replaceMessages swaps message annotations and keeps file comments", () => {
    createRoot((dispose) => {
      const prompt = createPromptSessionForTest({
        items: [msg("a1"), file("c1"), msg("a2"), file("c2", "other")],
      })

      prompt.context.replaceMessages([msg("b1"), msg("b2", "fresh")])

      expect(prompt.context.items()).toMatchObject([
        {
          type: "file",
          path: "src/c1.ts",
          commentID: "c1",
        },
        {
          type: "file",
          path: "src/c2.ts",
          commentID: "c2",
          comment: "other",
        },
        {
          type: "message",
          annotationID: "b1",
          key: "message:b1",
        },
        {
          type: "message",
          annotationID: "b2",
          comment: "fresh",
          key: "message:b2",
        },
      ])

      dispose()
    })
  })

  test("replaceComments keeps message annotations in place", () => {
    createRoot((dispose) => {
      const prompt = createPromptSessionForTest({
        items: [msg("a1"), file("c1"), msg("a2")],
      })

      prompt.context.replaceComments([file("c2", "next")])

      expect(prompt.context.items()).toMatchObject([
        {
          type: "message",
          annotationID: "a1",
          key: "message:a1",
        },
        {
          type: "message",
          annotationID: "a2",
          key: "message:a2",
        },
        {
          type: "file",
          path: "src/c2.ts",
          commentID: "c2",
          comment: "next",
        },
      ])

      dispose()
    })
  })
})
