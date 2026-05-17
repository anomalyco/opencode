import path from "path"
import { describe, expect, test } from "bun:test"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { toolInlineInfo, toolScroll, type ToolFrame } from "@/cli/cmd/run/tool"

function frame(name: string, input: Record<string, unknown>): ToolFrame {
  return {
    raw: "",
    name,
    input,
    meta: {},
    state: {
      status: "running",
      input,
      metadata: {},
    },
    status: "running",
    error: "",
  }
}

function scroll(name: string, input: Record<string, unknown>) {
  return toolScroll("start", frame(name, input))
}

function part(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown> = {}): ToolPart {
  return {
    id: `${tool}-1`,
    sessionID: "session-1",
    messageID: `msg-${tool}`,
    type: "tool",
    callID: `call-${tool}`,
    tool,
    state: {
      status: "completed",
      input,
      metadata,
    },
  } as ToolPart
}

describe("run tool display", () => {
  test("omits root workdir from bash scroll title", () => {
    expect(
      scroll("bash", {
        command: "git diff --check",
        workdir: process.cwd(),
        description: "Final whitespace check before commit",
      }),
    ).toBe("# Final whitespace check before commit\n$ git diff --check")
  })

  test("keeps meaningful bash workdir in scroll title", () => {
    expect(
      scroll("bash", {
        command: "bun test",
        workdir: path.join(process.cwd(), "apps/api"),
        description: "Run API tests",
      }),
    ).toBe("# Run API tests in apps/api\n$ bun test")

    expect(
      scroll("bash", {
        command: "bun test",
        workdir: path.join(process.cwd(), "apps/api"),
        description: "Run API tests in apps/api",
      }),
    ).toBe("# Run API tests in apps/api\n$ bun test")
  })

  test("omits root path from glob and grep scroll titles", () => {
    expect(
      scroll("glob", {
        pattern: "**/*.ts",
        path: process.cwd(),
      }),
    ).toBe('✱ Glob "**/*.ts"')

    expect(
      scroll("grep", {
        pattern: "tool",
        path: process.cwd(),
      }),
    ).toBe('✱ Grep "tool"')
  })

  test("applies the same root path rule to glob and grep inline descriptions", () => {
    expect(
      toolInlineInfo(
        part("glob", {
          pattern: "**/*.ts",
          path: process.cwd(),
        }),
      ),
    ).toEqual({
      icon: "✱",
      title: 'Glob "**/*.ts"',
    })

    expect(
      toolInlineInfo(
        part("grep", {
          pattern: "tool",
          path: process.cwd(),
        }),
      ),
    ).toEqual({
      icon: "✱",
      title: 'Grep "tool"',
    })

    expect(
      toolInlineInfo(
        part("glob", {
          pattern: "**/*.ts",
          path: path.join(process.cwd(), "apps/api"),
        }),
      ),
    ).toMatchObject({
      description: "in apps/api",
    })

    expect(
      toolInlineInfo(
        part("grep", {
          pattern: "tool",
          path: path.join(process.cwd(), "apps/api"),
        }),
      ),
    ).toMatchObject({
      description: "in apps/api",
    })
  })
})
