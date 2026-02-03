# OpenCode AI Architecture Index

## System Essence

OpenCode: Bun+TypeScript monorepo implementing AI-driven development tool with TUI interface. Namespace-based architecture: Zod-validated `Tool.define()` pattern, Hono HTTP server with SSE, extensible tool/agent/provider systems. Core dispatch: yargs CLI → `RunCommand`/`ServeCommand` → `InstanceBootstrap` → `Config.state()` → `Provider.state()` → `Agent.state()` → `ToolRegistry.state()` → `Server.listen()`. State orchestration: `Session` namespace manages lifecycle (create/fork/update/delete), `MessageV2` streaming generator, `Storage` with JSON persistence+Locking. Execution mediation: `ToolRegistry` filters tools by model/agent, `PermissionNext` enforces ruleset, `Provider` abstracts AI backends via dynamic `@ai-sdk/*` loading.

---

## Core Symbolic Map

### CLI Layer (`src/cli/cmd/*.ts`, `src/index.ts`)

| Symbol            | Role              | Purpose                                                                                                                     |
| ----------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `RunCommand`      | [Entry Point]     | `bun dev` → `Instance.provide({ init: InstanceBootstrap })` → `Tui.connect()` → `Server.listen(port:4096)` → `TuiRoutes.ws` |
| `ServeCommand`    | [Server Launcher] | `bun dev serve` → `Server.listen({ port, hostname?, mdns? })` → `Hono App.fetch()`                                          |
| `GenerateCommand` | [SDK Generator]   | Regenerates TypeScript SDK from OpenAPI spec via `./script/generate.ts`                                                     |
| `AuthCommand`     | [Auth Handler]    | `Provider.state()` → `Auth.all()` credential management                                                                     |
| `AgentCommand`    | [Agent Config]    | `Agent.state()` → config-driven agent definition                                                                            |
| `SessionCommand`  | [Session Ops]     | `Session.list()`, `Session.remove()`, `Session.fork()`                                                                      |
| `McpCommand`      | [MCP Manager]     | MCP server configuration via `Config.mcp`                                                                                   |
| `DebugCommand`    | [Diagnostics]     | Subcommands: `lsp`, `ripgrep`, `snapshot`                                                                                   |
| `Bootstrap`       | [Initializer]     | CLI bootstrapping, TUI initialization                                                                                       |
| `UI`              | [Renderer]        | Terminal UI rendering, logo, error display via `OpenTUI`                                                                    |

### Core Logic Layer (`src/session/`, `src/config/`)

| Symbol               | Role                                  | Purpose                                                                                                               | Reference               |
| -------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `Session`            | [State Manager] [Persistence Hub]     | Session lifecycle: create/fork/update/delete; message/part orchestration; `Bus.publish()` events                      | `session/index.ts`      |
| `Session.create`     | [Factory]                             | `Identifier.descending("session")` → `Storage.write(["session", projectID, id], info)` → `Bus.publish(Event.Created)` | `session/index.ts:140`  |
| `Session.fork`       | [Copier] [ID Remapper]                | Clones messages/parts with `Identifier.ascending()` remapping; preserves parentID                                     | `session/index.ts:158`  |
| `Session.touch`      | [State Updater]                       | Updates `time.updated` timestamp for activity tracking                                                                | `session/index.ts:200`  |
| `Session.update`     | [Editor]                              | `Storage.update()` mutates draft; triggers `Event.Updated`                                                            | `session/index.ts:297`  |
| `Session.getUsage`   | [Cost Calculator]                     | Computes token cost from `LanguageModelUsage` + `ProviderMetadata`                                                    | `session/index.ts:436`  |
| `Session.BusyError`  | [Error]                               | Signals session busy state                                                                                            | `session/index.ts:491`  |
| `MessageV2`          | [Message Struct] [Streaming Source]   | Message with parts; reverse-chronological `stream()` generator                                                        | `session/message-v2.ts` |
| `MessageV2.stream`   | [Generator]                           | `for await (const msg of MessageV2.stream(sessionID))` yields messages                                                | `session/message-v2.ts` |
| `MessageV2.Part`     | [Union Type]                          | `TextPart` \| `ReasoningPart` \| `FilePart` \| `ToolResultPart`                                                       | `session/message-v2.ts` |
| `Config`             | [Config Loader] [Permission Resolver] | Multi-source merge: remote→global→project→managed                                                                     | `config/config.ts`      |
| `Config.get`         | [Accessor]                            | Returns cached merged `Config.Info`                                                                                   | `config/config.ts:1267` |
| `Config.directories` | [Scanner]                             | Enumerates `.opencode` config directories                                                                             | `config/config.ts`      |
| `Config.state`       | [State Machine]                       | Lazy-loaded config with merge precedence                                                                              | `config/config.ts:62`   |

