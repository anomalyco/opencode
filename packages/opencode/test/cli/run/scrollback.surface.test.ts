import { afterEach, expect, test } from "bun:test"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { MockTreeSitterClient, createTestRenderer, type TestRenderer } from "@opentui/core/testing"
import { RunScrollbackStream } from "@/cli/cmd/run/scrollback.surface"
import { RUN_THEME_FALLBACK } from "@/cli/cmd/run/theme"
import type { StreamCommit } from "@/cli/cmd/run/types"

type ClaimedCommit = {
  snapshot: {
    height: number
    getRealCharBytes(addLineBreaks?: boolean): Uint8Array
    destroy(): void
  }
  trailingNewline: boolean
}

const decoder = new TextDecoder()
const active: TestRenderer[] = []

afterEach(() => {
  for (const renderer of active.splice(0)) {
    renderer.destroy()
  }
})

function claim(renderer: TestRenderer): ClaimedCommit[] {
  const queue = Reflect.get(renderer, "externalOutputQueue")
  if (!queue || typeof queue !== "object" || !("claim" in queue) || typeof queue.claim !== "function") {
    throw new Error("renderer missing external output queue")
  }

  const commits = queue.claim()
  if (!Array.isArray(commits)) {
    throw new Error("renderer external output queue returned invalid commits")
  }

  return commits as ClaimedCommit[]
}

function renderCommit(commit: ClaimedCommit) {
  return decoder.decode(commit.snapshot.getRealCharBytes(true)).replace(/ +\n/g, "\n")
}

function render(commits: ClaimedCommit[]) {
  return commits.map(renderCommit).join("")
}

function renderRows(commit: ClaimedCommit, width = 80) {
  const raw = decoder.decode(commit.snapshot.getRealCharBytes(true))
  return Array.from({ length: commit.snapshot.height }, (_, index) =>
    raw.slice(index * width, (index + 1) * width).trimEnd(),
  )
}

function destroy(commits: ClaimedCommit[]) {
  for (const commit of commits) {
    commit.snapshot.destroy()
  }
}

async function setup(
  input: {
    width?: number
    wrote?: boolean
  } = {},
) {
  const out = await createTestRenderer({
    width: input.width ?? 80,
    screenMode: "split-footer",
    footerHeight: 6,
    externalOutputMode: "capture-stdout",
    consoleMode: "disabled",
  })
  active.push(out.renderer)

  const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 0 })
  treeSitterClient.setMockResult({ highlights: [] })

  return {
    renderer: out.renderer,
    scrollback: new RunScrollbackStream(out.renderer, RUN_THEME_FALLBACK, {
      treeSitterClient,
      wrote: input.wrote ?? false,
    }),
  }
}

function assistant(text: string, phase: StreamCommit["phase"] = "progress"): StreamCommit {
  return {
    kind: "assistant",
    text,
    phase,
    source: "assistant",
    messageID: "msg-1",
    partID: "part-1",
  }
}

function user(text: string): StreamCommit {
  return {
    kind: "user",
    text,
    phase: "start",
    source: "system",
  }
}

function error(text: string): StreamCommit {
  return {
    kind: "error",
    text,
    phase: "start",
    source: "system",
  }
}

function toolPart(tool: string, state: Record<string, unknown>, id: string, messageID: string): ToolPart {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "tool",
    callID: `call-${id}`,
    tool,
    state,
  } as ToolPart
}

function toolCommit(input: {
  tool: string
  phase: StreamCommit["phase"]
  toolState?: StreamCommit["toolState"]
  text?: string
  state?: Record<string, unknown>
  id?: string
  messageID?: string
}): StreamCommit {
  const id = input.id ?? `${input.tool}-1`
  const messageID = input.messageID ?? `msg-${input.tool}`

  return {
    kind: "tool",
    text: input.text ?? "",
    phase: input.phase,
    source: "tool",
    partID: id,
    messageID,
    tool: input.tool,
    ...(input.toolState ? { toolState: input.toolState } : {}),
    ...(input.state ? { part: toolPart(input.tool, input.state, id, messageID) } : {}),
  }
}

test("finalizes markdown tables for streamed and coalesced input", async () => {
  const text =
    "| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n| Row 1 | Value 1 | Value 2 |\n| Row 2 | Value 3 | Value 4 |"

  for (const chunks of [[text], [...text]]) {
    const out = await setup()

    try {
      for (const chunk of chunks) {
        await out.scrollback.append(assistant(chunk))
      }

      await out.scrollback.complete()

      const commits = claim(out.renderer)
      try {
        const output = render(commits)
        expect(output).toContain("Column 1")
        expect(output).toContain("Row 2")
        expect(output).toContain("Value 4")
      } finally {
        destroy(commits)
      }
    } finally {
      out.scrollback.destroy()
    }
  }
})

