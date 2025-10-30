# OpenCode Command Arguments: Comprehensive Guide

## Executive Summary

OpenCode supports multiple command types with distinct argument handling patterns: CLI commands (using yargs), slash commands (with template substitution), and MCP server commands. This guide documents how arguments are parsed, validated, and passed across these different command types, providing best practices and common pitfalls to avoid.

## Table of Contents

1. [Command Types Overview](#command-types-overview)
2. [CLI Command Arguments](#cli-command-arguments)
3. [Slash Command Arguments](#slash-command-arguments)
4. [Template Command Arguments](#template-command-arguments)
5. [MCP Server Arguments](#mcp-server-arguments)
6. [Tool Argument Patterns](#tool-argument-patterns)
7. [Argument Validation](#argument-validation)
8. [Common Pitfalls](#common-pitfalls)
9. [Best Practices](#best-practices)
10. [Migration Guide](#migration-guide)

## Command Types Overview

OpenCode supports three primary command types, each with different argument handling mechanisms:

### 1. CLI Commands

- **Entry Point**: `packages/opencode/src/index.ts`
- **Parser**: yargs with strict mode enabled
- **Usage**: `opencode <command> [options] [arguments...]`

### 2. Slash Commands

- **Storage**: Markdown files in `command/` directories
- **Processing**: Template substitution with `$ARGUMENTS`
- **Usage**: `/command-name <arguments>`

### 3. MCP Server Commands

- **Transport**: HTTP, SSE, or Stdio
- **Schema**: JSON Schema via MCP protocol
- **Usage**: Tool calls with structured parameters

## CLI Command Arguments

### Architecture

CLI commands use yargs for argument parsing with the following structure:

```typescript
// packages/opencode/src/cli/cmd/run.ts
export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run opencode with a message",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
    // ... more options
  },
  handler: async (args) => {
    // Command implementation
  },
})
```

### Argument Types

#### Positional Arguments

```typescript
// Array positional argument
positional("message", {
  describe: "message to send",
  type: "string",
  array: true, // Accepts multiple values
  default: [], // Default empty array
})

// Single positional argument
positional("name", {
  describe: "server name",
  type: "string",
})
```

#### Options

```typescript
// String option with alias
.option("model", {
  type: "string",
  alias: ["m"],
  describe: "model to use in the format of provider/model",
})

// Boolean option
.option("share", {
  type: "boolean",
  describe: "share the session",
})

// Choice option
.option("format", {
  type: "string",
  choices: ["default", "json"],
  default: "default",
  describe: "format: default (formatted) or json (raw JSON events)",
})
```

### Complex Argument Parsing

#### Array Arguments with Special Handling

```typescript
// packages/opencode/src/cli/cmd/mcp.ts
.option("headers", {
  alias: "H",
  type: "string",
  array: true,
  describe: "Headers in format 'Key: Value'"
})

// Handler processes array into object
function parseHeaders(headers?: string[]): Record<string, string> | undefined {
  if (!headers || headers.length === 0) return undefined

  return headers.reduce(
    (acc, header) => {
      const [key, ...valueParts] = header.split(":")
      if (key && valueParts.length > 0) {
        acc[key.trim()] = valueParts.join(":").trim()
      }
      return acc
    },
    {} as Record<string, string>,
  )
}
```

#### Environment Variable Arguments

```typescript
.option("env", {
  alias: "e",
  type: "string",
  array: true,
  describe: "Environment variables in format 'KEY=VALUE'",
})

// Parse into environment object
function parseEnvironment(env?: string[]): Record<string, string> | undefined {
  if (!env || env.length === 0) return undefined

  return env.reduce(
    (acc, envVar) => {
      const [key, ...valueParts] = envVar.split("=")
      if (key && valueParts.length > 0) {
        acc[key] = valueParts.join("=")
      }
      return acc
    },
    {} as Record<string, string>,
  )
}
```

### Error Handling

CLI commands use yargs' built-in validation and custom error handling:

```typescript
// packages/opencode/src/index.ts
.fail((msg) => {
  if (
    msg.startsWith("Unknown argument") ||
    msg.startsWith("Not enough non-option arguments") ||
    msg.startsWith("Invalid values:")
  ) {
    cli.showHelp("log")
  }
  process.exit(1)
})
.strict() // Enable strict mode to catch unknown arguments
```

## Slash Command Arguments

### Configuration Structure

Slash commands are defined in markdown files with frontmatter:

```markdown
---
description: Add a remote MCP server
agent: build
subtask: true
---

Add a remote MCP server with specified name and URL.

!`opencode mcp user $ARGUMENTS`

The MCP server will be configured and available as tools once added.
```

### Template Substitution

The core mechanism for argument handling in slash commands is template substitution:

```typescript
// packages/opencode/src/session/prompt.ts
export async function command(input: CommandInput) {
  const command = await Command.get(input.command)

  // Core substitution: replace $ARGUMENTS with provided arguments
  let template = command.template.replaceAll("$ARGUMENTS", input.arguments)

  // Process shell command substitutions
  const shell = ConfigMarkdown.shell(template)
  if (shell.length > 0) {
    const results = await Promise.all(
      shell.map(async ([, cmd]) => {
        try {
          return await $`${{ raw: cmd }}`.nothrow().text()
        } catch (error) {
          return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
        }
      }),
    )
    let index = 0
    template = template.replace(bashRegex, () => results[index++])
  }

  // Process file references
  const files = ConfigMarkdown.files(template)
  await Promise.all(
    files.map(async (match) => {
      const name = match[1]
      const filepath = name.startsWith("~/")
        ? path.join(os.homedir(), name.slice(2))
        : path.resolve(Instance.worktree, name)

      const stats = await fs.stat(filepath).catch(() => undefined)
      if (!stats) {
        // Check if it's an agent reference
        const agent = await Agent.get(name)
        if (agent) {
          parts.push({
            type: "agent",
            name: agent.name,
          })
        }
        return
      }

      // Add file part based on type
      if (stats.isDirectory()) {
        parts.push({
          type: "file",
          url: `file://${filepath}`,
          filename: name,
          mime: "application/x-directory",
        })
      } else {
        parts.push({
          type: "file",
          url: `file://${filepath}`,
          filename: name,
          mime: "text/plain",
        })
      }
    }),
  )
}
```

### Template Patterns

#### Basic Argument Substitution

```markdown
---
description: Simple echo command
---

Echo the provided arguments: $ARGUMENTS
```

#### Shell Command Substitution

```markdown
---
description: Get current git branch
---

Current branch: !`git branch --show-current`

Working on: $ARGUMENTS
```

#### File Reference Substitution

```markdown
---
description: Analyze configuration file
---

Analyze the @opencode.json configuration file.

Focus on: $ARGUMENTS
```

#### Combined Patterns

```markdown
---
description: Complex command with multiple substitutions
---

Analyzing @README.md in project.

Current user: !`whoami`
Arguments: $ARGUMENTS
Config: @.opencode/config.json
```

### Argument Processing Flow

1. **Template Loading**: Read command template from markdown content
2. **Argument Substitution**: Replace `$ARGUMENTS` with user-provided arguments
3. **Shell Execution**: Execute `!`command`` patterns and substitute results
4. **File Resolution**: Resolve `@file` references to file parts or agent references
5. **Part Assembly**: Combine all parts into message structure

## Template Command Arguments

### Command Schema

Template commands are defined using Zod schemas:

```typescript
// packages/opencode/src/config/config.ts
export const Command = z.object({
  template: z.string(),
  description: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  subtask: z.boolean().optional(),
})
```

### Loading Process

```typescript
// packages/opencode/src/config/config.ts
const COMMAND_GLOB = new Bun.Glob("command/**/*.md")
async function loadCommand(dir: string) {
  const result: Record<string, Command> = {}
  for await (const item of COMMAND_GLOB.scan({ absolute: true, followSymlinks: true, dot: true, cwd: dir })) {
    const content = await Bun.file(item).text()
    const md = matter(content)
    if (!md.data) continue

    const name = (() => {
      const patterns = ["/.opencode/command/", "/command/"]
      const pattern = patterns.find((p) => item.includes(p))

      if (pattern) {
        const index = item.indexOf(pattern)
        return item.slice(index + pattern.length, -3)
      }
      return path.basename(item, ".md")
    })()

    const config = {
      name,
      ...md.data,
      template: md.content.trim(),
    }
    const parsed = Command.safeParse(config)
    if (parsed.success) {
      result[config.name] = parsed.data
      continue
    }
    throw new InvalidError({ path: item }, { cause: parsed.error })
  }
  return result
}
```

### Command Execution

```typescript
// packages/opencode/src/session/prompt.ts
export const CommandInput = z.object({
  messageID: Identifier.schema("message").optional(),
  sessionID: Identifier.schema("session"),
  agent: z.string().optional(),
  model: z.string().optional(),
  arguments: z.string(),
  command: z.string(),
})

export async function command(input: CommandInput) {
  log.info("command", input)
  const command = await Command.get(input.command)
  const agentName = command.agent ?? input.agent ?? "build"

  // Template substitution and processing
  let template = command.template.replaceAll("$ARGUMENTS", input.arguments)

  // ... shell and file processing as shown above

  // Determine execution mode
  const agent = await Agent.get(agentName)
  if ((agent.mode === "subagent" && command.subtask !== false) || command.subtask === true) {
    // Execute as subtask via task tool
    return await executeAsSubtask(template, agent, input)
  }

  // Execute as regular prompt
  return await prompt({
    sessionID: input.sessionID,
    messageID: input.messageID,
    model,
    agent: agentName,
    parts,
  })
}
```

## MCP Server Arguments

### Configuration Types

MCP servers support two connection types with different argument patterns:

#### Local MCP Servers

```typescript
// packages/opencode/src/config/config.ts
export const McpLocal = z
  .object({
    type: z.literal("local"),
    command: z.string().array().describe("Command and arguments to run MCP server"),
    environment: z
      .record(z.string(), z.string())
      .optional()
      .describe("Environment variables to set when running MCP server"),
    enabled: z.boolean().optional().describe("Enable or disable MCP server on startup"),
  })
  .strict()
```

#### Remote MCP Servers

```typescript
export const McpRemote = z
  .object({
    type: z.literal("remote"),
    url: z.string().describe("URL of remote MCP server"),
    enabled: z.boolean().optional().describe("Enable or disable MCP server on startup"),
    headers: z.record(z.string(), z.string()).optional().describe("Headers to send with request"),
  })
  .strict()
```

### Argument Processing

#### Local Server Arguments

```typescript
// packages/opencode/src/cli/cmd/mcp.ts
export const McpAddLocalCommand = cmd({
  command: "local <name> [command..]",
  describe: "add a local MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", { describe: "MCP server name", type: "string" })
      .positional("command", { describe: "Command to run", type: "string", array: true, default: [] })
      .option("env", {
        alias: "e",
        type: "string",
        array: true,
        describe: "Environment variables in format 'KEY=VALUE'",
      })
      .option("enabled", { type: "boolean", default: true, describe: "Enable server on startup" }),
  async handler(argv: any) {
    const { name, command, env, enabled } = argv

    if (!command || command.length === 0) {
      throw new Error("Command is required. Provide the command to run after the server name.")
    }

    // Parse environment variables
    const environment = parseEnvironment(env)

    // Save configuration
    const newMcpConfig = {
      ...mcpConfig,
      [name]: {
        type: "local" as const,
        command,
        environment,
        enabled,
      },
    }
  },
})
```

#### Remote Server Arguments

```typescript
export const McpAddUserCommand = cmd({
  command: "user <name> <url>",
  describe: "add a remote MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", { describe: "MCP server name", type: "string" })
      .positional("url", { describe: "MCP server URL", type: "string" })
      .option("headers", { alias: "H", type: "string", array: true, describe: "Headers in format 'Key: Value'" })
      .option("enabled", { type: "boolean", default: true, describe: "Enable server on startup" }),
  async handler(argv: any) {
    const { name, url, headers, enabled } = argv

    // Validate URL format
    if (!url || !URL.canParse(url)) {
      throw new Error(`Invalid URL: ${url}`)
    }

    // Parse headers
    const parsedHeaders = parseHeaders(headers)

    // Save configuration
    const newMcpConfig = {
      ...mcpConfig,
      [name]: {
        type: "remote" as const,
        url,
        headers: parsedHeaders,
        enabled,
      },
    }
  },
})
```

### MCP Tool Integration

```typescript
// packages/opencode/src/mcp/index.ts
export async function tools() {
  const result: Record<string, Tool> = {}
  for (const [clientName, client] of Object.entries(await clients())) {
    for (const [toolName, tool] of Object.entries(await client.tools())) {
      const sanitizedClientName = clientName.replace(/\s+/g, "_")
      const sanitizedToolName = toolName.replace(/[-\s]+/g, "_")
      result[sanitizedClientName + "_" + sanitizedToolName] = tool
    }
  }
  return result
}
```

## Tool Argument Patterns

### Tool Definition Structure

```typescript
// packages/opencode/src/tool/tool.ts
export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  id: string
  init: () => Promise<{
    description: string
    parameters: Parameters
    execute(
      args: z.infer<Parameters>,
      ctx: Context,
    ): Promise<{
      title: string
      metadata: M
      output: string
      attachments?: MessageV2.FilePart[]
    }>
  }>
}
```

### Example Tool Implementations

#### Bash Tool

```typescript
// packages/opencode/src/tool/bash.ts
export const BashTool = Tool.define("bash", {
  description: DESCRIPTION,
  parameters: z.object({
    command: z.string().describe("The command to execute"),
    timeout: z.number().describe("Optional timeout in milliseconds").optional(),
    description: z.string().describe("Clear, concise description of what this command does in 5-10 words..."),
  }),
  async execute(params, ctx) {
    // Command execution with validation
    const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)

    // Parse and validate command
    const tree = await parser().then((p) => p.parse(params.command))

    // Security checks
    await validateCommandSecurity(tree, params.command)

    // Execute command
    return await executeCommand(params.command, timeout, ctx)
  },
})
```

#### Read Tool

```typescript
// packages/opencode/src/tool/read.ts
export const ReadTool = Tool.define("read", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The path to file to read"),
    offset: z.coerce.number().describe("The line number to start reading from (0-based)").optional(),
    limit: z.coerce.number().describe("The number of lines to read (defaults to 2000)").optional(),
  }),
  async execute(params, ctx) {
    // Path resolution and validation
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.join(process.cwd(), filepath)
    }

    // Security check
    if (!Filesystem.contains(Instance.directory, filepath)) {
      throw new Error(`File ${filepath} is not in current working directory`)
    }

    // File reading logic
    return await readFile(filepath, params.offset, params.limit)
  },
})
```

#### Edit Tool

```typescript
// packages/opencode/src/tool/edit.ts
export const EditTool = Tool.define("edit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to file to modify"),
    oldString: z.string().describe("The text to replace"),
    newString: z.string().describe("The text to replace it with (must be different from oldString)"),
    replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
  }),
  async execute(params, ctx) {
    // Validation
    if (params.oldString === params.newString) {
      throw new Error("oldString and newString must be different")
    }

    // Path resolution and security
    const filePath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    if (!Filesystem.contains(Instance.directory, filePath)) {
      throw new Error(`File ${filePath} is not in current working directory`)
    }

    // Edit operation with multiple replacement strategies
    return await performEdit(filePath, params)
  },
})
```

## Argument Validation

### Zod Schema Validation

All command arguments use Zod schemas for validation:

```typescript
// Command input validation
export const CommandInput = z.object({
  messageID: Identifier.schema("message").optional(),
  sessionID: Identifier.schema("session"),
  agent: z.string().optional(),
  model: z.string().optional(),
  arguments: z.string(),
  command: z.string(),
})

