import { inputRequired, inputResponse, McpServer, ResourceTemplate } from "@modelcontextprotocol/server"
import { skillEntry, SkillsExtension } from "@modelcontextprotocol/server/ext/skills"

// The one MCP server every MCP test talks to. It is served in process over Streamable HTTP (both eras), over stdio by
// ./stdio.ts, and over an in-memory transport, so each path is checked against the same surface. It imports only the
// MCP server SDK, so the stdio child starts quickly.

export interface Spec {
  /** Offers MCP Skills: one `deploy` skill. */
  readonly skills?: boolean
  /** Advertises MCP Events; the HTTP harness answers the events requests. */
  readonly events?: boolean
  /** Offers no resources. */
  readonly resources?: false
}

/** What the server keeps across the instances it creates: modern HTTP builds one per request. */
export interface State {
  /** Tools added by the `change` tool, listed after the fixed ones. */
  readonly added: string[]
  /** Serves skill files that no longer match their listed digests. */
  tampered?: boolean
}

export const SKILL = "---\nname: deploy\ndescription: Deploy the app\n---\n# Deploy\n\nRun scripts/run.sh.\n"
export const SKILL_FILES = { "SKILL.md": SKILL, "scripts/run.sh": "echo run" }
export const INSTRUCTIONS = "Use the fixture tools."
export const README = { uri: "docs://readme", text: "hello", mimeType: "text/plain" }
export const LOGO = { uri: "docs://logo", blob: "aGVsbG8=", mimeType: "image/png" }
export const ELICITATION_URL = "https://example.com/authorize"

const object = { type: "object" as const, properties: {} }
const entries = skillEntry("deploy", SKILL_FILES).then((entry) => [entry])
// Not listed, but confirmed by `skills/get`.
export const DISPUTES = "---\nname: disputes\ndescription: Handle disputes\n---\n# Disputes\n"
const unlisted = skillEntry("billing/disputes", { "SKILL.md": DISPUTES })

/**
 * Tools: `echo` answers with what it received (arguments as structured content, `text` as text, plus the session and
 * whether a progress token came along); `confirm` asks for a URL elicitation; `ask` asks for a form; `agree` for one with no fields;
 * `roots` asks for the client's roots; `change` adds a tool and announces it through `changed`; `result` answers with
 * the result its `result` argument holds; `typed` declares an output schema.
 */
