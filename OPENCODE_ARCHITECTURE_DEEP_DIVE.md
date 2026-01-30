# Opencode Architecture Deep Dive

This document provides an in-depth explanation of how opencode processes user requests, from CLI input to LLM response and tool execution.

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INPUT                                      │
│                        opencode run "fix the bug"                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         1. CLI LAYER (run.ts)                                │
│  • Parse arguments (yargs)                                                   │
│  • Validate inputs                                                           │
│  • Bootstrap instance context                                                │
│  • Create SDK client                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      2. HTTP SERVER (Hono Routes)                            │
│  • POST /session - Create session                                            │
│  • POST /session/:id/message - Send prompt                                   │
│  • Validate request with Zod schemas                                         │
│  • Delegate to Session module                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    3. SESSION PROMPT (prompt.ts)                             │
│  • Create user message                                                       │
│  • Resolve agent & model                                                     │
│  • Enter processing loop                                                     │
│  • Handle compaction if needed                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   4. SESSION PROCESSOR (processor.ts)                        │
│  • Create assistant message shell                                            │
│  • Stream LLM response                                                       │
│  • Handle tool calls                                                         │
│  • Detect doom loops                                                         │
│  • Manage retries on errors                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         5. LLM LAYER (llm.ts)                                │
│  • Build system prompt                                                       │
│  • Resolve provider & model                                                  │
│  • Configure streaming parameters                                            │
│  • Call Vercel AI SDK streamText()                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                          ┌─────────┴─────────┐
                          ▼                   ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│        TEXT RESPONSE         │   │        TOOL CALLS            │
│  • Stream text deltas        │   │  • Validate permissions      │
│  • Update message parts      │   │  • Execute tool              │
│  • Publish events            │   │  • Return results to LLM     │
└──────────────────────────────┘   └──────────────────────────────┘
                          │                   │
                          └─────────┬─────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           6. EVENT STREAMING                                 │
│  • Bus publishes events (message.part.updated, session.idle, etc.)          │
│  • CLI subscribes via SDK                                                    │
│  • Real-time output to terminal                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: CLI Layer

**File:** `packages/opencode/src/cli/cmd/run.ts`

The CLI is the user's entry point. It uses **yargs** for command parsing and handles:

### Key Responsibilities:
1. Parse CLI arguments (message, model, agent, files, etc.)
2. Bootstrap the instance context for the project directory
3. Create/resume sessions
4. Subscribe to events and render output

### Code Flow:

