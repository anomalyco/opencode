# Executor Setup

Executor keeps the always-loaded tool descriptions short. The complete workflow is fetched on demand through `skills`, and individual tool signatures are fetched at runtime through `tools.search()` and `tools.describe.tool()`.

## Always-Loaded Tool: `execute`

### Tool Description

Execute TypeScript in a sandboxed runtime.

Before writing code, call `skills({ name: "execute" })` for the workflow on how to use this tool.

## Available integrations

Integrations you have connected. Their tools live under `tools.<integration>.…`.
- `context7`
- `github`
- `linear`

### Parameters

#### `code`

Type: `string`

Required: `true`

Constraints: trimmed, minimum length 1

Description: none

## Always-Loaded Tool: `skills`

### Tool Description

Fetch a named how-to skill. Skills hold the long-form guidance that would otherwise bloat another tool's always-loaded description.
Call `skills({ name: "execute" })` for the full guide to writing code for the `execute` tool (search the catalog, call tools, emit results, resume paused runs).
Call with no name to list the available skills.

### Parameters

#### `name`

Type: `string`

Required: `false`

Description: The skill to fetch, e.g. "execute". Omit to list available skills.

## Result Of `skills({ name: "execute" })`

# execute

Execute TypeScript in a sandboxed runtime with access to configured API tools.

## Workflow

1. `const { items: matches } = await tools.search({ query: "<intent + key nouns>", limit: 12 });`
2. `const path = matches[0]?.path; if (!path) return "No matching tools found.";`
3. `const details = await tools.describe.tool({ path });`
4. Use `details.inputTypeScript` / `details.outputTypeScript` and `details.typeScriptDefinitions` for compact shapes.
5. Use `tools.executor.coreTools.connections.list({})` when you need live saved-connection inventory.
6. Call the tool: `const result = await tools.<path>(input);`

## Rules

- `tools.search()` returns paginated, ranked matches: `{ items, total, hasMore, nextOffset }`. Best-first. Use short intent phrases like `github issues`, `repo details`, or `create calendar event`.
- When you already know the namespace, narrow with `tools.search({ namespace: "github", query: "issues" })`.
- `tools.executor.coreTools.connections.list({})` returns saved connections with `{ address, integration, owner, name, ... }`. The `address` field includes the leading `tools.` root.
- Tool calls return a value union: `{ ok: true, data }` for success or `{ ok: false, error: { code, message, status?, details?, retryable? } }` for expected tool/domain failures. Branch on `result.ok`.
- `data` is the upstream payload itself. HTTP-backed tools (OpenAPI) also set `http: { status, headers }` beside `data` - read `result.http?.headers` for pagination (Link) or rate-limit headers.
- Use `emit(value)` to append user-visible output and return `undefined`. Plain values become MCP text content. MCP content blocks are forwarded as-is. `ToolFile` values are rendered by MIME. Emitted output goes to the user, not back to you; the result envelope reports an `emitted` count so you can confirm it landed, but to read a value yourself, `return` it.
- File-returning tools may return `ToolFile` values: `{ _tag: "ToolFile", name?, mimeType, encoding: "base64", data, byteLength }`. Emit any attachment with `emit(result.data)`.
- To emit MCP-native content directly, pass an MCP content block to `emit(...)`, such as `{ type: "image", data, mimeType }`, `{ type: "audio", data, mimeType }`, `{ type: "text", text }`, `{ type: "resource", resource }`, or `{ type: "resource_link", uri, name, ... }`.
- `emit(ToolFile)` is MIME-based: `image/*` becomes MCP image content, `audio/*` becomes MCP audio content, text-like files become decoded text, and other binary files become embedded MCP resources.
- `return` is only for ordinary structured data. Returning a `ToolFile`, a `ToolResult`, an MCP content block, or a bare base64 string does not emit content to the MCP client.
- Some providers, including Gmail, return attachment bytes without a public URL. To send that attachment to another API from code, decode `ToolFile.data` from base64 and pass the bytes to that API's upload/file input.
- If `tools.search()` returns `hasMore: true` and you didn't find what you need, fetch the next page: `tools.search({ query, offset: nextOffset, limit })`.
- Always use the full address when calling tools: `tools.<integration>.<owner>.<connection>.<tool>(args)`. The `path` returned by `tools.search()` / `tools.describe.tool()` is already the exact path under `tools` - call `tools[path]` rather than guessing segments.
- The `tools` object is a lazy proxy - `Object.keys(tools)` won't work. Use `tools.search()` or `tools.executor.coreTools.connections.list({})` instead.
- Pass an object to system tools, e.g. `tools.search({ query: "..." })`, `tools.executor.coreTools.connections.list({})`, and `tools.describe.tool({ path })`.
- `tools.describe.tool()` returns compact TypeScript shapes. Use `inputTypeScript`, `outputTypeScript`, and `typeScriptDefinitions`. If the path doesn't resolve, the result carries `error: { code: "tool_not_found", suggestions }` - use a suggestion instead of retrying the same path.
- For tools that return large collections (e.g. `getStates`, `getAll`), filter results in code rather than calling per-item tools.
- Do not use `fetch` - all API calls go through `tools.*`.
- If execution pauses for interaction, resume it with the returned `resumePayload`.
- TypeScript type syntax (`: T`, `as T`, generics, interfaces, type aliases) is stripped before execution - feel free to write idiomatic TypeScript using the shapes from `tools.describe.tool()`. Decorators and `enum` are not supported.

