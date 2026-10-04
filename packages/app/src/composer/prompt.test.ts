import { Skill } from "@opencode/schema/skill"
import { SessionMessage } from "@opencode/schema/session-message"
import { describe, expect, test } from "bun:test"
import type { SessionMessageUser } from "@opencode/client/promise"
import { extractPromptComments, extractPromptFromMessage } from "./prompt"

describe("extractPromptFromMessage", () => {
  test("restores uploaded attachments in order, optimistic data URLs, and review comments", () => {
    const message = {
      id: SessionMessage.ID.make("msg_1", { disableChecks: true }),
      type: "user",
      text: "model text",
      metadata: {
        displayText: "visible text",
        comments: [
          {
            path: "src/app.ts",
            comment: "check this",
            selection: { startLine: 2, startChar: 0, endLine: 2, endChar: 4 },
            origin: "review",
          },
        ],
      },
      files: [
        { data: "AAA", mime: "image/png", source: { type: "inline" }, name: "a.png" },
        { data: "BBB", mime: "application/pdf", source: { type: "inline" }, name: "b.pdf" },
        { data: "", mime: "image/png", source: { type: "uri", uri: "data:image/png;base64,CCC" }, name: "c.png" },
      ],
      time: { created: 1 },
    } satisfies SessionMessageUser

    expect(extractPromptFromMessage(message)).toEqual([
      { type: "text", content: "visible text", start: 0, end: 12 },
      ...[
        ["a.png", "image/png", "data:image/png;base64,AAA"],
        ["b.pdf", "application/pdf", "data:application/pdf;base64,BBB"],
        ["c.png", "image/png", "data:image/png;base64,CCC"],
      ].map(([filename, mime, url], index) => ({
        type: "image" as const,
        id: `msg_1:file:${index}`,
        filename,
        mime,
        blob: { id: url, url },
      })),
    ])
    expect(extractPromptComments(message)).toMatchObject([
      { path: "src/app.ts", comment: "check this", origin: "review" },
    ])
  })

  test("keeps the directory of a file mention without an at-sign", () => {
    const message = {
      id: SessionMessage.ID.make("msg_1", { disableChecks: true }),
      type: "user",
      text: "inspect src/client.ts",
      files: [
        {
          data: "",
          mime: "text/plain",
          source: { type: "uri", uri: "file:///repo/src/client.ts" },
          name: "client.ts",
          mention: { text: "src/client.ts", start: 8, end: 21 },
        },
      ],
      time: { created: 1 },
    } satisfies SessionMessageUser

    expect(extractPromptFromMessage(message)).toMatchObject([
      { type: "text", content: "inspect " },
      { type: "file", content: "src/client.ts", path: "src/client.ts" },
    ])
  })

  test("uses model text when presentation metadata is incomplete", () => {
    const message = {
      id: SessionMessage.ID.make("msg_1", { disableChecks: true }),
      type: "user",
      text: "model text",
      metadata: { displayText: "partial display text" },
      time: { created: 1 },
    } satisfies SessionMessageUser

    expect(extractPromptFromMessage(message)[0]).toMatchObject({ type: "text", content: "model text" })
  })

  test("restores skill mentions as structured Composer parts", () => {
    const message = {
      id: SessionMessage.ID.make("msg_1", { disableChecks: true }),
      type: "user",
      text: "Use @review",
      skills: [
        {
          id: Skill.ID.make("review", { disableChecks: true }),
          name: "Review",
          mention: { text: "@review", start: 4, end: 11 },
        },
      ],
      time: { created: 1 },
    } satisfies SessionMessageUser

    expect(extractPromptFromMessage(message)).toMatchObject([
      { type: "text", content: "Use " },
      {
        type: "skill",
        id: "review",
        name: "Review",
        content: "@review",
      },
    ])
  })
})