test("holds markdown code blocks until final commit and keeps newline ownership", async () => {
  const out = await setup()

  try {
    await out.scrollback.append(
      assistant(
        '# Markdown Sample\n\n- Item 1\n- Item 2\n\n```js\nconst message = "Hello, markdown"\nconsole.log(message)\n```',
      ),
    )

    const progress = claim(out.renderer)
    try {
      expect(progress).toHaveLength(1)
      expect(render(progress)).toContain("Markdown Sample")
      expect(render(progress)).toContain("Item 2")
      expect(render(progress)).not.toContain("console.log(message)")
    } finally {
      destroy(progress)
    }

    await out.scrollback.complete()

    const final = claim(out.renderer)
    try {
      expect(final).toHaveLength(1)
      expect(final[0]!.trailingNewline).toBe(false)
      expect(render(final)).toContain('const message = "Hello, markdown"')
      expect(render(final)).toContain("console.log(message)")
    } finally {
      destroy(final)
    }
  } finally {
    out.scrollback.destroy()
  }
})

test("renders todo and question summaries without boilerplate footer copy", async () => {
  const cases = [
    {
      title: "# Todos",
      include: [
        "[✓] List files under `run/`",
        "[•] Count functions in each `run/` file",
        "[ ] Mark each tracking item complete",
      ],
      exclude: ["Updating", "todos completed"],
      start: toolCommit({
        tool: "todowrite",
        phase: "start",
        toolState: "running",
        state: {
          status: "running",
          input: {
            todos: [
              { status: "completed", content: "List files under `run/`" },
              { status: "in_progress", content: "Count functions in each `run/` file" },
              { status: "pending", content: "Mark each tracking item complete" },
            ],
          },
          time: { start: 1 },
        },
      }),
      final: toolCommit({
        tool: "todowrite",
        phase: "final",
        toolState: "completed",
        state: {
          status: "completed",
          input: {
            todos: [
              { status: "completed", content: "List files under `run/`" },
              { status: "in_progress", content: "Count functions in each `run/` file" },
              { status: "pending", content: "Mark each tracking item complete" },
            ],
          },
          metadata: {},
          time: { start: 1, end: 4 },
        },
      }),
    },
    {
      title: "# Questions",
      include: ["What should I work on in the codebase next?", "Bug fix"],
      exclude: ["Asked", "questions completed"],
      start: toolCommit({
        tool: "question",
        phase: "start",
        toolState: "running",
        state: {
          status: "running",
          input: {
            questions: [
              {
                question: "What should I work on in the codebase next?",
                header: "Next work",
                options: [{ label: "bug", description: "Bug fix" }],
                multiple: false,
              },
            ],
          },
          time: { start: 1 },
        },
      }),
      final: toolCommit({
        tool: "question",
        phase: "final",
        toolState: "completed",
        state: {
          status: "completed",
          input: {
            questions: [
              {
                question: "What should I work on in the codebase next?",
                header: "Next work",
                options: [{ label: "bug", description: "Bug fix" }],
                multiple: false,
              },
            ],
          },
          metadata: {
            answers: [["Bug fix"]],
          },
          time: { start: 1, end: 2100 },
        },
      }),
    },
  ]

  for (const item of cases) {
    const out = await setup()

    try {
      await out.scrollback.append(item.start)
      expect(claim(out.renderer)).toHaveLength(0)

      await out.scrollback.append(item.final)

      const commits = claim(out.renderer)
      try {
        expect(commits).toHaveLength(1)
        const rows = renderRows(commits[0]!)
        const output = rows.join("\n")
        expect(output).toContain(item.title)
        for (const line of item.include) {
          expect(output).toContain(line)
        }
        for (const line of item.exclude) {
          expect(output).not.toContain(line)
        }
      } finally {
        destroy(commits)
      }
    } finally {
      out.scrollback.destroy()
    }
  }
})