### Tool System (`src/tool/*.ts`)

| Symbol               | Role                             | Purpose                                                                       |
| -------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| `Tool`               | [Namespace] [Definition Factory] | `Tool.define(id, init)` pattern for registration                              |
| `Tool.Info`          | [Interface]                      | `{ id, init, description, parameters: z.ZodType, execute }`                   |
| `Tool.Context`       | [Execution Context]              | `{ sessionID, messageID, agent, abort, callID, messages, metadata(), ask() }` |
| `Tool.define`        | [Factory Wrapper]                | Wraps init with Zod validation + `Truncate.output()`                          |
| `ToolRegistry`       | [Registry] [Router]              | Tool enumeration, model/agent filtering, plugin integration                   |
| `ToolRegistry.state` | [Loader]                         | Lazy-loads built-in + custom tools via `Config.directories()`                 |
| `ToolRegistry.tools` | [Provider]                       | Returns `{ id, description, parameters }[]` for model/agent                   |
| `BashTool`           | [Executor]                       | `Bun.spawn({ cmd, cwd })` with permission checking                            |
| `ReadTool`           | [File Reader]                    | `Bun.file(path).text()` with encoding handling                                |
| `WriteTool`          | [File Writer]                    | `Bun.write(path, content)` with directory auto-creation                       |
| `EditTool`           | [File Editor]                    | In-place modification via replacement patterns                                |
| `GlobTool`           | [Finder]                         | `Bun.glob(pattern).scan()`                                                    |
| `GrepTool`           | [Searcher]                       | `ripgrep.search()` via regex patterns                                         |
| `TaskTool`           | [Subagent Dispatcher]            | Launches `Agent.explore` / `Agent.general`                                    |
| `WebFetchTool`       | [HTTP Client]                    | `fetch(url)` with markdown conversion                                         |
| `WebSearchTool`      | [Web Search]                     | Exa API web search                                                            |
| `CodeSearchTool`     | [Code Search]                    | Exa API semantic code search                                                  |
| `TodoWriteTool`      | [State Manager]                  | Task list mutation                                                            |
| `TodoReadTool`       | [State Reader]                   | Task list retrieval                                                           |
| `BatchTool`          | [Parallel Executor]              | Multiple tool execution in single turn                                        |
| `ApplyPatchTool`     | [Patch Applier]                  | Unified Diff patch application                                                |
| `SkillTool`          | [Skill Loader]                   | Executes predefined skill workflows                                           |
| `PlanEnterTool`      | [Mode Switcher]                  | Enters plan mode with permission check                                        |
| `PlanExitTool`       | [Mode Switcher]                  | Exits plan mode to build mode                                                 |
| `InvalidTool`        | [Fallback]                       | Gracefully handles unknown tool calls                                         |
| `Truncate`           | [Output Limiter]                 | Long output truncation to files                                               |

### Agent System (`src/agent/*.ts`)

| Symbol               | Role                        | Purpose                                                         |
| -------------------- | --------------------------- | --------------------------------------------------------------- |
| `Agent`              | [Namespace] [Agent Factory] | Built-in + dynamic agent definitions                            |
| `Agent.Info`         | [Schema]                    | `{ name, mode, permission, model, prompt, temperature, steps }` |
| `Agent.state`        | [Loader]                    | Lazy-loads configs with permission merging                      |
| `Agent.get`          | [Accessor]                  | Retrieves agent by name                                         |
| `Agent.list`         | [Enumerator]                | Returns sorted list with default first                          |
| `Agent.defaultAgent` | [Resolver]                  | Resolves from config or fallback                                |
| `Agent.generate`     | [Generator]                 | Creates agent config via LLM                                    |
| `Agent.build`        | [Primary Agent]             | Default agent: full edit permissions                            |
| `Agent.plan`         | [Primary Agent]             | Planning mode: no edit tools                                    |
| `Agent.general`      | [Subagent]                  | General-purpose multi-step tasks                                |
| `Agent.explore`      | [Subagent]                  | Read-only codebase exploration                                  |
| `Agent.compaction`   | [System Agent]              | Session context compression                                     |
| `Agent.title`        | [System Agent]              | Session title generation                                        |
| `Agent.summary`      | [System Agent]              | Session summary generation                                      |
| `Agent.checker`      | [Subagent]                  | Code quality verification                                       |
| `PermissionNext`     | [Permission Engine]         | Pattern-based permission matching + inheritance                 |

### Provider System (`src/provider/*.ts`)

