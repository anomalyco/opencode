# `prompt.before` Plugin Hook

## Overview

The `prompt.before` hook is a powerful plugin hook that fires **before** OpenCode sends a prompt to the LLM. This enables plugins to:

- Inspect the prompt and session context
- Override model selection dynamically
- Inject additional context into prompts
- Block prompts based on custom validation logic
- React to user preferences (e.g., optimization toggle state)

## Hook Signature

```typescript
"prompt.before"?: (
  input: {
    sessionID: string
    agent: string
    prompt: string
    model?: { providerID: string; modelID: string }
    noReply?: boolean
    optimizeEnabled: boolean
  },
  output: {
    model?: { providerID: string; modelID: string }
    additionalContext?: string
    block?: boolean
    blockReason?: string
  },
) => Promise<void>
```

## Input Parameters

### `sessionID: string`
The unique identifier for the current session.

### `agent: string`
The name of the current agent (e.g., `"build"`, `"auto-optimized"`).

### `prompt: string`
The user's prompt text (without synthetic parts).

### `model?: { providerID: string; modelID: string }`
The currently selected model, if any.

### `noReply?: boolean`
Whether this is a context-only message (no AI inference).

### `optimizeEnabled: boolean`
The user's optimization toggle state. Plugins should respect this preference.

## Output Parameters

### `model?: { providerID: string; modelID: string }`
Override the model selection. The plugin can change which model will be used for this prompt.

**Example:**
```typescript
output.model = {
  providerID: "anthropic",
  modelID: "claude-3-5-haiku-20241022"
}
```

### `additionalContext?: string`
Inject additional context that will be prepended to the user's prompt.

**Example:**
```typescript
output.additionalContext = "Remember to follow security best practices."
```

### `block?: boolean`
Block the prompt from being sent to the LLM.

**Example:**
```typescript
output.block = true
output.blockReason = "Prompt contains sensitive information"
```

### `blockReason?: string`
Explanation for why the prompt was blocked (shown to the user).

## Execution Order

```
1. User submits prompt
2. createUserMessage()
3. Agent.get()
4. 🔥 prompt.before hook executes    ← YOUR PLUGIN RUNS HERE
5. resolveModel() (uses plugin's model override if provided)
6. resolveSystemPrompt()
7. chat.params hook
8. streamText() (LLM call)
```

**Critical Insight:** The `prompt.before` hook executes **before** model resolution, allowing plugins to control which model is used. The existing `chat.params` hook fires **after** model selection and cannot override the model.

## Basic Example: Prompt Logger

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const PromptLoggerPlugin: Plugin = async () => {
  console.log("🎯 Prompt Logger Plugin Loaded")

  return {
    "prompt.before": async (input, output) => {
      console.log("━".repeat(60))
      console.log("📝 PROMPT RECEIVED")
      console.log("━".repeat(60))
      console.log("Session:", input.sessionID)
      console.log("Agent:", input.agent)
      console.log("Prompt:", input.prompt)
      console.log("Model:", input.model
        ? `${input.model.providerID}/${input.model.modelID}`
        : "default")
      console.log("Optimize:", input.optimizeEnabled ? "ON" : "OFF")
      console.log("━".repeat(60))
    }
  }
}
```

## Advanced Example: Dynamic Model Selection

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const ModelOptimizerPlugin: Plugin = async () => {
  return {
    "prompt.before": async (input, output) => {
      // Respect user's optimization preference
      if (!input.optimizeEnabled) {
        console.log("⏭️  Optimization disabled by user")
        return
      }

      const promptLower = input.prompt.toLowerCase()
      const promptLength = input.prompt.length

      // Detect simple tasks
      const isSimpleTask =
        promptLower.includes("fix typo") ||
        promptLower.includes("simple") ||
        promptLower.includes("quick") ||
        promptLength < 50

      // Detect complex tasks
      const isComplexTask =
        promptLower.includes("refactor") ||
        promptLower.includes("architecture") ||
        promptLower.includes("design") ||
        promptLower.includes("implement") ||
        promptLength > 500

      if (isSimpleTask) {
        // Route to fast, cheap model
        output.model = {
          providerID: "anthropic",
          modelID: "claude-3-5-haiku-20241022"
        }
        console.log("✅ Switched to Haiku (simple task)")
      } else if (isComplexTask) {
        // Route to powerful model
        output.model = {
          providerID: "anthropic",
          modelID: "claude-sonnet-4-5"
        }
        console.log("✅ Switched to Sonnet 4.5 (complex task)")
      }
    }
  }
}
```

