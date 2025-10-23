# Autonomous Workflow System - Usage Guide

## Overview

The autonomous workflow system enables you to provide a Product Requirements Document (PRD) and have specialized AI agents automatically plan, implement, test, and deploy your feature through a structured, state-machine-enforced workflow.

## The Problem That Was Fixed

**Previous Issue:** Workflows were created successfully but never actually executed. They stayed in "running" status with 0 tasks completed, stuck in the planning phase.

**Root Cause:** The orchestrator created workflows and tasks, but there was no execution engine to actually run the tasks through agents.

**Solution:** Implemented a new `Executor` module with a continuous execution loop that:
- Picks up pending tasks
- Assigns them to specialized agents
- Executes tasks with full context
- Marks tasks as complete
- Auto-progresses through stages

## Quick Start

### 1. Create a Workflow

```bash
# From PRD text
opencode workflow create --prd "Build a REST API for user authentication with JWT tokens"

# From PRD file
opencode workflow create --prd path/to/prd.md --workspace /path/to/repo
```

This will:
- Parse your PRD using TaskMaster AI
- Break it down into structured tasks
- Assign tasks to workflow stages (planning → coding → testing → deployment)
- Create a workflow instance with a unique ID
- Output the workflow ID for execution

Example output:
```
✓ Workflow created successfully!

Workflow: Add User Authentication API
ID: 01K87ZZF5SYRYVFVV0G8Z7MMKH
Status: running
Current Stage: planning

Task Breakdown:
  planning: 3 tasks
  coding: 5 tasks
  testing: 4 tasks
  deployment: 3 tasks

Use 'opencode workflow status 01K87ZZF5SYRYVFVV0G8Z7MMKH' to check progress
Use 'opencode workflow run 01K87ZZF5SYRYVFVV0G8Z7MMKH' to start execution
```

### 2. Check Workflow Status

```bash
opencode workflow status 01K87ZZF5SYRYVFVV0G8Z7MMKH
```

Output shows:
- Current workflow stage
- Tasks completed in each stage
- Overall progress
- Task details

### 3. Execute the Workflow (NEW!)

**This is the key command that was missing before:**

```bash
opencode workflow run 01K87ZZF5SYRYVFVV0G8Z7MMKH
```

This starts the continuous execution loop that:
1. **Picks up pending tasks** in the current stage
2. **Checks dependencies** are satisfied
3. **Assigns task to appropriate agent** (Planning, Coding, Testing, or Deployment)
4. **Executes task** with full workflow context
5. **Records results** and marks task complete
6. **Auto-progresses** to next stage when current stage is complete
7. **Repeats** until workflow is fully complete

### 4. Monitor Progress

While the workflow runs, you can check status in another terminal:

```bash
# Check overall status
opencode workflow status 01K87ZZF5SYRYVFVV0G8Z7MMKH

# View specific task details
opencode workflow tasks 01K87ZZF5SYRYVFVV0G8Z7MMKH

# View workflow metrics
opencode workflow metrics 01K87ZZF5SYRYVFVV0G8Z7MMKH
```

### 5. Pause/Resume Workflow

```bash
# Pause execution
opencode workflow pause 01K87ZZF5SYRYVFVV0G8Z7MMKH

# Resume execution
opencode workflow resume 01K87ZZF5SYRYVFVV0G8Z7MMKH
```

## Workflow Stages

The workflow progresses through four enforced stages:

### 1. Planning Stage
**Agent:** Planning Agent (read-only)

**Responsibilities:**
- Analyze the PRD thoroughly
- Research existing codebase patterns
- Identify dependencies and risks
- Create detailed implementation plans
- Document file changes needed

**Example Tasks:**
- "Research authentication patterns in codebase"
- "Design database schema for users table"
- "Create API endpoint specifications"

### 2. Coding Stage
**Agent:** Coding Agent (full permissions)

**Responsibilities:**
- Implement features per the plan
- Write clean, maintainable code
- Follow project conventions
- Make incremental commits
- Add documentation and comments

**Example Tasks:**
- "Implement User model with Prisma"
- "Create POST /auth/login endpoint"
- "Add JWT token generation utility"

### 3. Testing Stage
**Agent:** Testing Agent (test execution + minor fixes)

**Responsibilities:**
- Run all relevant tests
- Verify functionality
- Check code coverage
- Report failures with diagnostics
- Suggest or make minor fixes

**Example Tasks:**
- "Run unit tests for auth module"
- "Test JWT token expiration handling"
- "Verify API endpoint security"

### 4. Deployment Stage
**Agent:** Deployment Agent (approval required)

