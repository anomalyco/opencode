# Session Component

The Session component is core abstraction for managing conversations, state, and context in OpenCode. It handles message persistence, AI interactions, and session lifecycle.

## Architecture Overview

```
┌─────────────────┐
│   Session       │
│   Manager       │
└─────────────────┘
          │
          ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Message       │    │   Storage       │    │   Event Bus     │
│   Processing    │◄──►│   Layer         │◄──►│                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
          │                                           │
          ▼                                           ▼
┌─────────────────┐                           ┌─────────────────┐
│   AI            │                           │   Clients       │
│   Integration   │                           │ (CLI/TUI/Web)   │
└─────────────────┘                           └─────────────────┘
```

## Core Files

### Session Management (`packages/opencode/src/session/index.ts`)

- **Session CRUD**: Create, read, update, delete sessions
- **Message Management**: Handle message lifecycle
- **Storage Integration**: Persist session data
- **Event Publishing**: Notify changes to clients

### Prompt Processing (`packages/opencode/src/session/prompt.ts`)

- **AI Interaction**: Handle AI provider communication
- **Tool Execution**: Coordinate tool calls
- **Streaming**: Manage real-time response streaming
- **Loop Management**: Handle conversation flow

### Message System (`packages/opencode/src/session/message-v2.ts`)

- **Message Structure**: Define message and part types
- **Serialization**: Convert to/from AI provider formats
- **Validation**: Ensure message integrity

## Session Lifecycle

### 1. Session Creation

```typescript
// packages/opencode/src/session/index.ts
/**
 * Creates a new OpenCode session with default configuration
 * Generates unique ID, timestamps, and persists to storage
 *
 * @param input - Optional session configuration
 *   - id: Optional custom session ID (uses generated ID if not provided)
 *   - title: Optional session title (uses auto-generated title if not provided)
 *   - parentID: Optional parent session ID for forking conversations
 * @returns Promise<Session.Info> - Complete session information with generated metadata
 */
export const create = fn(async (input) => {
  // Generate unique session ID using descending timestamp for chronological ordering
  // This ensures newer sessions come first in listings
  const result: Session.Info = {
    id: Identifier.descending("session", input.id),
    version: Installation.VERSION, // Track OpenCode version for compatibility
    projectID: Instance.project.id, // Link session to current project context
    directory: Instance.directory, // Store working directory for session context
    title: input.title ?? createDefaultTitle(), // Use provided title or generate default
    time: {
      created: Date.now(), // Session creation timestamp
      updated: Date.now(), // Initial update timestamp (same as creation)
    },
  }

  // Persist session to storage using hierarchical key structure
  // Storage path: ["session", projectID, sessionID]
  await Storage.write(["session", Instance.project.id, result.id], result)

  // Publish event to notify all connected clients about new session
  // This enables real-time UI updates across all client types
  Bus.publish(Event.Created, { info: result })

  return result
})
```

### 2. Message Processing

```typescript
// packages/opencode/src/session/prompt.ts
/**
 * Processes user input and creates a message in the session
 * Optionally triggers AI response generation if not in no-reply mode
 *
 * @param input - Message processing configuration
 *   - sessionID: Target session identifier
 *   - parts: Message parts (text, files, etc.)
 *   - agent: AI agent to use for processing
 *   - model: AI model configuration (uses session default if not provided)
 *   - noReply: If true, only stores message without generating AI response
 * @returns Promise<MessageV2.WithParts> - Created message information
 */
export const prompt = fn(PromptInput, async (input) => {
  // Retrieve existing session to maintain conversation context
  const session = await Session.get(input.sessionID)

  // Create user message with all provided parts (text, files, etc.)
  // This handles file attachments, agent references, and text content
  const message = await createUserMessage(input)

  // Update session timestamp to reflect recent activity
  await Session.touch(input.sessionID)

  // Check if AI response generation is requested
  // noReply mode is used for storing data without triggering AI processing
  if (!input.noReply) {
    // Start the conversation loop to generate AI response
    return loop(input.sessionID)
  }

  // Return the created message without AI response
  return message
})
```

### 3. Conversation Loop

