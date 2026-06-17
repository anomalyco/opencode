# OpenCode Advanced Automation Features

This document describes the advanced automation features implemented for OpenCode: loop scheduling, intelligent auto-reply, and pattern detection with webhook support.

## Features Overview

### 1. Loop Scheduling (`/loop` command)
Schedule recurring or one-time commands with cron-based timing, similar to Claude Code's `/loop` feature.

### 2. Intelligent Auto-Reply with Webhook Support
Smart auto-reply system that can use static phrases, AI-to-AI conversation continuation, or external webhooks.

### 3. Pattern Detection & Loop Prevention
Automatically detects when agents get stuck in repetitive loops and intervenes to unstuck them.

### 4. Hook System
Extensible system for executing external handlers (CLI, HTTP, file, function) as auto-reply sources.

## Installation

The features are automatically integrated into OpenCode. No additional installation is required.

## Usage

### Loop Scheduling

#### Basic Usage
```bash
# Schedule a command to run every 5 minutes
/loop 5m "check git status and summarize changes"

# Schedule a daily digest
/loop 1d "summarize commits from the last 24 hours"

# One-time reminder
/loop --once "remind me to push the release at 3 PM"
```

#### Advanced Usage
```bash
# With custom scheduling using cron expressions
/loop "*/15 * * * *" "check deployment health"

# With metadata and custom ID
/loop --id "health-check" --cron "*/5 * * * *" --meta '{"env": "staging"}' "run smoke tests"

# Nested commands (call other slash commands)
/loop 10m "/review-pr 1234"
```

#### Loop Commands
```bash
# List all scheduled tasks
/loop-list

# Cancel a task
/loop-cancel <task-id>

# Pause/Resume tasks
/loop-pause <task-id>
/loop-resume <task-id>
```

### Auto-Reply with Webhook Support

#### Basic Auto-Reply
```bash
# Enable auto-reply with default phrases
auto-reply on

# Enable with custom phrases
auto-reply on --phrases "continue,go on,proceed,do it"

# Check status
auto-reply status

# Disable
auto-reply off
```

#### Webhook-Enhanced Auto-Reply
```bash
# Enable hook-based auto-reply
auto-reply on --use-hooks --primary-hook "ai-enhanced"

# Configure a CLI hook (spawns new opencode instance)
hook add ai-enhanced --type cli --command "opencode run --cli" --fallback "continue" --instruction-file "~/.opencode/hook-instructions.txt"

# Configure an HTTP hook
hook add external-api --type http --url "https://api.example.com/autoreply" --fallback "go on" --headers '{"Authorization": "Bearer token"}'

# Test a hook
hook test ai-enhanced

# List all configured hooks
hook list
```

#### Hook Configuration Examples

**CLI Hook** - Spawn OpenCode instances for AI-to-AI conversation:
```bash
hook add ai-assistant --type cli \
  --command "opencode run --cli" \
  --instruction-file "~/.opencode/hook-instructions.txt" \
  --fallback "continue" \
  --timeout 15000
```

**HTTP Hook** - Call external AI service:
```bash
hook add openai-assistant --type http \
  --url "https://api.openai.com/v1/chat/completions" \
  --fallback "go on" \
  --headers '{"Authorization": "Bearer YOUR_API_KEY", "Content-Type": "application/json"}' \
  --timeout 10000
```

**File Hook** - Execute external script:
```bash
hook add custom-responder --type file \
  --command "/path/to/script.sh" \
  --fallback "proceed"
```

### Pattern Detection

#### Configuration
```bash
# Check pattern detection status
pattern-detection status

# Configure pattern detection
pattern-detection --threshold 0.8 --repetitions 5 --window "10m" --enable

# Reset pattern detection state
pattern-detection reset

# Test pattern detection
pattern-detection test
```

## Configuration Files

### Hook Configuration
Hooks are stored in `~/.opencode/hooks.json`. Example:

```json
{
  "hooks": {
    "ai-enhanced": {
      "type": "cli",
      "command": "opencode run --cli",
      "instructionFile": "~/.opencode/hook-instructions.txt",
      "fallback": "continue",
      "timeout": 15000,
      "maxRetries": 2
    },
    "external-api": {
      "type": "http",
      "url": "https://api.example.com/autoreply",
      "fallback": "go on",
      "timeout": 10000,
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

### Auto-Reply Configuration
Auto-reply settings are stored in `~/.opencode/auto-reply.json`. Example:

```json
{
  "enabled": true,
  "useHooks": true,
  "primaryHook": "ai-enhanced",
  "fallbackToPhrases": true,
  "phrases": ["continue", "go on", "proceed", "do it"],
  "triggerPhrases": ["next steps", "what next", "continue with"],
  "responseDelay": 1000,
  "cooldownPeriod": 30000
}
```

## Advanced Features

### Hook Instruction Files
Create custom instruction files for CLI hooks:

```text
You are an auto-reply assistant. Analyze the following text and provide a brief, helpful response to continue the conversation.

