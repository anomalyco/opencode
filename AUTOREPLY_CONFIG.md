# Auto-Reply Configuration Guide

The auto-reply feature in this fork has been significantly enhanced to use opencode's built-in subagent system with OpenAI integration, making it much more intelligent and integrated!

## Quick Start

### Enable Auto-Reply with Subagent (Recommended)
```bash
# Enable with default subagent configuration
auto-reply on

# Enable with custom subagent settings
auto-reply on \
  --subagent-provider openai \
  --subagent-model gpt-4o-mini \
  --subagent-prompt "You are an AI assistant. Provide concise, helpful responses to continue conversations naturally." \
  --subagent-temperature 0.7 \
  --subagent-tokens 150
```

### Traditional Phrase-Based Auto-Reply
```bash
# Enable phrase-based auto-reply
auto-reply on \
  --phrases "continue,go on,proceed,do it" \
  --triggers "next steps,what next,continue with"

# Or use hooks with external APIs
auto-reply on \
  --use-hooks \
  --primary-hook openai-assistant \
  --fallback-phrases true
```

## Configuration Options

### Subagent-Based Auto-Reply (Default & Recommended)

The subagent approach uses opencode's built-in AI client to spawn intelligent auto-reply agents, providing much better responses than static phrases.

```bash
auto-reply on \
  --use-subagent true \                    # Enable subagent replies (default: true)
  --subagent-provider openai \              # AI provider: openai, anthropic, local, etc.
  --subagent-model gpt-4o-mini \           # Model to use
  --subagent-prompt "Custom system prompt" \
  --subagent-temperature 0.7 \            # Response randomness (0-1)
  --subagent-tokens 150                    # Max response length
```

**Default Configuration:**
- Provider: `openai`
- Model: `gpt-4o-mini`
- Temperature: `0.7`
- Max tokens: `150`
- System prompt: `"You are an auto-reply assistant. Provide brief, helpful responses to continue conversations naturally."`

### Phrase-Based Auto-Reply (Simple & Fast)

```bash
auto-reply on \
  --phrases "continue,go on,proceed,do it,carry on,next step" \
  --triggers "next steps,what next,continue with,proceed with,moving forward" \
  --response-delay 1000 \                  # 1 second delay
  --cooldown 30s                          # 30 second cooldown period
```

### Hook-Based Auto-Reply (External APIs)

```bash
auto-reply on \
  --use-hooks true \
  --primary-hook ai-assistant \
  --fallback-phrases true
```

## Advanced Configuration Examples

### 1. Production AI-Powered Auto-Reply
```bash
auto-reply on \
  --use-subagent true \
  --subagent-provider openai \
  --subagent-model gpt-4o \
  --subagent-prompt "You are an expert assistant helping with software development. Provide concise, technically accurate responses that continue the conversation naturally." \
  --subagent-temperature 0.3 \
  --subagent-tokens 200 \
  --triggers "continue,next step,proceed,what next,how to continue" \
  --cooldown 1m
```

### 2. Development Team Auto-Reply
```bash
auto-reply on \
  --use-subagent true \
  --subagent-provider openai \
  --subagent-model gpt-4o-mini \
  --subagent-prompt "You are a helpful development assistant. Analyze code and conversation context to provide intelligent continuation responses." \
  --use-hooks true \
  --primary-hook code-review-assistant \
  --fallback-phrases true \
  --phrases "continue,go on,proceed,do it"
```

### 3. Minimal Configuration
```bash
# Just enable with defaults
auto-reply on

# Disable completely
auto-reply off

# Check current status
auto-reply status
```

## Configuration Priority (High to Low)

1. **Subagent responses** (highest priority, enabled by default)
2. **Hook responses** (if subagent fails and hooks enabled)
3. **Phrase responses** (fallback method)

## How Subagent Auto-Reply Works

When enabled, the system:

1. **Detects triggers** in user messages using configured trigger phrases
2. **Spawns a subagent** with the specified provider and model
3. **Analyzes context** including conversation history and original message
4. **Generates intelligent response** using the AI model
5. **Updates statistics** tracking response types and performance
6. **Respects cooldowns** to prevent excessive responses

## Statistics and Monitoring

Check auto-reply performance with:
```bash
auto-reply status
```

**Statistics shown:**
- Total/Recent responses
- Trigger count
- Subagent vs Hook vs Phrase response counts
- Last response time
- Current configuration

## Troubleshooting

### Common Issues

1. **Subagent not working:**
   - Check if AI provider credentials are configured
   - Verify model availability in your opencode config
   - Try simpler configuration first

2. **Too many responses:**
   - Increase cooldown period: `--cooldown 5m`
   - Reduce trigger phrases
   - Disable subagent: `--use-subagent false`

3. **Responses too generic:**
   - Customize system prompt with `--subagent-prompt`
   - Adjust temperature: `--subagent-temperature 0.5`

### Reset Configuration
```bash
# Reset to defaults
auto-reply off --reset

# Disable and clear stats
auto-reply off --reset-stats
```

## Integration Examples

### With Loop Scheduling
```bash
# Enable intelligent auto-reply for scheduled tasks
auto-reply on \
  --use-subagent true \
  --subagent-provider openai \
  --subagent-model gpt-4o-mini

# Schedule tasks with auto-reply context
/loop 5m "analyze recent commits and provide status update"
```

### With Pattern Detection
```bash
# Prevent AI loops with pattern detection
pattern-detection --enable --threshold 0.8 --repetitions 3

# Enable auto-reply with intelligent responses
auto-reply on \
  --use-subagent true \
  --subagent-provider openai \
  --subagent-model gpt-4o-mini
```

## Performance Considerations

- **Subagent responses** are slower but more intelligent (~1-3 seconds)
- **Phrase responses** are instant but generic
- **Hook responses** vary by external API speed
- **Cooldown periods** prevent excessive API usage
- **Temperature settings** affect response quality vs randomness

The subagent approach is recommended for most use cases as it provides the best balance of intelligence and integration with opencode's existing architecture!