```typescript
/**
 * Main conversation loop that handles AI responses, tool execution, and session management
 * Continues until session is aborted, conversation completes naturally, or error occurs
 *
 * Key responsibilities:
 * - Process pending subtasks and compactions
 * - Handle context overflow with automatic compaction
 * - Generate AI responses with tool integration
 * - Manage conversation flow and state
 */
export const loop = fn(Identifier.schema("session"), async (sessionID) => {
  // Initialize abort controller for graceful cancellation
  const abort = start(sessionID)

  // Main conversation loop - continues until natural stopping condition
  while (true) {
    // Check for abort signal before each iteration
    if (abort.aborted) {
      Log.Default.info("Session aborted by user", { sessionID })
      break
    }

    // Load conversation history, filtering out compacted messages for context management
    // Compacted messages are summarized to reduce token usage
    let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))

    // Find the most recent user message to determine what to respond to
    let lastUser: MessageV2.User | undefined
    let lastAssistant: MessageV2.Assistant | undefined
    let lastFinished: MessageV2.Assistant | undefined
    let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []

    // Scan messages backwards to find conversation context
    // This is more efficient than scanning forwards for the last occurrence
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (!lastUser && msg.info.role === "user") {
        lastUser = msg.info as MessageV2.User
      }
      if (!lastAssistant && msg.info.role === "assistant") {
        lastAssistant = msg.info as MessageV2.Assistant
      }
      // Track the last completed assistant message for flow control
      if (!lastFinished && msg.info.role === "assistant" && msg.info.finish) {
        lastFinished = msg.info as MessageV2.Assistant
      }

      // Stop when we have both user context and completion status
      if (lastUser && lastFinished) break

      // Collect pending tasks (compactions or subtasks) that need processing
      const task = msg.parts.filter((part) =>
        part.type === "compaction" || part.type === "subtask"
      )
      if (task && !lastFinished) {
        tasks.push(...task)
      }
    }

    // Validate we have a user message to respond to
    if (!lastUser) {
      throw new Error("No user message found in stream. This should never happen.")
    }

    // Check if conversation is already complete (assistant finished successfully)
    // Tool calls and unknown status indicate incomplete responses
    if (
      lastAssistant?.finish &&
      !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
      lastUser.id < lastAssistant.id // Ensure assistant responded to user
    ) {
      Log.Default.info("Conversation completed naturally", { sessionID })
      break
    }

    // Increment step counter for tracking conversation progress
    step++

    // On first step, generate session title if it's still the default
    if (step === 1) {
      await ensureTitle({
        session: await Session.get(sessionID),
        modelID: lastUser.model.modelID,
        providerID: lastUser.model.providerID,
        message: msgs.find((m) => m.info.role === "user")!,
        history: msgs,
      })
    }

    // Get AI model configuration for this conversation turn
    const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID)

    // Process any pending tasks before generating new AI response
    const task = tasks.pop()

    // Handle pending subtask delegation to specialized agents
    if (task?.type === "subtask") {
      await processSubtask(task, model, lastUser, sessionID, abort)
      continue
    }

    // Handle pending session compaction for context management
    if (task?.type === "compaction") {
      const result = await SessionCompaction.process({
        messages: msgs,
        parentID: lastUser.id,
        abort,
        agent: lastUser.agent,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
        },
        sessionID,
      })
      if (result === "stop") break
      continue
    }

    // Check for context overflow and trigger automatic compaction
    if (
      lastFinished &&
      lastFinished.summary !== true && // Not already compacted
      SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model: model.info })
    ) {
      await SessionCompaction.create({
        sessionID,
        agent: lastUser.agent,
        model: lastUser.model,
      })
      continue
    }

    // Normal AI response generation
    await generateAIResponse({
      lastUser,
      lastAssistant,
      msgs,
      agent: await Agent.get(lastUser.agent),
      model,
      sessionID,
      abort,
      step,
    })
  }

  // Clean up any remaining compaction data
  SessionCompaction.prune({ sessionID })

  // Return the final assistant message to any waiting callbacks
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user") continue // Skip user messages
    const queued = state()[sessionID]?.callbacks ?? []
    for (const q of queued) {
      q.resolve(item) // Resolve any waiting promises
    }
    return item
  }

  // This should never be reached under normal circumstances
  throw new Error("Conversation loop ended unexpectedly")
})

/**
 * Processes a subtask by delegating to a specialized agent
 * Creates tool execution part and handles the delegation lifecycle
 */
async function processSubtask(
  task: MessageV2.SubtaskPart,
  model: Provider.Model,
  lastUser: MessageV2.User,
  sessionID: string,
  abort: AbortSignal
) {
  const taskTool = await TaskTool.init()

  // Create assistant message for subtask execution
  const assistantMessage = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "assistant",
    parentID: lastUser.id,
    sessionID,
    mode: task.agent, // Use the specified subagent
    path: {
      cwd: Instance.directory,
      root: Instance.worktree,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: model.modelID,
    providerID: model.providerID,
    time: { created: Date.now() },
  }) as MessageV2.Assistant

  // Create tool execution part for tracking
  let part = await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: assistantMessage.id,
    sessionID: assistantMessage.sessionID,
    type: "tool",
    callID: ulid(), // Unique identifier for this tool call
    tool: TaskTool.id,
    state: {
      status: "running",
      input: {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
      },
      time: { start: Date.now() },
    },
  }) as MessageV2.ToolPart

  try {
    // Execute the subtask with the specialized agent
    const result = await taskTool.execute(
      {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
      },
      {
        agent: task.agent,
        messageID: assistantMessage.id,
        sessionID: sessionID,
        abort,
        async metadata(input) {
          // Update tool part in real-time with progress
          await Session.updatePart({
            ...part,
            type: "tool",
            state: {
              ...part.state,
              ...input, // Merge progress updates
            }
          } satisfies MessageV2.ToolPart)
        },
      }
    )

    // Mark assistant message as completed with tool calls
    assistantMessage.finish = "tool-calls"
    assistantMessage.time.completed = Date.now()
    await Session.updateMessage(assistantMessage)

    // Update tool part with completion status
    if (result && part.state.status === "running") {
      await Session.updatePart({
        ...part,
        state: {
          status: "completed",
          input: part.state.input,
          title: result.title,
          metadata: result.metadata,
          output: result.output,
          attachments: result.attachments,
          time: {
            ...part.state.time,
            end: Date.now(),
          },
        },
      } satisfies MessageV2.ToolPart)
    }

    // Handle tool execution failure
    if (!result) {
      await Session.updatePart({
        ...part,
        state: {
          status: "error",
          error: "Tool execution failed",
          time: {
            start: part.state.status === "running" ? part.state.time.start : Date.now(),
            end: Date.now(),
          },
          metadata: part.metadata,
          input: part.state.input,
        },
      } satisfies MessageV2.ToolPart)
    }
  } catch (error) {
    // Log error but don't crash the conversation
    Log.Default.error("Subtask execution failed", {
      error: error.message,
      task: task.prompt,
      agent: task.agent
    })
  }
}

/**
 * Generates AI response using the configured model and tools
 * Handles the complete flow from prompt generation to response streaming
 */
async function generateAIResponse({
  lastUser,
  lastAssistant,
  msgs,
  agent,
  model,
  sessionID,
  abort,
  step,
}: {
  lastUser: MessageV2.User,
  lastAssistant: MessageV2.Assistant | undefined;
  msgs: MessageV2.WithParts[];
  agent: Agent.Info;
  model: Provider.Model;
  sessionID: string;
  abort: AbortSignal;
  step: number;
}) {
  // Create assistant message to store the AI response
  const processor = SessionProcessor.create({
    assistantMessage: await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: lastUser.id,
      mode: agent.name,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.modelID,
      providerID: model.providerID,
      time: { created: Date.now() },
    }) as MessageV2.Assistant,
    sessionID: sessionID,
    model: model.info,
    providerID: model.providerID,
    abort,
  })

  // Resolve system prompt based on agent and model
  const system = await resolveSystemPrompt({
    providerID: model.providerID,
    modelID: model.info.id,
    agent,
    system: lastUser.system,
  })

  // Resolve available tools for this agent and model combination
  const tools = await resolveTools({
    agent,
    model: lastUser.model,
    sessionID,
    tools: lastUser.tools,
    processor,
  })

  // Allow plugins to modify generation parameters
  const params = await Plugin.trigger(
    "chat.params",
    {
      sessionID: sessionID,
      agent: lastUser.agent,
      model: model.info,
      provider: await Provider.getProvider(model.providerID),
      message: lastUser,
    },
    {
      // Use agent-specific temperature if set, otherwise use model default
      temperature: model.info.temperature
        ? (agent.temperature ?? ProviderTransform.temperature(model.providerID, model.modelID))
        : undefined,
      topP: agent.topP ?? ProviderTransform.topP(model.providerID, model.modelID),
      // Merge options from multiple sources in priority order
      options: pipe(
        {},
        ProviderTransform.options(model.providerID, model.modelID, model.npm ?? "", sessionID),
        mergeDeep(model.info.options),
        mergeDeep(agent.options),
      ),
    },
  })

  // On first step, trigger background session summarization
  if (step === 1) {
    SessionSummary.summarize({
      sessionID: sessionID,
      messageID: lastUser.id,
    })
  }

  // Generate AI response using streaming
  const result = await processor.process(() =>
    streamText({
      onError(error) {
        Log.Default.error("AI stream error", { error })
      },
      // Attempt to repair tool call names (case sensitivity issues)
      async experimental_repairToolCall(input) {
        const lower = input.toolCall.toolName.toLowerCase()
        if (lower !== input.toolCall.toolName && tools[lower]) {
          Log.Default.info("repairing tool call", {
            tool: input.toolCall.toolName,
            repaired: lower,
          })
          return {
            ...input.toolCall,
            toolName: lower,
          }
        }
        // Create invalid tool call for error cases
        return {
          ...input.toolCall,
          input: JSON.stringify({
            tool: input.toolCall.toolName,
            error: input.error.message,
          }),
          toolName: "invalid",
        }
      },
      // Add OpenCode-specific headers for internal routing
      headers: {
        ...(model.providerID === "opencode"
          ? {
              "x-opencode-session": sessionID,
              "x-opencode-request": lastUser.id,
            }
          : undefined),
        ...model.info.headers,
      },
      maxRetries: 0, // We handle retries at the loop level
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      maxOutputTokens: ProviderTransform.maxOutputTokens(
        model.providerID,
        params.options,
        model.info.limit.output,
        OUTPUT_TOKEN_MAX,
      ),
      abortSignal: abort,
      providerOptions: ProviderTransform.providerOptions(model.npm, model.providerID, params.options),
      stopWhen: stepCountIs(1), // Process one step at a time
      temperature: params.temperature,
      topP: params.topP,
      // Build message array with system prompts and conversation history
      messages: [
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        // Filter conversation history, removing certain error cases
        ...MessageV2.toModelMessage(
          msgs.filter((m) => {
            if (m.info.role !== "assistant" || m.info.error === undefined) {
              return true
            }
            // Include aborted errors if they have meaningful content
            if (
              MessageV2.AbortedError.isInstance(m.info.error) &&
              m.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
            ) {
              return true
            }
            return false
          }),
        ),
      ],
      tools: model.info.tool_call === false ? undefined : tools,
      // Apply model-specific transformations and middleware
      model: wrapLanguageModel({
        model: model.language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                // Transform prompts for specific model requirements
                args.params.prompt = ProviderTransform.message(
                  args.params.prompt,
                  model.providerID,
                  model.modelID
                )
              }
              return args.params
            },
          },
        ],
      }),
    })
  )

  // Stop if AI generation was interrupted
  if (result === "stop") break

  // Continue to next iteration of conversation loop
  return
}
```

