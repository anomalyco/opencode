# OpenCode Prefill Assistant Plugin

> **Premium Plugin** - Control Claude's output format and maintain agent personas with intelligent assistant message prefilling.

## What is Prefilling?

Prefilling is an Anthropic-specific feature that allows you to start Claude's response with specific text. This gives you powerful control over:

- **Output format**: Force JSON, code blocks, or structured data without preambles
- **Agent personas**: Keep specialized agents in character during long conversations  
- **Conciseness**: Skip "I'll help you..." preambles and get straight to the point
- **Context maintenance**: Reinforce debugging, implementation, or planning modes

Learn more: [Anthropic's Prefill Documentation](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prefill-claudes-response)

## Installation

```bash
npm install @opencode-ai/plugin-prefill-assistant
# or
bun add @opencode-ai/plugin-prefill-assistant
```

## Configuration

Add to your `opencode.jsonc`:

```jsonc
{
  "plugin": [
    "@opencode-ai/plugin-prefill-assistant"
  ],
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
```

## Configuration Options

### `enabled` (default: `true`)
Master toggle for the prefilling feature.

### `agentPrefilling` (default: `true`)
Enable automatic prefilling based on the active agent (`@orchestrator`, `@general`, `@plan`).

### `patternDetection` (default: `true`)
Enable detection of user intent patterns in messages:
- "give me JSON" → prefills with `{`
- "show code only" → prefills with ` ``` `
- "be concise" → prefills with concise prompt

### `minDepthForRole` (default: `10`)
Minimum number of conversation turns before applying role maintenance prefills.

### `contexts`
Custom prefill strings for different contexts. You can override defaults or add your own.

## Examples

### Force JSON Output

**Without prefilling:**
```
User: Extract the name and price as JSON
Assistant: Here's the extracted information in JSON format:

```json
{
  "name": "Product",
  "price": 49.99
}
```

I've extracted the following details...
```

**With prefilling:**
```
User: Extract the name and price as JSON
Assistant: {
  "name": "Product",
  "price": 49.99
}
```

Clean, concise, parser-ready!

### Maintain Agent Persona

**Without prefilling (turn 15 of conversation):**
```
User: What should we do next?
Assistant: I'll help you figure out the next steps. Let me analyze...
```

**With prefilling:**
```
User: What should we do next?
Assistant: [Orchestrator] Next, we should delegate the database schema task to the general agent...
```

Agent stays in character throughout long conversations.

### Skip Preambles

**User:** "be brief - what's the bug?"

**With prefilling:** Skips "Let me analyze..." and jumps straight to the answer.

## Use Cases

### 1. **API Response Formatting**
Force clean JSON without explanatory text - perfect for programmatic parsing.

### 2. **Long Agent Conversations**  
Keep `@orchestrator`, `@general`, and `@plan` agents consistently in character.

### 3. **Code Generation**
Get code-only responses without surrounding commentary when needed.

### 4. **Debugging Sessions**
Maintain debug context marker throughout multi-turn troubleshooting.

### 5. **Concise Mode**
Skip preambles when you want quick, direct answers.

## Advanced: Custom Contexts

Add your own prefill contexts:

```jsonc
{
  "prefillAssistant": {
    "contexts": {
      // Add custom context
      "security": "[Security Analysis]",
      "performance": "[Performance Review]",
      "custom": "Based on the requirements:"
    }
  }
}
```

Then trigger them via pattern detection or manually in your prompts.

## Provider Support

This plugin **only works with Anthropic models** (Claude). Prefilling is an Anthropic-specific feature and will be automatically disabled for other providers.

## Monetization

This plugin demonstrates OpenCode's plugin architecture for premium features. You can:

1. Use it freely in your projects
2. Fork and customize for your needs
3. Package similar plugins for distribution
4. Create premium plugin packages

## License

MIT - See LICENSE file for details

## Contributing

PRs welcome! Please ensure:
- TypeScript types are correct
- Pattern detection is robust
- Documentation is updated
- Tests pass (when available)

## Support

- [OpenCode Documentation](https://opencode.ai/docs)
- [GitHub Issues](https://github.com/opencode-ai/opencode)
- [Discord Community](https://discord.gg/opencode)