**Responsibilities:**
- Build deployment artifacts
- Verify deployment configuration
- Execute deployment (with approval)
- Monitor deployment success
- Handle rollbacks if needed

**Example Tasks:**
- "Build production Docker image"
- "Deploy to staging environment"
- "Run smoke tests on production"

## How Task Execution Works

### Before (The Problem)

```
User creates workflow
└─> Tasks created but never executed
    └─> Workflow stuck in "running" state forever
        └─> 0 tasks completed
```

### After (The Solution)

```
User creates workflow
└─> User runs: opencode workflow run <id>
    └─> Executor.runWorkflow() starts
        ├─> Loop through stages
        │   ├─> Find pending tasks in current stage
        │   ├─> Check dependencies are met
        │   ├─> Execute task with specialized agent
        │   │   ├─> Build context prompt
        │   │   ├─> Include PRD, task details, files to modify
        │   │   ├─> Run AI model with agent prompt
        │   │   └─> Collect results
        │   ├─> Mark task as completed
        │   └─> Record metrics
        └─> Progress to next stage when complete
            └─> Repeat until workflow completes
```

## Architecture Deep Dive

### Components

1. **TaskMaster AI** (`taskmaster.ts`)
   - Parses PRD into structured tasks
   - Validates task dependencies
   - Optimizes task execution order

2. **Orchestrator** (`orchestrator.ts`)
   - Manages workflow lifecycle
   - Enforces state machine rules
   - Tracks task status
   - Handles stage progression

3. **Executor** (`executor.ts`) **← NEW!**
   - Executes tasks through agents
   - Builds context-rich prompts
   - Manages execution loop
   - Records completion status

4. **Workspace** (`workspace.ts`)
   - Multi-repository management
   - Directory structure tracking
   - Configuration persistence

5. **Agents** (`agents.ts`)
   - Specialized agent configurations
   - Permission definitions
   - Stage-specific prompts

6. **Metrics** (`metrics.ts`)
   - Performance tracking
   - Task completion statistics
   - Error recording

7. **Heuristics** (`heuristics.ts`)
   - Pattern detection
   - Bottleneck identification
   - Failure analysis

8. **Self-Healing** (`self-healing.ts`)
   - Dynamic prompt adaptation
   - Automatic optimization
   - Performance improvement

## Task Execution Flow

```
┌─────────────────────────────────────────────────────────┐
│ Executor.runWorkflow(workflowID)                        │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ While workflow status == "running"                      │
│   ├─> Get workflow state                                │
│   ├─> Get pending tasks in current stage               │
│   └─> For each task:                                    │
│       ├─> Check dependencies met?                       │
│       │   └─> No: Skip task                             │
│       └─> Yes: Execute task                             │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Executor.executeTask(workflowID, taskID)               │
│   ├─> Get agent for task's stage                       │
│   ├─> Start task (mark as "in_progress")               │
│   ├─> Get AI model (from config or default)            │
│   ├─> Build task prompt:                                │
│   │   ├─> Agent system prompt                           │
│   │   ├─> Workflow context (PRD, title, description)   │
│   │   ├─> Task details (title, description, files)     │
│   │   ├─> Dependencies info                             │
│   │   └─> Stage-specific guidance                       │
│   ├─> Execute: generateText(model, prompt)             │
│   ├─> Collect results                                   │
│   └─> Mark task completed/failed                        │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Check if stage complete                                  │
│   └─> All tasks completed/skipped?                      │
│       └─> Yes: Orchestrator.progressStage()             │
│           ├─> Update workflow stage                      │
│           ├─> Publish stage_completed event             │
│           └─> Publish stage_started event               │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Continue to next stage or complete workflow             │
└─────────────────────────────────────────────────────────┘
```

## Example Usage Scenarios

### Scenario 1: Simple Feature Addition

```bash
# 1. Create workflow
opencode workflow create --prd "Add dark mode toggle to settings page"

# Output: Workflow ID: 01K87ABC123XYZ

# 2. Run workflow
opencode workflow run 01K87ABC123XYZ

# 3. Monitor in another terminal
watch -n 2 'opencode workflow status 01K87ABC123XYZ'
```

### Scenario 2: Complex Multi-Service Feature

```bash
# 1. Create workspace with multiple repos
opencode workflow create \
  --prd prd/new-payment-gateway.md \
  --workspace ~/projects/microservices

# 2. Check the breakdown before running
opencode workflow status 01K87DEF456UVW

# 3. Start execution
opencode workflow run 01K87DEF456UVW

# 4. Pause if needed
opencode workflow pause 01K87DEF456UVW

# 5. Resume when ready
opencode workflow resume 01K87DEF456UVW
```

