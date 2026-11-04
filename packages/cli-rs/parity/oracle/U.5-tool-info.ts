// P-ORACLE for U.5: runs a corpus of tool parts, built with the TUI's own `canonicalToolPart` fixture, through
// `toolInlineInfo`, and the tool display helpers over a few inputs each. Writes parity/fixtures/U.5/tool-info.json;
// crates/ui/tests/tool_info_oracle.rs feeds the same parts to the Rust port and compares.
import { readDisplayText, toolInlineInfo, toolOutputText } from "../../../tui/src/mini/tool.ts"
import { formatPath } from "../../../tui/src/util/path-format.ts"
import {
  executeCallSummary,
  executeCalls,
  primitiveInputSummary,
  webSearchProviderLabel,
} from "../../../tui/src/util/tool-display.ts"
import { canonicalToolPart } from "../../../tui/test/mini/fixture/tool-part.ts"

type State = Parameters<typeof canonicalToolPart>[1]

const output = new URL("../fixtures/U.5/tool-info.json", import.meta.url).pathname
const directory = "/work/project"
const text = (value: string) => [{ type: "text" as const, text: value }]
const completed = (input: Record<string, unknown>, metadata: Record<string, unknown> = {}, content = text("")) => ({
  status: "completed",
  input,
  metadata,
  content,
})
const running = (input: Record<string, unknown>, metadata: Record<string, unknown> = {}) => ({
  status: "running",
  input,
  metadata,
})
const failed = (input: Record<string, unknown>, message = "boom") => ({
  status: "error",
  input,
  error: { type: "unknown", message },
  metadata: {},
})
const streaming = (input: string) => ({ status: "streaming", input })

const cases: Array<[string, string, unknown, string?]> = [
  [
    "shell completed",
    "shell",
    completed({ command: "ls -la", description: "List" }, { exit: 0 }, [
      ...text("a\nb\n"),
      ...text("Command exited with code 0."),
    ]),
  ],
  ["shell running", "shell", running({ command: "sleep 1" })],
  ["shell error", "shell", failed({ command: "false" })],
  ["shell streaming", "shell", streaming('{"command":"l')],
  ["shell legacy bash", "bash", completed({ command: "pwd" }, {}, text("  /work/project  \n"))],
  ["shell no command", "shell", completed({})],
  ["shell unknown status", "shell", { status: "paused", input: { command: "ls" }, metadata: {} }],
  ["write inside", "write", completed({ filePath: "/work/project/src/a.ts", content: "x" }, {}, text("Wrote file"))],
  ["write outside", "write", completed({ filePath: "/etc/hosts", content: "x" })],
  ["write relative", "write", running({ path: "src/../b.ts", content: "x" })],
  [
    "edit with files",
    "edit",
    completed(
      { filePath: "/work/project/a.ts" },
      {
        files: [{ type: "update", filePath: "/work/project/a.ts", relativePath: "a.ts", patch: "@@ -1 +1 @@\n-a\n+b" }],
      },
    ),
  ],
  ["edit with diff", "edit", completed({ filePath: "/work/project/a.ts" }, { diff: "--- a\n+++ b" })],
  ["edit running", "edit", running({ filePath: "/work/project/a.ts", oldString: "a", newString: "b" })],
  [
    "patch two files",
    "apply_patch",
    completed(
      { patchText: "*** Begin Patch" },
      {
        files: [
          { type: "add", relativePath: "a.ts" },
          { type: "move", filePath: "/x/b.ts", relativePath: "c.ts" },
        ],
      },
    ),
  ],
  ["patch one file", "patch", completed({}, { files: [{ file: "a.ts", status: "modified" }] })],
  ["patch nameless files", "patch", completed({}, { files: [{ patch: "x" }] })],
  ["patch no files", "patch", running({ patchText: "*** Begin Patch" })],
  ["patch error", "patch", failed({ patchText: "x" }, "bad patch")],
  ["batch two", "batch", completed({ tool_calls: [{}, {}] }, {}, text("done"))],
  ["batch one", "batch", running({ tool_calls: [{}] })],
  ["batch none", "batch", running({})],
  ["subagent completed", "task", completed({ subagent_type: "explore", description: "Inspect the repo" })],
  ["subagent running", "subagent", running({ agent: "general", description: "Work" })],
  ["subagent error", "subagent", failed({ agent: "code-review" })],
  ["subagent no agent", "subagent", running({})],
  ["subagent agent not a string", "subagent", running({ agent: 7 })],
  [
    "todowrite",
    "todowrite",
    completed({
      todos: [
        { content: "one", status: "completed" },
        { content: "two", status: "in_progress" },
        { content: "three", status: "cancelled" },
        { content: "four", status: "weird" },
        { content: "", status: "pending" },
        "bad",
      ],
    }),
  ],
  ["todowrite empty", "todowrite", running({})],
  ["question one", "question", completed({ questions: [{ question: "Why?" }] }, { answers: [["Because"]] })],
  ["question three", "question", running({ questions: [{}, {}, {}] })],
  ["question none", "question", running({})],
  [
    "read with range",
    "read",
    completed(
      { filePath: "/work/project/src/a.ts", offset: 10, limit: 20 },
      {},
      text('{"type":"text-page","content":"hello"}'),
    ),
  ],
  ["read outside", "read", completed({ filePath: "/tmp/x.txt" })],
  ["read flags", "read", running({ path: "a.ts", raw: true, encoding: "utf8" })],
  ["read no path", "read", running({})],
  ["glob full", "glob", completed({ pattern: "*.ts", path: "/work/project/src" }, { count: 3 })],
  ["glob one match", "glob", completed({ pattern: "*.md" }, { count: 1 })],
  ["glob no count", "glob", running({ pattern: "**/*" })],
  ["glob null count", "glob", completed({ pattern: "x", path: "/elsewhere" }, { count: null })],
  ["glob bad path", "glob", running({ pattern: "x", path: 5 })],
  ["grep full", "grep", completed({ pattern: "needle", path: "src" }, { matches: 0 })],
  ["grep one", "grep", completed({ pattern: "needle" }, { matches: 1 })],
  ["list path", "list", completed({ path: "/work/project/src" })],
  ["list none", "list", running({})],
  ["lsp full", "lsp", completed({ operation: "hover", filePath: "/work/project/a.ts", line: 3, character: 7 })],
  ["lsp no position", "lsp", running({ operation: "definition", filePath: "b.ts", line: 3 })],
  ["lsp no file", "lsp", running({})],
  ["webfetch", "webfetch", completed({ url: "https://example.com", format: "markdown" })],
  ["webfetch none", "webfetch", running({})],
  ["websearch exa", "websearch", completed({ query: "rust serde" }, { provider: "exa" })],
  ["websearch opencode", "websearch", completed({ query: "x" }, { provider: "opencode" })],
  ["websearch none", "websearch", running({})],
  ["skill metadata", "skill", completed({ id: "tigerstyle" }, { name: "effect" })],
  ["skill input", "skill", completed({ id: "tigerstyle" })],
  ["skill none", "skill", running({})],
  ["invalid", "invalid", completed({ tool: "nope" }, {}, text("Invalid tool nope"))],
  ["unknown tool", "mcp_search", completed({ query: "x", limit: 5, nested: { a: [1, 2] } })],
  ["unknown tool empty", "mcp_search", running({})],
  ["unknown tool streaming", "mcp_search", streaming("{")],
  ["no directory", "webfetch", completed({ url: "https://a.b" }), "none"],
]

