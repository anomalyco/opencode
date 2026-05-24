import { expect, test } from "bun:test"
import { confirmationAction } from "@/cli/cmd/tui/routes/session/permission"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import type { TuiConfig } from "@/cli/cmd/tui/config/tui"

function request(input: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: "per_test",
    sessionID: "ses_test",
    permission: "bash",
    patterns: ["touch test"],
    metadata: {},
    always: ["touch *"],
    ...input,
  }
}

test("permission prompt confirms allow always by default", () => {
  expect(confirmationAction(undefined, request(), "once")).toBe("never")
  expect(confirmationAction(undefined, request(), "always")).toBe("always")
  expect(confirmationAction(undefined, request(), "reject")).toBe("never")
})

test("permission prompt confirmation supports response defaults", () => {
  const confirmation: TuiConfig.Resolved["permission_prompt"]["confirmation"] = {
    default: "never",
    response: {
      reject: "always",
    },
  }

  expect(confirmationAction(confirmation, request(), "always")).toBe("never")
  expect(confirmationAction(confirmation, request(), "reject")).toBe("always")
})

test("permission prompt confirmation supports permission pattern overrides", () => {
  const confirmation: TuiConfig.Resolved["permission_prompt"]["confirmation"] = {
    default: "never",
    permission: {
      bash: {
        "*": "never",
        "rm *": "always",
      },
    },
  }

  expect(confirmationAction(confirmation, request({ patterns: ["touch test"] }), "always")).toBe("never")
  expect(confirmationAction(confirmation, request({ patterns: ["rm test"] }), "always")).toBe("always")
})
