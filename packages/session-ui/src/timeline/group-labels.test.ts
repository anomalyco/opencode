import { describe, expect, test } from "bun:test"
import { useI18n } from "@opencode/ui/context/i18n"
import { storyTool } from "../storybook/current-session-scenarios"
import { contextGroupLabel } from "../tools/context-group-label"
import type { ContextGroupPart } from "../tools/tool-renderer"
import { labelGroups } from "./group-label-fixtures"

// Pins the labels the current timeline's groups show, so moving their counting does not change a word.

const i18n = useI18n()

describe("group labels", () => {
  test("the current timeline names a group by the tools it used", () => {
    expect(
      Object.fromEntries(
        Object.entries(labelGroups).map(([name, parts]) => [
          name,
          contextGroupLabel(
            parts.flatMap((part): ContextGroupPart[] => (part.type === "event" ? [] : [part])),
            i18n,
          ),
        ]),
      ),
    ).toMatchSnapshot()
  })

  test("the current timeline counts a user shell as a Shell call", () => {
    const parts: ContextGroupPart[] = [
      { type: "shell", id: "u1", render: () => null },
      storyTool("r1", "read", "completed", { path: "/repo/a.ts" }),
      { type: "notice", id: "n1", render: () => null },
    ]

    expect(contextGroupLabel(parts, i18n).text).toBe("Used 2 Shell, Read")
    expect(contextGroupLabel([{ type: "notice", id: "n1", render: () => null }], i18n).text).toBe("Updates")
  })

  test("the current timeline counts a script's steps, without a patch for its changes, with scriptSteps", () => {
    const step = (tool: string, input: Record<string, string>) => ({ tool, status: "completed", input })

    const script = storyTool(
      "x1",
      "execute",
      "completed",
      {},
      {
        metadata: {
          toolCalls: [
            step("read", { path: "/repo/a.ts" }),
            step("shell", { command: "ls" }),
            step("edit", { path: "/repo/b.ts" }),
            step("Bun", { method: "write", path: "/repo/c.ts" }),
          ],
          files: [{ file: "/repo/b.ts" }, { file: "/repo/c.ts" }],
        },
      },
    )

    expect(contextGroupLabel([script], i18n, true).text).toBe("Used 4 Read, Shell, Edit")
    expect(contextGroupLabel([script], i18n).text).toBe("Used 1 Execute")
  })
})
