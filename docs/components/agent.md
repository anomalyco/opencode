# Agent Component

The Agent component defines AI behavior, capabilities, and permissions in OpenCode. It provides a flexible system for different AI personalities and access levels.

## Architecture Overview

```
┌─────────────────┐
│   Agent         │
│   Registry      │
└─────────────────┘
          │
          ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Built-in      │    │   Custom        │    │   Generated     │
│   Agents        │    │   Agents        │    │   Agents        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Permissions   │    │   Tools         │    │   Prompts       │
│   Matrix        │    │   Access        │    │   System        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Core Files

### Agent Management (`packages/opencode/src/agent/agent.ts`)

- **Agent Registry**: Central repository of all agents
- **Configuration**: Agent settings and permissions
- **Generation**: Dynamic agent creation from descriptions

### Built-in Agents

#### 1. Build Agent

```typescript
build: {
  name: "build",
  tools: { ...defaultTools },
  options: {},
  permission: agentPermission,
  mode: "primary",
  builtIn: true,
}
```

- **Purpose**: Full-featured development agent
- **Permissions**: Broad access for development tasks
- **Tools**: All available tools enabled

#### 2. Plan Agent

```typescript
plan: {
  name: "plan",
  options: {},
  permission: planPermission,
  tools: { ...defaultTools },
  mode: "primary",
  builtIn: true,
}
```

- **Purpose**: Read-only analysis and planning
- **Permissions**: Restricted to safe operations
- **Tools**: Limited to read-only tools

#### 3. General Agent

```typescript
general: {
  name: "general",
  description: "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks",
  tools: {
    todoread: false,
    todowrite: false,
    ...defaultTools,
  },
  options: {},
  permission: agentPermission,
  mode: "subagent",
  builtIn: true,
}
```

- **Purpose**: Complex multi-step tasks and research
- **Permissions**: Full access for subagent tasks
- **Tools**: Most tools except todo management

## Agent Configuration

### Agent Info Schema

```typescript
export const Info = z.object({
  name: z.string(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]),
  builtIn: z.boolean(),
  topP: z.number().optional(),
  temperature: z.number().optional(),
  color: z.string().optional(),
  permission: z.object({
    edit: Config.Permission,
    bash: z.record(z.string(), Config.Permission),
    webfetch: Config.Permission.optional(),
    doom_loop: Config.Permission.optional(),
    external_directory: Config.Permission.optional(),
  }),
  model: z
    .object({
      modelID: z.string(),
      providerID: z.string(),
    })
    .optional(),
  prompt: z.string().optional(),
  tools: z.record(z.string(), z.boolean()),
  options: z.record(z.string(), z.any()),
})
```

### Permission System

#### Default Permissions

```typescript
const defaultPermission: Info["permission"] = {
  edit: "allow",
  bash: {
    "*": "allow",
  },
  webfetch: "allow",
  doom_loop: "ask",
  external_directory: "ask",
}
```

#### Plan Agent Permissions (Restricted)

```typescript
const planPermission = {
  edit: "deny",
  bash: {
    "cut*": "allow",
    "diff*": "allow",
    "du*": "allow",
    "file *": "allow",
    "find *": "allow",
    "git diff*": "allow",
    "git log*": "allow",
    "git show*": "allow",
    "git status*": "allow",
    "git branch": "allow",
    "grep*": "allow",
    "head*": "allow",
    "less*": "allow",
    "ls*": "allow",
    "more*": "allow",
    "pwd*": "allow",
    "rg*": "allow",
    "sort*": "allow",
    "stat*": "allow",
    "tail*": "allow",
    "tree*": "allow",
    "uniq*": "allow",
    "wc*": "allow",
    "whereis*": "allow",
    "which*": "allow",
    "*": "ask",
  },
  webfetch: "allow",
}
```

### Permission Levels

- **`allow`**: Automatic execution without confirmation
- **`ask`**: User confirmation required
- **`deny`**: Execution blocked

## Agent Modes

### Primary Agents

- **Direct User Interaction**: Can be selected by users
- **Full Session Control**: Manage conversation flow
- **Tool Access**: Direct access to tool system

### Subagents

- **Internal Use**: Called by other agents
- **Task-Specific**: Focused on particular tasks
- **Limited Interface**: No direct user interaction

### All Mode

- **Universal**: Can be used as primary or subagent
- **Flexible**: Supports both interaction patterns

## Agent Generation

### Dynamic Agent Creation

```typescript
export async function generate(input: { description: string }) {
  const defaultModel = await Provider.defaultModel()
  const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)

  const system = SystemPrompt.header(defaultModel.providerID)
  system.push(PROMPT_GENERATE)

  const result = await generateObject({
    temperature: 0.3,
    prompt: [
      ...system.map((item) => ({
        role: "system" as const,
        content: item,
      })),
      {
        role: "user" as const,
        content: `Create an agent configuration based on this request: "${input.description}".
        
IMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}
Return ONLY the JSON object, no other text, do not wrap in backticks`,
      },
    ],
    model: model.language,
    schema: z.object({
      identifier: z.string(),
      whenToUse: z.string(),
      systemPrompt: z.string(),
    }),
  })

  return result.object
}
```

### Generation Prompt Template

```text
// packages/opencode/src/agent/generate.txt
You are an AI assistant that helps create specialized agents for OpenCode.