## Data Structures

### Session Info

```typescript
export const Info = z.object({
  id: Identifier.schema("session"),
  projectID: z.string(),
  directory: z.string(),
  parentID: Identifier.schema("session").optional(),
  summary: z
    .object({
      additions: z.number(),
      deletions: z.number(),
      files: z.number(),
      diffs: Snapshot.FileDiff.array().optional(),
    })
    .optional(),
  share: z
    .object({
      url: z.string(),
    })
    .optional(),
  title: z.string(),
  version: z.string(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    compacting: z.number().optional(),
  }),
  revert: z
    .object({
      messageID: z.string(),
      partID: z.string().optional(),
      snapshot: z.string().optional(),
      diff: z.string().optional(),
    })
    .optional(),
})
```

### Message Types

```typescript
// User Message
export const User = z.object({
  id: Identifier.schema("message"),
  role: z.literal("user"),
  sessionID: Identifier.schema("session"),
  agent: z.string(),
  model: z.object({
    providerID: z.string(),
    modelID: z.string(),
  }),
  time: z.object({
    created: z.number(),
  }),
  tools: z.record(z.string(), z.boolean()).optional(),
  system: z.string().optional(),
})

// Assistant Message
export const Assistant = z.object({
  id: Identifier.schema("message"),
  role: z.literal("assistant"),
  sessionID: Identifier.schema("session"),
  parentID: Identifier.schema("message"),
  mode: z.string(),
  path: z.object({
    cwd: z.string(),
    root: z.string(),
  }),
  cost: z.number(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    reasoning: z.number(),
    cache: z.object({
      read: z.number(),
      write: z.number(),
    }),
  }),
  modelID: z.string(),
  providerID: z.string(),
  finish: z.enum(["stop", "tool-calls", "unknown"]).optional(),
  error: z.any().optional(),
  time: z.object({
    created: z.number(),
    completed: z.number().optional(),
  }),
})
```