### Scenario 3: Monitoring and Metrics

```bash
# Create and run workflow
ID=$(opencode workflow create --prd "..." | grep "ID:" | cut -d' ' -f2)
opencode workflow run $ID &

# Monitor live
while true; do
  clear
  opencode workflow status $ID
  opencode workflow metrics $ID
  sleep 5
done
```

## Configuration

### Agent Configuration

You can customize agent behavior in `.opencode/config.json`:

```json
{
  "agent": {
    "planning": {
      "temperature": 0.3,
      "model": "anthropic:claude-sonnet-4"
    },
    "coding": {
      "temperature": 0.5,
      "model": "anthropic:claude-sonnet-4"
    },
    "testing": {
      "temperature": 0.2,
      "model": "anthropic:claude-sonnet-4"
    },
    "deployment": {
      "temperature": 0.1,
      "model": "anthropic:claude-sonnet-4"
    }
  }
}
```

### Workflow Configuration

Pass custom config when creating workflows:

```typescript
const workflow = await Orchestrator.startWorkflow({
  workspaceID: "...",
  prd: "...",
  config: {
    autoProgress: false,        // Require manual stage progression
    retryOnFailure: true,        // Retry failed tasks
    maxRetries: 3,               // Max retry attempts
    stageTimeouts: {
      planning: 30 * 60 * 1000,  // 30 min
      coding: 120 * 60 * 1000,   // 2 hours
      testing: 60 * 60 * 1000,   // 1 hour
      deployment: 30 * 60 * 1000 // 30 min
    },
    approvalRequired: ["deployment"] // Stages requiring approval
  }
})
```

## Troubleshooting

### Workflow Stuck in Planning

**Before the fix:** This was the primary issue - workflows never progressed.

**After the fix:** If a workflow is still stuck:

1. Check if you ran the execution command:
   ```bash
   opencode workflow run <workflow-id>
   ```

2. Check task status:
   ```bash
   opencode workflow tasks <workflow-id>
   ```

3. Check for failed tasks:
   ```bash
   opencode workflow status <workflow-id>
   ```

### Task Failing Repeatedly

Check the task details and error messages:

```bash
opencode workflow tasks <workflow-id>
```

Options:
- Pause workflow and fix manually
- Skip the problematic task
- Adjust agent configuration
- Check logs for detailed error info

### Want to Run Tasks Manually

You can still use OpenCode's interactive mode for specific tasks:

```bash
# Use standard OpenCode for manual control
opencode

# Or use in plan mode
opencode --plan
```

## Advanced Features

### Self-Healing

The system automatically learns from failures:

```typescript
// Heuristics detect patterns
const patterns = await Heuristics.detectFailurePatterns(workflowID)

// Self-healing adapts prompts
const adaptations = await SelfHealing.generateAdaptations(workflowID, patterns)

// Adaptations auto-apply on next workflow
```

### Metrics and Analytics

```bash
# View comprehensive metrics
opencode workflow metrics <workflow-id>

# Export metrics for analysis
opencode workflow metrics <workflow-id> --export metrics.json
```

### Custom Agents

Define custom agents in config:

```json
{
  "agent": {
    "security-audit": {
      "mode": "primary",
      "temperature": 0.2,
      "prompt": "You are a security auditor...",
      "permission": {
        "edit": "deny",
        "bash": { "*": "deny" }
      }
    }
  }
}
```

## Next Steps

1. **Try it out:**
   ```bash
   opencode workflow create --prd "Your PRD here"
   opencode workflow run <workflow-id>
   ```

2. **Monitor progress:**
   ```bash
   opencode workflow status <workflow-id>
   ```

3. **Explore metrics:**
   ```bash
   opencode workflow metrics <workflow-id>
   ```

4. **Customize agents:**
   Edit `.opencode/config.json` to tune agent behavior

5. **Report issues:**
   If you encounter problems, check logs and file issues with:
   - Workflow ID
   - Task details
   - Error messages
   - Expected vs actual behavior

## Summary

The autonomous workflow system now has a complete execution engine:

✅ **Creates** workflows from PRDs
✅ **Parses** requirements into structured tasks
✅ **Executes** tasks through specialized agents
✅ **Progresses** through stages automatically
✅ **Monitors** progress and metrics
✅ **Adapts** based on failures
✅ **Completes** workflows end-to-end

The key missing piece was the `Executor` module and the `workflow run` command, which now bridge the gap between workflow creation and actual task execution.
