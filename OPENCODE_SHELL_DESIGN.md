# OpenCode Shell Integration: Design & Requirements Document

## Executive Summary

This document outlines the design and requirements for adding Lash-style shell integration capabilities to OpenCode. The implementation will provide three operational modes (Shell, Agent, Auto), persistent shell execution with state management, and seamless mode switching via keyboard shortcuts.

## Overview

OpenCode will be enhanced with shell integration features inspired by Lash's architecture, providing:
- Direct shell command execution with persistent state
- Intelligent routing between shell and AI agent based on command detection
- Mode switching via keyboard shortcuts (Ctrl+Space)
- Visual mode indicators in the UI
- Working directory display and management

## Goals

1. **Shell-like UX**: Provide direct shell execution in a persistent POSIX-compatible shell
2. **Smart Routing**: Automatically detect and route commands to appropriate handler
3. **Stateful Execution**: Maintain shell state (environment variables, working directory) across commands
4. **Visual Feedback**: Clear mode indicators and command execution feedback
5. **Keyboard-Driven**: Fast mode switching without breaking flow

## Non-Goals

- Implementing a full terminal emulator or PTY management
- Supporting interactive terminal applications (vim, less, etc.)
- Replacing the system shell
- Building SSH capabilities

## Architecture

### 1. Core Components

#### Mode System
```typescript
enum ExecutionMode {
  Shell = "Shell",   // Direct shell execution
  Agent = "Agent",   // AI agent processing
  Auto = "Auto"      // Intelligent routing
}
```

#### Shell Executor
- **POSIX Shell Emulation**: Use `mvdan.cc/sh/v3` equivalent for TypeScript/Node.js
- **Persistent State**: Maintain working directory and environment variables
- **Command Blocking**: Security layer to prevent dangerous operations
- **Output Capture**: Separate stdout/stderr handling

#### Mode Router
- **Command Detection**: Check if first token is executable
- **Builtin Recognition**: Detect shell builtins (cd, export, pwd, etc.)
- **PATH Resolution**: Use exec.LookPath equivalent to find executables
- **Fallback Logic**: Route to Agent when command not found

### 2. Implementation Architecture

```
┌─────────────────────────────────────────────┐
│                User Input                   │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│            Mode Controller                   │
│  ┌─────────┬──────────┬──────────┐         │
│  │ Shell   │  Auto    │  Agent   │         │
│  └─────────┴──────────┴──────────┘         │
└─────────────────┬───────────────────────────┘
                  │
        ┌─────────┴──────────┐
        │                    │
        ▼                    ▼
┌──────────────┐    ┌──────────────┐
│ Shell Engine │    │ Agent Engine │
│              │    │              │
│ - POSIX Exec │    │ - LLM Call   │
│ - State Mgmt │    │ - Tool Use   │
│ - Output Cap │    │ - Streaming  │
└──────────────┘    └──────────────┘
```

### 3. Key Features

#### Persistent Shell Management
```typescript
interface PersistentShell {
  workingDir: string;
  environment: Map<string, string>;
  execute(command: string): Promise<ShellResult>;
  setWorkingDir(dir: string): void;
  setEnv(key: string, value: string): void;
}
```

#### Auto Mode Routing Logic
```typescript
function shouldRouteToShell(input: string): boolean {
  const tokens = input.trim().split(/\s+/);
  if (tokens.length === 0) return false;
  
  const firstToken = tokens[0];
  
  // Check for shell builtins
  const builtins = ['cd', 'export', 'pwd', 'set', 'unset', 'alias'];
  if (builtins.includes(firstToken)) return true;
  
  // Check if contains path separator
  if (firstToken.includes('/')) {
    return isExecutableFile(firstToken);
  }
  
  // Check PATH
  return isInPath(firstToken);
}
```

#### Mode Switching
```typescript
interface ModeController {
  currentMode: ExecutionMode;
  toggleMode(): void;  // Cycles: Shell -> Agent -> Auto -> Shell
  setMode(mode: ExecutionMode): void;
  persistMode(): void;  // Save to config
}
```

## User Interface

### Status Bar
```
┌─────────────────────────────────────────────┐
│ ▌ Shell  │  ~/projects/opencode  │  Ctrl+Space: Mode  │
└─────────────────────────────────────────────┘
```

### Mode Indicators
- **Shell Mode**: Blue indicator `▌ Shell`
- **Agent Mode**: Purple indicator `▌ Agent`
- **Auto Mode**: Green indicator `▌ Auto`

### Command Execution Display
- Show working directory after `cd` commands
- Display `(ok)` for successful commands with no output
- Preserve command history in UI
- Format shell output with syntax highlighting

## Keyboard Shortcuts