```typescript
// run.ts - Entry handler
export const RunCommand = cmd({
  command: "run [message..]",
  handler: async (args) => {
    // 1. Parse and validate message
    let message = [...args.message, ...(args["--"] || [])]
      .map((arg) => (arg.includes(" ") ? `"${arg}"` : arg))
      .join(" ")

    // 2. Handle file attachments
    const fileParts: any[] = []
    if (args.file) {
      for (const filePath of files) {
        fileParts.push({
          type: "file",
          url: `file://${resolvedPath}`,
          filename: path.basename(resolvedPath),
          mime: "text/plain",
        })
      }
    }

    // 3. Bootstrap instance and execute
    await bootstrap(process.cwd(), async () => {
      // Create in-process fetch that routes to Hono server
      const fetchFn = async (input, init) => {
        const request = new Request(input, init)
        return Server.App().fetch(request)
      }
      const sdk = createOpencodeClient({ baseUrl: "http://opencode.internal", fetch: fetchFn })

      // Create or resume session
      const sessionID = await sdk.session.create({})

      // Execute the prompt
      await execute(sdk, sessionID)
    })
  },
})
```

### Event Processing Loop:

The CLI subscribes to a Server-Sent Events stream and processes events in real-time:

```typescript
const execute = async (sdk: OpencodeClient, sessionID: string) => {
  const events = await sdk.event.subscribe()

  // Start the prompt (non-blocking)
  await sdk.session.prompt({
    sessionID,
    parts: [...fileParts, { type: "text", text: message }],
  })

  // Process events as they arrive
  for await (const event of events.stream) {
    switch (event.type) {
      case "message.part.updated":
        // Tool completed, text generated, etc.
        const part = event.properties.part
        if (part.type === "tool" && part.state.status === "completed") {
          printEvent(color, tool, title)
        }
        if (part.type === "text" && part.time?.end) {
          process.stdout.write(UI.markdown(part.text))
        }
        break

      case "session.error":
        UI.error(props.error.data.message)
        break

      case "permission.asked":
        // Prompt user for permission
        const result = await select({
          message: `Permission required: ${permission.permission}`,
          options: [
            { value: "once", label: "Allow once" },
            { value: "always", label: "Always allow" },
            { value: "reject", label: "Reject" },
          ],
        })
        await sdk.permission.respond({ sessionID, permissionID, response: result })
        break

      case "session.idle":
        // Session finished processing
        break
    }
  }
}
```

---

## Layer 2: HTTP Server (Hono Routes)

**File:** `packages/opencode/src/server/routes/session.ts`

The HTTP layer uses **Hono** framework with OpenAPI-style route definitions. It acts as a thin validation and routing layer.

### Key Routes:

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/session` | Create new session |
| POST | `/session/:id/message` | Send prompt (main endpoint) |
| POST | `/session/:id/command` | Execute a slash command |
| POST | `/session/:id/abort` | Cancel processing |
| GET | `/session/:id/message` | Get message history |
| POST | `/session/:id/share` | Share session publicly |

### Prompt Endpoint:

```typescript
// session.ts - The main prompt endpoint
.post(
  "/:sessionID/message",
  describeRoute({
    summary: "Send message",
    operationId: "session.prompt",
  }),
  validator("param", z.object({
    sessionID: z.string(),
  })),
  validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
  async (c) => {
    return stream(c, async (stream) => {
      const sessionID = c.req.valid("param").sessionID
      const body = c.req.valid("json")

      // Delegate to SessionPrompt module
      const msg = await SessionPrompt.prompt({ ...body, sessionID })
      stream.write(JSON.stringify(msg))
    })
  },
)
```

### Request Validation (Zod Schema):

```typescript
export const PromptInput = z.object({
  sessionID: Identifier.schema("session"),
  model: z.object({
    providerID: z.string(),
    modelID: z.string(),
  }).optional(),
  agent: z.string().optional(),
  variant: z.string().optional(),
  parts: z.array(
    z.discriminatedUnion("type", [
      MessageV2.TextPart,    // { type: "text", text: string }
      MessageV2.FilePart,    // { type: "file", url: string, mime: string }
      MessageV2.AgentPart,   // { type: "agent", name: string }
      MessageV2.SubtaskPart, // { type: "subtask", prompt: string, agent: string }
    ]),
  ),
})
```

---

## Layer 3: Session Prompt

**File:** `packages/opencode/src/session/prompt.ts`

The prompt module orchestrates the conversation flow. It manages the main processing loop that continues until the LLM finishes or an error occurs.

### The Processing Loop:

```
┌─────────────────────────────────────────────────────────────────┐
│                      SessionPrompt.loop()                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Get Messages   │◄─────────────────────┐
                    │  from Storage   │                      │
                    └────────┬────────┘                      │
                             │                               │
                             ▼                               │
                    ┌─────────────────┐                      │
                    │  Find Last User │                      │
                    │  & Assistant    │                      │
                    └────────┬────────┘                      │
                             │                               │
                             ▼                               │
              ┌──────────────────────────────┐               │
              │  Is conversation complete?   │               │
              │  (finish !== "tool-calls")   │               │
              └──────────────┬───────────────┘               │
                             │                               │
                    No ──────┴────── Yes                     │
                    │                 │                      │
                    ▼                 ▼                      │
           ┌────────────────┐   ┌─────────┐                  │
           │ Create         │   │  EXIT   │                  │
           │ Processor &    │   │  LOOP   │                  │
           │ Resolve Tools  │   └─────────┘                  │
           └───────┬────────┘                                │
                   │                                         │
                   ▼                                         │
           ┌────────────────┐                                │
           │ processor      │                                │
           │ .process()     │                                │
           └───────┬────────┘                                │
                   │                                         │
                   ▼                                         │
           ┌────────────────┐                                │
           │ Result?        │                                │
           │ "continue" ────┼────────────────────────────────┘
           │ "stop"    ─────┼──► EXIT LOOP
           │ "compact" ─────┼──► Create compaction, continue
           └────────────────┘
```