Based on the user's request, create a detailed agent configuration that includes:
1. A unique identifier (no spaces, use underscores or hyphens)
2. Clear description of when to use this agent
3. A comprehensive system prompt that defines the agent's behavior, capabilities, and limitations

The agent should be:
- Focused on a specific domain or task type
- Clear about its capabilities and limitations
- Helpful and aligned with development workflows
- Safe and responsible in its recommendations

Consider what tools this agent should have access to and what permissions it needs.
```

## Agent Resolution

### Agent Selection

```typescript
export async function get(agent: string) {
  return state().then((x) => x[agent])
}

export async function list() {
  return state().then((x) => Object.values(x))
}
```

### Configuration Merging

```typescript
// Merge user config with defaults
for (const [key, value] of Object.entries(cfg.agent ?? {})) {
  if (value.disable) {
    delete result[key]
    continue
  }

  let item = result[key]
  if (!item) {
    item = result[key] = {
      name: key,
      mode: "all",
      permission: agentPermission,
      options: {},
      tools: {},
      builtIn: false,
    }
  }

  // Merge configuration
  const { name, model, prompt, tools, description, temperature, top_p, mode, permission, color, ...extra } = value

  if (model) item.model = Provider.parseModel(model)
  if (prompt) item.prompt = prompt
  if (tools) item.tools = { ...item.tools, ...tools }
  if (description) item.description = description
  if (temperature != undefined) item.temperature = temperature
  if (top_p != undefined) item.topP = top_p
  if (mode) item.mode = mode
  if (color) item.color = color

  // Merge permissions
  if (permission ?? cfg.permission) {
    item.permission = mergeAgentPermissions(cfg.permission ?? {}, permission ?? {})
  }

  // Merge extra options
  item.options = { ...item.options, ...extra }
}
```

## Agent Context

### System Prompt Resolution

```typescript
async function resolveSystemPrompt(input: { system?: string; agent: Agent.Info; providerID: string; modelID: string }) {
  let system = SystemPrompt.header(input.providerID)
  system.push([
    // Custom system prompt or agent prompt
    ...(input.system
      ? [input.system]
      : input.agent.prompt
        ? [input.agent.prompt]
        : SystemPrompt.provider(input.modelID)),
  ])

  system.push(...(await SystemPrompt.environment()))
  system.push(...(await SystemPrompt.custom()))

  // Max 2 system prompt messages for caching
  const [first, ...rest] = system
  system = [first, rest.join("\n")]

  return system
}
```

### Tool Access Control

```typescript
async function resolveTools(input: {
  agent: Agent.Info
  model: { providerID: string; modelID: string }
  sessionID: string
  tools?: Record<string, boolean>
}) {
  const enabledTools = pipe(
    input.agent.tools,
    mergeDeep(await ToolRegistry.enabled(input.model.providerID, input.model.modelID, input.agent)),
    mergeDeep(input.tools ?? {}),
  )

  for (const item of await ToolRegistry.tools(input.model.providerID, input.model.modelID)) {
    if (Wildcard.all(item.id, enabledTools) === false) continue

    // Register tool for this agent
    tools[item.id] = tool({
      id: item.id,
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute: async (args, options) => {
        // Permission check
        await checkPermissions(item.id, args, input.agent)

        // Execute tool
        return await item.execute(args, {
          sessionID: input.sessionID,
          abort: options.abortSignal,
          messageID: messageID,
          callID: options.toolCallId,
          agent: input.agent.name,
        })
      },
    })
  }

  return tools
}
```

## Agent Switching

### Mode Switching Logic

```typescript
function insertReminders(input: { messages: MessageV2.WithParts[]; agent: Agent.Info }) {
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

  // Add plan reminder for plan agent
  if (input.agent.name === "plan") {
    userMessage.parts.push({
      id: Identifier.ascending("part"),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: PROMPT_PLAN,
      synthetic: true,
    })
  }

  // Add build switch reminder when switching from plan to build
  const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.mode === "plan")
  if (wasPlan && input.agent.name === "build") {
    userMessage.parts.push({
      id: Identifier.ascending("part"),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: BUILD_SWITCH,
      synthetic: true,
    })
  }

  return input.messages
}
```

## Configuration Examples

### Custom Agent Definition

```json
{
  "agent": {
    "security": {
      "name": "security",
      "description": "Security-focused code review agent",
      "mode": "primary",
      "temperature": 0.1,
      "permission": {
        "edit": "ask",
        "bash": {
          "security-scan*": "allow",
          "audit*": "allow",
          "*": "deny"
        },
        "webfetch": "deny"
      },
      "tools": {
        "read": true,
        "grep": true,
        "websearch": false,
        "bash": false
      },
      "prompt": "You are a security expert focused on identifying vulnerabilities and security issues in code. Always explain security implications and suggest secure alternatives."
    }
  }
}
```

### Agent with Custom Model

```json
{
  "agent": {
    "specialist": {
      "name": "specialist",
      "model": "anthropic/claude-3-5-sonnet",
      "temperature": 0.3,
      "top_p": 0.9,
      "color": "#ff6b6b",
      "tools": {
        "read": true,
        "write": true,
        "edit": true,
        "bash": true
      }
    }
  }
}
```

## Integration Points

### CLI Integration

```bash
# List available agents
opencode agent list