| Symbol                        | Role                  | Purpose                                           |
| ----------------------------- | --------------------- | ------------------------------------------------- |
| `Provider`                    | [Namespace] [Factory] | AI provider abstraction + dynamic SDK loading     |
| `Provider.Model`              | [Schema]              | Model metadata: id, capabilities, cost, limits    |
| `Provider.Info`               | [Schema]              | Provider metadata: id, models, auth options       |
| `Provider.state`              | [Loader]              | Lazy-loads providers from config/env/auth/plugins |
| `Provider.list`               | [Enumerator]          | Returns all available providers                   |
| `Provider.getModel`           | [Resolver]            | Retrieves model with fuzzy matching               |
| `Provider.getLanguage`        | [Factory]             | Creates `LanguageModelV2` instance                |
| `Provider.getSDK`             | [Factory]             | Creates/caches provider SDK instance              |
| `Provider.defaultModel`       | [Resolver]            | Resolves default model from config                |
| `Provider.getSmallModel`      | [Resolver]            | Finds small/fast model for lightweight tasks      |
| `Provider.parseModel`         | [Parser]              | Parses "provider/model" string                    |
| `Provider.ModelNotFoundError` | [Error]               | Model lookup failure with suggestions             |
| `Provider.InitError`          | [Error]               | Provider initialization failure                   |
| `ModelsDev`                   | [Model Registry]      | Remote model registry from opencode.ai            |
| `ProviderTransform`           | [Mutator]             | Model variant transformation                      |

### Server Layer (`src/server/*.ts`)

| Symbol               | Role                   | Purpose                                       |
| -------------------- | ---------------------- | --------------------------------------------- |
| `Server`             | [HTTP Server] [Router] | Hono-based server + OpenAPI spec generation   |
| `Server.url`         | [Accessor]             | Returns server URL                            |
| `Server.App`         | [Hono App]             | Main application with all routes              |
| `Server.listen`      | [Launcher]             | Starts Bun HTTP server + optional mDNS        |
| `Server.openapi`     | [Spec Generator]       | Generates OpenAPI 3.1.1 spec                  |
| `TuiRoutes`          | [TUI API]              | WebSocket/TUI communication endpoints         |
| `SessionRoutes`      | [Session API]          | Session CRUD: list/get/create/delete/fork     |
| `ProjectRoutes`      | [Project API]          | Project info + configuration                  |
| `PtyRoutes`          | [PTY API]              | PTY creation + I/O                            |
| `McpRoutes`          | [MCP API]              | MCP server management                         |
| `FileRoutes`         | [File API]             | File operations via HTTP                      |
| `ConfigRoutes`       | [Config API]           | Configuration management                      |
| `ProviderRoutes`     | [Provider API]         | Provider/model listing                        |
| `PermissionRoutes`   | [Permission API]       | Permission queries                            |
| `QuestionRoutes`     | [Question API]         | User prompt routing                           |
| `GlobalRoutes`       | [Global API]           | Global/singleton endpoints                    |
| `ExperimentalRoutes` | [Experimental API]     | Feature flags                                 |
| `Bus`                | [Event Bus]            | Global `publish()`/`subscribe()` distribution |
| `Bus.publish`        | [Publisher]            | Emits events to subscribers                   |
| `Bus.subscribe`      | [Subscriber]           | Registers event handler                       |
| `Bus.subscribeAll`   | [Bulk Subscriber]      | Registers handler for all events              |
| `BusEvent`           | [Event Definition]     | Typed event schema definition                 |

### Storage Layer (`src/storage/*.ts`)

| Symbol                  | Role                 | Purpose                                |
| ----------------------- | -------------------- | -------------------------------------- |
| `Storage`               | [Persistence Engine] | JSON file storage with key-array paths |
| `Storage.read`          | [Loader]             | Reads JSON by key array path           |
| `Storage.write`         | [Writer]             | Writes JSON with write lock            |
| `Storage.update`        | [Editor]             | Updates JSON with write lock           |
| `Storage.remove`        | [Deleter]            | Removes JSON file                      |
| `Storage.list`          | [Scanner]            | Lists keys with prefix                 |
| `Storage.NotFoundError` | [Error]              | Key not found                          |
| `Lock`                  | [Mutex]              | File-based read/write locking          |
| `Lock.read`             | [Read Lock]          | Acquires shared lock                   |
| `Lock.write`            | [Write Lock]         | Acquires exclusive lock                |

### Project Layer (`src/project/*.ts`)