test("inserts spacers for new visible groups", async () => {
  const prior = await setup({ wrote: true })

  try {
    await prior.scrollback.append(user("use subagent to explore run.ts"))

    const commits = claim(prior.renderer)
    try {
      expect(commits).toHaveLength(2)
      expect(renderCommit(commits[0]!).trim()).toBe("")
      expect(renderCommit(commits[1]!).trim()).toBe("› use subagent to explore run.ts")
    } finally {
      destroy(commits)
    }
  } finally {
    prior.scrollback.destroy()
  }

  const grouped = await setup()

  try {
    await grouped.scrollback.append(assistant("hello"))
    await grouped.scrollback.complete()
    destroy(claim(grouped.renderer))

    await grouped.scrollback.append(
      toolCommit({
        tool: "glob",
        phase: "start",
        text: "running glob",
        toolState: "running",
        state: {
          status: "running",
          input: {
            pattern: "**/run.ts",
          },
          time: { start: 1 },
        },
      }),
    )

    const commits = claim(grouped.renderer)
    try {
      expect(commits).toHaveLength(2)
      expect(renderCommit(commits[0]!).trim()).toBe("")
      expect(renderCommit(commits[1]!).replace(/ +/g, " ").trim()).toBe('✱ Glob "**/run.ts"')
    } finally {
      destroy(commits)
    }
  } finally {
    grouped.scrollback.destroy()
  }
})

test("coalesces same-line tool progress into one snapshot", async () => {
  const out = await setup()

  try {
    await out.scrollback.append(toolCommit({ tool: "bash", phase: "progress", text: "abc" }))
    await out.scrollback.append(toolCommit({ tool: "bash", phase: "progress", text: "def" }))
    await out.scrollback.append(toolCommit({ tool: "bash", phase: "final", text: "", toolState: "completed" }))

    const commits = claim(out.renderer)
    try {
      expect(commits).toHaveLength(1)
      expect(render(commits)).toContain("abcdef")
    } finally {
      destroy(commits)
    }
  } finally {
    out.scrollback.destroy()
  }
})

test("renders completed bash output with one blank line after the command and before the next group", async () => {
  const out = await setup()

  try {
    const lines: string[] = []
    const take = () => {
      const commits = claim(out.renderer)
      try {
        lines.push(...commits.flatMap((commit) => renderRows(commit).flatMap((row) => row.split("\n"))))
      } finally {
        destroy(commits)
      }
    }

    await out.scrollback.append(user("/fmt bash"))
    take()
    await out.scrollback.append(
      toolCommit({
        tool: "bash",
        phase: "start",
        toolState: "running",
        state: {
          status: "running",
          input: {
            command: "git status",
            workdir: "/tmp/demo",
            description: "Show git status",
          },
          time: { start: 1 },
        },
      }),
    )
    take()
    await out.scrollback.append(
      toolCommit({
        tool: "bash",
        phase: "progress",
        toolState: "completed",
        text: ["/tmp/demo", "git status", "On branch demo", "nothing to commit, working tree clean", ""].join("\n"),
        state: {
          status: "completed",
          input: {
            command: "git status",
            workdir: "/tmp/demo",
            description: "Show git status",
          },
          time: { start: 1, end: 2 },
        },
      }),
    )
    take()
    await out.scrollback.append(assistant("oc-run-dev ahead 1"))
    await out.scrollback.complete()
    take()

    const output = lines.join("\n")
    expect(output).toContain("$ git status\n\nOn branch demo")
    expect(output).toContain("nothing to commit, working tree clean\n\noc-run-dev ahead 1")
    expect(output).not.toContain("nothing to commit, working tree clean\n\n\noc-run-dev ahead 1")
  } finally {
    out.scrollback.destroy()
  }
})

test("inserts a spacer before the next tool after completed multiline bash output", async () => {
  const out = await setup()

  try {
    const lines: string[] = []
    const take = () => {
      const commits = claim(out.renderer)
      try {
        lines.push(...commits.flatMap((commit) => renderRows(commit).flatMap((row) => row.split("\n"))))
      } finally {
        destroy(commits)
      }
    }

    await out.scrollback.append(
      toolCommit({
        tool: "bash",
        phase: "start",
        toolState: "running",
        state: {
          status: "running",
          input: {
            command: "pwd; ls -la",
            workdir: "/tmp/demo",
            description: "Lists current directory files",
          },
          time: { start: 1 },
        },
      }),
    )
    take()
    await out.scrollback.append(
      toolCommit({
        tool: "bash",
        phase: "progress",
        toolState: "completed",
        text: ["/tmp/demo", "pwd; ls -la", "/tmp/demo", "total 4", "", ""].join("\n"),
        state: {
          status: "completed",
          input: {
            command: "pwd; ls -la",
            workdir: "/tmp/demo",
            description: "Lists current directory files",
          },
          output: ["/tmp/demo", "pwd; ls -la", "/tmp/demo", "total 4", "", ""].join("\n"),
          title: "pwd; ls -la",
          metadata: {
            exitCode: 0,
          },
          time: { start: 1, end: 2 },
        },
      }),
    )
    take()
    await out.scrollback.append(
      toolCommit({
        tool: "glob",
        phase: "start",
        toolState: "running",
        state: {
          status: "running",
          input: {
            pattern: "**/*tool*",
            path: "src/cli/cmd",
          },
          time: { start: 3 },
        },
      }),
    )
    take()

    const output = lines.join("\n")
    expect(output).toContain('total 4\n\n✱ Glob "**/*tool*" in src/cli/cmd')
  } finally {
    out.scrollback.destroy()
  }
})