### Message Parts

```typescript
// Text Part
export const TextPart = z.object({
  id: Identifier.schema("part"),
  type: z.literal("text"),
  messageID: Identifier.schema("message"),
  sessionID: Identifier.schema("session"),
  text: z.string(),
  synthetic: z.boolean().optional(),
})

// Tool Part
export const ToolPart = z.object({
  id: Identifier.schema("part"),
  type: z.literal("tool"),
  messageID: Identifier.schema("message"),
  sessionID: Identifier.schema("session"),
  tool: z.string(),
  callID: z.string(),
  state: z.object({
    status: z.enum(["running", "completed", "error"]),
    input: z.any(),
    output: z.string().optional(),
    title: z.string().optional(),
    metadata: z.any().optional(),
    time: z.object({
      start: z.number(),
      end: z.number().optional(),
    }),
  }),
})

// File Part
export const FilePart = z.object({
  id: Identifier.schema("part"),
  type: z.literal("file"),
  messageID: Identifier.schema("message"),
  sessionID: Identifier.schema("session"),
  url: z.string(),
  filename: z.string(),
  mime: z.string(),
  source: z.string().optional(),
})
```

## Storage Architecture

### File System Structure

```
project/
├── .opencode/
│   ├── session/
│   │   └── {sessionID}/
│   │       ├── info.json           # Session metadata
│   │       ├── message/
│   │       │   └── {messageID}.json  # Message data
│   │       └── part/
│   │           └── {partID}.json      # Message parts
│   ├── share/
│   │   └── {sessionID}.json         # Share data
│   └── config.json                 # Project config
```

