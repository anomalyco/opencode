import { describe, expect, test } from "bun:test"
import {
  createPermissionBodyState,
  permissionAlwaysLines,
  permissionCancel,
  permissionEscape,
  permissionInfo,
  permissionReject,
  permissionRun,
} from "../../src/mini/permission.shared"
import type { MiniPermissionRequest } from "../../src/mini/types"
import { canonicalToolPart } from "./fixture/tool-part"

function req(input: Partial<MiniPermissionRequest> = {}): MiniPermissionRequest {
  return {
    id: "perm-1",
    sessionID: "session-1",
    action: "read",
    resources: [],
    metadata: {},
    save: [],
    ...input,
  }
}

function body() {
  return createPermissionBodyState(req())
}

describe("run permission shared", () => {
  test("replies immediately for allow once", () => {
    const out = permissionRun(body(), "perm-1", "once")

    expect(out.reply).toEqual({
      sessionID: "session-1",
      requestID: "perm-1",
      reply: "once",
    })
  })

  test("requires confirmation for allow always", () => {
    const next = permissionRun(body(), "perm-1", "always")
    expect(next.state.stage).toBe("always")
    expect(next.state.selected).toBe("confirm")
    expect(next.reply).toBeUndefined()

    expect(permissionRun(next.state, "perm-1", "confirm").reply).toEqual({
      sessionID: "session-1",
      requestID: "perm-1",
      reply: "always",
    })

    expect(permissionRun(next.state, "perm-1", "cancel").state).toMatchObject({
      stage: "permission",
      selected: "always",
    })
  })

  test("builds trimmed reject replies and stage transitions", () => {
    const next = permissionRun(body(), "perm-1", "reject")
    expect(next.state.stage).toBe("reject")

    const out = permissionReject({ ...next.state, message: "  use rg  " }, "perm-1")
    expect(out).toEqual({
      sessionID: "session-1",
      requestID: "perm-1",
      reply: "reject",
      message: "use rg",
    })

    expect(permissionCancel(next.state)).toMatchObject({
      stage: "permission",
      selected: "reject",
    })

    expect(permissionEscape(body())).toMatchObject({
      stage: "reject",
      selected: "reject",
    })

    expect(permissionEscape({ ...next.state, stage: "always", selected: "confirm" })).toMatchObject({
      stage: "permission",
      selected: "always",
    })
  })

  test("maps supported permission types into display info", () => {
    expect(
      permissionInfo(
        req({
          action: "shell",
          source: { type: "tool", messageID: "msg-shell", callID: "call-shell" },
          tool: canonicalToolPart(
            "shell",
            {
              status: "running",
              input: { command: "git status --short" },
              structured: {},
              content: [],
            },
            "call-shell",
          ),
        }),
      ),
    ).toMatchObject({
      title: "Shell command",
      lines: ["$ git status --short"],
    })

    expect(
      permissionInfo(
        req({
          action: "external_directory",
          resources: ["/tmp/work/**/*.ts", "/tmp/work/**/*.tsx"],
        }),
      ),
    ).toMatchObject({
      title: "Access external directory /tmp/work",
      lines: ["- /tmp/work/**/*.ts", "- /tmp/work/**/*.tsx"],
    })

    expect(permissionInfo(req({ action: "doom_loop" }))).toMatchObject({
      title: "Continue after repeated failures",
    })

    expect(permissionInfo(req({ action: "custom_tool" }))).toMatchObject({
      title: "Call tool custom_tool",
      lines: ["Tool: custom_tool"],
    })
  })

  test("prefers canonical request metadata over source tool metadata", () => {
    expect(
      permissionInfo(
        req({
          action: "websearch",
          metadata: { provider: "parallel" },
          source: { type: "tool", messageID: "msg-search", callID: "call-search" },
          tool: canonicalToolPart(
            "websearch",
            {
              status: "running",
              input: { query: "current releases" },
              structured: { provider: "exa", retained: true },
              content: [],
            },
            "call-search",
          ),
        }),
      ),
    ).toMatchObject({
      title: 'Parallel Web Search "current releases"',
      lines: ["Query: current releases"],
    })
  })

  test("uses source patch text when an edit has no generated diff", () => {
    expect(
      permissionInfo(
        req({
          action: "edit",
          resources: ["src/index.ts"],
          source: { type: "tool", messageID: "msg-edit", callID: "call-edit" },
          tool: canonicalToolPart(
            "edit",
            {
              status: "running",
              input: { patchText: "*** Begin Patch\n*** Update File: src/index.ts\n@@\n-old\n+new\n*** End Patch" },
              structured: {},
              content: [],
            },
            "call-edit",
          ),
        }),
      ),
    ).toMatchObject({
      title: "Edit src/index.ts",
      diff: undefined,
      patch: "*** Begin Patch\n*** Update File: src/index.ts\n@@\n-old\n+new\n*** End Patch",
    })
  })

  test("formats always-allow copy for wildcard and explicit patterns", () => {
    expect(permissionAlwaysLines(req({ action: "bash", save: ["*"] }))).toEqual([
      "This will allow bash until OpenCode is restarted.",
    ])

    expect(permissionAlwaysLines(req({ save: ["src/**/*.ts", "src/**/*.tsx"] }))).toEqual([
      "This will allow the following patterns until OpenCode is restarted.",
      "- src/**/*.ts",
      "- src/**/*.tsx",
    ])
  })
})