test("does not double-space before completed bash output when inline tool headers intervene", async () => {
  const out = await setup()

  try {
    const lines: string[] = []
    const take = () => {
      const commits = claim(out.renderer)
      try {
        lines.push(...commits.flatMap((commit) => renderRows(commit).flatMap((row) => row.split("\n"))))
      } finally {
        destroy(commits)
      }
    }

    await out.scrollback.append(
      toolCommit({
        tool: "bash",
        phase: "start",
        toolState: "running",
        state: {
          status: "running",
          input: {
            command: "ls",
            workdir: "src/cli/cmd/run",
            description: "Lists files in run directory",
          },
          time: { start: 1 },
        },
      }),
    )
    take()
    await out.scrollback.append(
      toolCommit({
        tool: "glob",
        phase: "start",
        toolState: "running",
        state: {
          status: "running",
          input: {
            pattern: "**/*tool*",
            path: "src/cli/cmd/run",
          },
          time: { start: 2 },
        },
      }),
    )
    take()
    await out.scrollback.append(
      toolCommit({
        tool: "grep",
        phase: "start",
        toolState: "running",
        state: {
          status: "running",
          input: {
            pattern: "tool",
            path: "src/cli/cmd/run",
          },
          time: { start: 3 },
        },
      }),
    )
    take()
    await out.scrollback.append(
      toolCommit({
        tool: "bash",
        phase: "progress",
        toolState: "completed",
        text: ["src/cli/cmd/run", "ls", "demo.ts", "entry.body.ts", "", ""].join("\n"),
        state: {
          status: "completed",
          input: {
            command: "ls",
            workdir: "src/cli/cmd/run",
            description: "Lists files in run directory",
          },
          output: ["src/cli/cmd/run", "ls", "demo.ts", "entry.body.ts", "", ""].join("\n"),
          title: "ls",
          metadata: {
            exitCode: 0,
          },
          time: { start: 1, end: 4 },
        },
      }),
    )
    take()

    const output = lines.join("\n")
    expect(output).toContain('✱ Grep "tool" in src/cli/cmd/run\n\ndemo.ts')
    expect(output).not.toContain('✱ Grep "tool" in src/cli/cmd/run\n\n\ndemo.ts')
  } finally {
    out.scrollback.destroy()
  }
})

test("does not emit blank patch snapshots between edit and task", async () => {
  const out = await setup()

  try {
    const lines: string[] = []
    const take = () => {
      const commits = claim(out.renderer)
      try {
        lines.push(...commits.flatMap((commit) => renderRows(commit).flatMap((row) => row.split("\n"))))
      } finally {
        destroy(commits)
      }
    }

    await out.scrollback.append(
      toolCommit({
        tool: "edit",
        phase: "final",
        toolState: "completed",
        state: {
          status: "completed",
          input: {
            filePath: "src/demo-format.ts",
          },
          output: "",
          title: "edit",
          metadata: {
            diff: "@@ -1 +1 @@\n-export const demo = 1\n+export const demo = 42\n",
          },
          time: { start: 1, end: 2 },
        },
      }),
    )
    take()
    await out.scrollback.append(
      toolCommit({
        tool: "apply_patch",
        phase: "final",
        toolState: "completed",
        state: {
          status: "completed",
          input: {
            patchText: "*** Begin Patch\n*** End Patch",
          },
          output: "",
          title: "apply_patch",
          metadata: {
            files: [
              {
                type: "update",
                filePath: "src/demo-format.ts",
                relativePath: "src/demo-format.ts",
                diff: "@@ -1 +1 @@\n-export const demo = 1\n+export const demo = 42\n",
                deletions: 1,
              },
              {
                type: "add",
                filePath: "README-demo.md",
                relativePath: "README-demo.md",
              },
            ],
          },
          time: { start: 2, end: 3 },
        },
      }),
    )
    take()
    await out.scrollback.append(
      toolCommit({
        tool: "task",
        phase: "final",
        toolState: "completed",
        state: {
          status: "completed",
          input: {
            description: "Scan run/* for reducer touchpoints",
            subagent_type: "explore",
          },
          output: "",
          title: "task",
          metadata: {
            sessionId: "sub_demo_1",
          },
          time: { start: 3, end: 4 },
        },
      }),
    )
    take()

    const output = lines.join("\n")
    expect(output).toContain("+ Created README-demo.md")
    expect(output).not.toContain("~ Patched src/demo-format.ts")
    expect(output).toContain("+ Created README-demo.md\n\n# Explore Task")
    expect(output).not.toContain("+ Created README-demo.md\n\n\n# Explore Task")
  } finally {
    out.scrollback.destroy()
  }
})