const parts = cases.map(([label, name, state, dir]) => {
  const part = canonicalToolPart(name, state as State)
  const where = dir === "none" ? undefined : directory
  return { label, part, directory: where, expected: toolInlineInfo(part, where) }
})

const content = [
  ["shell", [...text("out\n"), ...text("Command exited with code 0.")]],
  ["bash", [{ type: "image" }, ...text("")]],
  ["grep", [...text("a"), ...text(""), { type: "file" }, ...text("b")]],
  ["read", text('{"type":"text-page","content":"page"}')],
  ["read", text('{"encoding":"utf8","content":"utf"}')],
  ["read", text('{"entries":["a",{"path":"b"},{"x":1},3]}')],
  ["read", text("{not json")],
  ["read", text("plain")],
] as const

const helpers = {
  toolOutputText: content.map(([name, items]) => ({ name, content: items, expected: toolOutputText(name, items) })),
  readDisplayText: ['{"content":"x"}', '{"type":"text-page","content":"y"}', "[]", "{}", '{"entries":[]}'].map(
    (input) => ({ input, expected: readDisplayText(input) ?? null }),
  ),
  toolPath: [
    ["src/a.ts", "/work/project", false],
    ["/work/project/src/a.ts", "/work/project", false],
    ["/work/project", "/work/project", false],
    ["../shared/x", "/work/project", false],
    ["..cache/x", "/work/project", false],
    ["/work/./project/../other//x", "/work/project", false],
    ["C:\\Users\\x", "/work/project", false],
    ["\\\\server\\share", "/work/project", false],
    ["/home/user/notes.md", "/work/project", true],
    ["/home/user", "/work/project", true],
    ["/home/username/x", "/work/project", true],
    ["", "/work/project", false],
  ].map(([input, dir, home]) => ({
    input,
    directory: dir,
    home: home ? "/home/user" : null,
    // `toolPath` with a fixed home instead of `os.homedir()`, so the fixture is the same on every machine.
    expected: formatPath(input as string, {
      base: dir as string,
      home: home ? "/home/user" : undefined,
      forwardSlashes: true,
    }),
  })),
  primitiveInputSummary: [
    [{ b: 1, a: "x y", c: true, d: null, e: [1], f: { g: 1 }, h: 1.5 }, []],
    [{ path: "a", offset: 1 }, ["path"]],
    [{}, []],
  ].map(([input, omit]) => ({
    input,
    omit,
    expected: primitiveInputSummary(input as Record<string, unknown>, omit as string[]),
  })),
  executeCalls: [
    [
      { tool: "read", status: "completed", input: { path: "a b\n c" } },
      { tool: "x", status: "weird" },
      "bad",
      { tool: "glob", status: "running" },
    ],
    "not an array",
  ].map((input) => ({ input, expected: executeCalls(input).map(executeCallSummary) })),
  webSearchProviderLabel: ["exa", "opencode", "", null, 3, "ñandu"].map((provider) => ({
    provider,
    expected: webSearchProviderLabel(provider),
  })),
}

await Bun.write(output, JSON.stringify({ parts, helpers }, null, 2) + "\n")
console.log(`U.5: wrote ${parts.length} parts to ${output}`)
