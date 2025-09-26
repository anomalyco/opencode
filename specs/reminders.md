# Reminders

A background scheduling system for opencode that allows agents to set up delayed or recurring reminders to re-execute actions.

---

## Overview

The Reminders system provides three core functions:

- `add_reminder()` - Schedule a future reminder
- `list_reminders()` - View active reminders
- `remove_reminder()` - Cancel scheduled reminders

---

## Use cases

### Delayed file monitoring

```
"Wait for 5 min and check this file again for instructions"
```

Creates a one-time timer that triggers after 5 minutes and executes the action "Review and decide what to do with /workspace/last-login.log".

### Regular website monitoring

```
"Check this website regularly and let me know when it has new information"
```

Sets up a recurring timer (default 1 minute interval) that fetches http://google.com?q=Helsinki-News and compares content for changes.

### Email auto-reply

```
"Check my email every hour and reply that I'm busy"
```

Creates a recurring 1-hour timer that checks email and sends automated responses using whatever email tools are available.

### List active reminders

```
"Show me what I'm waiting for"
```

Returns all active reminders with their timers and descriptions.

### Cancel reminders

```
"Stop checking my email"
```

Identifies and removes matching reminders based on description.

---

## Architecture

### Core components

#### Reminder namespace

```typescript
export namespace Reminder {
  export interface Info {
    id: string
    sessionID: string
    projectID: string
    type: "one-time" | "recurring"
    interval: number // milliseconds

    // Tool-agnostic: store resolved user intent with concrete details
    originalPrompt: string // "check /workspace/logs/app.log for new errors"
    userDescription: string // "Email auto-reply reminder"

    time: {
      created: number
      nextExecution: number
      lastExecution?: number
    }
    status: "active" | "paused" | "cancelled"
  }
}
```

#### Reminder manager

```typescript
export namespace ReminderManager {
  function schedule(reminder: Reminder.Info): void
  function cancel(reminderID: string): void
  function list(sessionID?: string): Reminder.Info[]
  function execute(reminderID: string): Promise<void>
}
```

### Integration points

#### Reminder tools

Three tools that agents can discover and use autonomously:

**`add_reminder`**

- Description: "Set up a reminder that will make me re-execute an action later. Use when user asks to 'remind me to...' or 'check X every Y time'. I'll actually perform the action when reminded, not just notify."
- Parameters: `interval_seconds`, `type` (one-time/recurring), `action_prompt`, `description`
- **Critical**: `action_prompt` must contain fully resolved information (absolute paths, specific names, concrete data) since context may change over time
- Success: Returns confirmation like "Reminder set: I'll check your email in 1 hour" or "Reminder set: I'll monitor the log file every 5 minutes"
- Error: When limit reached, returns "Can't set more reminders, too many reminders already active." along with list of current reminders, suggesting user choose which to remove first

**`list_reminders`**

- Description: "List all active reminders in this session. Use when user asks 'what reminders do I have' or wants to see scheduled actions."
- Returns: Array of active reminders with descriptions and next execution times

**`remove_reminder`**

- Description: "Cancel a scheduled reminder. Use when user asks to 'stop checking X' or 'cancel the reminder for Y'. Will attempt to match user's description to existing reminders."
- Parameters: `description_pattern` - What the user wants to stop
- Success: Returns confirmation like "Reminder cancelled: No longer checking your email every hour" or "Reminder removed: Stopped monitoring log file"
- Error: Returns "No matching reminder found" if pattern doesn't match any active reminders

#### Storage integration

Reminders are stored in memory only during session execution. No persistent storage - reminders are removed when:

- Session is deleted
- Application exits
- Session becomes inactive (implementation dependent)

#### Session integration

Reminders are **session-scoped**: they exist only while their session exists. When a session is deleted, all reminders belonging to that session are automatically removed.

---

## Implementation approach

### Reminder scheduling

Use Node.js `setTimeout` and `setInterval` for timing. Store active timers in project state for cleanup.

### Timer execution and queuing

When a timer fires:

1. **Message posting**: System posts the stored `originalPrompt` as if the **agent** (who set the timer) sent it
2. **Queue handling**: If previous timer message is still being processed, new messages queue up normally
3. **Session state**: Messages accumulate in inactive sessions - user sees them when opening the session
4. **Normal processing**: Agent processes queued messages in order with full context and tool access
5. **Cancellation**: User can cancel/interrupt queued messages using standard session controls

### Agent decision making

Agents decide when to use reminders based on user language patterns:

- "wait 5 minutes then..." → `add_reminder` with one-time timer
- "check every hour..." → `add_reminder` with recurring timer
- "what am I waiting for?" → `list_reminders`
- "stop checking my email" → `remove_reminder`

### Default configuration analysis

**Current approach: Disabled by default**

**Pros of disabled by default:**

- **Resource safety**: Prevents accidental timer proliferation
- **User control**: Explicit opt-in ensures users understand the feature
- **Server-friendly**: Default installations don't consume background resources
- **Enterprise safety**: Organizations can evaluate before allowing

**Cons of disabled by default:**

- **Discovery friction**: Users might never find this powerful feature
- **Extra setup step**: Requires configuration before use
- **Reduces adoption**: Features enabled by default get more usage
- **Demo limitations**: Showcasing opencode requires extra setup

**Recommendation: Enable by default**
Natural AI assistant behavior where "remind me..." works out of the box, with easy disable options.

```typescript
{
  "reminders": {
    "enabled": true,  // Default: enabled for natural user experience
    "max_reminders_per_project": 50,
    "min_interval_seconds": 30
  }
}
```

**Disable options:**

