# Orchestrator System Documentation

## Introduction

The Orchestrator system in Kilo Code provides a sophisticated framework for managing complex, multi-step development workflows. It enables breaking down large projects into focused subtasks, each executed by specialized AI agents (modes) with appropriate capabilities. The system maintains hierarchical task relationships, allowing seamless coordination between parent and child tasks while preserving context isolation and efficient workflow management.

### Key Principles

- **Task Decomposition**: Complex projects are broken into manageable, focused subtasks
- **Specialized Execution**: Each subtask runs in the most appropriate mode (Code, Architect, Debug, etc.)
- **Context Isolation**: Subtasks maintain separate conversation histories for clarity
- **Hierarchical Coordination**: Parent tasks coordinate child tasks and receive summarized results
- **Workflow Continuity**: Results flow between subtasks to create smooth development pipelines

## Orchestrator Architecture

### Core Components

The orchestrator architecture consists of several key components working together:

#### 1. Task Management System
- **Task Stack**: Maintains hierarchical relationships between parent and child tasks
- **Context Preservation**: Saves and restores task state across mode switches
- **Result Transfer**: Passes summarized results from child tasks back to parents

#### 2. Mode Coordination
- **Mode Switching**: Seamless transitions between specialized modes
- **Capability Matching**: Automatically selects appropriate modes for specific tasks
- **State Synchronization**: Maintains consistent state across mode transitions

#### 3. Workflow Engine
- **Task Decomposition**: Analyzes complex requests and suggests breakdown strategies
- **Dependency Management**: Handles task sequencing and prerequisite relationships
- **Progress Tracking**: Monitors completion status across the task hierarchy

### CodeIndexOrchestrator Example

```typescript
export class CodeIndexOrchestrator {
    constructor(
        private readonly configManager: CodeIndexConfigManager,
        private readonly stateManager: CodeIndexStateManager,
        private readonly workspacePath: string,
        private readonly cacheManager: CacheManager,
        private readonly vectorStore: IVectorStore,
        private readonly scanner: DirectoryScanner,
        private readonly fileWatcher: IFileWatcher,
    ) {}

    async startIndexing(): Promise<void> {
        // Coordinate multiple services for indexing workflow
        await this.vectorStore.initialize()
        await this.scanner.scanDirectory(/*...*/)
        await this._startWatcher()
    }
}
```

## Mode Switching

### Mode Architecture

Kilo Code operates through specialized modes, each optimized for specific types of work:

- **Code Mode**: Full access to code editing, debugging, and development tools
- **Architect Mode**: Specialized for system design and planning (markdown-only editing)
- **Ask Mode**: Optimized for answering questions and providing information
- **Debug Mode**: Equipped for systematic problem diagnosis and resolution
- **Orchestrator Mode**: Coordinates complex workflows through subtask delegation

### Switch Mode Tool

The `switch_mode` tool enables seamless transitions between modes:

```xml
<switch_mode>
    <mode_slug>architect</mode_slug>
    <reason>Need to design the system architecture before implementation</reason>
</switch_mode>
```

### Mode Capabilities Matrix

| Mode | File Editing | Tool Access | Primary Use Case |
|------|-------------|-------------|------------------|
| Code | Full (all types) | Code editing, debugging | Implementation |
| Architect | Markdown only | Design tools | System planning |
| Ask | None | Information tools | Research, questions |
| Debug | Limited | Diagnostic tools | Problem solving |
| Orchestrator | None | Task management | Workflow coordination |

### Mode Transition Process

1. **Request Validation**: Verify target mode exists and is accessible
2. **Context Preservation**: Save current task state and conversation history
3. **Capability Adjustment**: Update available tools based on new mode
4. **State Synchronization**: Apply mode-specific settings and restrictions
5. **Continuation**: Resume task execution with new mode capabilities

## Subagents

### Subtask Creation

Subtasks are created using the `new_task` tool, which establishes parent-child relationships:

```xml
<new_task>
    <mode>code</mode>
    <message>Implement user authentication with login and registration</message>
</new_task>
```

### Subtask Lifecycle

1. **Creation**: Parent task analyzes complexity and creates focused subtasks
2. **Execution**: Child task operates in isolation with specialized mode
3. **Completion**: Child signals completion with summarized results
4. **Integration**: Parent receives summary and continues workflow
5. **Cleanup**: Task hierarchy is maintained for navigation

### Context Management

- **Isolation**: Each subtask maintains separate conversation history
- **Explicit Transfer**: Information must be explicitly passed via task messages
- **Downward Flow**: Parent provides context through initial instructions
- **Upward Flow**: Child provides results through completion summaries