// Tool parameter validation
parameters: z.object({
  filePath: z.string().describe("The path to file to read"),
  offset: z.coerce.number().describe("Line number to start reading from").optional(),
  limit: z.coerce.number().describe("Number of lines to read").optional(),
})
```

### Runtime Validation

#### Path Security Validation

```typescript
// Filesystem containment check
if (!Filesystem.contains(Instance.directory, filepath)) {
  throw new Error(`File ${filepath} is not in current working directory`)
}

// Command security validation
for (const node of tree.rootNode.descendantsOfType("command")) {
  const command = extractCommand(node)
  if (isDangerousCommand(command)) {
    throw new Error(`Command not allowed: ${command}`)
  }
}
```

#### Type Coercion

```typescript
// Automatic type conversion
offset: z.coerce.number().describe("The line number to start reading from (0-based)").optional(),
limit: z.coerce.number().describe("The number of lines to read (defaults to 2000)").optional(),
```

### Error Handling Patterns

#### Validation Errors

```typescript
const parsed = Command.safeParse(config)
if (parsed.success) {
  result[config.name] = parsed.data
} else {
  throw new InvalidError({ path: item }, { cause: parsed.error })
}
```

#### User-Friendly Error Messages

```typescript
if (!command || command.length === 0) {
  throw new Error("Command is required. Provide the command to run after the server name.")
}

