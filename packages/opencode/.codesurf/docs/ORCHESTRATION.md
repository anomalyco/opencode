# OpenCode Orchestration System

Complete guide to the Kilo Code-style orchestration system in OpenCode.

## Overview

The orchestration system enables complex, multi-agent workflows with:

- **Task Hierarchy**: Parent-child session relationships
- **Mode Switching**: Dynamic agent capability changes
- **Parallel Execution**: Isolated git worktrees for concurrent work
- **Rules**: Configurable behavior constraints
- **Workflows**: Reusable orchestration patterns

## Architecture

### Core Components

1. **Agent System** (`src/agent/agent.ts`)
   - Agent configurations with capabilities
   - Built-in agents: orchestrator, general, plan, architect
   - Custom agent support

2. **Task Hierarchy** (`src/session/task-hierarchy.ts`)
   - Parent-child session management
   - State tracking (active, paused, completed, failed)
   - Result passing between tasks

3. **Tools**
   - `task` - Create subtasks with specialized agents
   - `switch_mode` - Switch between agent modes
   - `complete_task` - Complete subtask and return to parent

4. **Parallel Mode** (`src/parallel/`)
   - Git worktree isolation
   - Automatic commit and cleanup
   - Branch management

5. **Rules System** (`src/session/rules.ts`)
   - Agent behavior configuration
   - Context-aware rule application
   - Priority-based rule ordering

6. **Workflows System** (`src/session/workflows.ts`)
   - Predefined orchestration patterns
   - Step-by-step execution plans
   - Dependency management

## Agents

### Orchestrator Agent

**Role**: Workflow coordinator that delegates to specialized agents

**Capabilities**:

- Create subtasks (via `task` tool)
- Switch modes (via `switch_mode` tool)
- Read files, search code
- Track progress with todos

**Cannot**:

- Modify files directly
- Run bash commands (except git status/log/diff)
- Execute code implementations

**When to Use**: Multi-step features, complex workflows, coordination tasks

### General Agent

**Role**: Full-capability implementation agent

**Capabilities**:

- All tools available
- File modifications
- Code execution
- Subtask creation
- Mode switching

**When to Use**: Code implementation, testing, debugging, file operations

### Plan Agent

**Role**: Read-only strategic planner

**Capabilities**:

- Read files, search code
- Analysis and planning
- Mode switching
- Subtask completion

**Cannot**:

- Modify files
- Run bash commands (except git read-only)
- Create subtasks

**When to Use**: Architecture design, root cause analysis, strategic planning

### Architect Agent

**Role**: System design specialist (markdown-only editing)

**Capabilities**:

- Read and search files
- Edit markdown, text, and JSON files only
- Create documentation
- Mode switching

**Cannot**:

- Edit code files
- Run bash commands (except git read-only)
- Create subtasks

**When to Use**: Architecture documentation, design specifications, technical docs

## Task Hierarchy

### Creating Subtasks

The `task` tool creates child sessions:

```typescript
// Orchestrator creates subtask
{
  description: "Implement authentication",
  prompt: "Add JWT authentication with login/logout endpoints",
  subagent_type: "general",
  parallel: true  // Optional: run in isolated worktree
}
```

### Subtask State

Each subtask has orchestration state:

- `depth`: Hierarchy level (0 = root, 1 = child, etc.)
- `status`: active | paused | completed | failed
- `pausedMode`: Mode to resume after child completes
- `result`: Output from completed subtask

### Completing Subtasks

The `complete_task` tool returns results to parent:

```typescript
{
  result: "Authentication implemented with JWT tokens...",
  status: "success"
}
```

## Mode Switching

### Switch Mode Tool

Agents can switch modes to access different capabilities:

```typescript
{
  mode_slug: "architect",
  reason: "Need to create architecture documentation"
}
```

### Switching Patterns

**Orchestrator → Architect → Orchestrator**

```
1. Orchestrator analyzes requirements
2. Switches to architect mode
3. Creates design documents
4. Switches back to orchestrator
5. Delegates implementation to @general
```

**Orchestrator → Plan → Orchestrator**

```
1. Orchestrator receives complex bug report
2. Switches to plan mode for analysis
3. Identifies root cause
4. Switches back to orchestrator
5. Delegates fix to @general
```

## Parallel Execution

### Enabling Parallel Mode

Subtasks can run in isolated git worktrees:

```bash
# CLI level
opencode run --parallel "Implement feature"

# Tool level
{
  description: "Backend implementation",
  prompt: "Implement API endpoints",
  subagent_type: "general",
  parallel: true
}
```

### Parallel Workflow

1. **Setup**: Create git worktree and branch
2. **Execute**: Run subtask in isolated directory
3. **Commit**: Auto-commit changes
4. **Teardown**: Remove worktree, restore directory
5. **Merge**: User merges branch when ready

### Benefits

- **Isolation**: Changes don't affect main workspace
- **Concurrency**: Multiple subtasks in parallel
- **Safety**: Easy to discard if subtask fails
- **Review**: Changes on separate branch

## Rules System