### Storage Operations

```typescript
// Session storage
await Storage.write(["session", project.id, session.id], result)
await Storage.read<Info>(["session", project.id, id])
await Storage.update<Info>(["session", project.id, id], updater)

// Message storage
await Storage.write(["message", sessionID, message.id], message)
await Storage.write(["part", messageID, part.id], part)
```

## Event System

### Session Events

```typescript
export const Event = {
  Created: Bus.event(
    "session.created",
    z.object({
      info: Info,
    }),
  ),
  Updated: Bus.event(
    "session.updated",
    z.object({
      info: Info,
    }),
  ),
  Deleted: Bus.event(
    "session.deleted",
    z.object({
      info: Info,
    }),
  ),
  Diff: Bus.event(
    "session.diff",
    z.object({
      sessionID: z.string(),
      diff: Snapshot.FileDiff.array(),
    }),
  ),
  Error: Bus.event(
    "session.error",
    z.object({
      sessionID: z.string().optional(),
      error: MessageV2.Assistant.shape.error,
    }),
  ),
}
```

### Message Events

```typescript
export const Event = {
  Updated: Bus.event(
    "message.updated",
    z.object({
      info: MessageV2.Info,
    }),
  ),
  Removed: Bus.event(
    "message.removed",
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
    }),
  ),
  PartUpdated: Bus.event(
    "message.part.updated",
    z.object({
      part: MessageV2.Part,
      delta: z.string().optional(),
    }),
  ),
}
```

## Advanced Features

### Session Forking