export function make(spec: Spec, state: State, changed: () => void) {
  const server = new McpServer(
    { name: "fixture", title: "Fixture", version: "1.0.0" },
    {
      instructions: INSTRUCTIONS,
      capabilities: {
        prompts: {},
        ...(spec.events ? { extensions: { "io.modelcontextprotocol/events": {} } } : {}),
      },
    },
  )
  server.server.registerCapabilities({ tools: { listChanged: true } })
  server.server.setRequestHandler("tools/list", () =>
    Promise.resolve({
      tools: [
        { name: "echo", title: "Echo", inputSchema: { ...object, properties: { text: { type: "string" } } } },
        { name: "confirm", inputSchema: object },
        { name: "ask", inputSchema: object },
        { name: "agree", inputSchema: object },
        { name: "roots", inputSchema: object },
        { name: "change", inputSchema: object },
        { name: "result", inputSchema: object },
        {
          name: "typed",
          inputSchema: object,
          outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
        },
        ...state.added.map((name) => ({ name, inputSchema: object })),
      ],
    }),
  )
  server.server.setRequestHandler("tools/call", (request, ctx) => {
    const args = request.params.arguments ?? {}
    const responses = ctx.mcpReq.inputResponses
    switch (request.params.name) {
      case "echo":
        return Promise.resolve({
          content: typeof args.text === "string" ? [{ type: "text" as const, text: args.text }] : [],
          structuredContent: {
            args,
            sessionID: request.params._meta?.["ai.opencode/sessionID"] ?? null,
            progress: request.params._meta?.progressToken !== undefined,
          },
        })
      case "confirm": {
        if (!responses)
          return Promise.resolve(
            inputRequired({
              inputRequests: { auth: inputRequired.elicitUrl({ message: "Authorize", url: ELICITATION_URL }) },
            }),
          )
        const response = inputResponse(responses, "auth")
        return Promise.resolve({
          content: [],
          structuredContent: { action: response.kind === "elicit" ? response.action : "cancel" },
        })
      }
      case "ask": {
        if (!responses)
          return Promise.resolve(
            inputRequired({
              inputRequests: {
                form: inputRequired.elicit({
                  message: "Pick",
                  requestedSchema: {
                    type: "object",
                    properties: {
                      name: { type: "string", title: "Name", minLength: 1 },
                      size: { type: "string", enum: ["s", "m"], enumNames: ["Small", "Medium"] },
                      count: { type: "integer", minimum: 1 },
                      urgent: { type: "boolean", title: "boolean" },
                      tags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
                    },
                    required: ["name"],
                  },
                }),
              },
            }),
          )
        const response = inputResponse(responses, "form")
        return Promise.resolve({
          content: [],
          structuredContent:
            response.kind === "elicit" ? { action: response.action, content: response.content ?? null } : {},
        })
      }
      case "agree": {
        if (!responses)
          return Promise.resolve(
            inputRequired({
              inputRequests: {
                form: inputRequired.elicit({ message: "Agree", requestedSchema: { type: "object", properties: {} } }),
              },
            }),
          )
        const response = inputResponse(responses, "form")
        return Promise.resolve({
          content: [],
          structuredContent: response.kind === "elicit" ? { action: response.action } : {},
        })
      }
      case "roots": {
        if (!responses) return Promise.resolve(inputRequired({ inputRequests: { roots: inputRequired.listRoots() } }))
        return Promise.resolve({ content: [], structuredContent: inputResponse(responses, "roots") })
      }
      case "result":
        return Promise.resolve(args.result as { content: [] })
      case "typed":
        return Promise.resolve({ content: [], structuredContent: { ok: true } })
      case "change":
        state.added.push(`added_${state.added.length + 1}`)
        changed()
        return Promise.resolve({ content: [{ type: "text" as const, text: "changed" }] })
      default:
        if (!state.added.includes(request.params.name))
          return Promise.reject(new Error(`Unknown tool: ${request.params.name}`))
        return Promise.resolve({ content: [{ type: "text" as const, text: request.params.name }] })
    }
  })
  server.server.setRequestHandler("prompts/list", () =>
    Promise.resolve({
      prompts: [{ name: "greet", description: "Greet", arguments: [{ name: "name", required: true }] }],
    }),
  )
  server.server.setRequestHandler("prompts/get", (request) =>
    Promise.resolve({
      messages: [
        { role: "user" as const, content: { type: "text" as const, text: `hi ${request.params.arguments?.name}` } },
      ],
    }),
  )
  if (spec.resources !== false) {
    server.registerResource("Readme", README.uri, {}, () => Promise.resolve({ contents: [README, LOGO] }))
    server.registerResource("File", new ResourceTemplate("docs://{path}", { list: undefined }), {}, (uri) =>
      Promise.resolve({ contents: [{ uri: uri.href, text: uri.href }] }),
    )
  }
  if (spec.skills)
    new SkillsExtension({
      source: {
        list: () => entries.then((skills) => ({ skills })),
        get: (uri) =>
          Promise.all([entries, unlisted]).then(([skills, hidden]) =>
            [...skills, hidden].find((skill) => skill.uri === uri),
          ),
        read: (uri) => {
          const text =
            uri === "skill://billing/disputes/SKILL.md"
              ? DISPUTES
              : uri.startsWith("skill://deploy/")
                ? SKILL_FILES[uri.slice("skill://deploy/".length) as keyof typeof SKILL_FILES]
                : undefined
          return Promise.resolve(
            text === undefined ? undefined : { text: state.tampered ? `${text.slice(0, -1)}!` : text },
          )
        },
      },
    }).attach(server)
  return server
}