| Symbol               | Role                | Purpose                               |
| -------------------- | ------------------- | ------------------------------------- |
| `Instance`           | [Context Container] | Per-request project/directory context |
| `Instance.state`     | [State Factory]     | Lazy state with cleanup               |
| `Instance.provide`   | [Context Wrapper]   | Wraps async operation with context    |
| `Instance.dispose`   | [Cleanup]           | Releases all resources                |
| `Instance.directory` | [Accessor]          | Working directory                     |
| `Instance.worktree`  | [Accessor]          | Git worktree root                     |
| `Instance.project`   | [Accessor]          | Project metadata                      |
| `InstanceBootstrap`  | [Initializer]       | Initializes project, VCS, plugins     |
| `Vcs`                | [Version Control]   | Git operations: branch, status        |
| `ProjectBootstrap`   | [Initializer]       | Project structure creation            |

### Utility Layer (`src/util/*.ts`)

| Symbol        | Role              | Purpose                                  |
| ------------- | ----------------- | ---------------------------------------- |
| `Log`         | [Logging]         | Structured JSON logging with levels      |
| `Log.create`  | [Factory]         | Creates namespaced logger                |
| `Log.Default` | [Singleton]       | Default application logger               |
| `NamedError`  | [Error Factory]   | Typed error with metadata                |
| `Identifier`  | [ID Generator]    | Generates lexicographically sortable IDs |
| `fn`          | [Decorator]       | Zod-validated function wrapper           |
| `lazy`        | [Memoizer]        | Lazy initialization with memoization     |
| `BusGlobal`   | [Global Bus]      | Cross-instance event bus                 |
| `Global`      | [Env Accessor]    | Environment paths + utilities            |
| `Flag`        | [Feature Flag]    | Runtime feature flag access              |
| `Auth`        | [Auth Storage]    | Provider credential management           |
| `Format`      | [Formatter]       | Code formatting orchestration            |
| `LSP`         | [Language Server] | LSP server management                    |
| `Skill`       | [Skill Loader]    | Skill workflow definition                |
| `Plugin`      | [Plugin Manager]  | Plugin loading + lifecycle               |

---

## Primary Data Contracts

### Zod Schemas (State Definition)

```typescript
Session.Info = z.object({
  id: Identifier.schema("session"),
  slug: z.string(),
  projectID: z.string(),
  directory: z.string(),
  parentID: Identifier.schema("session").optional(),
  summary: z.object({ additions, deletions, files, diffs }).optional(),
  share: z.object({ url: z.string() }).optional(),
  title: z.string(),
  version: z.string(),
  time: { created, updated, compacting, archived },
  permission: PermissionNext.Ruleset.optional(),
  revert: { messageID, partID, snapshot, diff }.optional(),
})

MessageV2 = {
  info: { id, sessionID, role: "user"|"assistant", parentID?, error? },
  parts: TextPart | ReasoningPart | FilePart | ToolResultPart[],
}

Tool.Info = {
  id: string,
  init: (InitContext) => Promise<{
    description: string,
    parameters: z.ZodType,
    execute: (args, Context) => Promise<{
      title: string,
      metadata: Metadata,
      output: string,
      attachments: FilePart[],
    }>,
  }>,
}

Agent.Info = {
  name: string,
  mode: "subagent"|"primary"|"all",
  permission: PermissionNext.Ruleset,
  model: { providerID, modelID }.optional(),
  temperature: z.number().optional(),
  steps: z.number().int().positive().optional(),
  prompt: z.string().optional(),
}

Provider.Model = {
  id: string,
  providerID: string,
  api: { id, url, npm },
  capabilities: { temperature, reasoning, attachment, toolcall, input, output },
  cost: { input, output, cache: { read, write } },
  limit: { context, input, output },
  status: "alpha"|"beta"|"deprecated"|"active",
  variants: Record<string, Record<string, any>>,
}

Config.Info = {
  model: z.string().optional(),
  small_model: z.string().optional(),
  default_agent: z.string().optional(),
  agent: Record<string, Agent>,
  provider: Record<string, Provider>,
  mcp: Record<string, Mcp>,
  permission: Permission,
  share: "manual"|"auto"|"disabled",
  compaction: { auto, prune }.optional(),
}

PermissionNext.Ruleset = Array<{
  permission: string,
  action: "ask"|"allow"|"deny",
  pattern?: string,
}>
```

### Object Lifecycle

**Session:** `Session.create()` → `Identifier.descending("session")` → `Storage.write()` → `Bus.publish(Event.Created)` → `Session.update()` (mutate draft) → `Session.fork()` (ID remap) → `Session.remove()` (cascade delete)

**Message:** `MessageV2.stream(sessionID)` → generator yields reverse-chronological → `Session.updateMessage()` → `Storage.write(["message", sessionID, id])` → `Session.updatePart()` → `Storage.write(["part", messageID, id])`