```typescript
export const fork = fn(async (input) => {
  const session = await createNext({
    directory: Instance.directory,
  })

  // Copy messages up to specified point
  const msgs = await messages({ sessionID: input.sessionID })
  for (const msg of msgs) {
    if (input.messageID && msg.info.id >= input.messageID) break

    const cloned = await updateMessage({
      ...msg.info,
      sessionID: session.id,
      id: Identifier.ascending("message"),
    })

    // Copy parts
    for (const part of msg.parts) {
      await updatePart({
        ...part,
        id: Identifier.ascending("part"),
        messageID: cloned.id,
        sessionID: session.id,
      })
    }
  }

  return session
})
```

### Session Sharing

```typescript
export const share = fn(async (id) => {
  const cfg = await Config.get()
  if (cfg.share === "disabled") {
    throw new Error("Sharing is disabled in configuration")
  }

  const session = await get(id)
  if (session.share) return session.share

  const share = await Share.create(id)
  await update(id, (draft) => {
    draft.share = {
      url: share.url,
    }
  })

  // Sync all session data
  await Share.sync("session/info/" + id, session)
  for (const msg of await messages({ sessionID: id })) {
    await Share.sync("session/message/" + id + "/" + msg.info.id, msg.info)
    for (const part of msg.parts) {
      await Share.sync("session/part/" + id + "/" + msg.info.id + "/" + part.id, part)
    }
  }

  return share
})
```

### Session Compaction

```typescript
// Handle context overflow
if (SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model: model.info })) {
  await SessionCompaction.create({
    sessionID,
    agent: lastUser.agent,
    model: lastUser.model,
  })
  continue
}
```

### Session Revert

```typescript
// Revert to previous state
export const revert = fn(async (input) => {
  // Store current state
  await update(input.sessionID, (draft) => {
    draft.revert = {
      messageID: input.messageID,
      partID: input.partID,
      snapshot: input.snapshot,
      diff: input.diff,
    }
  })

  // Restore previous state
  const snapshot = await Snapshot.get(input.snapshot)
  await Snapshot.restore(input.sessionID, snapshot)
})
```

## Performance Optimizations

### Message Streaming

```typescript
export async function* stream(sessionID: string) {
  for await (const item of Storage.list(["message", sessionID])) {
    const message = await Storage.read<MessageV2.Info>(item)
    const parts = await loadParts(message.id)
    yield { info: message, parts }
  }
}
```

### Lazy Loading

```typescript
// Load parts on demand
export async function loadParts(messageID: string) {
  const parts: MessageV2.Part[] = []
  for await (const item of Storage.list(["part", messageID])) {
    const part = await Storage.read<MessageV2.Part>(item)
    parts.push(part)
  }
  return parts
}
```

### Caching

```typescript
// Session state caching
const state = Instance.state(async () => {
  // Initialize session state
  return {}
})
```

## Error Handling

### Session Errors

```typescript
export class BusyError extends Error {
  constructor(public readonly sessionID: string) {
    super(`Session ${sessionID} is busy`)
  }
}
```

### Message Validation

```typescript
// Zod schema validation
export const Info = z
  .object({
    // ... schema definition
  })
  .meta({
    ref: "Message",
  })
```

## Integration Points

### AI Provider Integration

```typescript
// Convert to AI provider format
export function toModelMessage(messages: MessageV2.WithParts[]): ModelMessage[] {
  return messages.map((msg) => ({
    role: msg.info.role,
    content: msg.parts
      .map((part) => {
        if (part.type === "text") return { type: "text", text: part.text }
        if (part.type === "tool")
          return {
            type: "tool-call",
            toolCallId: part.callID,
            toolName: part.tool,
            args: part.state.input,
          }
        // ... other part types
      })
      .flat(),
  }))
}
```

### Tool Integration

```typescript
// Tool execution in session context
const result = await tool.execute(args, {
  sessionID: input.sessionID,
  abort: options.abortSignal,
  messageID: input.processor.message.id,
  callID: options.toolCallId,
  agent: input.agent.name,
  metadata: async (val) => {
    // Update tool part in real-time
    await Session.updatePart({
      ...part,
      state: { ...part.state, ...val },
    })
  },
})
```

The Session component provides robust conversation management with features like forking, sharing, compaction, and real-time collaboration, making it a powerful foundation for AI-assisted development.
