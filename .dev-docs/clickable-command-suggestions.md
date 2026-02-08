# Clickable Command Suggestions

## What It Is

A feature that makes shell commands in chat messages clickable. When you click a command like `cd packages/claxedo-web && bun run dev`, it automatically creates a new terminal and runs the command.

## Why It's Useful

Currently, when OpenCode suggests commands in chat, users need to:

1. Read the command
2. Click "Copy" button
3. Click "New Terminal" button
4. Wait for terminal to open
5. Paste and press Enter

This feature reduces it to:

1. Click the command
2. Done

## How It Works

### User Experience

1. **OpenCode suggests a command in chat:**

   ```bash
   cd packages/claxedo-web && bun run dev
   ```

2. **User sees two buttons on the code block:**
   - `Copy` (existing)
   - `Run` (new) - appears on hover for shell code blocks

3. **User clicks "Run":**
   - A new terminal tab is created
   - The command is automatically executed
   - Terminal becomes active/focused

4. **Visual feedback:**
   - Button shows loading state while terminal is being created
   - Terminal tab appears with a descriptive title (e.g., "Command 1")

### Technical Flow

```
User clicks "Run" button
    ↓
Markdown component detects click via event delegation
    ↓
Calls onRunCommand(command) callback
    ↓
Session panel receives callback
    ↓
Calls claxedo.terminal.requestCreate(command, "Command")
    ↓
[Existing terminal creation flow]
    ↓
Terminal created, command executes
```

### Architecture

**1. Detection Layer** (`packages/ui/src/components/markdown.tsx`)

- Identifies shell code blocks (bash, sh, zsh, shell)
- Adds "Run" button next to "Copy" button
- Event listener detects clicks on run buttons

**2. Callback Layer** (`packages/ui/src/components/message-part.tsx`)

- Passes `onRunCommand` callback through component tree
- Markdown → Part → Message → Session

**3. Execution Layer** (`packages/claxedo-app/src/claxedo-ui/components/session-panel.tsx`)

- Receives command from callback
- Calls existing terminal creation infrastructure
- Uses `claxedo.terminal.requestCreate()` (same as "New Terminal" button)

**4. Terminal Creation** (existing infrastructure)

- Signal-based coordination between app and directory contexts
- PTY creation via SDK
- Tab creation and activation

## Implementation Details

### Files to Modify

1. **`packages/ui/src/components/markdown.tsx`**
   - Add `setupCommandClicks()` function
   - Modify `createCodeBlock()` to add run buttons for shell languages
   - Pass `onRunCommand` prop through

2. **`packages/ui/src/components/markdown.css`**
   - Style run button (similar to copy button)
   - Position: `right: 48px` (leaves space for copy button)
   - Show on hover

3. **`packages/ui/src/components/message-part.tsx`**
   - Add `onRunCommand` to `Part` component props
   - Pass through to `Markdown` component

4. **`packages/claxedo-app/src/claxedo-ui/components/session-panel.tsx`**
   - Add `handleRunCommand` function
   - Wire to `claxedo.terminal.requestCreate()`
   - Pass down to message parts

### Shell Language Detection

Supported code block languages:

- `bash`
- `sh`
- `shell`
- `zsh`
- `fish`
- `command` (already used for bash tool output)

### Edge Cases to Handle

1. **Multi-line commands:**

   ```bash
   cd packages/claxedo-web && \
   bun run dev
   ```

   → Should work as-is (entire code block content is sent)

2. **Commands with working directory:**

   ```bash
   cd foo && npm install
   ```

   → Future enhancement: parse `cd` and set terminal cwd

3. **Long-running commands:**
   → Terminal stays open, user can see output and interact

4. **Multiple commands in one block:**

   ```bash
   npm install
   npm run build
   npm test
   ```

   → All commands execute sequentially (shell behavior)

5. **Terminal creation fails:**
   → Show error toast notification

## Future Enhancements

### Phase 1 (Initial Implementation)

- Run button on shell code blocks
- Creates new terminal every time
- Fixed title "Command N"

### Phase 2 (Smart Execution)

- Parse working directory from `cd` commands
- Detect package.json location and auto-set cwd
- Ask user: "Run in new terminal or current terminal?"

### Phase 3 (Advanced Features)

- Command history tracking
- Re-run previous commands with one click
- Suggest commands based on project context
- Command templates (e.g., "Start dev server", "Run tests")

### Phase 4 (Intelligence)

- Detect if command is already running
- Show status indicator on run button
- Kill existing process before re-running
- Integrate with task runner detection (npm, bun, cargo, etc.)

## Security Considerations

1. **No automatic execution:**
   - User must explicitly click "Run"
   - Commands are never auto-executed

2. **Command visibility:**
   - Command is always visible before running
   - No hidden commands

3. **Sandboxing:**
   - Commands run in user's normal shell environment
   - Same permissions as manually typed commands
   - No elevation or special privileges

4. **User control:**
   - Can still use copy button instead
   - Can modify command before running
   - Can kill terminal at any time

## Testing Considerations

1. **Unit tests:**
   - Shell language detection
   - Button rendering logic
   - Event delegation

2. **Integration tests:**
   - Click → terminal creation flow
   - Command execution
   - Error handling

3. **Manual testing:**
   - Various command types (short, long, multi-line)
   - Different shell languages
   - Rapid clicking (shouldn't create multiple terminals)
   - Terminal creation failures

## Estimated Effort

- **Design & Planning:** 1 hour
- **Implementation:** 2-3 hours
- **Testing:** 1 hour
- **Polish & Edge Cases:** 1 hour

**Total:** ~5-6 hours for Phase 1

## Success Metrics

- % of commands run via click vs copy-paste
- Average time to execute suggested commands
- User feedback on feature usefulness
- Bug reports related to command execution