# Generate new agent
opencode agent generate "A code review agent that focuses on performance"

# Use specific agent
opencode run --agent security "Review this code for security issues"
```

### Session Integration

```typescript
// Use agent in session
await sdk.session.prompt({
  sessionID,
  agent: "security",
  parts: [{ type: "text", text: "Review this code" }],
})
```

### Tool Integration

```typescript
// Agent-specific tool behavior
const toolResult = await tool.execute(args, {
  agent: agent.name,
  sessionID,
  // Agent context affects tool behavior
})
```

## Performance Considerations

### Agent State Management

```typescript
// Lazy agent initialization
const state = Instance.state(async () => {
  const cfg = await Config.get()
  // Build agent registry
  return agentRegistry
})
```

### Permission Caching

```typescript
// Cache permission checks
const permissionCache = new Map<string, boolean>()
function checkPermission(tool: string, agent: Agent.Info): boolean {
  const cacheKey = `${agent.name}:${tool}`
  if (permissionCache.has(cacheKey)) {
    return permissionCache.get(cacheKey)!
  }

  const result = evaluatePermission(tool, agent)
  permissionCache.set(cacheKey, result)
  return result
}
```

The Agent component provides a flexible, secure system for defining AI behavior with fine-grained control over permissions, tools, and capabilities, enabling everything from read-only analysis to full-featured development assistance.