{{original_text}}

{{conversation_history}}

Provide a concise, natural response that moves the conversation forward.
```

### Pattern Detection Algorithm
The pattern detection system uses:
- **Text similarity**: Jaccard similarity algorithm to detect similar text
- **Tool usage tracking**: Monitors repeated tool calls with similar inputs
- **Time window**: Only considers recent activity (configurable)
- **Threshold-based**: Configurable similarity threshold and repetition count

### Error Handling & Fallbacks
All hook systems include comprehensive error handling:
- Retry logic with configurable attempts and delays
- Fallback responses when hooks fail
- Timeout protection
- Graceful degradation

## Examples

### Use Case 1: Continuous Monitoring
```bash
# Monitor deployment every 2 minutes
/loop 2m "check if staging deployment is healthy and report status"

# Enable auto-reply to handle any "next steps" interruptions
auto-reply on --use-hooks --primary-hook "deployment-monitor"

# Configure hook for intelligent responses
hook add deployment-monitor --type cli --command "opencode run --cli" --fallback "continue"
```

### Use Case 2: AI-Powered Conversation Continuation
```bash
# Enable enhanced auto-reply
auto-reply on --use-hooks --primary-hook "ai-assistant"

# Configure OpenAI-powered hook
hook add ai-assistant --type http \
  --url "https://api.openai.com/v1/chat/completions" \
  --headers '{"Authorization": "Bearer YOUR_KEY"}' \
  --fallback "continue"

# Start a complex conversation that never gets interrupted
/loop "write a complex feature and implement it step by step"
```

### Use Case 3: Development Workflow
```bash
# Schedule daily code review
/loop 1d "review new commits and provide feedback"

# Enable pattern detection to avoid infinite loops
pattern-detection --enable --repetitions 3

# Configure auto-reply for development context
auto-reply on --phrases "continue,fix this,proceed" --trigger-phrases "next steps,fix this"
```

## Troubleshooting

### Common Issues

**Hooks not working:**
1. Check if the hook service is enabled
2. Verify hook configuration with `hook test <name>`
3. Check permissions for file/CLI hooks
4. Review logs for error messages

**Pattern detection too sensitive:**
1. Adjust similarity threshold with `--threshold 0.5-0.9`
2. Increase repetition count with `--repetitions 5-10`
3. Extend time window with `--window "5m-1h"`

**Auto-reply not triggering:**
1. Check if auto-reply is enabled: `auto-reply status`
2. Verify trigger phrases are appropriate
3. Check cooldown period settings

### Debug Commands
```bash
# Check all service statuses
auto-reply status
pattern-detection status
hook list

# Test individual components
pattern-detection test
hook test <hook-name>

# Reset state
auto-reply off --reset
pattern-detection reset
```

## Integration with Existing Workflows

### Session Management
All features integrate seamlessly with OpenCode's session management:
- Pattern detection works across session continuations
- Auto-reply respects session boundaries
- Scheduled tasks persist across sessions (in memory)

### Agent Compatibility
Features work with all OpenCode agent types:
- Local agents
- Remote agents (via attach)
- Subagents
- Custom agents

### Performance Considerations
- Pattern detection has minimal performance impact
- Hook execution is asynchronous with timeouts
- Memory usage is optimized with time-based cleanup

## Future Enhancements

Planned improvements:
- Persistent storage for scheduled tasks
- Advanced hook types (database, message queues, etc.)
- Machine learning for pattern detection
- Integration with external monitoring systems
- Advanced scheduling features (timezones, calendars)

## Contributing

To contribute to these features:
1. Review the source code in:
   - `src/scheduler/` - Loop scheduling
   - `src/auto-reply/` - Auto-reply system
   - `src/pattern-detection/` - Loop prevention
   - `src/hook/` - Hook system
   - `src/cli/cmd/` - CLI commands
2. Test with various configurations
3. Report issues and suggest improvements
4. Add new hook types and integrations