## Available integrations

Integrations you have connected. Their tools live under `tools.<integration>.…`.
- `context7`
- `github`
- `linear`

## Example Runtime Discovery

The signatures below are not included in either always-loaded description. The model discovers them from inside the sandbox.

### Search

```ts
const searches = await Promise.all([
  tools.search({ namespace: "context7", query: "resolve library", limit: 5 }),
  tools.search({ namespace: "github", query: "issues", limit: 5 }),
  tools.search({ namespace: "linear", query: "issues", limit: 5 }),
])
return searches
```

Illustrative result:

```json
[
  {
    "items": [
      {
        "path": "context7.user.default.resolve-library-id",
        "name": "resolve-library-id",
        "description": "Resolve a package name to its Context7 library ID",
        "integration": "context7",
        "score": 237
      }
    ],
    "total": 1,
    "hasMore": false,
    "nextOffset": null
  },
  {
    "items": [
      {
        "path": "github.org.main.list_issues",
        "name": "list_issues",
        "description": "List issues in a GitHub repository",
        "integration": "github",
        "score": 221
      },
      {
        "path": "github.org.main.create_issue",
        "name": "create_issue",
        "description": "Create a GitHub issue",
        "integration": "github",
        "score": 190
      }
    ],
    "total": 2,
    "hasMore": false,
    "nextOffset": null
  },
  {
    "items": [
      {
        "path": "linear.org.main.search_issues",
        "name": "search_issues",
        "description": "Search Linear issues",
        "integration": "linear",
        "score": 218
      },
      {
        "path": "linear.org.main.get_issue",
        "name": "get_issue",
        "description": "Get a Linear issue by ID",
        "integration": "linear",
        "score": 176
      }
    ],
    "total": 2,
    "hasMore": false,
    "nextOffset": null
  }
]
```

### Describe

```ts
const paths = [
  "context7.user.default.resolve-library-id",
  "github.org.main.create_issue",
  "github.org.main.list_issues",
  "linear.org.main.get_issue",
  "linear.org.main.search_issues",
]

return await Promise.all(paths.map((path) => tools.describe.tool({ path })))
```

Illustrative compact descriptions:

