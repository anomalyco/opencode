import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import type { SessionMessageAssistantTool } from "@opencode-ai/client/promise"
import { entryBody, entryCanStream, entryDone } from "../../src/mini/entry.body"
import type { StreamCommit, ToolSnapshot } from "../../src/mini/types"
import { canonicalToolPart } from "./fixture/tool-part"

function commit(input: Partial<StreamCommit> & Pick<StreamCommit, "kind" | "text" | "phase" | "source">): StreamCommit {
  return input
}

function toolCommit(input: {
  tool: string
  state: SessionMessageAssistantTool["state"]
  directory?: string
  phase?: StreamCommit["phase"]
  toolState?: StreamCommit["toolState"]
  text?: string
  id?: string
  messageID?: string
}) {
  return commit({
    kind: "tool",
    text: input.text ?? "",
    phase: input.phase ?? "final",
    source: "tool",
    tool: input.tool,
    directory: input.directory,
    toolState:
      input.toolState ??
      (input.state.status === "error" ? "error" : input.state.status === "completed" ? "completed" : "running"),
    messageID: input.messageID,
    part: canonicalToolPart(input.tool, input.state, input.id),
  })
}

function structured(next: StreamCommit) {
  const body = entryBody(next)
  expect(body.type).toBe("structured")
  if (body.type !== "structured") {
    throw new Error("expected structured body")
  }

  return body.snapshot
}