**Tool:** `ToolRegistry.tools(model, agent)` → filter/enumerate → `generateObject()` → `ToolRegistry.execute(toolID, args, ctx)` → `ctx.ask()` (permission check) → `tool.execute()` → `Truncate.output()` → return `{ title, metadata, output, attachments }` → `Session.updatePart(ToolResultPart)`

**Provider:** `Provider.state()` → lazy load → `ModelsDev.get()` → merge config/env/auth/plugins → `Provider.getSDK(model)` → dynamic `@ai-sdk/*` import → `sdk.languageModel(model.api.id)` → cache by hash

**Config Merge Precedence (low→high):** Remote well-known → Global user → Custom file → Project → Inline content → Managed (`/etc/opencode/`)

---

## Core Execution Loops

### Tool Execution Loop

```typescript
async function executeToolLoop(
  model: Provider.Model,
  agent: Agent.Info,
  sessionID: string,
  messageID: string,
  abortSignal: AbortSignal,
): Promise<void> {
  const tools = await ToolRegistry.tools(model, agent)
  const toolDefs = tools.map((t) => ({
    id: t.id,
    description: t.description,
    parameters: zodToJsonSchema(t.parameters),
  }))
  const { fullStream } = generateObject({
    model: providerLanguageModel,
    tools: toolDefs,
    messages: sessionMessages,
  })
  for await (const chunk of fullStream) {
    if (chunk.type === "error") throw chunk.error
    if (chunk.type === "tool-call") {
      const toolResult = await executeSingleTool(chunk, sessionID, messageID, agent, abortSignal)
      streamToolResult(toolResult)
    }
  }
}

async function executeSingleTool(chunk, sessionID, messageID, agent, abortSignal) {
  const tool = await ToolRegistry.get(chunk.toolName)
  if (!tool) return { error: "Unknown tool" }
  const ctx: Tool.Context = {
    sessionID,
    messageID,
    agent: agent.name,
    abort: abortSignal,
    callID: chunk.toolCallId,
    messages: await Session.messages({ sessionID }),
    metadata() {},
    async ask(request) {
      const allowed = await PermissionNext.check(agent.permission, chunk.toolName, request)
      if (!allowed) throw new PermissionDeniedError()
    },
  }
  const result = await tool.execute(chunk.toolArgs, ctx)
  const truncated = await Truncate.output(result.output, { truncated: result.metadata }, agent)
  await Session.updatePart({
    ...result,
    output: truncated.content,
    metadata: { ...result.metadata, truncated: truncated.truncated, outputPath: truncated.outputPath },
    messageID,
    id: Identifier.ascending("part"),
  })
  return result
}
```

### Session Persistence Flow

```typescript
async function persistSessionFlow(sessionID: string, operation: "create" | "update" | "delete") {
  switch (operation) {
    case "create":
      const sessionInfo = {
        id: Identifier.descending("session"),
        slug: Slug.create(),
        version: Installation.VERSION,
        projectID: Instance.project.id,
        directory: Instance.directory,
        title: `New session - ${ISO}`,
        time: { created: Date.now(), updated: Date.now() },
      }
      await Storage.write(["session", projectID, id], sessionInfo)
      Bus.publish(Session.Event.Created, { info: sessionInfo })
      if (Config.get().share === "auto") {
        const share = await Session.share(id)
        await Storage.update(["session", projectID, id], (draft) => {
          draft.share = share
        })
      }
      break
    case "update":
      await Storage.update(["session", projectID, sessionID], (draft) => {
        editor(draft)
        draft.time.updated = Date.now()
      })
      Bus.publish(Session.Event.Updated, { info: updatedInfo })
      break
    case "delete":
      for (const child of await Session.children(sessionID)) await Session.remove(child.id)
      for (const msg of await Storage.list(["message", sessionID])) {
        for (const part of await Storage.list(["part", msg.last()])) await Storage.remove(part)
        await Storage.remove(msg)
      }
      await Storage.remove(["session", projectID, sessionID])
      Bus.publish(Session.Event.Deleted, { info: sessionInfo })
      break
  }
}
```

### Config Loading State Machine