```ts
{
  path: "context7.user.default.resolve-library-id",
  name: "resolve-library-id",
  description: "Resolve a package name to its Context7 library ID",
  inputTypeScript: "{ libraryName: string; }",
  outputTypeScript: "{ ok: true; data: { id: string; title: string; }; http?: ToolHttpMeta } | { ok: false; error: ToolError }",
  typeScriptDefinitions: {
    ToolError: "{ code: string; message: string; status?: number; details?: unknown; retryable?: boolean }",
    ToolHttpMeta: "{ status: number; headers: { [k: string]: string; } }",
    ToolFile: "{ _tag: \"ToolFile\"; name?: string; mimeType: string; encoding: \"base64\"; data: string; byteLength: number; }",
  },
}

{
  path: "github.org.main.create_issue",
  name: "create_issue",
  description: "Create a GitHub issue",
  inputTypeScript: "{ owner: string; repo: string; title: string; body?: string; }",
  outputTypeScript: "{ ok: true; data: { number: number; url: string; }; http?: ToolHttpMeta } | { ok: false; error: ToolError }",
  typeScriptDefinitions: {
    ToolError: "{ code: string; message: string; status?: number; details?: unknown; retryable?: boolean }",
    ToolHttpMeta: "{ status: number; headers: { [k: string]: string; } }",
    ToolFile: "{ _tag: \"ToolFile\"; name?: string; mimeType: string; encoding: \"base64\"; data: string; byteLength: number; }",
  },
}

{
  path: "github.org.main.list_issues",
  name: "list_issues",
  description: "List issues in a GitHub repository",
  inputTypeScript: "{ owner: string; repo: string; state?: \"open\" | \"closed\"; }",
  outputTypeScript: "{ ok: true; data: Array<{ number: number; title: string; state: string; }>; http?: ToolHttpMeta } | { ok: false; error: ToolError }",
  typeScriptDefinitions: {
    ToolError: "{ code: string; message: string; status?: number; details?: unknown; retryable?: boolean }",
    ToolHttpMeta: "{ status: number; headers: { [k: string]: string; } }",
    ToolFile: "{ _tag: \"ToolFile\"; name?: string; mimeType: string; encoding: \"base64\"; data: string; byteLength: number; }",
  },
}

{
  path: "linear.org.main.get_issue",
  name: "get_issue",
  description: "Get a Linear issue by ID",
  inputTypeScript: "{ id: string; }",
  outputTypeScript: "{ ok: true; data: { id: string; identifier: string; title: string; status: string; }; http?: ToolHttpMeta } | { ok: false; error: ToolError }",
  typeScriptDefinitions: {
    ToolError: "{ code: string; message: string; status?: number; details?: unknown; retryable?: boolean }",
    ToolHttpMeta: "{ status: number; headers: { [k: string]: string; } }",
    ToolFile: "{ _tag: \"ToolFile\"; name?: string; mimeType: string; encoding: \"base64\"; data: string; byteLength: number; }",
  },
}

{
  path: "linear.org.main.search_issues",
  name: "search_issues",
  description: "Search Linear issues",
  inputTypeScript: "{ query: string; limit?: number; }",
  outputTypeScript: "{ ok: true; data: Array<{ id: string; identifier: string; title: string; }>; http?: ToolHttpMeta } | { ok: false; error: ToolError }",
  typeScriptDefinitions: {
    ToolError: "{ code: string; message: string; status?: number; details?: unknown; retryable?: boolean }",
    ToolHttpMeta: "{ status: number; headers: { [k: string]: string; } }",
    ToolFile: "{ _tag: \"ToolFile\"; name?: string; mimeType: string; encoding: \"base64\"; data: string; byteLength: number; }",
  },
}
```

### Invoke

```ts
const matches = await tools.search({ namespace: "github", query: "list issues", limit: 5 })
const path = matches.items[0]?.path
if (!path) return "No matching tools found."

const details = await tools.describe.tool({ path })
if (details.error) return details.error

const result = await tools[path]({ owner: "opencode-ai", repo: "opencode", state: "open" })
if (!result.ok) return { error: result.error.message }

return result.data.map((issue) => ({ number: issue.number, title: issue.title }))
```
