// Stdio MCP server for oclite tests. Deviation (ARCHITECTURE §14): replaces @modelcontextprotocol/server-everything,
// which isn't installed. Modelled on packages/opencode/test/fixture/mcp-lifecycle-stdio.ts; raw JSON Schemas, no zod.
//
// Run: `bun test/fixture/mcp-everything.ts`. Env:
//   FIXTURE_WRITE_DIR=<dir>   write_file writes inside <dir> only; unset → write_file writes nothing and returns ok.
//   FIXTURE_LIST_CHANGED=1    after the first tools/list, adds tool `late` and emits notifications/tools/list_changed.
//
// Tools: echo{text}, add{a,b}, slow{steps,ms} (progress when _meta.progressToken is set), crash (exits mid-call),
// write_file{path,content} (readOnlyHint false), lookup{key} (readOnlyHint true).
// Prompt: greet{name}. Resources: fixture://readme, template fixture://item/{id}.
import path from "path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"

const INSTRUCTIONS = "Fixture server for oclite tests. Prefer lookup for read-only questions."
const README = "# fixture\n\nThis is the mcp-everything fixture readme.\n"
const TABLE: Record<string, string> = { alpha: "1", beta: "2" }

const tools: Tool[] = [
  {
    name: "echo",
    description: "Echo the given text back",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add",
    description: "Add two numbers",
    inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "slow",
    description: "Wait `steps` times `ms` milliseconds, reporting progress after each step",
    inputSchema: {
      type: "object",
      properties: { steps: { type: "number" }, ms: { type: "number" } },
      required: ["steps", "ms"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "crash",
    description: "Exit the server process in the middle of the call",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "write_file",
    description: "Write a file (inside the fixture write dir only)",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: "lookup",
    description: "Look up a value by key",
    inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    annotations: { readOnlyHint: true },
  },
]

const late: Tool = {
  name: "late",
  description: "Appears after tools/list_changed",
  inputSchema: { type: "object", properties: {} },
}

const state = { listed: false, late: false }

const server = new Server(
  { name: "mcp-everything", version: "1.0.0" },
  {
    capabilities: { tools: { listChanged: true }, prompts: {}, resources: {} },
    instructions: INSTRUCTIONS,
  },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (!state.listed && process.env.FIXTURE_LIST_CHANGED === "1")
    // After the response is written, so the client sees list → list_changed → list.
    setTimeout(() => {
      state.late = true
      void server.sendToolListChanged()
    }, 20)
  state.listed = true
  return { tools: state.late ? [...tools, late] : tools }
})

server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
  const args = request.params.arguments ?? {}
  const name = request.params.name
  if (name === "echo") return text(String(args.text))
  if (name === "add") return text(String(Number(args.a) + Number(args.b)))
  if (name === "lookup") {
    const key = String(args.key)
    return key in TABLE ? text(TABLE[key]) : { ...text(`not found: ${key}`), isError: true }
  }
  if (name === "slow") {
    const steps = Number(args.steps)
    const token = request.params._meta?.progressToken
    for (const step of Array.from({ length: steps }, (_, i) => i + 1)) {
      await Bun.sleep(Number(args.ms))
      if (token !== undefined)
        await extra.sendNotification({
          method: "notifications/progress",
          params: { progressToken: token, progress: step, total: steps, message: `step ${step}/${steps}` },
        })
    }
    return text(`done after ${steps} steps`)
  }
  if (name === "crash") {
    process.stderr.write("mcp-everything: crashing on request\n")
    process.exit(1)
  }
  if (name === "write_file") return writeFile(String(args.path), String(args.content))
  if (name === "late" && state.late) return text("late tool called")
  return { ...text(`unknown tool: ${name}`), isError: true }
})

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: "greet",
      description: "Greet someone by name",
      arguments: [{ name: "name", description: "Who to greet", required: true }],
    },
  ],
}))

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== "greet") throw new Error(`unknown prompt: ${request.params.name}`)
  return {
    description: "Greeting",
    messages: [{ role: "user", content: { type: "text", text: `Please greet ${request.params.arguments?.name ?? "someone"} warmly.` } }],
  }
})

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [{ uri: "fixture://readme", name: "readme", mimeType: "text/markdown", description: "Fixture readme" }],
}))

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [{ uriTemplate: "fixture://item/{id}", name: "item", mimeType: "text/plain", description: "An item by id" }],
}))

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri
  if (uri === "fixture://readme") return { contents: [{ uri, mimeType: "text/markdown", text: README }] }
  const item = uri.match(/^fixture:\/\/item\/(.+)$/)
  if (item) return { contents: [{ uri, mimeType: "text/plain", text: `item ${decodeURIComponent(item[1])}` }] }
  throw new Error(`unknown resource: ${uri}`)
})

await server.connect(new StdioServerTransport())

function text(value: string): CallToolResult {
  return { content: [{ type: "text", text: value }] }
}

async function writeFile(target: string, content: string): Promise<CallToolResult> {
  const dir = process.env.FIXTURE_WRITE_DIR
  if (!dir) return text(`ok (dry run): ${target}`)
  const resolved = path.resolve(dir, target)
  if (path.relative(dir, resolved).startsWith("..") || path.isAbsolute(path.relative(dir, resolved)))
    return { ...text(`refused: ${target} is outside the write dir`), isError: true }
  await Bun.write(resolved, content)
  return text(`wrote ${content.length} bytes to ${target}`)
}
