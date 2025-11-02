# Prefill Assistant Plugin - Complete Guide

## Overview

The **Prefill Assistant Plugin** is an Anthropic-specific feature that automatically adds "starter text" to Claude's responses to guide behavior and improve output quality. This guide covers what it does, how to use it, and importantly, what it does NOT do.

---

## What is Prefilling?

Prefilling is a technique where you start Claude's response with specific text before it generates the rest. This gives you powerful control over:

- **Output format**: Force JSON, code blocks, or structured data without preambles
- **Agent personas**: Keep specialized agents in character during long conversations
- **Conciseness**: Skip "I'll help you..." preambles and get straight to the point
- **Context maintenance**: Reinforce debugging, implementation, or planning modes

**Example:**

```
User: "Extract user data as JSON"
System adds: { role: "assistant", content: "{" }
Claude continues: { "users": [ ... ] }
```

Learn more: [Anthropic's Prefill Documentation](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prefill-claudes-response)

---

## What It Does vs. What It Doesn't Do

### ✅ DOES:

- **Maintain** agent personas once YOU choose them
- Add role markers to keep agents "in character"
- Control output format based on your request patterns
- Prevent "role drift" in long conversations
- Skip unnecessary preambles and chattiness

### ❌ DOES NOT:

- Switch agents for you automatically
- Choose which agent to use
- Activate `@orchestrator` vs `@general` based on your request
- Route tasks to appropriate agents

**You still manually control** which agent to use with `@orchestrator`, `@general`, `@plan`, etc.

---

## Installation & Configuration

### Current Configuration

Located in `.opencode/opencode.json`:

````json
{
  "plugin": ["@opencode-ai/plugin-prefill-assistant"],
  "anthropic": {
    "prefillAssistantMessages": true
  },
  "prefillAssistant": {
    "enabled": true,
    "agentPrefilling": true,
    "patternDetection": true,
    "minDepthForRole": 10,
    "contexts": {
      "jsonOutput": "{",
      "codeOnly": "```",
      "orchestrator": "[Orchestrator]",
      "general": "[General Agent]",
      "plan": "[Planning Mode - Read Only]",
      "concise": "Here's the solution:",
      "technical": "Technical analysis:",
      "debugging": "[Debug Context]"
    }
  }
}
````

### Configuration Options

| Option             | Default | Description                                                 |
| ------------------ | ------- | ----------------------------------------------------------- |
| `enabled`          | `true`  | Master toggle for the prefilling feature                    |
| `agentPrefilling`  | `true`  | Enable automatic prefilling based on active agent           |
| `patternDetection` | `true`  | Enable detection of user intent patterns                    |
| `minDepthForRole`  | `10`    | Minimum conversation turns before applying role maintenance |
| `contexts`         | `{}`    | Custom prefill strings for different contexts               |

---

## How It Works

### Priority System

The plugin applies prefills in this order:

```
1. Pattern Detection (highest priority)
   ↓
2. Agent Prefilling
   ↓
3. Role Maintenance (after 10+ messages)
```

### Feature 1: Pattern Detection

Automatically detects user intent from keywords in your message.

#### JSON Output Detection

**Triggers:** `"json"`, `"object"`, `"structured data"`

**Example:**

```bash
User: Extract this data as JSON
# Plugin prefills: "{"
# Claude outputs: { "userId": 123, "name": "John" }
```

**Without prefill:**

````
Claude: Here's the extracted information in JSON format:

```json
{
  "userId": 123,
  "name": "John"
}
````

I've extracted the following details...

```

**With prefill:**
```

Claude: {
"userId": 123,
"name": "John"
}

````

#### Code-Only Detection

**Triggers:** `"code only"`, `"just code"`, `"show code"`

**Example:**
```bash
User: Show me the code only for a React component
# Plugin prefills: "```"
# Claude outputs: ```jsx\nfunction MyComponent() { ... }
````

#### Concise Detection

**Triggers:** `"concise"`, `"brief"`, `"quick"`, `"short"`, `"summarize"`

**Example:**

```bash
User: Be brief - what does this file do?
# Plugin prefills: "Here's the solution:"
# Claude outputs: Here's the solution: This file handles user authentication...
```

---

### Feature 2: Agent Prefilling

When you manually invoke an agent, the plugin adds a role marker immediately.

#### How Agent Selection Works (Manual)

```bash
# YOU manually invoke agents with @ syntax:
@orchestrator Build a new auth system
@general Implement the login function
@plan Design the database schema
```

The plugin **does not** choose agents for you. You still control which agent to use.

#### What Agent Prefilling Does

Once you've chosen an agent, it adds the role marker:

```bash
# YOU type:
@orchestrator What should we build?

# Plugin automatically adds:
{ role: "assistant", content: "[Orchestrator]" }

# Claude continues:
[Orchestrator] We should break this into 3 tasks:
1) Design schema
2) Implement API
3) Add tests
```

**Without prefill:**

```
Claude: I'll help you plan this project. Let me think about the best approach...
```

**With prefill:**

```
Claude: [Orchestrator] We should break this into 3 tasks: 1) Design schema...
```

#### Available Agent Prefills

| Agent           | Prefill                       | Usage                          |
| --------------- | ----------------------------- | ------------------------------ |
| `@orchestrator` | `[Orchestrator]`              | Planning and task coordination |
| `@general`      | `[General Agent]`             | Code implementation            |
| `@plan`         | `[Planning Mode - Read Only]` | Read-only analysis and design  |

---

### Feature 3: Role Maintenance

In **long conversations** (10+ messages), agents can "forget" their role. The plugin automatically reminds them.

#### Example Flow:

```bash
# Message 1:
@orchestrator Start planning the auth system

# Message 5:
@orchestrator Continue with the implementation plan

# Message 12: (After minDepthForRole: 10)
@orchestrator What's next?
# Plugin automatically adds "[Orchestrator]" prefill to maintain role
```

#### Why This Matters:

- Prevents "role drift" where Claude forgets it's the orchestrator
- Keeps specialized behavior consistent across long sessions
- Reduces need to re-state "you are the orchestrator" every few messages

---

## Testing the Plugin

### Test 1: JSON Output

```bash
# Pattern: Detects "JSON" keyword
> Extract user data as JSON

# Expected behavior:
# - Plugin prefills with "{"
# - Claude outputs clean JSON without preamble
```

### Test 2: Code Only

````bash
# Pattern: Detects "code only" keywords
> Show me the code only for a React component

# Expected behavior:
# - Plugin prefills with "```"
# - Claude outputs only code block
````

### Test 3: Concise Response

```bash
# Pattern: Detects "concise" or "brief"
> Be concise - what does this file do?

# Expected behavior:
# - Plugin prefills with "Here's the solution:"
# - Claude stays brief and to the point
```

### Test 4: Agent Prefilling

```bash
# Use the @orchestrator agent manually
@orchestrator What should we build next?

# Expected behavior:
# - Plugin prefills with "[Orchestrator]"
# - Claude maintains orchestrator persona
```

### Test 5: Long Conversation Role Maintenance

```bash
# After 10+ messages in a conversation with any agent
@general Continue with the implementation

# Expected behavior:
# - Plugin prefills with "[General Agent]"
# - Prevents role drift
```

---

## Pattern vs. Agent Priority

When both pattern and agent are present, **pattern wins**:

```bash
@orchestrator Give me JSON output

# Pattern detection wins:
# - Prefills: "{"
# - NOT: "[Orchestrator]"
```

This ensures output format takes priority over role markers.

---

## Provider Support

**Works with:**

- ✅ Anthropic/Claude models only

**Does NOT work with:**

- ❌ OpenAI (GPT-4, etc.)
- ❌ Google (Gemini)
- ❌ Other providers

The plugin automatically disables itself for non-Anthropic providers.

---

## Customization

### Adding Custom Prefills

Edit `.opencode/opencode.json`:

````json
{
  "prefillAssistant": {
    "contexts": {
      // Built-in contexts
      "jsonOutput": "{",
      "codeOnly": "```",

      // Add your own custom contexts
      "security": "[🔒 Security Analysis]",
      "performance": "[⚡ Performance Review]",
      "refactor": "Refactored code:\n```",
      "documentation": "# Documentation\n\n"
    }
  }
}
````

### Disabling Features Selectively

```json
{
  "prefillAssistant": {
    "enabled": true,
    "agentPrefilling": true,
    "patternDetection": false, // Disable pattern detection
    "minDepthForRole": 999 // Effectively disable role maintenance
  }
}
```

### Customizing Role Maintenance Depth

```json
{
  "prefillAssistant": {
    "minDepthForRole": 5 // Apply role prefills after 5 messages instead of 10
  }
}
```

---

## Debugging

### Plugin Not Working?

1. **Check plugin loaded:**
   - Look for `"loading plugin"` logs on startup
   - Should see `"@opencode-ai/plugin-prefill-assistant"`

2. **Verify provider:**
   - Only works with `anthropic` provider
   - Check your model is Claude-based

3. **Test pattern:**
   - Try exact phrase: `"Give me JSON output"`
   - Should trigger `jsonOutput` context

4. **Check configuration:**

   ```bash
   # View current config
   cat .opencode/opencode.json

   # Verify plugin is listed
   # Verify prefillAssistant section exists
   # Verify enabled: true
   ```

5. **Restart session:**
   - Configuration changes require a restart
   - Close and reopen OpenCode

---

## Common Use Cases

### 1. API Response Formatting

Force clean JSON without explanatory text - perfect for programmatic parsing.

```bash
User: Extract fields as JSON
Output: { "field1": "value1", "field2": "value2" }
```

### 2. Long Agent Conversations

Keep `@orchestrator`, `@general`, and `@plan` agents consistently in character over many turns.

### 3. Code Generation

Get code-only responses without surrounding commentary when needed.

````bash
User: Show me the code only
Output: ```typescript
function example() { ... }
````

````

### 4. Debugging Sessions

Maintain debug context marker throughout multi-turn troubleshooting.

```bash
@general Debug this error
[General Agent] Looking at the stack trace...
````

### 5. Concise Mode

Skip preambles when you want quick, direct answers.

```bash
User: Be brief - explain async/await
Output: Here's the solution: async/await is syntactic sugar for Promises...
```

---

## Automatic Agent Switching (Future Feature)

**Currently NOT supported.** If you want automatic agent switching, you'd need:

1. **Route detection logic** - Analyze user intent and choose agent
2. **Agent selection system** - Programmatically invoke agents
3. **Different plugin/system** - This would be a separate "smart routing" plugin

**Example of what automatic switching might look like (NOT included):**

```bash
User: "Design a database schema"
System: Detects "design" → auto-invokes @plan
System: Adds prefill "[Planning Mode - Read Only]"

User: "Now implement the schema"
System: Detects "implement" → auto-invokes @general
System: Adds prefill "[General Agent]"
```

This would be a **future enhancement** - potentially a "smart routing" plugin.

---

## Summary

### Key Points

- ✅ **Prefill Assistant** controls output format and maintains agent personas
- ✅ **You still manually choose** agents with `@orchestrator`, `@general`, etc.
- ✅ **Pattern detection** works regardless of which agent you're using
- ✅ **Role maintenance** prevents agent drift in long conversations
- ✅ **Only works** with Anthropic/Claude models
- ❌ **Does NOT** automatically switch agents for you

### Quick Reference

| Feature           | What It Does                             | Example                            |
| ----------------- | ---------------------------------------- | ---------------------------------- |
| Pattern Detection | Detects keywords → applies format        | "json" → prefills `{`              |
| Agent Prefilling  | Adds role marker when you invoke agent   | `@orchestrator` → `[Orchestrator]` |
| Role Maintenance  | Reminds agent of role after 10+ messages | Prevents role drift                |

---

## Additional Resources

- [Plugin Source Code](../plugin-prefill-assistant/src/index.ts)
- [Plugin README](../plugin-prefill-assistant/README.md)
- [Anthropic Prefill Docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prefill-claudes-response)
- [OpenCode Documentation](https://opencode.ai/docs)

---

## Contributing

Found a bug or want to add a feature? PRs welcome!

1. Fork the repo
2. Make your changes
3. Test thoroughly
4. Submit PR

---

**Last Updated:** November 2, 2025
**Plugin Version:** 0.0.1
**OpenCode Version:** Latest
