import { describe, expect, test } from "bun:test"
import { SessionCodexCli } from "../../src/session/codex-cli"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"

const sessionID = SessionID.make("session_test")
const providerID = ProviderID.make("test")
const modelID = ModelID.make("model_test")

function message(role: "user" | "assistant", id: string, parts: MessageV2.Part[]): MessageV2.WithParts {
  return {
    info:
      role === "user"
        ? {
            id: MessageID.make(id),
            sessionID,
            role,
            time: { created: 0 },
            agent: "build",
            model: { providerID, modelID },
          }
        : {
            id: MessageID.make(id),
            sessionID,
            role,
            parentID: MessageID.make("msg_user"),
            time: { created: 0 },
            agent: "build",
            mode: "build",
            path: { cwd: "/repo", root: "/repo" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID,
            providerID,
          },
    parts,
  }
}

describe("SessionCodexCli", () => {
  test("responseItemsFromMessages preserves history as separate Codex items", () => {
    const items = SessionCodexCli.responseItemsFromMessages([
      message("user", "msg_user", [
        {
          id: PartID.make("prt_user"),
          sessionID,
          messageID: MessageID.make("msg_user"),
          type: "text",
          text: "Fix the failing test",
        },
      ]),
      message("assistant", "msg_assistant", [
        {
          id: PartID.make("prt_reasoning"),
          sessionID,
          messageID: MessageID.make("msg_assistant"),
          type: "reasoning",
          text: "Need to inspect logs",
          time: { start: 0 },
        },
        {
          id: PartID.make("prt_tool"),
          sessionID,
          messageID: MessageID.make("msg_assistant"),
          type: "tool",
          tool: "bash",
          callID: "call_1",
          state: {
            status: "completed",
            input: { command: "bun test" },
            output: "1 failed",
            title: "",
            metadata: {},
            time: { start: 0, end: 1 },
          },
        },
      ]),
    ])

    expect(items).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Fix the failing test" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "[reasoning]\nNeed to inspect logs\n\n[tool:bash]\n1 failed",
          },
        ],
      },
    ])
  })

  test("inputFromMessage builds a single Codex turn from the current user message", () => {
    expect(
      SessionCodexCli.inputFromMessage(
        message("user", "msg_user", [
          {
            id: PartID.make("prt_user"),
            sessionID,
            messageID: MessageID.make("msg_user"),
            type: "text",
            text: "Inspect this screenshot",
          },
          {
            id: PartID.make("prt_image"),
            sessionID,
            messageID: MessageID.make("msg_user"),
            type: "file",
            mime: "image/png",
            filename: "screenshot.png",
            url: "data:image/png;base64,abc",
          },
        ]),
      ),
    ).toEqual([
      { type: "text", text: "Inspect this screenshot", text_elements: [] },
      { type: "image", url: "data:image/png;base64,abc" },
    ])
  })

  test("patchFiles maps Codex file updates to UI patch metadata", () => {
    expect(
      SessionCodexCli.patchFiles(
        [
          {
            path: "/repo/src/index.ts",
            diff: "--- a/src/index.ts\n+++ b/src/index.ts\n@@\n-old\n+new\n+extra",
            kind: { type: "update" },
          },
          {
            path: "/repo/src/old.ts",
            diff: "--- a/src/old.ts\n+++ b/src/new.ts\n@@\n-old\n+new",
            kind: { type: "update", move_path: "/repo/src/new.ts" },
          },
        ],
        "/repo",
      ),
    ).toEqual([
      {
        filePath: "/repo/src/index.ts",
        relativePath: "src/index.ts",
        type: "update",
        diff: "--- a/src/index.ts\n+++ b/src/index.ts\n@@\n-old\n+new\n+extra",
        additions: 2,
        deletions: 1,
      },
      {
        filePath: "/repo/src/old.ts",
        relativePath: "src/old.ts",
        type: "move",
        diff: "--- a/src/old.ts\n+++ b/src/new.ts\n@@\n-old\n+new",
        additions: 1,
        deletions: 1,
        movePath: "/repo/src/new.ts",
      },
    ])
  })
})
