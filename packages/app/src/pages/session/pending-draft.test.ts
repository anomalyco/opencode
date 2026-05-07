import { describe, expect, test } from "bun:test"
import type { ContextItem, Prompt } from "@/context/prompt"
import { buildRequestParts } from "@/components/prompt-input/build-request-parts"
import { fromPendingDraft, fromRequestParts, toPendingDraft } from "./pending-draft"

const withoutStructuredClone = <T>(run: () => T) => {
  const original = globalThis.structuredClone
  globalThis.structuredClone = (() => {
    throw new Error("structuredClone should not be called")
  }) as typeof structuredClone
  try {
    return run()
  } finally {
    globalThis.structuredClone = original
  }
}

const isFilePromptPart = <T extends { type: string }>(part: T): part is Extract<T, { type: "file" }> =>
  part.type === "file"

const restorableParts = (parts: unknown[]) => parts as Parameters<typeof fromRequestParts>[0]["parts"]

describe("fromRequestParts", () => {
  test("restores prompt, context files, and structured comments from request parts", () => {
    const prompt: Prompt = [{ type: "text", content: "please review this", start: 0, end: 18 }]
    const context = [
      {
        key: "ctx:file",
        type: "file" as const,
        path: "src/app.ts",
        selection: {
          startLine: 3,
          endLine: 6,
          startChar: 0,
          endChar: 0,
        },
      },
      {
        key: "ctx:comment",
        type: "file" as const,
        path: "src/review.ts",
        selection: {
          startLine: 10,
          endLine: 12,
          startChar: 0,
          endChar: 0,
        },
        comment: "look here @src/other.ts",
        commentID: "comment-1",
        commentOrigin: "review" as const,
        preview: "preview lines",
      },
    ]

    const { requestParts } = buildRequestParts({
      prompt,
      context,
      images: [],
      text: "please review this",
      messageID: "message-1",
      sessionID: "session-1",
      sessionDirectory: "/repo",
    })

    const restored = fromRequestParts({
      parts: restorableParts(requestParts),
      directory: "/repo",
      attachmentName: "attachment",
      existingComments: [
        {
          id: "comment-1",
          file: "src/review.ts",
          selection: { start: 10, end: 12 },
          time: 42,
        },
      ],
    })

    expect(restored.prompt).toEqual(prompt)
    expect(restored.context).toEqual([
      {
        key: expect.any(String),
        type: "file",
        path: "/repo/src/app.ts",
        selection: {
          startLine: 3,
          endLine: 6,
          startChar: 0,
          endChar: 0,
        },
      },
      {
        key: expect.any(String),
        type: "file",
        path: "src/review.ts",
        selection: {
          startLine: 10,
          endLine: 12,
          startChar: 0,
          endChar: 0,
        },
        comment: "look here @src/other.ts",
        commentID: "comment-1",
        commentOrigin: "review",
        preview: "preview lines",
      },
    ])
    expect(restored.comments).toEqual([
      {
        id: "comment-1",
        file: "src/review.ts",
        selection: { start: 10, end: 12 },
        comment: "look here @src/other.ts",
        time: 42,
      },
    ])
  })

  test("preserves a separate context selection on the same file as a comment", () => {
    const prompt: Prompt = [{ type: "text", content: "check both ranges", start: 0, end: 17 }]
    const context = [
      {
        key: "ctx:comment",
        type: "file" as const,
        path: "src/review.ts",
        selection: {
          startLine: 10,
          endLine: 12,
          startChar: 0,
          endChar: 0,
        },
        comment: "review this range",
        commentID: "comment-2",
        commentOrigin: "review" as const,
        preview: "comment range",
      },
      {
        key: "ctx:selection",
        type: "file" as const,
        path: "src/review.ts",
        selection: {
          startLine: 20,
          endLine: 24,
          startChar: 0,
          endChar: 0,
        },
      },
    ]

    const { requestParts } = buildRequestParts({
      prompt,
      context,
      images: [],
      text: "check both ranges",
      messageID: "message-2",
      sessionID: "session-2",
      sessionDirectory: "/repo",
    })

    const restored = fromRequestParts({
      parts: restorableParts(requestParts),
      directory: "/repo",
      attachmentName: "attachment",
      existingComments: [
        {
          id: "comment-2",
          file: "src/review.ts",
          selection: { start: 10, end: 12 },
          time: 84,
        },
      ],
    })

    expect(restored.context).toEqual([
      {
        key: expect.any(String),
        type: "file",
        path: "src/review.ts",
        selection: {
          startLine: 10,
          endLine: 12,
          startChar: 0,
          endChar: 0,
        },
        comment: "review this range",
        commentID: "comment-2",
        commentOrigin: "review",
        preview: "comment range",
      },
      {
        key: expect.any(String),
        type: "file",
        path: "/repo/src/review.ts",
        selection: {
          startLine: 20,
          endLine: 24,
          startChar: 0,
          endChar: 0,
        },
      },
    ])
  })

  test("preserves command drafts while editing even if command names are not hydrated", () => {
    const draft = withoutStructuredClone(() =>
      toPendingDraft({
        attachmentName: "attachment",
        commandNames: [],
        draft: {
          sessionID: "session-3",
          sessionDirectory: "/repo",
          prompt: [{ type: "text", content: "/review --fast", start: 0, end: 14 }],
          context: [],
          agent: "build",
          model: { providerID: "provider", modelID: "model" },
          pendingBaseDraft: {
            kind: "command",
            preview: "/review --fast",
            composer: {
              prompt: [{ type: "text", content: "/review --fast", start: 0, end: 14 }],
              context: [],
            },
            request: {
              command: "review",
              arguments: "--fast",
              parts: [],
            },
          },
        },
      }),
    )

    expect(draft.kind).toBe("command")
    if (draft.kind === "command") {
      expect(draft.request.command).toBe("review")
      expect(draft.request.arguments).toBe("--fast")
    }
  })

  test("restores command drafts with request parts without structuredClone", () => {
    const promptSelection = {
      startLine: 6,
      endLine: 9,
      startChar: 0,
      endChar: 0,
    }
    const contextSelection = {
      startLine: 15,
      endLine: 18,
      startChar: 1,
      endChar: 4,
    }
    const pending = toPendingDraft({
      attachmentName: "attachment",
      commandNames: ["review"],
      draft: {
        sessionID: "session-4",
        sessionDirectory: "/repo",
        prompt: [
          { type: "text", content: "/review ", start: 0, end: 8 },
          {
            type: "file",
            content: "@src/command.ts",
            start: 8,
            end: 23,
            path: "src/command.ts",
            selection: promptSelection,
          },
        ],
        context: [
          {
            key: "ctx:command",
            type: "file",
            path: "src/context.ts",
            selection: contextSelection,
            comment: "keep command context",
            commentID: "comment-command",
            commentOrigin: "review",
            preview: "command context",
          },
        ],
        agent: "build",
        model: { providerID: "provider", modelID: "model" },
        variant: "fast",
      },
    })

    expect(pending.kind).toBe("command")
    if (pending.kind !== "command") throw new Error("expected command draft")
    expect(pending.request.parts?.length).toBeGreaterThan(0)

    const restored = withoutStructuredClone(() =>
      fromPendingDraft({
        draft: pending,
        directory: "/repo",
        attachmentName: "attachment",
      }),
    )

    expect(restored.prompt).toEqual(pending.composer.prompt)
    expect(restored.context).toEqual(pending.composer.context)
    expect(restored.prompt).not.toBe(pending.composer.prompt)
    expect(restored.context).not.toBe(pending.composer.context)
  })

  test("snapshots prompt and context drafts without structuredClone", () => {
    const promptSelection = {
      startLine: 4,
      endLine: 7,
      startChar: 1,
      endChar: 2,
    }
    const contextSelection = {
      startLine: 12,
      endLine: 14,
      startChar: 0,
      endChar: 3,
    }
    const prompt: Prompt = [
      { type: "text", content: "please check ", start: 0, end: 13 },
      {
        type: "file",
        content: "@src/app.ts",
        start: 13,
        end: 24,
        path: "src/app.ts",
        selection: promptSelection,
      },
      { type: "agent", content: "@build", start: 25, end: 31, name: "build" },
      {
        type: "image",
        id: "image-1",
        filename: "diagram.png",
        mime: "image/png",
        dataUrl: "data:image/png;base64,AAA=",
      },
    ]
    const context: (ContextItem & { key: string })[] = [
      {
        key: "ctx:comment",
        type: "file",
        path: "src/review.ts",
        selection: contextSelection,
        comment: "check this range",
        commentID: "comment-3",
        commentOrigin: "review",
        preview: "range preview",
      },
    ]

    const draft = withoutStructuredClone(() =>
      toPendingDraft({
        attachmentName: "attachment",
        commandNames: [],
        draft: {
          sessionID: "session-5",
          sessionDirectory: "/repo",
          prompt,
          context,
          agent: "build",
          model: { providerID: "provider", modelID: "model" },
          variant: "fast",
        },
      }),
    )

    expect(draft.kind).toBe("prompt")
    expect(draft.composer.prompt).toEqual(prompt)
    expect(draft.composer.context).toEqual(context)
    expect(draft.composer.prompt).not.toBe(prompt)
    expect(draft.composer.context).not.toBe(context)
    const filePart = draft.composer.prompt.find(isFilePromptPart)
    expect(filePart?.selection).toEqual(promptSelection)
    expect(filePart?.selection).not.toBe(promptSelection)
    expect(draft.composer.context[0]?.selection).toEqual(contextSelection)
    expect(draft.composer.context[0]?.selection).not.toBe(contextSelection)

    const restored = withoutStructuredClone(() =>
      fromPendingDraft({
        draft,
        directory: "/repo",
        attachmentName: "attachment",
      }),
    )

    expect(restored.prompt).toEqual(draft.composer.prompt)
    expect(restored.context).toEqual(draft.composer.context)
    expect(restored.prompt).not.toBe(draft.composer.prompt)
    expect(restored.context).not.toBe(draft.composer.context)
    const restoredFile = restored.prompt.find(isFilePromptPart)
    const draftFile = draft.composer.prompt.find(isFilePromptPart)
    expect(restoredFile?.selection).toEqual(draftFile?.selection)
    expect(restoredFile?.selection).not.toBe(draftFile?.selection)
    expect(restored.context[0]?.selection).toEqual(draft.composer.context[0]?.selection)
    expect(restored.context[0]?.selection).not.toBe(draft.composer.context[0]?.selection)
  })
})