### Rule Structure

Rules are JSON/YAML files in `.opencode/rules/`:

```json
{
  "id": "typescript-style",
  "name": "TypeScript Code Style",
  "enabled": true,
  "priority": 100,
  "scope": {
    "agents": ["general"],
    "fileTypes": [".ts", ".tsx"]
  },
  "content": "Use 2-space indentation, explicit return types..."
}
```

### Rule Application

Rules are:

1. Loaded at startup
2. Sorted by priority
3. Filtered by context (agent, file type, directory)
4. Injected into system prompt
5. Enforced during execution

### Example Rules

- **typescript-style.json**: Code style guidelines
- **security-review.json**: Security requirements
- **test-coverage.json**: Testing standards

## Workflows System

### Workflow Structure

Workflows are JSON files in `.opencode/workflows/`:

```json
{
  "id": "feature-implementation",
  "name": "Full Feature Implementation",
  "steps": [
    {
      "id": "design",
      "name": "Design Architecture",
      "agent": "architect",
      "dependencies": [],
      "prompt": "Design the architecture for..."
    },
    {
      "id": "implement",
      "name": "Implementation",
      "agent": "general",
      "dependencies": ["design"],
      "parallel": true,
      "prompt": "Implement based on design..."
    }
  ]
}
```

### Workflow Execution

1. **Load**: Orchestrator loads workflow by ID
2. **Plan**: Generate execution order from dependencies
3. **Execute**: Run steps in order
4. **Validate**: Check completion criteria
5. **Report**: Summarize results

### Built-in Workflows

- **feature-implementation**: Complete feature workflow
- **bugfix-workflow**: Systematic bug fixing
- **refactor-workflow**: Code refactoring (example)
- **review-workflow**: Code review process (example)

## Usage Examples

### Example 1: Feature Implementation with Orchestrator

```bash
opencode run --agent orchestrator "Add user authentication system"
```

**Orchestrator flow**:

1. Creates todo list
2. Switches to `architect` mode to design system
3. Switches back to `orchestrator` mode
4. Creates `task` for @general to implement backend
5. Creates `task` for @general to implement frontend
6. Creates `task` for @general to add tests
7. Validates integration
8. Reports completion

### Example 2: Parallel Subtasks

```bash
opencode run --agent orchestrator --parallel "Build multi-service feature"
```

**With parallel mode**:

1. Orchestrator creates subtask with `parallel: true`
2. Subtask runs in isolated git worktree
3. Changes committed to separate branch
4. Multiple subtasks can run concurrently
5. User merges branches when ready

### Example 3: Bug Fix with Analysis

```bash
opencode run --agent orchestrator "Fix authentication token expiry bug"
```

**Orchestrator flow**:

1. Switches to `plan` mode for analysis
2. Identifies root cause
3. Switches back to `orchestrator` mode
4. Creates `task` for @general to implement fix
5. Creates `task` for @general to add regression test
6. Validates fix works
7. Reports completion

### Example 4: Using Workflows

```bash
opencode run --agent orchestrator "Use feature-implementation workflow for: real-time notifications"
```

**Orchestrator with workflow**:

1. Loads `feature-implementation` workflow
2. Substitutes variables (feature description)
3. Executes steps in order:
   - Design (architect)
   - Plan (plan)
   - Backend (general, parallel)
   - Frontend (general, parallel)
   - Integration (general)
   - Testing (general)
   - Documentation (architect)

## Configuration

### Enable/Disable Features

In `.opencode/config.jsonc`:

```json
{
  "orchestration": {
    "enabled": true,
    "parallelMode": true,
    "rules": true,
    "workflows": true
  }
}
```

### Custom Agents

Add custom agents in config:

```json
{
  "agent": {
    "backend": {
      "description": "Backend API specialist",
      "roleDefinition": "Expert in server-side development",
      "mode": "primary",
      "capabilities": {
        "canCreateSubtasks": false,
        "canSwitchModes": true,
        "canModifyFiles": true,
        "canExecuteCommands": true
      },
      "fileTypeRestrictions": [".ts", ".js", ".json"]
    }
  }
}
```

## Best Practices

### Orchestrator Usage

✅ **DO**:

- Use for multi-step workflows
- Break down complex tasks
- Validate at each milestone
- Keep user informed
- Use todos for tracking

❌ **DON'T**:

- Implement directly
- Skip planning for complex tasks
- Mix multiple concerns in one delegation
- Forget to update todos

### Subtask Design

✅ **DO**:

- Clear, specific prompts
- Single responsibility
- Right agent for the task
- Validation criteria

❌ **DON'T**:

- Overly broad subtasks
- Unclear success criteria
- Wrong agent capabilities
- Missing dependencies

### Parallel Execution

✅ **DO**:

- Use for independent subtasks
- Ensure git repository
- Test thoroughly
- Review changes before merging

❌ **DON'T**:

- Use for dependent tasks
- Forget to merge branches
- Run without git repo
- Ignore merge conflicts

### Rules and Workflows

✅ **DO**:

- Clear, actionable content
- Appropriate scope and priorities
- Test before deploying
- Document purpose

❌ **DON'T**:

- Overly restrictive rules
- Circular dependencies in workflows
- Forget to enable
- Skip validation

## Troubleshooting

### Orchestrator Not Delegating

**Symptoms**: Orchestrator tries to implement directly

**Solutions**:

- Check orchestrator prompt is loaded
- Verify tools are enabled (task, switch_mode)
- Ensure agents exist and are configured

### Subtasks Not Completing

**Symptoms**: Subtask hangs or doesn't return

**Solutions**:

- Check `complete_task` tool is enabled
- Verify subtask is not root session
- Check for errors in subtask execution

### Parallel Mode Failures

**Symptoms**: Worktree creation fails

**Solutions**:

- Ensure in git repository
- Check for uncommitted changes
- Verify git is installed
- Check worktree permissions

### Rules Not Loading

**Symptoms**: Rules not applied

**Solutions**:

- Check JSON syntax
- Verify file location (`.opencode/rules/`)
- Check `enabled: true`
- Review logs for errors

### Workflows Not Executing

**Symptoms**: Workflow steps skip or fail

**Solutions**:

- Verify dependencies are met
- Check agents exist
- Ensure no circular dependencies
- Validate step prompts

## API Reference

### TaskHierarchy Namespace

```typescript
// Create subtask
await TaskHierarchy.createSubtask(
  parentSessionID: string,
  agentName: string,
  title?: string
): Promise<string>

// Complete subtask
await TaskHierarchy.completeSubtask(
  sessionID: string,
  result: string
): Promise<void>

// Fail subtask
await TaskHierarchy.failSubtask(
  sessionID: string,
  error: string
): Promise<void>
```

### Rules Namespace

```typescript
// Get rules for context
await Rules.getForContext({
  agent?: string
  fileType?: string
  directory?: string
  taskType?: string
}): Promise<Rule[]>

// Build prompt from rules
await Rules.buildPrompt(context): Promise<string>
```

### Workflows Namespace

```typescript
// Get workflow
await Workflows.get(id: string): Promise<Workflow | undefined>

// Generate execution plan
await Workflows.generatePlan(workflowId: string): Promise<string>

// Get execution order
await Workflows.getExecutionOrder(workflowId: string): Promise<WorkflowStep[][]>
```

## Migration Guide

### From Previous Version

No breaking changes. All new features are additive and optional.

**To enable orchestration**:

1. Update to latest version
2. Orchestrator agent is built-in
3. Create `.opencode/rules/` for rules (optional)
4. Create `.opencode/workflows/` for workflows (optional)

### Backward Compatibility

- Existing agents work unchanged
- Task tool enhanced but compatible
- Parallel mode opt-in via `--parallel` flag
- Rules and workflows are optional

## Performance Considerations

### Subtask Overhead

Each subtask creates a new session:

- ~100ms overhead per subtask
- Session storage write
- State management

**Optimization**: Batch related operations in single subtask

### Parallel Mode

Worktree creation:

- ~500ms per worktree
- Git operations overhead
- Directory switching

**Optimization**: Use parallel mode only for truly independent work

### Rules Loading

Rules loaded once at startup:

- ~10ms per rule
- Cached for session lifetime

**Optimization**: Keep rules concise, use specific scope

## Security Considerations

### Parallel Mode

- **Isolation**: Changes isolated to worktree
- **Review**: Always review before merging
- **Permissions**: Same permissions as main workspace

### Rules

- **Validation**: Rules can enforce security constraints
- **Approval**: `requiresApproval` flag for sensitive operations
- **Scope**: Limit rules to specific agents/contexts

### Subtasks

- **Inheritance**: Subtasks inherit parent permissions
- **Isolation**: Separate sessions prevent state leakage
- **Validation**: Validate subtask results before using

## Future Enhancements

Planned features:

- UI for task hierarchy visualization
- Workflow editor
- Advanced parallel execution (multiple concurrent subtasks)
- Rule templates
- Workflow marketplace
- Performance profiling
- Enhanced error recovery

## Contributing

To extend the orchestration system:

1. **New Agents**: Add to `src/agent/agent.ts`
2. **New Tools**: Create in `src/tool/`
3. **Rules**: Add JSON files to `.opencode/rules/`
4. **Workflows**: Add JSON files to `.opencode/workflows/`
5. **Tests**: Add tests to `test/`

## Support

- **Documentation**: This file and inline code comments
- **Examples**: `.opencode/rules/` and `.opencode/workflows/`
- **Issues**: GitHub issues for bugs/features
- **Community**: Discord for questions

## References

- [AGENTS.md](AGENTS.md) - Agent system overview
- [PARALLEL_MODE.md](PARALLEL_MODE.md) - Parallel execution details
- [.opencode/rules/README.md](.opencode/rules/README.md) - Rules system guide
- [.opencode/workflows/README.md](.opencode/workflows/README.md) - Workflows guide
- [Kilo Code](https://kilo.foundation) - Original orchestration inspiration
