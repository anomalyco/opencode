# Reminders architecture

Structured background scheduling system implementation for opencode

---

## Overview

The Reminders system adds three core tools (`reminderadd`, `reminderlist`, `reminderremove`) that enable agents to schedule delayed or recurring message executions within sessions. The architecture leverages opencode's existing storage, state management, session messaging, and tool systems.

---

## Core components

### Reminder namespace

**Location**: `src/reminder/reminder.ts`

```typescript
export namespace Reminder {
  export const Info = z
    .object({
      id: z.string(),
      sessionID: z.string(),
      projectID: z.string(),
      type: z.enum(["one-time", "recurring"]),
      interval: z.number(), // milliseconds
      originalPrompt: z.string(), // resolved action to execute
      userDescription: z.string(), // human-readable description
      time: z.object({
        created: z.number(),
        nextExecution: z.number(),
        lastExecution: z.number().optional(),
      }),
      status: z.enum(["active", "paused", "cancelled"]),
    })
    .meta({ ref: "Reminder" })

  export type Info = z.infer<typeof Info>

  export const Event = {
    Created: Bus.event("reminder.created", z.object({ info: Info })),
    Executed: Bus.event("reminder.executed", z.object({ info: Info })),
    Cancelled: Bus.event("reminder.cancelled", z.object({ info: Info })),
  }
}
```

---

## Timer management

### ReminderManager namespace

**Location**: `src/reminder/manager.ts`

```typescript
export namespace ReminderManager {
  const log = Log.create({ service: "reminder.manager" })

  // Project-scoped state using existing Instance.state pattern
  const state = Instance.state(
    () => ({
      reminders: new Map<string, Reminder.Info>(),
      timers: new Map<string, NodeJS.Timeout>(),
    }),
    async (state) => {
      // Cleanup all timers on disposal
      for (const timer of state.timers.values()) {
        clearTimeout(timer)
      }
    },
  )

  export function init() {
    log.info("init")

    // Subscribe to session deletion events for cleanup
    Bus.subscribe(Session.Event.Deleted, async ({ properties }) => {
      await cleanupSession(properties.info.id)
    })

    // Initialize reminders from storage asynchronously
    Storage.list(["reminder", Instance.project.id])
      .then(async (reminderKeys) => {
        // ... restore reminders from storage
      })
      .catch((error) => {
        log.warn("failed to initialize reminders", { error })
      })
  }

  export async function schedule(reminder: Reminder.Info): Promise<void>
  export async function cancel(reminderID: string): Promise<boolean>
  export async function list(sessionID?: string): Promise<Reminder.Info[]>
  export async function execute(reminderID: string): Promise<void>
  export async function cleanupSession(sessionID: string): Promise<void>
}
```

**Key implementation details:**

1. **Initialization Pattern**: Follows opencode's standard `init()` pattern - synchronous function that kicks off async work
2. **Timer Creation**: Uses Node.js `setTimeout()` for scheduling
3. **State Persistence**: Stores reminders via `Storage.write(["reminder", projectID, reminderID], reminder)`
4. **Memory Management**: Maintains timer references in project state for cleanup
5. **Session Binding**: Reminders are scoped to sessions and cleaned up on session deletion
6. **Logging**: Uses standard `Log.create()` pattern for consistent logging
7. **Event Subscription**: Bus subscriptions done in `init()` following Format system pattern

---

## Storage integration

**Storage keys**: `["reminder", projectID, reminderID]`

**Persistence strategy**:

- Write reminder info to storage immediately upon creation
- Update storage on status changes (active → cancelled)
- Remove from storage on cancellation
- Load active reminders on project initialization

**Cleanup hooks**:

- Subscribe to `Session.Event.Deleted` in `init()` → cancel all reminders for deleted session
- Integrate with `Instance.state()` dispose function → clear all timers and cleanup

---

## Message execution system

### Timer execution flow

When a reminder timer fires:

```typescript
async function executeReminder(reminderID: string) {
  const reminder = await Storage.read<Reminder.Info>(["reminder", projectID, reminderID])

  // Post reminder message as agent message to originating session
  await SessionPrompt.prompt({
    sessionID: reminder.sessionID,
    messageID: Identifier.ascending("message"),
    parts: [
      {
        id: Identifier.ascending("part"),
        type: "text",
        text: reminder.originalPrompt,
      },
    ],
  })

  // Update execution tracking
  reminder.time.lastExecution = Date.now()

  if (reminder.type === "recurring") {
    // Schedule next execution
    reminder.time.nextExecution = Date.now() + reminder.interval
    scheduleTimer(reminder)
  } else {
    // Remove one-time reminder
    await cancel(reminder.id)
  }

  Bus.publish(Reminder.Event.Executed, { info: reminder })
}
```

**Message attribution**: Reminder-triggered messages appear as agent messages in the session (not system messages), preserving conversation context.

**Queue integration**: Uses existing session message queuing - no special handling required.

---

### Tool implementation

### Location

**File**: `src/tool/reminderadd.ts`, `src/tool/reminderlist.ts`, `src/tool/reminderremove.ts`

### Tool definitions

```typescript
export const ReminderAddTool = Tool.define("reminderadd", {
  description:
    "Set up a reminder that will make me re-execute an action later. Use when user asks to 'remind me to...' or 'check X every Y time'. I'll actually perform the action when reminded, not just notify.",
  parameters: z.object({
    interval_seconds: z.number().min(30),
    type: z.enum(["one-time", "recurring"]),
    action_prompt: z.string().describe("Fully resolved action with absolute paths and specific identifiers"),
    description: z.string().describe("Human-readable description for identification"),
  }),
  execute: async (args, ctx) => {
    const config = await Config.get()
    const maxReminders = config.reminders?.max_reminders_per_project ?? 50

    const existing = await ReminderManager.list(ctx.sessionID)
    if (existing.length >= maxReminders) {
      return {
        title: "Reminder limit reached",
        output: `Can't set more reminders, too many reminders already active (${existing.length}/${maxReminders}). Current reminders:\n${existing.map((r) => `- ${r.userDescription}`).join("\n")}`,
        metadata: {},
      }
    }

    const reminder: Reminder.Info = {
      id: Identifier.ascending("reminder"),
      sessionID: ctx.sessionID,
      projectID: Instance.project.id,
      type: args.type,
      interval: args.interval_seconds * 1000,
      originalPrompt: args.action_prompt,
      userDescription: args.description,
      time: {
        created: Date.now(),
        nextExecution: Date.now() + args.interval_seconds * 1000,
      },
      status: "active",
    }

    await ReminderManager.schedule(reminder)

    return {
      title: "Reminder set",
      output: `Reminder set: ${args.description} (${args.type === "one-time" ? "in" : "every"} ${args.interval_seconds} seconds)`,
      metadata: { reminderID: reminder.id },
    }
  },
})

export const ReminderListTool = Tool.define("reminderlist", {
  description:
    "List all active reminders in this session. Use when user asks 'what reminders do I have' or wants to see scheduled actions.",
  parameters: z.object({}),
  execute: async (args, ctx) => {
    const reminders = await ReminderManager.list(ctx.sessionID)

    if (reminders.length === 0) {
      return {
        title: "No active reminders",
        output: "No active reminders in this session.",
        metadata: {},
      }
    }

    const output = reminders
      .map((r) => {
        const nextIn = Math.round((r.time.nextExecution - Date.now()) / 1000)
        const nextText = nextIn > 0 ? `in ${nextIn}s` : "overdue"
        return `- ${r.userDescription} (${r.type}, next execution ${nextText})`
      })
      .join("\n")

    return {
      title: `${reminders.length} active reminders`,
      output: `Active reminders:\n${output}`,
      metadata: { count: reminders.length },
    }
  },
})