```typescript
async function loadConfigState(): Promise<Config.Info> {
  let result: Config.Info = {}
  for (const [key, value] of await Auth.all()) {
    if (value.type === "wellknown") {
      const remote = await fetch(`${key}/.well-known/opencode`)
      result = mergeConfigConcatArrays(result, await load(remote.config))
    }
  }
  result = mergeConfigConcatArrays(result, await globalConfig())
  if (Flag.OPENCODE_CONFIG) result = mergeConfigConcatArrays(result, await loadFile(Flag.OPENCODE_CONFIG))
  if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
    for (const file of ["opencode.jsonc", "opencode.json"]) {
      const found = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
      for (const resolved of found.toReversed()) {
        result = mergeConfigConcatArrays(result, await loadFile(resolved))
      }
    }
  }
  if (Flag.OPENCODE_CONFIG_CONTENT) result = mergeConfigConcatArrays(result, JSON.parse(Flag.OPENCODE_CONFIG_CONTENT))
  const directories = computeConfigDirectories()
  for (const dir of unique(directories)) {
    result.command = mergeDeep(result.command, await loadCommand(dir))
    result.agent = mergeDeep(result.agent, await loadAgent(dir))
    result.agent = mergeDeep(result.agent, await loadMode(dir))
    result.plugin.push(...(await loadPlugin(dir)))
    await installDependencies(dir)
  }
  if (existsSync(managedConfigDir)) {
    for (const file of ["opencode.jsonc", "opencode.json"]) {
      result = mergeConfigConcatArrays(result, await loadFile(path.join(managedConfigDir, file)))
    }
  }
  if (Flag.OPENCODE_PERMISSION) result.permission = mergeDeep(result.permission, JSON.parse(Flag.OPENCODE_PERMISSION))
  migrateDeprecatedModeToAgent(result)
  migrateLegacyToolsToPermissions(result)
  return result
}
```

### Server Request Flow (Hono)

```typescript
async function handleRequest(request: Request): Promise<Response> {
  const directory = request.query("directory") || request.header("x-opencode-directory")
  return Instance.provide({ directory, init: InstanceBootstrap, fn: () => routeRequest(request) })
}

function routeRequest(request: Request): Response {
  return app.fetch(request)
}

function setupRoutes(app: Hono): void {
  app
    .route("/project", ProjectRoutes())
    .route("/session", SessionRoutes())
    .route("/pty", PtyRoutes())
    .route("/mcp", McpRoutes())
    .route("/file", FileRoutes())
    .route("/config", ConfigRoutes())
    .route("/provider", ProviderRoutes())
    .route("/tui", TuiRoutes())
    .route("/permission", PermissionRoutes())
    .route("/question", QuestionRoutes())
    .get("/event", eventStreamHandler)
    .get("/agent", agentListHandler)
    .get("/skill", skillListHandler)
    .post("/log", logHandler)
}

async function eventStreamHandler(c: Context): Response {
  return streamSSE(c, async (stream) => {
    stream.writeSSE({ data: JSON.stringify({ type: "server.connected" }) })
    const unsub = Bus.subscribeAll(async (event) => {
      stream.writeSSE({ data: JSON.stringify(event) })
    })
    const heartbeat = setInterval(() => {
      stream.writeSSE({ data: JSON.stringify({ type: "server.heartbeat" }) })
    }, 30000)
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(heartbeat)
        unsub()
        resolve()
      })
    })
  })
}
```

### Agent Loop (Primary Agent)

```typescript
async function runPrimaryAgent(sessionID: string, agent: Agent.Info, model: Provider.Model) {
  const provider = await Provider.getLanguage(model)
  const tools = await ToolRegistry.tools(model, agent)
  const system = [
    SystemPrompt.instructions(),
    agent.prompt || PROMPT_BUILD,
    ...Plugin.trigger("experimental.chat.system.transform", { model }, { system: [] }),
  ]
  const messages = await Session.messages({ sessionID })
  while (!abortSignal.aborted) {
    const result = await generateObject({
      model: provider,
      tools: toolDefs,
      messages: [...system.map((s) => ({ role: "system", content: s })), ...messages.map(transformToModelMessage)],
      maxSteps: agent.steps,
      temperature: agent.temperature,
    })
    for (const toolCall of result.toolCalls) {
      try {
        await executeToolCall(toolCall, sessionID, agent, abortSignal)
      } catch (error) {
        await streamToolError(error)
      }
    }
    if (result.toolCalls.length === 0) break
  }
  if (await shouldAutoCompact(sessionID)) await runCompactionAgent(sessionID)
}
```

---

## AI Navigation Call-Stack

### Entry: `bun dev` (RunCommand)

```
RunCommand.execute()
├─ Instance.provide({ directory, init: InstanceBootstrap })
│  ├─ InstanceBootstrap()
│  │  ├─ Instance.state(async () => { ... })
│  │  │  ├─ Config.get()
│  │  │  ├─ Provider.state()
│  │  │  ├─ Agent.state()
│  │  │  └─ ToolRegistry.state()
│  │  ├─ Plugin.loadAll()
│  │  └─ Vcs.init()
│  └─ Tui.connect()
│     ├─ Server.listen({ port: 4096 })
│     │  └─ Hono App.setup()
│     │     ├─ Bus.subscribeAll()
│     │     └─ Route registration
│     └─ Tui.start() [WebSocket]
│        └─ TuiRoutes.setup()
│           └─ handleTuiWebSocket()
│              └─ Agent loop dispatch
```