### Key Code:

```typescript
// prompt.ts - Main loop
export const loop = fn(Identifier.schema("session"), async (sessionID) => {
  const abort = start(sessionID)  // Get abort signal, prevent concurrent runs
  if (!abort) {
    // Already processing - queue callback for when done
    return new Promise((resolve, reject) => {
      state()[sessionID].callbacks.push({ resolve, reject })
    })
  }

  using _ = defer(() => cancel(sessionID))  // Cleanup on exit

  let step = 0
  while (true) {
    // 1. Load message history
    let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))

    // 2. Find last user and assistant messages
    let lastUser: MessageV2.User | undefined
    let lastAssistant: MessageV2.Assistant | undefined
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (!lastUser && msg.info.role === "user") lastUser = msg.info
      if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info
      if (lastUser && lastAssistant) break
    }

    // 3. Check if we should exit
    if (lastAssistant?.finish && !["tool-calls", "unknown"].includes(lastAssistant.finish)) {
      break  // LLM finished without requesting tool calls
    }

    step++
    const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID)
    const agent = await Agent.get(lastUser.agent)

    // 4. Create processor for this step
    const processor = SessionProcessor.create({
      assistantMessage: await Session.updateMessage({
        id: Identifier.ascending("message"),
        parentID: lastUser.id,
        role: "assistant",
        agent: agent.name,
        sessionID,
        // ... tokens, cost, etc.
      }),
      sessionID,
      model,
      abort,
    })

    // 5. Resolve available tools
    const tools = await resolveTools({ agent, session, model, processor, messages: msgs })

    // 6. Process (call LLM, handle tools)
    const result = await processor.process({
      user: lastUser,
      agent,
      abort,
      sessionID,
      system: await SystemPrompt.environment(model),
      messages: MessageV2.toModelMessages(msgs, model),
      tools,
      model,
    })

    if (result === "stop") break
    if (result === "compact") {
      await SessionCompaction.create({ sessionID, agent, model, auto: true })
    }
    // result === "continue" -> loop again
  }
})
```

### Tool Resolution:

Tools are resolved dynamically based on the agent's permissions and model capabilities:

```typescript
async function resolveTools(input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  processor: SessionProcessor.Info
  messages: MessageV2.WithParts[]
}) {
  const tools: Record<string, AITool> = {}

  // Create execution context factory
  const context = (args: any, options: ToolCallOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    agent: input.agent.name,
    messages: input.messages,
    // Permission checking
    async ask(req) {
      await PermissionNext.ask({
        ...req,
        sessionID: input.session.id,
        ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
      })
    },
  })

  // Register each tool from the registry
  for (const item of await ToolRegistry.tools(model, agent)) {
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(item.parameters),
      async execute(args, options) {
        const ctx = context(args, options)
        await Plugin.trigger("tool.execute.before", { tool: item.id }, { args })
        const result = await item.execute(args, ctx)
        await Plugin.trigger("tool.execute.after", { tool: item.id }, result)
        return result
      },
    })
  }

  return tools
}
```

---

## Layer 4: Session Processor

**File:** `packages/opencode/src/session/processor.ts`

The processor handles the actual LLM interaction, streaming responses, and tool execution coordination.

### Processing State Machine:

```
                         ┌─────────────────┐
                         │  LLM.stream()   │
                         └────────┬────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
            ┌──────────────┐            ┌──────────────┐
            │ "start"      │            │ "text-start" │
            │ Set busy     │            │ Create part  │
            └──────────────┘            └──────┬───────┘
                                               │
                                               ▼
                                        ┌──────────────┐
                                        │ "text-delta" │
                                        │ Append text  │
                                        │ Update part  │
                                        └──────┬───────┘
                                               │
                    ┌──────────────────────────┤
                    ▼                          ▼
            ┌──────────────┐            ┌──────────────┐
            │ "text-end"   │            │ "tool-call"  │
            │ Finalize     │            │ Check perms  │
            └──────────────┘            │ Execute tool │
                                        └──────┬───────┘
                                               │
                    ┌──────────────────────────┤
                    ▼                          ▼
            ┌──────────────┐            ┌──────────────┐
            │ "tool-result"│            │ "tool-error" │
            │ Store output │            │ Handle error │
            └──────────────┘            │ Maybe block  │
                                        └──────────────┘
                                               │
                                               ▼
                                        ┌──────────────┐
                                        │ "finish-step"│
                                        │ Update tokens│
                                        │ Snapshot     │
                                        └──────────────┘
```

### Core Processing Code:

```typescript
// processor.ts
export function create(input: {
  assistantMessage: MessageV2.Assistant
  sessionID: string
  model: Provider.Model
  abort: AbortSignal
}) {
  const toolcalls: Record<string, MessageV2.ToolPart> = {}
  let blocked = false

  return {
    async process(streamInput: LLM.StreamInput) {
      while (true) {
        try {
          const stream = await LLM.stream(streamInput)

          for await (const value of stream.fullStream) {
            input.abort.throwIfAborted()

            switch (value.type) {
              case "start":
                SessionStatus.set(input.sessionID, { type: "busy" })
                break

              case "text-delta":
                // Append streamed text to current part
                if (currentText) {
                  currentText.text += value.text
                  await Session.updatePart({ part: currentText, delta: value.text })
                }
                break

              case "tool-call":
                // Tool invocation started
                const part = await Session.updatePart({
                  type: "tool",
                  tool: value.toolName,
                  callID: value.id,
                  state: { status: "running", input: value.input },
                })
                toolcalls[value.id] = part

                // Doom loop detection - same tool called 3x with same input
                const lastThree = parts.slice(-3)
                if (lastThree.every(p =>
                  p.tool === value.toolName &&
                  JSON.stringify(p.state.input) === JSON.stringify(value.input)
                )) {
                  await PermissionNext.ask({
                    permission: "doom_loop",
                    patterns: [value.toolName],
                    sessionID: input.sessionID,
                  })
                }
                break

              case "tool-result":
                // Tool completed successfully
                await Session.updatePart({
                  ...toolcalls[value.toolCallId],
                  state: {
                    status: "completed",
                    output: value.output.output,
                    title: value.output.title,
                  },
                })
                break

              case "tool-error":
                // Tool failed
                await Session.updatePart({
                  ...toolcalls[value.toolCallId],
                  state: {
                    status: "error",
                    error: value.error.toString(),
                  },
                })
                // Check if we should stop the loop
                if (value.error instanceof PermissionNext.RejectedError) {
                  blocked = true
                }
                break

              case "finish-step":
                // LLM finished a response cycle
                const usage = Session.getUsage({ model, usage: value.usage })
                input.assistantMessage.cost += usage.cost
                input.assistantMessage.tokens = usage.tokens
                break
            }
          }
        } catch (e) {
          // Handle retryable errors
          const retry = SessionRetry.retryable(error)
          if (retry !== undefined) {
            attempt++
            await SessionRetry.sleep(delay, input.abort)
            continue  // Retry the loop
          }
          input.assistantMessage.error = MessageV2.fromError(e)
          Bus.publish(Session.Event.Error, { sessionID, error })
        }

        // Determine loop result
        if (blocked) return "stop"
        if (input.assistantMessage.error) return "stop"
        return "continue"
      }
    },
  }
}
```

