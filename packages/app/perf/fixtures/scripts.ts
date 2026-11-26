import type { SessionMessageAssistant } from "@opencode/client/promise"

// How many calls each of 46 Code Mode scripts made in one turn of a real audit session: most made a few, six walked a
// source tree file by file. 19,039 calls in all.
const calls = [
  1, 3, 6965, 1, 1, 2, 1, 1, 3, 1, 1592, 4, 1, 377, 2, 1893, 2, 7, 2, 1, 1, 3, 3906, 3, 2004, 2, 1, 8, 1, 0, 2, 1, 1, 1,
  1, 2, 1, 4, 2, 86, 2, 1, 3, 2138, 3, 2,
]

/** The turn's scripts, completed, each listing the files it read through `Bun.file`. */
export function scriptTools(): SessionMessageAssistant["content"] {
  return calls.map((count, script) => ({
    type: "tool",
    id: `prt_script_${String(script).padStart(2, "0")}`,
    name: "execute",
    time: {
      created: 1700000001000 + script * 1_000,
      ran: 1700000001000 + script * 1_000,
      completed: 1700000001500 + script * 1_000,
    },
    state: {
      status: "completed",
      input: { code: `const files = await Array.fromAsync(new Bun.Glob("**/*.ts").scan(root))\nreturn files.length` },
      content: [{ type: "text", text: `${count} files` }],
      metadata: {
        toolCalls: Array.from({ length: count }, (_, call) => ({
          tool: "read",
          status: "completed",
          input: {
            path: `C:/OpenCode/TimelineStateRegression/packages/app/src/module-${script}-${call}.ts`,
          },
        })),
      },
    },
  }))
}