### Entry: `bun dev serve` (ServeCommand)

```
ServeCommand.execute()
├─ Instance.provide({ directory, init: InstanceBootstrap })
│  └─ (same as above)
└─ Server.listen({ port, hostname, mdns })
   └─ Hono App.fetch()
      ├─ SessionRoutes: GET/POST/DELETE /session/:id[fork]
      ├─ ProjectRoutes: GET /project/info, POST /project/config
      ├─ ProviderRoutes: GET /provider, GET /provider/:id/model/:model
      ├─ FileRoutes: GET/POST/PUT/DELETE /file/*
      ├─ PtyRoutes: POST /pty, WS /pty/:id
      ├─ ConfigRoutes: GET/POST /config
      ├─ McpRoutes: GET/POST/DELETE /mcp
      ├─ PermissionRoutes: POST /permission/check
      ├─ QuestionRoutes: POST /question
      ├─ GET /event [SSE] → Bus.subscribeAll()
      ├─ GET /agent → Agent.list()
      ├─ GET /skill → Skill.all()
      └─ POST /log → Log.create()
```

### Entry: `/init` Command Execution

```
User sends init command via TUI
├─ TuiRoutes.handleMessage()
│  └─ Session.create({ directory, parentID?, permission? })
│     ├─ Identifier.descending("session")
│     ├─ Storage.write(["session", projectID, id], info)
│     ├─ Bus.publish(Event.Created, { info })
│     └─ Session.initialize({ sessionID, modelID, providerID, messageID })
│        └─ SessionPrompt.command({ sessionID, messageID, model, command: "init" })
│           └─ Agent.build.run()
│              ├─ ToolRegistry.tools(model, agent)
│              ├─ generateObject({ tools, messages, system })
│              └─ Tool execution loop
│                 └─ executeToolCall()
│                    ├─ PermissionNext.check(permission, toolID, args)
│                    └─ tool.execute(args, ctx)
│                       └─ Bus.publish(MessageV2.Event.PartUpdated, { part })
```

### Session Fork Flow

```
User triggers fork via UI
├─ SessionRoutes.fork({ sessionID, messageID? })
│  └─ Session.fork({ sessionID, messageID })
│     ├─ Session.get(sessionID) [read original]
│     ├─ Session.create() [create new session]
│     ├─ Session.messages({ sessionID: originalID })
│     │  └─ MessageV2.stream(originalID)
│     └─ For each message up to messageID:
│        ├─ Clone message with new ID
│        │  └─ Session.updateMessage({ ...msg, sessionID: newID, id: newMsgID })
│        └─ Clone all parts with new IDs
│           └─ Session.updatePart({ ...part, messageID: newMsgID, id: newPartID })
│              └─ Bus.publish(MessageV2.Event.PartUpdated, { part })
```

### Tool Execution via Agent

```
Agent generates tool call
├─ ToolRegistry.execute({ toolID, args, ctx })
│  ├─ await toolRegistry.get(toolID)
│  ├─ await tool.init({ agent })
│  ├─ tool.execute(args, ctx)
│  │  ├─ PermissionNext.check(permission, toolID, args)
│  │  │  └─ ctx.ask({ ... }) [if ask]
│  │  ├─ Tool-specific logic
│  │  │  ├─ BashTool.execute() → Bun.spawn({ cmd, cwd })
│  │  │  ├─ ReadTool.execute() → Bun.file(path).text()
│  │  │  ├─ WriteTool.execute() → Bun.write(path, content)
│  │  │  ├─ EditTool.execute() → fs.readFile + string.replace + fs.writeFile
│  │  │  ├─ GlobTool.execute() → Bun.glob(pattern).scan()
│  │  │  ├─ GrepTool.execute() → ripgrep.search()
│  │  │  ├─ TaskTool.execute() → Agent.explore.run() [or general]
│  │  │  ├─ WebFetchTool.execute() → fetch(url).text()
│  │  │  └─ ...other tools
│  │  ├─ Truncate.output(output, metadata, agent)
│  │  └─ Return { title, metadata, output, attachments }
│  └─ Session.updatePart({ ...result, messageID, id })
│     └─ Storage.write(["part", messageID, id], part)
│        └─ Bus.publish(MessageV2.Event.PartUpdated, { part })
└─ Stream result back to LLM
```

### Provider SDK Initialization