export const ReminderRemoveTool = Tool.define("reminderremove", {
  description:
    "Cancel a scheduled reminder. Use when user asks to 'stop checking X' or 'cancel the reminder for Y'. Will attempt to match user's description to existing reminders.",
  parameters: z.object({
    description_pattern: z.string().describe("What the user wants to stop (will match against reminder descriptions)"),
  }),
  execute: async (args, ctx) => {
    const reminders = await ReminderManager.list(ctx.sessionID)
    const pattern = args.description_pattern.toLowerCase()

    const matches = reminders.filter(
      (r) => r.userDescription.toLowerCase().includes(pattern) || r.originalPrompt.toLowerCase().includes(pattern),
    )

    if (matches.length === 0) {
      return {
        title: "No matching reminder found",
        output: `No matching reminder found for "${args.description_pattern}". Active reminders:\n${reminders.map((r) => `- ${r.userDescription}`).join("\n") || "None"}`,
        metadata: {},
      }
    }

    if (matches.length > 1) {
      return {
        title: "Multiple matches found",
        output: `Multiple reminders match "${args.description_pattern}":\n${matches.map((r) => `- ${r.userDescription}`).join("\n")}\nPlease be more specific.`,
        metadata: { matches: matches.length },
      }
    }

    const reminder = matches[0]
    await ReminderManager.cancel(reminder.id)

    return {
      title: "Reminder cancelled",
      output: `Reminder cancelled: ${reminder.userDescription}`,
      metadata: { reminderID: reminder.id },
    }
  },
})
```

### Tool registration

**File**: `src/tool/registry.ts`

Add to `BUILTIN` array:

```typescript
const BUILTIN = [
  // ... existing tools
  ReminderAddTool,
  ReminderListTool,
  ReminderRemoveTool,
]
```

---

## Configuration system

### Schema extension

**File**: `src/config/config.ts`

Extend `Config.Info` schema:

```typescript
reminders: z.object({
  enabled: z.boolean().default(true).describe("Enable reminder functionality"),
  max_reminders_per_project: z.number().default(50).describe("Maximum active reminders per project"),
  min_interval_seconds: z.number().default(30).describe("Minimum interval between reminder executions"),
}).optional()
```

**Configuration precedence**:

1. Default values (enabled: true, max: 50, min: 30)
2. Global config (`~/.config/opencode/config.json`)
3. Project config (`opencode.json` in project)
4. Runtime flags (`--disable-reminders`)

### Tool Availability Control

**Location**: `src/tool/registry.ts`

Tool availability is controlled via the `ToolRegistry.enabled()` function, following the same pattern as permission-based tool filtering:

```typescript
export async function enabled(
  _providerID: string,
  _modelID: string,
  agent: Agent.Info,
): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {}

  // Existing permission checks...

  // Reminder configuration control
  const config = await Config.get()
  if (config.reminders?.enabled === false) {
  result["reminderadd"] = false
  result["reminderlist"] = false
  result["reminderremove"] = false
  }

  return result
}
```

**Behavior when disabled:**

- Tools are filtered out before agent sees them
- No runtime config checks needed in tool execution
- Follows identical pattern to edit/bash/webfetch permission filtering

---

## Session lifecycle integration

### System initialization

**Location**: `src/project/bootstrap.ts`

ReminderManager follows the standard opencode system initialization pattern:

```typescript
export async function InstanceBootstrap() {
  await Plugin.init()
  Share.init()
  Format.init()
  LSP.init()
  Snapshot.init()
  FileWatcher.init()
  ReminderManager.init() // Added to bootstrap
}
```

### Event subscriptions

```typescript
export function init() {
  log.info("init")

  // Subscribe to session deletion events for cleanup
  Bus.subscribe(Session.Event.Deleted, async ({ properties }) => {
    await cleanupSession(properties.info.id)
  })

  // Check configuration before timer restoration
  Storage.list(["reminder", Instance.project.id])
    .then(async (reminderKeys) => {
      const config = await Config.get()
      if (config.reminders?.enabled === false) {
        log.info("reminders disabled in config, preserving storage but not restoring timers")
        log.info("found stored reminders while disabled", { count: reminderKeys.length })
        return
      }

      // ... existing restoration logic only runs when enabled
    })
    .catch(/* handle errors */)
}
```

### Permission inheritance

**Simplified permission handling** - reminders execute with the agent permissions from their originating session:

- Tool access rights preserved from originating session
- **Current session check**: Permission requests only shown if session is currently active (not busy/pending)
- **Non-current session behavior**: If session is not current and permission is needed:
  - Permission requests are treated as "deny" (not shown to user)
  - Agent posts an error message to the session explaining what went wrong
  - One-time reminders: cancelled and removed
  - Recurring reminders: current execution cancelled but reminder continues to reschedule for future attempts
- **Session activity check**: Uses `SessionPrompt.isBusy(sessionID)` to determine if session is current
- **User feedback**: When user later opens the session, they see the agent's explanation of why the reminder failed

### Error handling

**Timer execution errors**:

- Log errors via existing `Log.create()` system
- Post error message to originating session explaining what failed
- **Permission failures in non-current sessions**: Agent posts explanatory message like "I couldn't check the logs because this session wasn't active when the reminder triggered and I need bash permission. The reminder will try again later."
- Cancel reminder if execution repeatedly fails

**Resource cleanup**:

- All timers cleared on `Instance.dispose()`
- Storage cleaned up on session deletion
- No memory leaks from orphaned timers

---

## Architecture consistency patterns

**ReminderManager follows opencode's standard system patterns:**

1. **Initialization**: Synchronous `init()` function called from `InstanceBootstrap`
2. **Async work**: Kicked off in `init()` using `.then()/.catch()`, not awaited
3. **State management**: Uses `Instance.state()` with dispose function for cleanup
4. **Logging**: Standard `Log.create({ service: "reminder.manager" })` pattern
5. **Event handling**: Bus subscriptions set up in `init()` function
6. **Namespace structure**: `export namespace ReminderManager` with public API functions
7. **Storage integration**: Uses existing `Storage.read/write/delete` with consistent key patterns

## Configuration Control and Restart Behavior

### Enabled/Disabled State Management

When `config.reminders.enabled` is `false`:

**Tool Behavior:**

- Tools are filtered out via `ToolRegistry.enabled()` before agent sees them
- Uses identical pattern to permission-based tool control (edit/bash/webfetch)
- No runtime config checks needed in tool execution

**Manager Initialization:**

```typescript
export function init() {
  log.info("init")

  Bus.subscribe(Session.Event.Deleted, async ({ properties }) => {
    await cleanupSession(properties.info.id)
  })

  // Check configuration before timer restoration
  Storage.list(["reminder", Instance.project.id])
    .then(async (reminderKeys) => {
      const config = await Config.get()
      if (config.reminders?.enabled === false) {
        log.info("reminders disabled in config, preserving storage but not restoring timers")
        log.info("found stored reminders while disabled", { count: reminderKeys.length })
        return
      }

      // ... existing restoration logic only runs when enabled
    })
    .catch((error) => {
      log.warn("failed to check reminder config", { error })
    })
}
```

### Restart Behavior Specification

**Data Preservation Strategy:**

- When reminders are disabled, storage data is preserved but not acted upon
- Timer scheduling is completely skipped during initialization
- Re-enabling reminders restores all previously saved reminder configurations

**Implementation Guarantees:**

1. **No Data Loss**: Disabling reminders never deletes stored reminder data
2. **Clean Shutdown**: All active timers are cleared when feature is disabled
3. **Graceful Restoration**: Re-enabling immediately restores all saved reminders
4. **Session Isolation**: Session cleanup continues regardless of enabled state

## Implementation decisions

1. **Timer persistence across restarts**: ✅ **IMPLEMENTED** - Reminders persist in storage and are restored on startup with 1-hour grace period
2. **Permission handling**: ✅ **RESOLVED** - Simplified to current-session-only permission requests
3. **Agent context**: Uses originating session's agent context (preserved through SessionPrompt.prompt)
4. **Error handling**: Cancels reminders on repeated failures, logs via standard Log system
5. **Concurrent execution**: Uses existing session message queuing - no special handling needed
6. **Tool availability control**: ✅ **IMPLEMENTED** - Uses registration filtering pattern following opencode standards
