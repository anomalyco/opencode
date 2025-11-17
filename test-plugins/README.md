# Test Plugins for `prompt.before` Hook

This directory contains test plugins to verify the `prompt.before` hook implementation.

## Plugins

### 1. PromptLoggerPlugin (`prompt-logger.plugin.ts`)
Simple plugin that logs all prompts before they're sent to the LLM.

**Purpose**: Verify that the hook fires correctly and receives the right data.

**Usage**:
```json
{
  "plugin": ["file:///home/user/opencode-auto/test-plugins/prompt-logger.plugin.ts"]
}
```

**Output**:
```
🎯 PROMPT INTERCEPTED BY LOGGER:
  Session ID: session_xyz
  Agent: build
  Prompt (first 100 chars): fix the bug in auth.ts
  Prompt length: 22
  Current model: anthropic/claude-sonnet-4-5
  No reply: false
```

### 2. ModelSwitcherPlugin (`model-switcher.plugin.ts`)
Demonstrates dynamic model selection based on prompt complexity.

**Purpose**: Verify that plugins can override model selection.

**Features**:
- Detects simple tasks (typo fixes, small changes) → switches to Claude Haiku
- Detects complex tasks (refactoring, architecture) → switches to Claude Sonnet 4.5
- Injects additional context for architectural tasks

**Usage**:
```json
{
  "plugin": ["file:///home/user/opencode-auto/test-plugins/model-switcher.plugin.ts"]
}
```

**Example**:
```
Input: "fix typo in readme"
Output: ✅ Switched to Claude Haiku (simple task)

Input: "refactor the authentication system to use JWT"
Output: ✅ Switched to Claude Sonnet 4.5 (complex task)
         📝 Injected architectural guidance
```

### 3. PromptBlockerPlugin (`prompt-blocker.plugin.ts`)
Demonstrates blocking prompts based on content.

**Purpose**: Verify that plugins can block prompts.

**Features**:
- Blocks prompts containing dangerous keywords
- Can be extended for content filtering, rate limiting, etc.

**Usage**:
```json
{
  "plugin": ["file:///home/user/opencode-auto/test-plugins/prompt-blocker.plugin.ts"]
}
```

**Example**:
```
Input: "delete all files"
Output: 🚫 PROMPT BLOCKED:
        Reason: Contains sensitive keyword: delete all
```

## Testing

To test these plugins:

1. Add the plugin to your OpenCode config:
   ```json
   {
     "plugin": ["file:///home/user/opencode-auto/test-plugins/prompt-logger.plugin.ts"]
   }
   ```

2. Run OpenCode with logging enabled:
   ```bash
   opencode --print-logs --log-level DEBUG
   ```

3. Send a prompt and verify the hook fires

## Success Criteria

- ✅ Hook fires BEFORE model selection
- ✅ Hook receives correct prompt text
- ✅ Hook can read session context
- ✅ Hook can override model selection
- ✅ Overridden model is actually used for LLM call
- ✅ Hook can inject additional context
- ✅ Hook can block prompts
- ✅ Multiple plugins can chain
- ✅ Hook errors don't crash OpenCode