---

## Layer 5: LLM Layer

**File:** `packages/opencode/src/session/llm.ts`

The LLM layer abstracts the interaction with various AI providers using the **Vercel AI SDK**.

### Provider Architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                        LLM.stream()                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Build System Prompt                           │
│  • Agent prompt (personality, instructions)                      │
│  • Provider-specific system prompt                               │
│  • Environment info (cwd, project context)                       │
│  • User's custom system prompt                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Resolve Provider                              │
│  • Get language model from Provider registry                     │
│  • Apply provider-specific options                               │
│  • Configure headers, auth                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Vercel AI SDK streamText()                    │
│  • model: wrapLanguageModel(language, middleware)                │
│  • tools: resolved tool definitions                              │
│  • messages: [system prompts, ...conversation history]           │
│  • temperature, topP, maxOutputTokens                            │
│  • abortSignal: for cancellation                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Returns AsyncIterable                         │
│  • Yields: text-delta, tool-call, tool-result, finish, etc.     │
│  • Processor iterates and handles each event                     │
└─────────────────────────────────────────────────────────────────┘
```

### Stream Implementation:

```typescript
// llm.ts
export async function stream(input: StreamInput) {
  // 1. Build system prompt
  const system = [
    input.agent.prompt ?? SystemPrompt.provider(input.model),
    ...input.system,
    ...(input.user.system ? [input.user.system] : []),
  ].filter(Boolean).join("\n")

  // 2. Get provider-specific options
  const [language, cfg, provider] = await Promise.all([
    Provider.getLanguage(input.model),
    Config.get(),
    Provider.getProvider(input.model.providerID),
  ])

  // 3. Resolve tools (filter disabled ones)
  const tools = await resolveTools(input)
  const disabled = PermissionNext.disabled(Object.keys(input.tools), input.agent.permission)
  for (const tool of disabled) {
    delete tools[tool]
  }

  // 4. Call Vercel AI SDK
  return streamText({
    model: wrapLanguageModel({
      model: language,
      middleware: [{
        async transformParams(args) {
          // Provider-specific message transformations
          args.params.prompt = ProviderTransform.message(args.params.prompt, input.model)
          return args.params
        },
      }],
    }),
    tools,
    temperature: input.agent.temperature ?? ProviderTransform.temperature(input.model),
    topP: input.agent.topP ?? ProviderTransform.topP(input.model),
    maxOutputTokens: ProviderTransform.maxOutputTokens(input.model),
    abortSignal: input.abort,
    messages: [
      { role: "system", content: system },
      ...input.messages,
    ],
    // Error handling for malformed tool calls
    async experimental_repairToolCall(failed) {
      const lower = failed.toolCall.toolName.toLowerCase()
      if (tools[lower]) {
        return { ...failed.toolCall, toolName: lower }
      }
      return { ...failed.toolCall, toolName: "invalid" }
    },
  })
}
```

---

## Layer 6: Tool Execution

**File:** `packages/opencode/src/tool/tool.ts` (base), `packages/opencode/src/tool/bash.ts` (example)

Tools are the actions the LLM can take. Each tool follows a consistent pattern.

### Tool Interface:

```typescript
// tool.ts
export namespace Tool {
  export type Context = {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    callID?: string
    messages: MessageV2.WithParts[]
    // Update UI with progress
    metadata(input: { title?: string; metadata?: any }): void
    // Request permission from user
    ask(input: Omit<PermissionNext.Request, "id" | "sessionID">): Promise<void>
  }