```
Provider.getLanguage(model)
├─ Provider.state()
│  └─ await lazyState
│     ├─ Config.get()
│     ├─ ModelsDev.get()
│     ├─ Load env providers
│     ├─ Load auth providers
│     ├─ Load plugin providers
│     └─ Load custom loaders
├─ Provider.getSDK(model)
│  ├─ Check cache [hash(providerID, npm, options)]
│  ├─ BunProc.install(api.npm) [if not bundled]
│  ├─ import(module)
│  ├─ Create provider via BUNDLED_PROVIDERS[api.npm] or custom loader
│  └─ Cache SDK instance
└─ sdk.languageModel(model.api.id)
   └─ Return LanguageModelV2 instance
```

### Config Multi-Source Loading

```
Config.get()
├─ Config.state()
│  └─ Lazy async function:
│     ├─ Load remote well-known configs → Auth.all() → fetch(${provider}/.well-known/opencode)
│     ├─ Merge global config → loadFile($HOME/.config/opencode/config.json)
│     ├─ Merge custom config → loadFile(OPENCODE_CONFIG)
│     ├─ Merge project config → Filesystem.findUp("opencode.jsonc")
│     ├─ Merge inline config → JSON.parse(OPENCODE_CONFIG_CONTENT)
│     ├─ Load commands/agents/plugins from directories
│     │  ├─ loadCommand(dir) [glob "**/*.md" in commands/]
│     │  ├─ loadAgent(dir) [glob "**/*.md" in agents/]
│     │  └─ loadPlugin(dir) [glob "*.ts" in plugins/]
│     ├─ Apply managed config → loadFile(/etc/opencode/opencode.jsonc)
│     ├─ Migrate deprecated fields
│     └─ Return merged config
└─ Return cached config
```

---

## Architectural Guardrails

### Runtime & Format

- Runtime: Bun with TypeScript ESM modules
- Formatting: Prettier with `semi: false`, `printWidth: 120`
- APIs: Use Bun native: `Bun.file()`, `Bun.spawn()`, `Bun.glob()`

### Imports

- Relative imports for local modules
- Named imports: `import { foo } from "bar"` (not default)
- Avoid default exports where named exports clearer
- Plugin imports via `import.meta.resolve!()`

### Types

- Avoid `any` - use precise types or `z.custom<>()`
- Zod schemas for all runtime validation
- TypeScript interfaces for type definitions
- Inferred types where possible

### Naming

- Variables/Functions: camelCase
- Classes/Namespaces: PascalCase
- Constants: SCREAMING_SNAKE_CASE
- Single-word names preferred

### Control Flow

- Avoid `else` - use early returns
- Avoid `let` - prefer `const` or ternary

### Error Handling

- Prefer `.catch()` over `try`/`catch`
- Result patterns for tool execution
- Never throw in tools - return error objects
- `NamedError.create()` for typed errors

### Testing

- Avoid mocks - test actual implementation
- Tests must not duplicate logic
- Actual file I/O and subprocess execution

### File Structure

- Namespace-based: `Tool.define()`, `Session.create()`
- Zod-validated inputs
- `Log.create({ service: "name" })` logging
- `NamedError` for errors
- `Instance.state(async () => { ... })` for lazy init

### Event Communication

- `Bus.publish(event, properties)` for emits
- `Bus.subscribe(event, callback)` for listeners
- Events: `session.created`, `session.updated`, `session.diff`, `message.*`, `tool.*`

### Storage

- Keys as arrays: `Storage.write(["session", projectID, sessionID], data)`
- Write locks: `using _ = await Lock.write(path)`
- Read locks: `using _ = await Lock.read(path)`

### Provider

- `Provider.getLanguage(model)` for LLM operations
- `Provider.getModel(providerID, modelID)` for metadata
- `model.variants[variantID]` for variants
- `Session.getUsage(model, usage, metadata)` for cost

### Tool

- `Tool.define(id, init)` for definition
- Context: `sessionID`, `messageID`, `agent`, `abort`, `messages`
- `ctx.ask()` for permission requests
- Return: `{ title, metadata, output, attachments }`
- `Truncate.output()` for long outputs

### Session

- `Identifier.descending()` for session IDs
- `Identifier.ascending()` for message/part IDs
- Forking remaps IDs preserving relationships

### Config

- Merge precedence: remote → global → project → managed
- `mergeConfigConcatArrays()` for arrays
- `mergeDeep()` for objects
- `deduplicatePlugins()` for plugins

### Never Rules

- Never use `import default from "module"`
- Never throw in tool execute functions
- Never skip Zod validation on tool parameters
- Never use `any` without `z.custom<>()`
- Never commit secrets
- Never skip error handling in async
- Never use sync file I/O in handlers
- Never bypass permission checks for "ask" actions