if (!url || !URL.canParse(url)) {
  throw new Error(`Invalid URL: ${url}`)
}
```

## Common Pitfalls

### 1. Argument Array Handling

**Problem**: Incorrect handling of array arguments in CLI commands.

```typescript
// ❌ Wrong - assumes single string
.option("headers", { type: "string" })

// ✅ Correct - handle array properly
.option("headers", {
  type: "string",
  array: true,
  describe: "Headers in format 'Key: Value'"
})

// Process array into object
function parseHeaders(headers?: string[]): Record<string, string> | undefined {
  if (!headers || headers.length === 0) return undefined
  return headers.reduce((acc, header) => {
    const [key, ...valueParts] = header.split(":")
    if (key && valueParts.length > 0) {
      acc[key.trim()] = valueParts.join(":").trim()
    }
    return acc
  }, {})
}
```

### 2. Template Substitution Conflicts

**Problem**: Multiple substitution patterns interfering with each other.

```markdown
<!-- ❌ Problematic - nested substitutions -->

!`echo "Processing $ARGUMENTS with @config"`

<!-- ✅ Better - separate concerns -->

Processing arguments: $ARGUMENTS
Config file: @config
Shell output: !`echo "Done processing"`
```

### 3. Path Resolution Issues

**Problem**: Inconsistent path handling across tools.

```typescript
// ❌ Wrong - doesn't handle relative paths
const file = Bun.file(params.filePath)