  export interface Info<Parameters extends z.ZodType> {
    id: string
    init: () => Promise<{
      description: string
      parameters: Parameters
      execute(args: z.infer<Parameters>, ctx: Context): Promise<{
        title: string
        metadata: any
        output: string
        attachments?: MessageV2.FilePart[]
      }>
    }>
  }
}
```

### Bash Tool Example:

```typescript
// bash.ts - Complete tool implementation
export const BashTool = Tool.define("bash", async () => {
  const shell = Shell.acceptable()

  return {
    description: DESCRIPTION,  // Loaded from bash.txt
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().optional(),
      workdir: z.string().optional(),
      description: z.string().describe("What this command does"),
    }),

    async execute(params, ctx) {
      const cwd = params.workdir || Instance.directory
      const timeout = params.timeout ?? 120_000

      // 1. Parse command to extract patterns for permission checking
      const tree = await parser().then(p => p.parse(params.command))
      const patterns = new Set<string>()
      for (const node of tree.rootNode.descendantsOfType("command")) {
        const command = []
        for (const child of node.children) {
          if (child.type === "command_name" || child.type === "word") {
            command.push(child.text)
          }
        }
        patterns.add(command.join(" "))
      }

      // 2. Request permission
      await ctx.ask({
        permission: "bash",
        patterns: Array.from(patterns),
        always: Array.from(patterns).map(p => p + "*"),
        metadata: {},
      })

      // 3. Spawn process
      const proc = spawn(params.command, {
        shell,
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })

      let output = ""

      // 4. Stream output to UI
      proc.stdout?.on("data", (chunk) => {
        output += chunk.toString()
        ctx.metadata({
          metadata: { output, description: params.description },
        })
      })

      // 5. Handle abort
      ctx.abort.addEventListener("abort", () => {
        Shell.killTree(proc)
      })

      // 6. Handle timeout
      const timeoutTimer = setTimeout(() => {
        Shell.killTree(proc)
      }, timeout)

      await new Promise(resolve => proc.once("exit", resolve))
      clearTimeout(timeoutTimer)

      // 7. Return result
      return {
        title: params.description,
        metadata: { output, exit: proc.exitCode },
        output,
      }
    },
  }
})
```

### Permission Flow:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Tool Execute   │────►│ ctx.ask({...})  │────►│ PermissionNext  │
│  (bash, edit)   │     │                 │     │   .ask()        │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                    ┌────────────────────┼────────────────────┐
                                    ▼                    ▼                    ▼
                             ┌───────────┐        ┌───────────┐        ┌───────────┐
                             │  ALLOW    │        │   DENY    │        │    ASK    │
                             │ (auto)    │        │ (throw)   │        │ (prompt)  │
                             └───────────┘        └───────────┘        └─────┬─────┘
                                                                             │
                                                                             ▼
                                                                    ┌─────────────────┐
                                                                    │ Bus.publish     │
                                                                    │ permission.asked│
                                                                    └────────┬────────┘
                                                                             │
                                                                             ▼
                                                                    ┌─────────────────┐
                                                                    │ CLI prompts     │
                                                                    │ user            │
                                                                    └────────┬────────┘
                                                                             │
                                                                             ▼
                                                                    ┌─────────────────┐
                                                                    │ sdk.permission  │
                                                                    │ .respond()      │
                                                                    └─────────────────┘
```

---

## Event Bus Architecture

**File:** `packages/opencode/src/bus/index.ts`

The event bus enables real-time communication between components.

### Key Events:

| Event | Purpose |
|-------|---------|
| `message.part.updated` | Tool/text part changed |
| `session.idle` | Processing finished |
| `session.error` | Error occurred |
| `permission.asked` | User approval needed |

### Implementation:

```typescript
// bus/index.ts
export namespace Bus {
  const state = Instance.state(() => ({
    subscriptions: new Map<string, Subscription[]>(),
  }))

  export async function publish<Definition extends BusEvent.Definition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
  ) {
    const payload = { type: def.type, properties }

    // Notify local subscribers
    for (const key of [def.type, "*"]) {
      const match = state().subscriptions.get(key)
      for (const sub of match ?? []) {
        await sub(payload)
      }
    }

    // Notify global subscribers (cross-instance)
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload,
    })
  }

  export function subscribe<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: { type: string; properties: any }) => void,
  ) {
    const subscriptions = state().subscriptions
    let match = subscriptions.get(def.type) ?? []
    match.push(callback)
    subscriptions.set(def.type, match)

    return () => {
      // Unsubscribe
      const index = match.indexOf(callback)
      if (index !== -1) match.splice(index, 1)
    }
  }
}
```