- **Config**: Set `"enabled": false` in configuration
- **Command line**: Use `--disable-reminders` flag for single sessions
- **Protection**: Prevents accidental reminders for users preferring single-shot actions

---

## Execution context

### Session binding

Reminders execute in their originating session context, preserving:

- Agent configuration and permissions
- Conversation history and context
- Tool access rights and user-granted permissions

### Message attribution

Reminder messages appear as **agent messages** in the originating session (posted on behalf of the agent who set the timer), not system messages.

### Interactive permissions

When reminders need user permissions (e.g., bash tool access):

- **Current session only**: Permission requests are only shown if the session is currently active
- **Non-current sessions**: If a reminder requires permission while session is inactive, the reminder is automatically cancelled and removed
- **Simple handling**: No session blocking, queuing, or complex state management
- **Recurring reminders**: Will continue to be rescheduled if recurring, even if individual executions are cancelled due to permissions

### Background notifications

When reminders trigger in inactive sessions:

- Toast notification appears: "Reminder triggered in [Session Name]"
- Session displays red dot (●) indicator in session list
- Red dot changes to black (●) when session becomes active
- Notification state clears when session is opened

---

## Error handling

### Failed executions

Errors during reminder execution are logged and posted as error messages to the originating session.

### Resource management

- **Session lifecycle**: Reminders exist ONLY while their session is alive
  - Session deleted → All reminders for that session automatically removed
  - Application exit → All reminders lost (no persistence)
- **Reminder limit**: Maximum `max_reminders_per_project` active reminders per session (configurable, default 50)
  - When limit reached, tool returns error with current reminder list for user to choose what to stop
- **Minimum intervals**: `min_interval_seconds` minimum (configurable, default 30 seconds, not enforced as overload protection)
- **Message queuing**: Multiple timer messages queue naturally in session message flow
- **User control**: Standard session interrupt/cancel works on timer-triggered messages

---

## User interface

### Natural language parsing

The system should parse natural language requests like:

- "in 5 minutes do X" → one-time, 5min delay
- "every hour do Y" → recurring, 1hr interval
- "regularly check Z" → recurring, 1min default interval

### Reminder descriptions

Auto-generate human-readable descriptions for easy identification during listing and removal.

### Status reporting

Show time until next execution, total runs, and last execution status.

---

## Security considerations

### Permission inheritance

Reminders inherit the agent permissions from their originating session.

### Resource isolation

Each reminder execution runs in an isolated context to prevent interference.

### Sensitive data

Avoid storing sensitive information (passwords, tokens) in reminder context.

---

## Example workflow

### User Request

```
User: "Wait for 5 minutes and check this file again for instructions"
```

### Agent Response

Agent recognizes the pattern and calls:

```typescript
add_reminder({
  interval_seconds: 300,
  type: "one-time",
  action_prompt: "check /workspace/last-login.log file again for instructions",
  description: "Check file for instructions in 5 minutes",
})
```

### Timer Execution

After 5 minutes, system posts to session:

```
Agent: check /workspace/last-login.log file again for instructions
```

Agent processes this self-posted message normally, likely using `read` tool to check the file, then provides analysis.

### Critical: Prompt resolution

**Agents must resolve ambiguous references when creating reminders:**

❌ **Bad**: `"check this file again"`
✅ **Good**: `"check /workspace/last-login.log again"`

❌ **Bad**: `"reply to that email"`
✅ **Good**: `"reply to email ID msg_12345 from john@company.com"`

❌ **Bad**: `"check the latest build"`
✅ **Good**: `"check build status for commit a1b2c3d in main branch"`

**Use unique identifiers when possible:**

- Email IDs: `"reply to email ID msg_12345"` (not just sender/subject which may have duplicates)
- File versions: `"check file /workspace/log.txt modified at 2024-01-15 14:30"`
- Database records: `"update user record ID 789"`
- Git commits: `"review commit a1b2c3d"` (not "latest commit")

**Why this matters**: After time passes, "this", "that", "latest" may refer to completely different things. Unique IDs ensure reminders target the exact intended item even when multiple similar items exist.

### Tool-Agnostic Email Example

```
User: "Check my email every hour and reply that I'm busy"
```

Agent calls:

```typescript
add_reminder({
  interval_seconds: 3600,
  type: "recurring",
  action_prompt: "Check my email and reply that I'm busy",
  description: "Email auto-reply checker",
})
```

When timer fires hourly, system posts:

```
Agent: Check my email and reply that I'm busy
```

Agent decides to use available email tools (e.g., MCP email server's `check_mail()`, `send_reply()` etc.)

## Expected agent confirmations

### Setting reminders

```
User: "Remind me to check the logs in 10 minutes"
Agent: [calls add_reminder]
Tool: "Reminder set: I'll check the logs in 10 minutes"
Agent: "Got it! Reminder set - I'll check the logs in 10 minutes."
```

### Removing reminders

```
User: "Stop checking my email"
Agent: [calls remove_reminder]
Tool: "Reminder cancelled: No longer checking your email every hour"
Agent: "Done! I've cancelled the email checking reminder."
```

---

## Message flow behavior

### Timer message queuing

```
Session A (inactive):
  [10:00] User: "Check my email every 5 minutes"
  [10:00] Agent: "I'll check your email every 5 minutes" [sets timer]
  [10:05] Agent: "Check my email every 5 minutes" [timer fires]
  [10:05] Agent: [processing...checking email tools...]
  [10:10] Agent: "Check my email every 5 minutes" [timer fires again, queues]
  [10:10] Agent: [queued, waiting for previous to complete]
```

### User session control

When user opens Session A:

- Sees all accumulated messages and responses
- Can interrupt/cancel ongoing agent processing normally
- Red dot indicator disappears
- Toast notifications stop
