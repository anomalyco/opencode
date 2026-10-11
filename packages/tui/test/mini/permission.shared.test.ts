import { SessionMessage } from "@opencode/schema/session-message"
import { Session } from "@opencode/schema/session"
import { Permission } from "@opencode/schema/permission"
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
    id: Permission.ID.make("perm-1", { disableChecks: true }),
    sessionID: Session.ID.make("session-1", { disableChecks: true }),
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
    const out = permissionRun(body(), Permission.ID.make("perm-1", { disableChecks: true }), "once")

    expect<unknown>(out.reply).toEqual({
      sessionID: "session-1",
      requestID: "perm-1",
      decision: "once",
    })
  })

  test("requires confirmation for allow always", () => {
    const next = permissionRun(body(), Permission.ID.make("perm-1", { disableChecks: true }), "always")
    expect(next.state.stage).toBe("always")
    expect(next.state.selected).toBe("confirm")
    expect(next.reply).toBeUndefined()

    expect<unknown>(permissionRun(next.state, Permission.ID.make("perm-1", { disableChecks: true }), "confirm").reply).toEqual({
      sessionID: "session-1",
      requestID: "perm-1",
      decision: "always",
    })

    expect(
      permissionRun(next.state, Permission.ID.make("perm-1", { disableChecks: true }), "cancel").state,
    ).toMatchObject({
      stage: "permission",
      selected: "always",
    })
  })

  test("builds trimmed reject replies and stage transitions", () => {
    const next = permissionRun(body(), Permission.ID.make("perm-1", { disableChecks: true }), "reject")
    expect(next.state.stage).toBe("reject")

    const out = permissionReject(
      { ...next.state, message: "  use rg  " },
      Permission.ID.make("perm-1", { disableChecks: true }),
    )
    expect<unknown>(out).toEqual({
      sessionID: "session-1",
      requestID: "perm-1",
      decision: "reject",
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
          source: {
            type: "tool",
            messageID: SessionMessage.ID.make("msg-shell", { disableChecks: true }),
            id: "call-shell",
          },
          tool: canonicalToolPart(
            "shell",
            {
              status: "running",
              input: { command: "git status --short" },
              metadata: {},
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
          source: {
            type: "tool",
            messageID: SessionMessage.ID.make("msg-search", { disableChecks: true }),
            id: "call-search",
          },
          tool: canonicalToolPart(
            "websearch",
            {
              status: "running",
              input: { query: "current releases" },
              metadata: { provider: "exa", retained: true },
            },
            "call-search",
          ),
        }),
      ),
    ).toMatchObject({
      title: 'Web Search via Parallel "current releases"',
      lines: ["Query: current releases"],
    })
  })

  test("uses source patch text when an edit has no generated diff", () => {
    const patch = '*** Begin Patch\n*** Update File: src/index.ts\n@@\n-old\n+const arrow = "→"\n*** End Patch'
    const request = req({
      action: "edit",
      resources: ["src/index.ts"],
      source: { type: "tool", messageID: SessionMessage.ID.make("msg-edit", { disableChecks: true }), id: "call-edit" },
      tool: canonicalToolPart(
        "edit",
        {
          status: "running",
          input: { patchText: patch },
          metadata: {},
        },
        "call-edit",
      ),
    })
    expect(permissionInfo(request)).toMatchObject({
      title: "Edit src/index.ts",
      diff: undefined,
      patch,
    })
    expect(permissionInfo(request, undefined, true)).toMatchObject({
      title: "Edit src/index.ts",
      lines: [patch],
      diff: undefined,
      patch: undefined,
    })
  })

  test("formats always-allow copy for wildcard and explicit patterns", () => {
    expect(permissionAlwaysLines(req({ action: "bash", save: ["*"] }))).toEqual([
      "This will always allow bash for this project.",
    ])

    expect(permissionAlwaysLines(req({ save: ["src/**/*.ts", "src/**/*.tsx"] }))).toEqual([
      "This will always allow the following patterns for this project.",
      "- src/**/*.ts",
      "- src/**/*.tsx",
    ])
  })
})