test("renders plain errors with one blank line before and after the error block", async () => {
  const out = await setup()

  try {
    const lines: string[] = []
    const take = (check?: (commits: ClaimedCommit[]) => void) => {
      const commits = claim(out.renderer)
      try {
        check?.(commits)
        lines.push(...commits.flatMap((commit) => renderRows(commit).flatMap((row) => row.split("\n"))))
      } finally {
        destroy(commits)
      }
    }

    await out.scrollback.append(user("/fmt error"))
    take()
    await out.scrollback.append(error("demo error event"))
    take((commits) => {
      expect(commits.at(-1)?.trailingNewline).toBe(false)
    })
    await out.scrollback.append(assistant("next line"))
    await out.scrollback.complete()
    take()

    const output = lines.join("\n")
    expect(output).toContain("› /fmt error\n\ndemo error event")
    expect(output).toContain("demo error event\n\nnext line")
    expect(output).not.toContain("demo error event\n\n\nnext line")
  } finally {
    out.scrollback.destroy()
  }
})

test("renders structured write finals once as code blocks", async () => {
  const out = await setup()

  try {
    await out.scrollback.append(
      toolCommit({
        tool: "write",
        phase: "start",
        toolState: "running",
        id: "tool-2",
        messageID: "msg-2",
        state: {
          status: "running",
          input: {
            filePath: "src/a.ts",
            content: "const x = 1\nconst y = 2\n",
          },
          time: { start: 1 },
        },
      }),
    )
    expect(claim(out.renderer)).toHaveLength(0)

    await out.scrollback.append(
      toolCommit({
        tool: "write",
        phase: "final",
        toolState: "completed",
        id: "tool-2",
        messageID: "msg-2",
        state: {
          status: "completed",
          input: {
            filePath: "src/a.ts",
            content: "const x = 1\nconst y = 2\n",
          },
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }),
    )

    const commits = claim(out.renderer)
    try {
      expect(commits).toHaveLength(1)
      const output = render(commits[0] ? [commits[0]] : [])
      expect(output).toContain("# Wrote src/a.ts")
      expect(output).toMatch(/1\s+const x = 1/)
      expect(output).toMatch(/2\s+const y = 2/)
    } finally {
      destroy(commits)
    }
  } finally {
    out.scrollback.destroy()
  }
})

test("renders promoted task markdown without a leading blank row", async () => {
  const out = await setup()

  try {
    await out.scrollback.append(
      toolCommit({
        tool: "task",
        phase: "final",
        toolState: "completed",
        state: {
          status: "completed",
          input: {
            description: "Explore run.ts",
            subagent_type: "explore",
          },
          output: [
            "task_id: child-1 (for resuming to continue this task if needed)",
            "",
            "<task_result>",
            "Location: `/tmp/run.ts`",
            "",
            "Summary:",
            "- Local interactive mode",
            "- Attach mode",
            "</task_result>",
          ].join("\n"),
          metadata: {
            sessionId: "child-1",
          },
          time: { start: 1, end: 2 },
        },
      }),
    )

    const commits = claim(out.renderer)
    try {
      const output = render(commits)
      expect(output.startsWith("\n")).toBe(false)
      expect(output).toContain("Summary:")
      expect(output).toContain("Local interactive mode")
    } finally {
      destroy(commits)
    }
  } finally {
    out.scrollback.destroy()
  }
})