### Hierarchical Navigation

The system provides UI mechanisms to navigate between:
- Active parent tasks
- Executing child tasks
- Completed subtasks
- Parallel task branches

## Rules System

### Auto-Approval Framework

The rules system governs automatic execution of operations through configurable permissions:

#### Permission Categories

- **Read Operations**: File and directory access
- **Write Operations**: File creation and modification with diagnostic integration
- **Command Execution**: Terminal command execution with whitelist controls
- **Browser Actions**: Headless browser interaction
- **MCP Tools**: Model Context Protocol service integration
- **Mode Switching**: Automatic mode transitions
- **Subtask Management**: Automatic task creation and completion

#### Security Controls

```typescript
// Example whitelist configuration
const commandWhitelist = [
    'git status',
    'npm install',
    'python -m pytest'
]
```

### Diagnostic Integration

Write operations integrate with VSCode's Problems pane:

1. File modification triggers diagnostic analysis
2. System waits for configurable delay (default: 1000ms)
3. Problems pane updates with errors/warnings
4. Orchestrator checks for issues before proceeding

### Risk Assessment Matrix

| Operation | Risk Level | Auto-Approval | Controls |
|-----------|------------|---------------|----------|
| File Reading | Low | Recommended | Path validation |
| File Writing | High | Optional | Diagnostic integration |
| Command Execution | High | Restricted | Whitelist required |
| Mode Switching | Low | Recommended | Validation only |
| Subtask Creation | Low | Recommended | Approval required |

## Workflow System

### Task Decomposition Strategy

Complex projects are broken down using systematic analysis:

1. **Requirement Analysis**: Identify distinct phases and dependencies
2. **Capability Matching**: Assign appropriate modes to each phase
3. **Dependency Mapping**: Establish prerequisite relationships
4. **Execution Planning**: Create sequential or parallel task flows

### Workflow Patterns

#### Sequential Workflow
```
Architecture Design → Implementation → Testing → Documentation
```

#### Parallel Workflow
```
├── UI Design
├── API Design
├── Database Design
└── Security Review
```

#### Iterative Workflow
```
Initial Design → Prototype → Feedback → Refinement → Final Implementation
```

### Progress Tracking

The system maintains comprehensive progress tracking:

- **Task Status**: Pending, In Progress, Completed, Blocked
- **Completion Metrics**: Percentage complete, time estimates
- **Dependency Status**: Prerequisite completion tracking
- **Result Aggregation**: Summarized outcomes from subtasks

### Error Handling and Recovery

- **Graceful Degradation**: Continue with available information when subtasks fail
- **Retry Mechanisms**: Automatic retry for transient failures
- **Fallback Strategies**: Alternative approaches when primary paths fail
- **State Preservation**: Maintain progress across interruptions

## Integration

### IDE Integration Layer

The orchestrator integrates with development environments through standardized interfaces:

```typescript
interface IDE {
    readFile(filepath: string): Promise<string>
    writeFile(filepath: string, content: string): Promise<void>
    getWorkspaceDirs(): Promise<string[]>
    // ... additional methods
}
```

### LLM Integration

Multiple language model providers are supported through the `ILLM` interface:

```typescript
interface ILLM {
    streamFim(prefix: string, suffix: string, signal: AbortSignal): AsyncGenerator<string>
    chat(messages: ChatMessage[], signal: AbortSignal): Promise<string>
    countTokens(text: string): number
}
```

### Tool Integration

The system integrates with various development tools:

- **Version Control**: Git operations for change tracking
- **Build Systems**: npm, yarn, gradle integration
- **Testing Frameworks**: Jest, Vitest, pytest support
- **Code Quality**: ESLint, Prettier integration

### Extension Points

The architecture provides multiple extension points:

1. **Custom Modes**: Add specialized modes for domain-specific work
2. **Custom Tools**: Integrate additional development tools
3. **Custom Workflows**: Define organization-specific process templates
4. **Custom Integrations**: Connect with external services and APIs

### Configuration Management

The system supports flexible configuration:

- **Global Settings**: Organization-wide defaults
- **Project Settings**: Repository-specific configurations
- **User Preferences**: Individual developer customizations
- **Runtime Overrides**: Dynamic configuration changes

## Best Practices

### Task Design
- Keep subtasks focused and single-purpose
- Use descriptive task names and clear objectives
- Establish clear success criteria for each task