// ✅ Correct - proper path resolution
let filepath = params.filePath
if (!path.isAbsolute(filepath)) {
  filepath = path.join(process.cwd(), filepath)
}

// Security check
if (!Filesystem.contains(Instance.directory, filepath)) {
  throw new Error(`File ${filepath} is not in current working directory`)
}
```

### 4. MCP Server Configuration

**Problem**: Incorrect MCP server argument formatting.

```typescript
// ❌ Wrong - string instead of array
{
  type: "local",
  command: "npx -y @modelcontextprotocol/server-filesystem /tmp"  // String
}

// ✅ Correct - array of command parts
{
  type: "local",
  command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"]  // Array
}
```

### 5. Missing Argument Validation

**Problem**: Not validating required arguments.

```typescript
// ❌ Wrong - no validation
async execute(params, ctx) {
  return await process(params.filePath)  // Could be undefined
}

// ✅ Correct - proper validation
async execute(params, ctx) {
  if (!params.filePath) {
    throw new Error("filePath is required")
  }
  return await process(params.filePath)
}
```

## Best Practices

### 1. Consistent Argument Naming

Use consistent naming conventions across commands:

```typescript
// Standard option names
.option("model", { alias: "m" })           // Model selection
.option("agent", { alias: "a" })           // Agent selection
.option("format", { choices: ["json", "default"] })  // Output format
.option("timeout", { type: "number" })       // Timeout in ms
```

### 2. Comprehensive Validation

Validate all inputs with meaningful error messages:

```typescript
// Validate URL format
if (!URL.canParse(url)) {
  throw new Error(`Invalid URL format: ${url}. Expected format: https://example.com/path`)
}