## Example: Content Filtering

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const ContentFilterPlugin: Plugin = async () => {
  return {
    "prompt.before": async (input, output) => {
      const dangerousPatterns = [
        /delete\s+all/i,
        /drop\s+database/i,
        /rm\s+-rf\s+\//i,
      ]

      for (const pattern of dangerousPatterns) {
        if (pattern.test(input.prompt)) {
          output.block = true
          output.blockReason = `Blocked: Prompt contains potentially dangerous command`
          console.log("🚫 Blocked dangerous prompt")
          return
        }
      }
    }
  }
}
```

## Example: Context Injection

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const ContextInjectorPlugin: Plugin = async () => {
  return {
    "prompt.before": async (input, output) => {
      const promptLower = input.prompt.toLowerCase()

      if (promptLower.includes("security") || promptLower.includes("auth")) {
        output.additionalContext =
          "IMPORTANT: Follow OWASP security guidelines. " +
          "Never store passwords in plain text. " +
          "Use proper encryption and authentication."
        console.log("📋 Injected security context")
      }

      if (promptLower.includes("database") || promptLower.includes("sql")) {
        output.additionalContext =
          "REMINDER: Always use parameterized queries to prevent SQL injection. " +
          "Implement proper indexing for performance."
        console.log("📋 Injected database best practices")
      }
    }
  }
}
```

## Best Practices

### 1. Respect User Preferences

Always check `input.optimizeEnabled` before applying optimizations:

```typescript
if (!input.optimizeEnabled) {
  return // Skip optimization
}
```

### 2. Don't Break Existing Functionality

Only modify `output` fields when necessary. If you don't need to change something, don't set it:

```typescript
// ❌ Bad - always overrides
output.model = { providerID: "anthropic", modelID: "claude-haiku" }

// ✅ Good - only overrides when needed
if (isSimpleTask) {
  output.model = { providerID: "anthropic", modelID: "claude-haiku" }
}
```

### 3. Provide Clear Logging

Help users understand what your plugin is doing:

```typescript
console.log("✅ Switched to Haiku (cost optimization)")
console.log("⏭️  Skipping optimization (user disabled)")
console.log("🚫 Blocked prompt: contains sensitive data")
```

### 4. Handle Errors Gracefully

Don't let plugin errors crash OpenCode:

```typescript
"prompt.before": async (input, output) => {
  try {
    // Your plugin logic
  } catch (error) {
    console.error("Plugin error:", error)
    // Don't modify output on error
  }
}
```

### 5. Multiple Plugins

If multiple plugins use `prompt.before`, they execute in order. The **last plugin wins** for conflicting changes:

```typescript
// Plugin 1
output.model = { providerID: "openai", modelID: "gpt-4" }

// Plugin 2 (executes after Plugin 1)
output.model = { providerID: "anthropic", modelID: "claude-haiku" }

// Result: Claude Haiku is used
```

## Use Cases

### Cost Optimization
Route simple tasks to cheaper models, complex tasks to premium models:
- Typo fixes → Claude Haiku ($0.25/M tokens)
- Architecture design → GPT-5 ($10/M tokens)
- **Potential savings:** 40x cost reduction on simple tasks

### Security
- Block prompts containing sensitive patterns
- Prevent accidental data leaks
- Enforce security policies

### Context Enhancement
- Add domain-specific guidelines
- Inject best practices
- Remind about security considerations

### Quality Control
- Route specialized tasks to specialized models
- Use coding-optimized models for code tasks
- Use chat-optimized models for conversational tasks

### A/B Testing
- Route 50% of prompts to model A, 50% to model B
- Compare performance metrics
- Optimize model selection strategy

## Installation

1. Create your plugin file:

```typescript
// ~/.config/opencode/plugin/my-optimizer.ts
import type { Plugin } from "@opencode-ai/plugin"

export const MyOptimizerPlugin: Plugin = async () => {
  return {
    "prompt.before": async (input, output) => {
      // Your logic here
    }
  }
}
```

2. OpenCode automatically loads plugins from `~/.config/opencode/plugin/`

3. Restart OpenCode or reload plugins

4. Test your plugin:

```bash
opencode --print-logs --log-level DEBUG
```

## Debugging

Enable debug logging to see your plugin in action:

```bash
opencode --print-logs --log-level DEBUG
```

You'll see:
- Plugin load messages
- Your console.log() output
- Hook execution flow
- Model changes

## Related Hooks

- **`chat.params`**: Modify LLM parameters (temperature, topP, options) - fires **after** model selection
- **`chat.message`**: Called when a new message is received
- **`tool.execute.before`**: Intercept tool executions (Read, Write, Bash, etc.)
- **`tool.execute.after`**: Modify tool output before showing to LLM

## Comparison: `prompt.before` vs `chat.params`

| Feature | `prompt.before` | `chat.params` |
|---------|----------------|---------------|
| Can override model | ✅ Yes | ❌ No (model already selected) |
| Can block prompt | ✅ Yes | ❌ No |
| Can inject context | ✅ Yes | ❌ No |
| Can modify temperature | ❌ No | ✅ Yes |
| Can modify topP | ❌ No | ✅ Yes |
| Has access to user toggle | ✅ Yes | ❌ No |
| Execution order | Before model selection | After model selection |

**Use `prompt.before` for:** Model routing, content filtering, context injection, blocking

**Use `chat.params` for:** Fine-tuning model parameters (temperature, topP, provider-specific options)

## TypeScript Support

The hook is fully typed. Your IDE will provide autocomplete and type checking:

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async () => {
  return {
    "prompt.before": async (input, output) => {
      // input.* - autocomplete available
      // output.* - autocomplete available

      // TypeScript will warn about invalid values
      output.model = {
        providerID: "invalid", // IDE will warn if provider doesn't exist
        modelID: "invalid"
      }
    }
  }
}
```

## Performance Considerations

The hook is called on **every prompt**, so keep it fast:

✅ **Good:**
```typescript
// Quick string checks
if (input.prompt.includes("simple")) { ... }

// Simple regex
if (/simple|quick|fast/.test(input.prompt)) { ... }
```

❌ **Avoid:**
```typescript
// Heavy computation
const complexity = analyzePromptWithAI(input.prompt) // Slow!

// API calls
const suggestion = await fetch("https://api.example.com/suggest") // Network latency!

// Large file I/O
const config = await Bun.file("/huge/config.json").json() // Disk I/O!
```

## Troubleshooting

### Plugin not loading
- Check file location: `~/.config/opencode/plugin/`
- Check file extension: `.ts` or `.js`
- Check for TypeScript errors
- Run with `--print-logs` to see load errors

### Hook not firing
- Verify the hook signature matches the type
- Check for syntax errors
- Ensure you're returning the hooks object from the plugin function
- Use `console.log()` to confirm the hook is being called

### Model override not working
- Verify the model IDs are correct
- Check that the provider is available
- Make sure you're setting `output.model`, not `input.model`
- Ensure the hook isn't throwing an error

### Optimization toggle not working
- Verify you're checking `input.optimizeEnabled`
- Make sure the user has toggled it (check status bar)
- Confirm the toggle state is being sent from the client

## Community Plugins

Share your plugins with the community! Some ideas:

- **Language-specific routing**: Route Python tasks to Python-optimized models
- **Budget tracker**: Track costs and switch to cheaper models when over budget
- **Time-based routing**: Use faster models during peak hours
- **Expertise routing**: Route domain-specific questions to specialized models
- **Quality gating**: Block low-quality prompts that won't produce good results

## Contributing

Found a bug or have a feature request? Open an issue on GitHub!

Want to improve this documentation? Submit a PR!

## See Also

- [Optimization Toggle Documentation](./OPTIMIZATION_TOGGLE.md)
- [Plugin Development Guide](./PLUGIN_DEVELOPMENT.md)
- [Available Models](./MODELS.md)
- [Hook Reference](./HOOKS.md)