### Mode Selection
- Choose modes based on required capabilities
- Consider file type restrictions (Architect mode: markdown only)
- Match mode expertise to task complexity

### Workflow Planning
- Identify dependencies early in the process
- Plan for parallel execution where possible
- Include validation and testing phases

### Security Considerations
- Use auto-approval judiciously, especially for write operations
- Maintain command whitelists for terminal operations
- Regularly review and update permissions

### Performance Optimization
- Leverage caching for repetitive operations
- Use streaming for large data processing
- Monitor and optimize LLM call patterns

## Future Enhancements

### Planned Improvements
- **Multi-model Orchestration**: Ensemble predictions from multiple AI models
- **Cross-file Workflows**: Coordination across multiple files and projects
- **Learning Systems**: Adaptation based on successful workflow patterns
- **Collaborative Features**: Team coordination and knowledge sharing

### Research Areas
- **Automated Task Decomposition**: AI-driven breakdown of complex requirements
- **Workflow Optimization**: Learning optimal mode sequences for task types
- **Context Preservation**: Improved information transfer between tasks
- **Performance Analytics**: Detailed metrics and optimization recommendations


   ## Comprehensive Deconstruction of Kilo Code's Orchestrator System

   Based on my analysis of the codebase, here's a complete breakdown of how the orchestrator works, including mode switching, subagents, rules, and workflows. I've included key code examples
   to illustrate the core functionality.

   ### Core Orchestrator Architecture

   The system operates through multiple orchestration layers:

       1. High-Level Orchestrator Mode (packages/types/src/mode.ts)
           * Coordinates complex workflows by delegating to specialized modes

           * Breaks tasks into logical subtasks using the new_task tool

           * Manages workflow progress and synthesizes results

       {
           slug: "orchestrator",
           name: "Orchestrator",
           roleDefinition:
               "You are Kilo Code, a strategic workflow orchestrator who coordinates complex tasks by delegating them to appropriate specialized modes...",
           customInstructions:
               "Your role is to coordinate complex workflows by delegating tasks to specialized modes. As an orchestrator, you should:\n\n1. When given a complex task, break it down into
   logical subtasks...\n2. For each subtask, use the `new_task` tool to delegate...\n3. Track and manage the progress of all subtasks..."
       }

       1. Domain-Specific Orchestrators
           * CodeIndexOrchestrator (src/services/code-index/orchestrator.ts): Manages code indexing workflow across 6 services

           * CommitMessageOrchestrator (src/services/commit-message/CommitMessageOrchestrator.ts): Coordinates commit message generation

   ### Mode Switching Mechanism

   Mode switching is a deliberate, approval-required process:

   Process Flow:

       1. Validation: Verifies mode exists and differs from current mode
       2. User Approval: Requires explicit consent via approval dialog
       3. State Updates: Updates global state, task history, and API configuration
       4. Integration: Notifies UI and maintains task resumability

   Key Components:

       * switchModeTool.ts: Handles switch_mode tool execution
       * newTaskTool.ts: Manages mode switching during subtask creation
       * modes.ts: Defines mode permissions and file restrictions
       * ClineProvider.ts: Coordinates state management and event propagation

       // From switchModeTool.ts - Core switching logic
       export async function switchModeTool(cline: Task, block: ToolUse, askApproval: AskApproval, ...) {
           const mode_slug = block.params.mode_slug
           const reason = block.params.reason

           // Validate required parameters
           if (!mode_slug) {
               pushToolResult(await cline.sayAndCreateMissingParamError("switch_mode", "mode_slug"))
               return
           }

           // Verify the mode exists
           const targetMode = getModeBySlug(mode_slug, (await cline.providerRef.deref()?.getState())?.customModes)
           if (!targetMode) {
               pushToolResult(formatResponse.toolError(`Invalid mode: ${mode_slug}`))
               return
           }

           // Check if already in requested mode
           const currentMode = (await cline.providerRef.deref()?.getState())?.mode ?? defaultModeSlug
           if (currentMode === mode_slug) {
               pushToolResult(`Already in ${targetMode.name} mode.`)
               return
           }

           // Request user approval for mode switch
           const completeMessage = JSON.stringify({ tool: "switchMode", mode: mode_slug, reason })
           const didApprove = await askApproval("tool", completeMessage)

           if (!didApprove) {
               return
           }

           // Switch the mode using shared handler
           await cline.providerRef.deref()?.handleModeSwitch(mode_slug)
           pushToolResult(`Successfully switched to ${targetMode.name} mode${reason ? ` because: ${reason}` : ""}.`)
       }

   ### Subagent System (Subtasks)

   Subagents enable specialized task delegation:

   Creation & Management:

       * Tool: new_task creates subtasks with specific modes and instructions
       * Lifecycle: Parent task pauses → subtask executes → results synthesized → parent resumes
       * Isolation: Each subtask maintains separate conversation context
       * Hierarchy: Supports nested subtasks with proper stack management

       // From newTaskTool.ts - Subtask creation mechanism
       export async function newTaskTool(task: Task, block: ToolUse, askApproval: AskApproval, ...) {
           const mode = block.params.mode
           const message = block.params.message
           const todos = block.params.todos

           // Validate required parameters
           if (!mode) {
               pushToolResult(await task.sayAndCreateMissingParamError("new_task", "mode"))
               return
           }
           if (!message) {
               pushToolResult(await task.sayAndCreateMissingParamError("new_task", "message"))
               return
           }

           // Verify the mode exists
           const targetMode = getModeBySlug(mode, state?.customModes)
           if (!targetMode) {
               pushToolResult(formatResponse.toolError(`Invalid mode: ${mode}`))
               return
           }

           // Request user approval
           const toolMessage = JSON.stringify({ tool: "newTask", mode: targetMode.name, content: message, todos: todoItems })
           const didApprove = await askApproval("tool", toolMessage)

           if (!didApprove) {
               return
           }

           // Preserve the current mode so we can resume with it later
           task.pausedModeSlug = (await provider.getState()).mode ?? defaultModeSlug

           // Switch to the desired mode BEFORE creating the task
           await provider.handleModeSwitch(mode)

           // Create the subtask
           const newTask = await task.startSubtask(message, todoItems, mode)

           if (!newTask) {
               await provider.handleModeSwitch(task.pausedModeSlug) // Restore parent mode if task creation failed
               pushToolResult(t("tools:newTask.errors.policy_restriction"))
               return
           }

           pushToolResult(`Successfully created new task in ${targetMode.name} mode with message: ${message}`)
       }

   ### Rules and Workflow Files

   Rules System:

       * Storage: .kilocode/rules/ (global + local) with .md/.txt files
       * Enforcement: Integrated into system prompts when enabled
       * Toggle System: Individual files can be enabled/disabled

       // From custom-instructions.ts - Rule loading system
       export async function loadRuleFiles(cwd: string): Promise<string> {
           const rules: string[] = []
           const rooDirectories = getRooDirectoriesForCwd(cwd)

           // Check for .kilocode/rules/ directories in order (global first, then project-local)
           for (const rooDir of rooDirectories) {
               const rulesDir = path.join(rooDir, "rules")
               if (await directoryExists(rulesDir)) {
                   const files = await readTextFilesFromDirectory(rulesDir)
                   if (files.length > 0) {
                       const content = formatDirectoryContent(rulesDir, files)
                       rules.push(content)
                   }
               }
           }

           // If we found rules in .kilocode/rules/ directories, return them
           if (rules.length > 0) {
               return "\n" + rules.join("\n\n")
           }

           // Fall back to legacy rule files
           const ruleFiles = [".kilocoderules", ".roorules", ".clinerules"]
           for (const file of ruleFiles) {
               const content = await safeReadFile(path.join(cwd, file))
               if (content) {
                   return `\n# Rules from ${file}:\n${content}\n`
               }
           }

           return ""
       }

   Workflow System:

       * Storage: .kilocode/workflows/ with same structure as rules
       * Purpose: Define multi-step processes requiring Orchestrator mode
       * Execution: Guides complex tasks through numbered steps and mode delegation

       // From kilorules.ts - Workflow template generation
       function workflowTemplate(baseFileName: string) {
           return `# ${baseFileName}

       This workflow outlines the steps for conducting a thorough code review.

       ## Steps

       1. Analyze the code changes for functionality, performance, and security
       2. Check for adherence to coding standards and best practices
       `
       }

   ### Integration and Workflow

   The orchestrator system creates a hierarchical workflow management framework:

       Orchestrator Mode
       ├── Breaks complex task into subtasks
       ├── Delegates to specialized modes
       ├── Tracks progress via TODO lists
       ├── Synthesizes results
       └── Enforces rules and follows workflows

       Rules & Workflows
       ├── Provide behavioral guidelines
       ├── Define execution procedures
       ├── Toggle-based enable/disable
       └── Integrated into prompt system

   This architecture enables sophisticated task decomposition while maintaining clean separation of concerns, efficient context management, and user-configurable behavior through rules and
   workflows.