// Validate file existence
const stats = await fs.stat(filepath).catch(() => undefined)
if (!stats) {
  const suggestions = await findSimilarFiles(filepath)
  throw new Error(`File not found: ${filepath}\n\nDid you mean:\n${suggestions.join("\n")}`)
}
```

### 3. Graceful Error Handling

Provide helpful error messages and recovery suggestions:

```typescript
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  if (error instanceof NetworkError) {
    throw new Error(`Network operation failed: ${error.message}. Check your connection and try again.`)
  }
  throw error
}
```

### 4. Template Design Patterns

Design templates for clarity and maintainability:

```markdown
---
description: Add MCP server with validation
agent: build
subtask: true
---

Adding MCP server: $ARGUMENTS

!`opencode mcp user $ARGUMENTS`

The server will be available as tools once configured.
```

### 5. Security-First Design

Always validate and sanitize inputs:

```typescript
// Command injection prevention
const dangerousCommands = ["rm -rf", "sudo", "chmod 777"]
if (dangerousCommands.some((cmd) => params.command.includes(cmd))) {
  throw new Error(`Potentially dangerous command detected: ${params.command}`)
}

// Path traversal prevention
if (filepath.includes("..") || path.isAbsolute(filepath)) {
  throw new Error(`Path traversal not allowed: ${filepath}`)
}
```

## Migration Guide

### From CLI to Slash Commands

**CLI Command**:

```bash
opencode mcp user my-server https://example.com/mcp --headers "Authorization: Bearer token"
```

**Equivalent Slash Command**:

```markdown
---
description: Add remote MCP server
agent: build
subtask: true
---

