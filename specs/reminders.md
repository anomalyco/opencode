# Reminders

A background scheduling system for opencode that allows agents to set up delayed or recurring reminders to re-execute actions.

---

## Overview

The Reminders system provides three core functions:

- `reminderadd()` - Schedule a future reminder
- `reminderlist()` - View active reminders
- `reminderremove()` - Cancel scheduled reminders

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

**`reminderadd`**

- Description: "Set up a reminder that will make me re-execute an action later. Use when user asks to 'remind me to...' or 'check X every Y time'. I'll actually perform the action when reminded, not just notify."
- Parameters: `interval_seconds`, `type` (one-time/recurring), `action_prompt`, `description`
- **Critical**: `action_prompt` must contain fully resolved information (absolute paths, specific names, concrete data) since context may change over time
- Success: Returns confirmation like "Reminder set: I'll check your email in 1 hour" or "Reminder set: I'll monitor the log file every 5 minutes"
- Error: When limit reached, returns "Can't set more reminders, too many reminders already active." along with list of current reminders, suggesting user choose which to remove first

**`reminderlist`**

- Description: "List all active reminders in this session. Use when user asks 'what reminders do I have' or wants to see scheduled actions."
- Returns: Array of active reminders with descriptions and next execution times

**`reminderremove`**

- Description: "Cancel a scheduled reminder. Use when user asks to 'stop checking X' or 'cancel the reminder for Y'. Will attempt to match user's description to existing reminders."
- Parameters: `description_pattern` - What the user wants to stop
- Success: Returns confirmation like "Reminder cancelled: No longer checking your email every hour" or "Reminder removed: Stopped monitoring log file"
- Error: Returns "No matching reminder found" if pattern doesn't match any active reminders

#### Storage integration

Reminders are **persistently stored** across application restarts and are restored when opencode starts up. Reminders are removed when:

- Session is deleted
- Reminder is explicitly cancelled
- Reminder expires (one-time reminders after execution)

#### Session integration

Reminders are **session-scoped**: they exist only while their session exists. When a session is deleted, all reminders belonging to that session are automatically removed.

---

## Implementation approach

### Reminder scheduling

Use Node.js `setTimeout` and `setInterval` for timing. Store active timers in project state for cleanup.

### Timer execution and queuing

When a timer fires:

1. **Message posting**: System posts the stored `originalPrompt` as if the **agent** (who set the timer) sent it
2. **Automatic queuing**: Uses `SessionPrompt.prompt()` which automatically handles queuing if the session is busy
3. **Session state**: Messages are queued for busy sessions and processed when the session becomes available
4. **Normal processing**: Agent processes queued messages in order with full context and tool access
5. **Cancellation**: User can cancel/interrupt queued messages using standard session controls
6. **Cross-session delivery**: Reminders are delivered regardless of which session is currently active in the UI

### Agent decision making

Agents decide when to use reminders based on user language patterns:

- "wait 5 minutes then..." → `reminderadd` with one-time timer
- "check every hour..." → `reminderadd` with recurring timer
- "what am I waiting for?" → `reminderlist`
- "stop checking my email" → `reminderremove`

### Default configuration analysis

**Reminders are enable by default**
Natural AI assistant behavior where "remind me..." works out of the box, with easy disable options.

```typescript
{
  "reminders": {
    "enabled": true,  // Enabled by default for natural user experience
    "max_reminders_per_project": 50,
    "min_interval_seconds": 30
  }
}
```

**Disable options:**

- **Config**: Set `"enabled": false` in configuration
- **Environment**: Use `OPENCODE_DISABLE_REMINDERS=1` environment variable
- **Protection**: Prevents accidental reminders for users preferring single-shot actions

---

## Execution context

### Session binding

Reminders execute in their originating session context, preserving:

- Agent configuration and permissions
- Conversation history and context
- Tool access rights and user-granted permissions

### Message attribution

Reminder messages appear as **user messages** in the originating session (posted on behalf of the user who set the timer), not the agent.

### Interactive permissions

When reminders need user permissions (e.g., bash tool access):