---

## Bootstrap & Instance Context

**File:** `packages/opencode/src/project/bootstrap.ts`

The bootstrap process initializes all subsystems for a project directory.

```typescript
// bootstrap.ts
export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })

  // Initialize subsystems
  await Plugin.init()      // Load plugins from .opencode/
  Share.init()             // Session sharing
  ShareNext.init()         // New sharing system
  Format.init()            // Markdown formatting
  await LSP.init()         // Language Server Protocol
  FileWatcher.init()       // Watch for file changes
  File.init()              // File operations
  Vcs.init()               // Git integration
  Snapshot.init()          // File snapshots for undo
  Truncate.init()          // Output truncation

  // Handle init command
  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}
```

### Instance Provider Pattern:

```typescript
// cli/bootstrap.ts
export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: async () => {
      try {
        return await cb()
      } finally {
        await Instance.dispose()
      }
    },
  })
}
```

---

## Data Storage

All session data is persisted to `~/.opencode/storage/`:

```
~/.opencode/storage/
├── project/
│   └── [projectID].json          # Project metadata
├── session/
│   └── [projectID]/
│       └── [sessionID].json      # Session info
├── message/
│   └── [sessionID]/
│       └── [messageID].json      # Message metadata
├── part/
│   └── [messageID]/
│       └── [partID].json         # Message parts (text, tool, etc.)
└── session_diff/
    └── [sessionID].json          # File change snapshots
```

---

## Summary: Complete Request Flow

```
1. User runs: opencode run "fix the bug in auth.ts"

2. CLI Layer (run.ts):
   - Parse args → message="fix the bug in auth.ts"
   - bootstrap(cwd) → Initialize Instance context
   - sdk.session.create() → New session
   - sdk.session.prompt({ parts: [{ type: "text", text: message }] })

3. HTTP Server (session.ts):
   - POST /session/:id/message
   - Validate with Zod schema
   - Call SessionPrompt.prompt()

4. Session Prompt (prompt.ts):
   - Create user message in storage
   - Enter loop()
   - Load message history
   - Create SessionProcessor
   - Resolve tools based on agent permissions

5. Session Processor (processor.ts):
   - Create assistant message shell
   - Call LLM.stream()
   - Iterate fullStream events:
     - text-delta → Update message part
     - tool-call → Execute tool with permission check
     - tool-result → Store output
     - finish-step → Update tokens/cost

6. LLM Layer (llm.ts):
   - Build system prompt (agent + environment)
   - Get provider (Anthropic, OpenAI, etc.)
   - Call Vercel AI SDK streamText()
   - Return async iterable of events

7. Tool Execution (bash.ts, etc.):
   - Parse command for permission patterns
   - ctx.ask() → Check/request permission
   - Execute command/operation
   - Stream metadata updates
   - Return { title, output, metadata }

8. Event Bus (bus/index.ts):
   - Bus.publish(message.part.updated, ...)
   - GlobalBus.emit() for cross-instance
   - CLI receives via SSE stream

9. CLI renders output:
   - Tool executions with colored output
   - Streaming text response
   - Permission prompts
   - Final markdown-formatted response
```

---

## Key Patterns for Building Your Own

1. **Instance Context**: Use a provider pattern to scope state per-project
2. **Event-Driven**: Pub/sub for decoupled real-time updates
3. **Tool Registry**: Dynamic tool loading with permission gates
4. **Streaming**: Process LLM responses as async iterables
5. **Validation**: Zod schemas at every boundary
6. **Abort Signals**: Propagate cancellation through all layers
7. **Storage Abstraction**: Simple JSON files with migration support