Add a remote MCP server with specified name and URL.

!`opencode mcp user $ARGUMENTS`

Usage: /mcp-user my-server https://example.com/mcp --headers "Authorization: Bearer token"
```

### From Array to Object Arguments

**Before (Array)**:

```typescript
{
  type: "local",
  command: "node server.js --port 3000"
}
```

**After (Array of parts)**:

```typescript
{
  type: "local",
  command: ["node", "server.js", "--port", "3000"]
}
```

### Template Migration

**Old Template**:

```markdown
Process file: $FILE with options: $OPTIONS
```

**New Template**:

```markdown
Process file: @README.md with options: $ARGUMENTS
```

## Testing Command Arguments

### Unit Testing CLI Commands

```typescript
import { RunCommand } from "../src/cli/cmd/run"

describe("RunCommand", () => {
  it("should parse message arguments correctly", async () => {
    const mockHandler = jest.fn()
    const command = {
      ...RunCommand,
      handler: mockHandler,
    }

    await command.handler({
      message: ["hello", "world"],
      command: undefined,
      model: "anthropic/claude-3",
    })

    expect(mockHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        message: ["hello", "world"],
        model: "anthropic/claude-3",
      }),
    )
  })
})
```

### Integration Testing Slash Commands

```typescript
describe("Slash Command Processing", () => {
  it("should substitute arguments correctly", async () => {
    const template = "Process $ARGUMENTS with @config.json"
    const result = await processTemplate(template, "my-args")

    expect(result.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: "Process my-args with ",
        }),
        expect.objectContaining({
          type: "file",
          filename: "config.json",
        }),
      ]),
    )
  })
})
```

## Conclusion

Understanding OpenCode's argument handling patterns is crucial for building reliable commands and tools. The key takeaways are:

1. **CLI Commands**: Use yargs with strict validation and proper array handling
2. **Slash Commands**: Leverage template substitution with `$ARGUMENTS`, `!`command``, and `@file` patterns
3. **MCP Servers**: Support both local (array commands) and remote (URL + headers) configurations
4. **Tools**: Use Zod schemas for parameter validation and provide clear error messages
5. **Security**: Always validate inputs, especially paths and commands

By following these patterns and best practices, you can create commands that are robust, secure, and user-friendly.
