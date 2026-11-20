import { describe, expect, test } from "bun:test"
import { storyTool } from "../storybook/current-session-scenarios"
import { factsOf, summarize } from "./facts"
import { categoryOf } from "./place"

describe("timeline facts", () => {
  test("names facts by stable ids", () => {
    const part = { ...storyTool("p1", "edit", "completed", { path: "/repo/a.ts" }), messageID: "msg_1" }

    expect(factsOf([part]).map((fact) => fact.id)).toEqual(["msg_1:p1", "msg_1:p1:file:/repo/a.ts"])
  })

  test("names calls by their current tool and mode", () => {
    const facts = factsOf([
      storyTool("b1", "bash", "completed", { command: "ls" }),
      storyTool("t1", "task", "running", { description: "look" }),
      storyTool("p1", "apply_patch", "completed", {}, { metadata: { files: [{ file: "/repo/z.ts", additions: 2 }] } }),
      storyTool("x1", "custom", "error", {}),
    ])

    expect(
      facts.map((fact) => (fact.kind === "call" ? [fact.name, fact.mode, fact.background, fact.failed] : fact.kind)),
    ).toEqual([
      ["shell", "run", false, false],
      ["subagent", "tool", true, false],
      ["patch", "edit", false, false],
      "file",
      ["custom", "tool", false, true],
    ])
    expect(facts.map(categoryOf)).toEqual(["shell", "subagents", "edit", "edit", "tools"])
    expect(facts[3]).toMatchObject({ path: "/repo/z.ts", additions: 2, by: "p1", via: "direct" })
  })

  test("counts each file and read once", () => {
    const summary = summarize(
      factsOf([
        storyTool("r1", "read", "completed", { path: "/repo/a.ts" }),
        storyTool("r2", "read", "completed", { path: "/repo/a.ts", offset: 4 }),
        storyTool("e1", "edit", "completed", { path: "/repo/a.ts" }),
        storyTool("e2", "write", "completed", { path: "/repo/a.ts" }),
        storyTool("k1", "skill", "completed", { name: "review" }),
        { type: "reasoning", id: "t1", text: "hmm" },
      ]),
    )

    expect(summary).toMatchObject({
      calls: 5,
      reads: 1,
      readFiles: ["/repo/a.ts"],
      files: ["/repo/a.ts"],
      skills: 1,
      thoughts: 1,
      modes: { explore: 3, edit: 2, run: 0, tool: 0 },
    })
  })

  test("follows a part updated in place", () => {
    const part = storyTool("s1", "shell", "running", { command: "false" })
    const before = summarize(factsOf([part]))
    Object.assign(part, storyTool("s1", "shell", "error", { command: "false" }))

    expect(before.failed).toBe(0)
    expect(summarize(factsOf([part])).failed).toBe(1)
  })

  test("reads a script's calls, a search's matches and a provider each on its own", () => {
    const [script] = factsOf([
      storyTool(
        "x1",
        "execute",
        "completed",
        { code: "1" },
        {
          metadata: {
            toolCalls: [
              { tool: "read", status: "completed" },
              { tool: "edit", status: "completed" },
            ],
            provider: "exa",
            matches: 3,
          },
        },
      ),
    ])

    expect(script).toMatchObject({ kind: "call", toolCalls: 2, provider: "exa", matches: 3 })
  })
})