- **Queued execution**: Reminder messages are queued using the existing session message queuing system
- **Busy sessions**: If a session is busy processing other messages, reminders wait in the queue and execute when available
- **Permission handling**: Permission requests follow normal session flow - shown to user when the session processes the queued reminder message
- **No special handling**: Reminders use standard `SessionPrompt.prompt()` which handles all queuing, busy states, and permission flows automatically
- **User feedback**: Users see reminder execution and any permission requests in normal conversation flow

---

## Error handling

### Failed executions

Errors during reminder execution are logged and posted as error messages to the originating session.

**Permission failures**: When reminders fail due to permissions, agents post clear explanatory messages such as:

- "I couldn't check the logs because I need bash permission. The reminder will try again later." (recurring)
- "I couldn't run the deployment script because I need bash permission. The one-time reminder has been cancelled." (one-time)

### Resource management

- **Session lifecycle**: Reminders exist while their session is alive
  - Session deleted → All reminders for that session automatically removed
  - Application restart → All reminders restored from storage (unless disabled)
- **Reminder limit**: Maximum `max_reminders_per_project` active reminders per session (configurable, default 50)
  - When limit reached, tool returns error with current reminder list for user to choose what to stop
- **Minimum intervals**: `min_interval_seconds` minimum allowed interval between the same reminder executions (configurable, default 30 seconds, enforced at reminder creation)
- **Message queuing**: Multiple timer messages queue naturally in session message flow
- **User control**: Standard session interrupt/cancel works on timer-triggered messages

---

## Configuration Control

### Feature Enable/Disable

The reminder system can be disabled via configuration:

```json
{
  "reminders": {
    "enabled": false,
    "max_reminders_per_project": 50,
    "min_interval_seconds": 30
  }
}
```

### Disabled State Behavior

When `config.reminders.enabled` is `false` or `OPENCODE_DISABLE_REMINDERS` environment variable is set:

#### Tool Visibility

- **Filtered Out**: Reminder tools don't appear in agent's available tools
- **No Confusion**: Agent cannot attempt to use unavailable functionality
- **Clean Experience**: No error messages or failed tool calls

#### Example User Experience

```
User: "Remind me to check logs in 5 minutes"
Agent: "I don't have the ability to set reminders. You could set a manual timer or ask me to help with the logs directly."
```

#### Technical Implementation

- Uses `ToolRegistry.enabled()` filtering mechanism
- Identical pattern to permission-based tool control
- No runtime performance overhead

### Storage and Restart Behavior

**Important Design Decision**: When reminders are disabled, **storage is preserved but timers are not restored**.

#### Scenario 1: Disabling reminders

1. User has active reminders running
2. User sets `"reminders": { "enabled": false }` in config
3. User restarts opencode
4. **Result**:
   - All reminder data remains in storage
   - No timers are scheduled during initialization
   - Tools are filtered out (invisible to agent)

#### Scenario 2: Re-enabling reminders

1. User sets `"reminders": { "enabled": true }` in config
2. User restarts opencode
3. **Result**:
   - All previously saved reminders are restored from storage
   - Timers resume normal scheduling and execution
   - Tools become fully functional again

**Rationale**: This design allows users to temporarily disable reminders (e.g., during maintenance, testing, or policy compliance) without losing their reminder configurations. When the feature is re-enabled, all previous reminders resume exactly where they left off.

### Enterprise Use Cases

#### Compliance Scenarios

- **Policy Changes**: Disable reminders temporarily during compliance audits
- **Resource Management**: Disable during high-load periods
- **Security Reviews**: Disable during security assessments of automated behavior

#### User Experience

- **No Data Loss**: Users don't lose carefully configured reminder setups
- **Easy Recovery**: Single config change re-enables full functionality
- **Clear Feedback**: Tools provide clear explanation when disabled

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
reminderadd({
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
reminderadd({
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
Agent: [calls reminderadd]
Tool: "Reminder set: I'll check the logs in 10 minutes"
Agent: "Got it! Reminder set - I'll check the logs in 10 minutes."
```

### Removing reminders

```
User: "Stop checking my email"
Agent: [calls reminderremove]
Tool: "Reminder cancelled: No longer checking your email every hour"
Agent: "Done! I've cancelled the email checking reminder."
```