| Shortcut | Action | Description |
|----------|--------|-------------|
| Ctrl+Space | Toggle Mode | Cycle through Shell → Agent → Auto |
| Ctrl+C | Cancel | Interrupt current operation |
| Ctrl+D | Clear | Clear current input |
| Up/Down | History | Navigate command history |

## Configuration

### Settings Structure
```json
{
  "shell": {
    "defaultMode": "Auto",
    "persistMode": true,
    "shellBinary": "/bin/zsh",
    "shellArgs": ["-c"],
    "workingDirectory": "~/projects",
    "blockedCommands": ["rm -rf /", "shutdown"],
    "environment": {
      "CUSTOM_VAR": "value"
    }
  }
}
```

### Environment Variables
- `OPENCODE_SHELL`: Override shell binary
- `OPENCODE_MODE`: Set initial mode
- `OPENCODE_DISABLE_SHELL`: Disable shell features entirely

## Security Considerations

### Command Blocking
```typescript
const dangerousPatterns = [
  /rm\s+-rf\s+\/$/,
  /shutdown/,
  /reboot/,
  /:(){ :|:& };:/  // Fork bomb
];

function isCommandBlocked(command: string): boolean {
  return dangerousPatterns.some(pattern => pattern.test(command));
}
```

### Sandboxing
- Execute in restricted environment when possible
- Limit resource usage (CPU, memory, time)
- Log all executed commands
- Never execute with elevated privileges

## Implementation Plan

### Phase 1: Core Shell Execution (Week 1)
1. Implement PersistentShell class
2. Add POSIX shell emulation library
3. Create working directory management
4. Build environment variable handling

### Phase 2: Mode System (Week 2)
1. Implement ExecutionMode enum and controller
2. Add mode persistence to configuration
3. Create mode switching logic
4. Build Auto mode routing algorithm

### Phase 3: UI Integration (Week 3)
1. Add mode indicator to status bar
2. Implement keyboard shortcuts
3. Create command history navigation
4. Add working directory display

### Phase 4: Testing & Refinement (Week 4)
1. Unit tests for shell executor
2. Integration tests for mode switching
3. Security testing for command blocking
4. Performance optimization

## Testing Strategy

### Unit Tests
- Shell command parsing
- PATH resolution
- Environment variable substitution
- Command blocking patterns

### Integration Tests
- Mode switching persistence
- Shell state management
- Output formatting
- Error handling

### Security Tests
- Command injection prevention
- Resource limit enforcement
- Dangerous command blocking

## Performance Requirements

- Command execution latency: < 50ms overhead
- Mode switching: Instant (< 10ms)
- Memory usage: < 20MB for shell state
- Output streaming: Real-time

## Migration from Current OpenCode

### Backward Compatibility
- Preserve existing agent functionality
- Maintain current API surface
- Keep existing keyboard shortcuts
- Default to Auto mode for new users

### Data Migration
- Import existing command history
- Preserve user preferences
- Maintain session state

## Dependencies

### Required Libraries
- **Shell Execution**: `node-pty` or `execa` for process management
- **Shell Parsing**: `shell-quote` for command parsing
- **PATH Resolution**: `which` for executable detection
- **State Management**: Existing OpenCode state system

### Optional Enhancements
- **Syntax Highlighting**: `prismjs` for output formatting
- **Command Completion**: `readline` for autocomplete
- **History Search**: `fzf` integration for fuzzy finding

## Success Metrics

1. **Adoption**: 80% of users try shell mode within first week
2. **Retention**: 60% continue using shell features after 30 days
3. **Performance**: 95% of commands execute in < 100ms
4. **Accuracy**: Auto mode routes correctly 95% of the time
5. **Satisfaction**: User feedback score > 4.5/5

## Open Questions

1. Should we support Windows Command Prompt/PowerShell natively?
2. How to handle long-running commands (progress indication)?
3. Should command history be per-session or global?
4. Integration with existing OpenCode tool system?
5. Support for command aliases and custom functions?

## Appendix: Lash Implementation Details

### Key Files from Lash
- `/internal/shell/shell.go`: POSIX shell emulation
- `/internal/shell/persistent.go`: Singleton shell management
- `/internal/tui/page/chat/chat.go:123-140`: Auto routing logic
- `/internal/tui/tui.go:601-617`: Mode toggle implementation
- `/internal/config/config.go:395-414`: Mode persistence

### Lash Design Principles
1. Minimal UI with single-line status
2. Three-mode system with intelligent routing
3. Persistent shell state across commands
4. Security-first with command blocking
5. Keyboard-driven interaction model

## Conclusion

This design provides OpenCode with powerful shell integration capabilities while maintaining its AI-first approach. The three-mode system offers flexibility for different user preferences and workflows, while the Auto mode provides intelligent routing that "just works" for most use cases. The implementation is security-conscious, performant, and integrates seamlessly with OpenCode's existing architecture.