describe("run entry body", () => {
  test("renders a failed direct shell as an error instead of completed success", () => {
    const failed = commit({
      kind: "tool",
      text: "Shell exited with code 7",
      phase: "final",
      source: "tool",
      tool: "shell",
      toolState: "error",
      toolError: "Shell → exited · code 7",
      shell: { command: "false" },
    })
    expect(entryBody(failed)).toEqual({ type: "text", content: "✖ shell failed: Shell → exited · code 7" })
    expect(entryBody(failed, { mono: true })).toEqual({
      type: "text",
      content: "! shell failed: Shell → exited · code 7",
    })
  })

  test("renders assistant, reasoning, and user entries in their display formats", () => {
    expect(
      entryBody(
        commit({
          kind: "assistant",
          text: "# Title\n\nHello **world**",
          phase: "progress",
          source: "assistant",
          partID: "part-1",
        }),
      ),
    ).toEqual({
      type: "markdown",
      content: "# Title\n\nHello **world**",
    })

    const reasoning = entryBody(
      commit({
        kind: "reasoning",
        text: "Thinking: plan next steps",
        phase: "progress",
        source: "reasoning",
        partID: "reason-1",
      }),
    )
    expect(reasoning).toEqual({
      type: "code",
      filetype: "markdown",
      content: "_Thinking:_ plan next steps",
    })
    expect(
      entryCanStream(
        commit({
          kind: "reasoning",
          text: "Thinking: plan next steps",
          phase: "progress",
          source: "reasoning",
        }),
        reasoning,
      ),
    ).toBe(true)

    expect(
      entryBody(
        commit({
          kind: "user",
          text: "Inspect footer tabs",
          phase: "start",
          source: "system",
        }),
      ),
    ).toEqual({
      type: "text",
      content: "› Inspect footer tabs",
    })
    expect(
      entryBody(commit({ kind: "user", text: "Inspect footer tabs", phase: "start", source: "system" }), {
        mono: true,
      }),
    ).toEqual({ type: "text", content: "> Inspect footer tabs" })
  })

  for (const item of [
    {
      name: "keeps completed write tool finals structured",
      commit: toolCommit({
        tool: "write",
        state: {
          status: "completed",
          input: {
            path: "src/a.ts",
            content: "const x = 1\n",
          },
          metadata: {},
          content: [{ type: "text", text: "" }],
        },
      }),
      snapshot: {
        kind: "code",
        title: "# Wrote src/a.ts",
        content: "const x = 1\n",
        file: "src/a.ts",
      },
    },
    {
      name: "keeps completed edit tool finals structured",
      commit: toolCommit({
        tool: "edit",
        state: {
          status: "completed",
          input: {
            path: "src/a.ts",
          },
          metadata: {
            files: [{ file: "src/a.ts", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new\n" }],
          },
          content: [{ type: "text", text: "" }],
        },
      }),
      snapshot: {
        kind: "diff",
        items: [
          {
            title: "# Edited src/a.ts",
            diff: "@@ -1 +1 @@\n-old\n+new\n",
            file: "src/a.ts",
          },
        ],
      },
    },
    {
      name: "keeps completed patch tool finals structured",
      commit: toolCommit({
        tool: "patch",
        state: {
          status: "completed",
          input: {},
          content: [{ type: "text", text: "" }],
          metadata: {
            files: [
              {
                status: "modified",
                file: "src/a.ts",
                patch: "@@ -1 +1 @@\n-old\n+new\n",
              },
            ],
          },
        },
      }),
      snapshot: {
        kind: "diff",
        items: [
          {
            title: "# Patched src/a.ts",
            diff: "@@ -1 +1 @@\n-old\n+new\n",
            file: "src/a.ts",
            deletions: 0,
          },
        ],
      },
    },
  ] satisfies Array<{ name: string; commit: StreamCommit; snapshot: ToolSnapshot }>) {
    test(item.name, () => {
      expect(structured(item.commit)).toEqual(item.snapshot)
    })
  }

  test("keeps running subagent tool state out of scrollback", () => {
    expect(
      entryBody(
        toolCommit({
          tool: "subagent",
          phase: "start",
          toolState: "running",
          text: "running inspect reducer",
          state: {
            status: "running",
            input: {
              description: "Inspect reducer",
              agent: "explore",
            },
            metadata: { sessionID: "ses-child-1", status: "running" },
          },
        }),
      ),
    ).toEqual({
      type: "none",
    })
  })

  test("promotes subagent results to markdown and falls back to structured summaries", () => {
    const result = toolCommit({
      tool: "subagent",
      state: {
        status: "completed",
        input: {
          description: "Inspect reducer",
          agent: "explore",
        },
        content: [{ type: "text", text: "# Findings\n\n- Footer stays live" }],
        metadata: {
          sessionID: "ses-child-1",
          status: "completed",
          output: "# Findings\n\n- Footer stays live",
        },
      },
    })
    const markdown = {
      type: "markdown",
      content: "# Findings\n\n- Footer stays live",
    } as const
    expect(entryBody(result)).toEqual(markdown)
    expect(entryBody(result, { mono: true })).toEqual(markdown)

    expect(
      structured(
        toolCommit({
          tool: "subagent",
          state: {
            status: "completed",
            input: {
              description: "Inspect reducer",
              agent: "explore",
            },
            content: [{ type: "text", text: "" }],
            metadata: {
              sessionID: "ses-child-1",
              status: "completed",
              output: "",
            },
          },
        }),
      ),
    ).toEqual({
      kind: "task",
      title: "# Explore Subagent",
      rows: ["Inspect reducer"],
      tail: "",
    })
  })

  test("streams tool progress text and treats completed progress as done", () => {
    const body = entryBody(
      commit({
        kind: "tool",
        text: "partial output",
        phase: "progress",
        source: "tool",
        tool: "shell",
        partID: "tool-2",
      }),
    )

    expect(body).toEqual({
      type: "text",
      content: "partial output",
    })
    expect(
      entryCanStream(
        commit({
          kind: "tool",
          text: "partial output",
          phase: "progress",
          source: "tool",
          tool: "shell",
        }),
        body,
      ),
    ).toBe(true)
    expect(
      entryDone(
        commit({
          kind: "tool",
          text: "output",
          phase: "progress",
          source: "tool",
          tool: "shell",
          toolState: "completed",
        }),
      ),
    ).toBe(true)
  })

  test("formats completed shell output with a blank line after the command and no trailing blank row", () => {
    const output = ["/tmp/demo", "git status", "On branch demo", "nothing to commit, working tree clean", ""].join("\n")
    expect(
      entryBody(
        toolCommit({
          tool: "shell",
          phase: "progress",
          toolState: "completed",
          text: output,
          state: {
            status: "completed",
            input: {
              command: "git status",
              workdir: "/tmp/demo",
            },
            content: [{ type: "text", text: output }],
            metadata: { exit: 0, truncated: false },
          },
        }),
      ),
    ).toEqual({
      type: "text",
      content: "\nOn branch demo\nnothing to commit, working tree clean",
    })
  })

  test("renders command-only shell starts without the shell header", () => {
    expect(
      entryBody(
        toolCommit({
          tool: "shell",
          phase: "start",
          toolState: "running",
          text: "running shell",
          state: {
            status: "running",
            input: {
              command: "ls",
            },
            metadata: {},
          },
        }),
      ),
    ).toEqual({
      type: "text",
      content: "$ ls",
    })
  })

  test("renders a shell workdir before the prompt", () => {
    expect(
      entryBody(
        toolCommit({
          tool: "shell",
          directory: "/work/project",
          phase: "start",
          toolState: "running",
          state: {
            status: "running",
            input: {
              command: "ls",
              workdir: "packages/foo",
            },
            metadata: {},
          },
        }),
      ),
    ).toEqual({
      type: "text",
      content: "packages/foo$ ls",
    })

    expect(
      entryBody(
        toolCommit({
          tool: "shell",
          directory: path.join(os.homedir(), "project"),
          phase: "start",
          toolState: "running",
          state: {
            status: "running",
            input: {
              command: "pwd",
              workdir: path.join(os.homedir(), "outside", "folder"),
            },
            metadata: {},
          },
        }),
      ),
    ).toEqual({
      type: "text",
      content: "~/outside/folder$ pwd",
    })
  })

  test("renders direct shell commits without a synthetic shell header", () => {
    expect(
      entryBody(
        commit({
          kind: "tool",
          text: "running shell",
          phase: "start",
          source: "tool",
          tool: "shell",
          partID: "shell:call-1",
          toolState: "running",
          shell: {
            command: "pwd",
          },
        }),
      ),
    ).toEqual({
      type: "text",
      content: "$ pwd",
    })
    expect(
      entryBody(
        commit({
          kind: "tool",
          text: "/tmp/demo\n",
          phase: "progress",
          source: "tool",
          tool: "shell",
          partID: "shell:call-1",
          toolState: "completed",
          shell: {
            command: "pwd",
          },
        }),
      ),
    ).toEqual({
      type: "text",
      content: "\n/tmp/demo",
    })
  })

  test("hides shell tool output but not direct shell output", () => {
    const output = commit({ kind: "tool", text: "output", phase: "progress", source: "tool", tool: "shell" })
    expect(entryBody(output, { shellOutput: false })).toEqual({ type: "none" })
    expect(entryBody({ ...output, shell: { command: "pwd" } }, { shellOutput: false })).toEqual({
      type: "text",
      content: "\noutput",
    })
  })

  test("falls back to patch summary when patch has no visible diff items", () => {
    expect(
      entryBody(
        toolCommit({
          tool: "patch",
          state: {
            status: "completed",
            input: {
              patchText: "*** Begin Patch\n*** End Patch",
            },
            content: [{ type: "text", text: "" }],
            metadata: {
              files: [
                {
                  status: "modified",
                  file: "src/a.ts",
                },
              ],
            },
          },
        }),
      ),
    ).toEqual({
      type: "text",
      content: "~ Patched src/a.ts",
    })
  })

  test("suppresses redundant patched rows when patch also created a file", () => {
    expect(
      entryBody(
        toolCommit({
          tool: "patch",
          state: {
            status: "completed",
            input: {
              patchText: "*** Begin Patch\n*** End Patch",
            },
            content: [{ type: "text", text: "" }],
            metadata: {
              files: [
                {
                  status: "modified",
                  file: "src/a.ts",
                },
                {
                  status: "added",
                  file: "README-demo.md",
                },
              ],
            },
          },
        }),
      ),
    ).toEqual({
      type: "text",
      content: "+ Created README-demo.md",
    })
  })

  test("renders glob failures as the raw error under the existing header", () => {
    expect(
      entryBody(
        toolCommit({
          tool: "glob",
          phase: "final",
          toolState: "error",
          state: {
            status: "error",
            input: {
              pattern: "**/*tool*",
              path: "/tmp/demo/run",
            },
            error: { type: "unknown", message: "No such file or directory: '/tmp/demo/run'" },
            metadata: {},
          },
        }),
      ),
    ).toEqual({
      type: "text",
      content: "No such file or directory: '/tmp/demo/run'",
    })
  })

  test("renders bounded structured output for completed unknown tools without text", () => {
    const body = entryBody(
      toolCommit({
        tool: "mcp_custom",
        phase: "final",
        toolState: "completed",
        text: "",
        state: {
          status: "completed",
          input: { target: "demo" },
          metadata: {
            result: { ok: true, nested: { values: Array.from({ length: 40 }, (_, index) => ({ index })) } },
            large: "x".repeat(8_000),
          },
          content: [{ type: "text", text: "" }],
        },
      }),
    )

    expect(body).toMatchObject({ type: "code", filetype: "json" })
    expect(body.type === "code" ? body.content : "").toContain('"ok": true')
    expect(body.type === "code" ? body.content : "").toContain("[truncated]")
    expect(body.type === "code" ? body.content.length : Infinity).toBeLessThanOrEqual(4_096)
  })

  test("renders interrupted assistant finals as text", () => {
    expect(
      entryBody(
        commit({
          kind: "assistant",
          text: "",
          phase: "final",
          source: "assistant",
          interrupted: true,
          partID: "part-1",
        }),
      ),
    ).toEqual({
      type: "text",
      content: "assistant interrupted",
    })
  })
})
