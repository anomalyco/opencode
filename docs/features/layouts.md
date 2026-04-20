# Custom Layouts

OpenCode's TUI layout system lets you customize spacing, padding, and UI element visibility to optimize your workspace for different terminal sizes and preferences.

## Quick Start

### Switching Layouts

Use the `/layout` command to switch between available layouts:

1. Type `/layout` in the prompt
2. Select from the list:
   - **default** - Original OpenCode spacing (comfortable, spacious)
   - **dense** - Compact mode for small terminals
   - Your custom layouts (if any)

Or use the command palette:

- Press `Ctrl+P` (or your configured keybind)
- Search for "Switch layout"
- Select a layout

### Built-in Layouts

**default** - The original OpenCode layout

- Comfortable spacing throughout
- Shows all UI elements (header, footer, agent info)
- Best for: Large terminals (100+ columns, 30+ rows)

**dense** - Optimized for small terminals

- Minimal spacing between messages
- Agent/model info on status line (not below input)
- No decorative borders
- Centered cursor in input box (blank line above and below)
- Best for: 80x24 terminals, scaled text, screen readers

## Creating Custom Layouts

### Location

Create layout files in: `~/.config/opencode/layout/`

Supported formats:

- `.json` - Standard JSON
- `.jsonc` - JSON with comments (recommended)

### Basic Structure

```jsonc
{
  "$schema": "https://opencode.ai/layout.json",
  "name": "my-layout",
  "description": "Brief description of your layout",
  "config": {
    // Your configuration here
  },
}
```

### Example: Minimal Layout

Create `~/.config/opencode/layout/minimal.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/layout.json",
  "name": "minimal",
  "description": "Ultra-compact layout for maximum content",
  "config": {
    // No spacing between messages
    "messageSeparation": 0,

    // No padding in message containers
    "userMessagePaddingTop": 0,
    "userMessagePaddingBottom": 0,
    "assistantMessagePaddingTop": 0,
    "assistantMessagePaddingBottom": 0,
    "messagePaddingLeft": 1,

    // Minimal container padding
    "containerPaddingTop": 0,
    "containerPaddingBottom": 0,
    "containerPaddingLeft": 1,
    "containerPaddingRight": 1,

    // No gaps
    "containerGap": 0,
    "toolMarginTop": 0,
    "agentInfoMarginTop": 0,

    // Minimal indentation
    "textIndent": 2,
    "toolIndent": 1,

    // Hide UI chrome
    "showHeader": false,
    "showFooter": false,
    "forceSidebarHidden": true,

    // Ultra-compact input box
    "showInputAgentInfo": false,
    "showInputBorder": false,
    "inputAgentInfoPaddingTop": 0,
    "inputBoxPaddingTop": 0,
    "inputBoxPaddingBottom": 0,
  },
}
```

### Example: Comfortable Layout

Create `~/.config/opencode/layout/comfortable.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/layout.json",
  "name": "comfortable",
  "description": "Extra breathing room for relaxed reading",
  "config": {
    // Extra spacing between messages
    "messageSeparation": 2,

    // Generous padding
    "userMessagePaddingTop": 2,
    "userMessagePaddingBottom": 2,
    "assistantMessagePaddingTop": 2,
    "assistantMessagePaddingBottom": 2,
    "messagePaddingLeft": 3,

    // Roomy containers
    "containerPaddingTop": 2,
    "containerPaddingBottom": 2,
    "containerPaddingLeft": 3,
    "containerPaddingRight": 3,

    // Generous gaps
    "containerGap": 2,
    "toolMarginTop": 2,
    "agentInfoMarginTop": 2,

    // Clear indentation
    "textIndent": 4,
    "toolIndent": 3,

    // Show everything
    "showHeader": true,
    "showFooter": true,
    "forceSidebarHidden": false,

    // Spacious input box
    "showInputAgentInfo": true,
    "showInputBorder": true,
    "inputAgentInfoPaddingTop": 2,
    "inputBoxPaddingTop": 2,
    "inputBoxPaddingBottom": 1,
  },
}
```

## Configuration Reference

### Message Spacing

**`messageSeparation`** (number, default: 1)

- Blank lines between consecutive messages (your questions and assistant replies)
- `0` = no spacing, `1` = one blank line, etc.

**`userMessagePaddingTop`** (number, default: 1)

- Blank lines above content inside user message boxes

**`userMessagePaddingBottom`** (number, default: 0)

- Blank lines below content inside user message boxes

**`assistantMessagePaddingTop`** (number, default: 2)

- Blank lines above content inside assistant message boxes

**`assistantMessagePaddingBottom`** (number, default: 1)

- Blank lines below content inside assistant message boxes

**`messagePaddingLeft`** (number, default: 2)

- Spaces of indentation inside message boxes (both user and assistant)

### Container Spacing

**`containerPaddingTop`** (number, default: 1)

- Blank lines at top of session container

**`containerPaddingBottom`** (number, default: 1)

- Blank lines at bottom of session container

**`containerPaddingLeft`** (number, default: 2)

- Spaces of indentation at left edge

**`containerPaddingRight`** (number, default: 2)

- Spaces of indentation at right edge

**`containerGap`** (number, default: 1)

- Vertical spacing between container elements

### Tool Output Spacing

**`toolMarginTop`** (number, default: 1)

- Blank lines above tool output blocks (like bash commands, file reads)

**`agentInfoMarginTop`** (number, default: 1)

- Blank lines above agent/model footer (e.g., "▣ Build · anthropic · claude-sonnet-4-5")

### Text Indentation

**`textIndent`** (number, default: 3)

- Spaces to indent main message text

**`toolIndent`** (number, default: 2)

- Spaces to indent tool call/output text

### UI Visibility

**`showHeader`** (boolean, default: true)

- Show/hide the session header at top

**`showFooter`** (boolean, default: true)

- Show/hide the status footer at bottom (LSP/MCP indicators)

**`forceSidebarHidden`** (boolean, default: false)

- Always hide the sidebar (useful for narrow terminals)

### Input Box Styling

**`showInputAgentInfo`** (boolean, default: true)

- Show agent/model info below input box
- When `false`, info moves to status line

**`showInputBorder`** (boolean, default: true)

- Show decorative border below input box

**`inputAgentInfoPaddingTop`** (number, default: 1)

- Blank lines above agent info (when shown below input)

**`inputBoxPaddingTop`** (number, default: 1)

- Blank lines above cursor in input box
- `0` = cursor on first line, `1` = one blank line above cursor, etc.

**`inputBoxPaddingBottom`** (number, default: 0)

- Blank lines below cursor in input box

## Understanding the TUI Elements

The OpenCode TUI consists of several key elements you can customize:

### Header (optional)

- Location: Top of screen
- Content: Session title, navigation info
- Control: `showHeader`

### Message History

- Your messages: Gray background, left border in accent color
- Assistant messages: Transparent background, markdown-formatted text
- Tool outputs: Bordered boxes with command/file information
- Controls: `messageSeparation`, `messagePadding*`, `toolMarginTop`

### Agent/Model Footer

- Shows: "▣ Build · anthropic · claude-sonnet-4-5 · 2.3s"
- Location: Below each assistant message, or on status line
- Control: `agentInfoMarginTop`, `showInputAgentInfo`

### Input Box

- Where you type prompts
- Background: Gray box
- Optional elements: Agent info below, decorative border
- Controls: `inputBoxPadding*`, `showInputAgentInfo`, `showInputBorder`

### Status Line

- Shows spinner and status when assistant is thinking
- Shows agent/model info when input box doesn't
- Shows retry information when needed

### Footer (optional)

- Location: Bottom of screen
- Content: Directory, LSP count, MCP count
- Control: `showFooter`

## Use Cases

### Small Terminal / Screen Reader

```jsonc
{
  "name": "compact",
  "config": {
    "messageSeparation": 0,
    "userMessagePaddingTop": 0,
    "userMessagePaddingBottom": 0,
    "assistantMessagePaddingTop": 0,
    "assistantMessagePaddingBottom": 0,
    "toolMarginTop": 0,
    "agentInfoMarginTop": 0,
    "showHeader": false,
    "showFooter": false,
    "showInputAgentInfo": false,
    "showInputBorder": false,
    "inputBoxPaddingTop": 0,
    "inputBoxPaddingBottom": 0,
  },
}
```

**Result**: Maximum content, minimal chrome. Every row counts.

### Ultrawide Terminal

```jsonc
{
  "name": "ultrawide",
  "config": {
    "containerPaddingLeft": 20,
    "containerPaddingRight": 20,
    "messagePaddingLeft": 5,
    "textIndent": 6,
    "toolIndent": 4,
  },
}
```

**Result**: Content centered with generous margins, preventing eye strain from edge-to-edge text.

### Presentation Mode

```jsonc
{
  "name": "presentation",
  "config": {
    "messageSeparation": 3,
    "userMessagePaddingTop": 2,
    "userMessagePaddingBottom": 2,
    "assistantMessagePaddingTop": 2,
    "assistantMessagePaddingBottom": 2,
    "containerPaddingLeft": 10,
    "containerPaddingRight": 10,
    "textIndent": 5,
    "showFooter": false,
  },
}
```

**Result**: Large, clear spacing for demos and screen sharing.

### Focused Coding

```jsonc
{
  "name": "focused",
  "config": {
    "showHeader": false,
    "showFooter": false,
    "forceSidebarHidden": true,
    "messageSeparation": 1,
    "toolMarginTop": 0,
    "agentInfoMarginTop": 0,
    "showInputBorder": false,
  },
}
```

**Result**: Hide distractions, show only messages and code.

## Tips

### Start with a Built-in Layout

1. Copy `~/.config/opencode/layout/` from the OpenCode source
2. Find `context/layout/default.jsonc` or `dense.jsonc`
3. Copy to your config directory and modify
4. The inline comments explain each field

### Iterate Quickly

1. Edit your layout file
2. Switch to a different layout and back (to reload)
   - `/layout` → select different layout → `/layout` → select yours
3. See changes immediately
4. No need to restart OpenCode

### Common Patterns

**Want more vertical space?**

- Set `messageSeparation: 0`
- Set all `*PaddingTop` and `*PaddingBottom` to `0`
- Set `showHeader: false` and `showFooter: false`

**Want clearer separation?**

- Increase `messageSeparation` to `2` or `3`
- Increase `toolMarginTop` to `2`
- Increase `agentInfoMarginTop` to `2`

**Want less horizontal indentation?**

- Reduce `textIndent` and `toolIndent`
- Reduce `messagePaddingLeft`
- Reduce `containerPaddingLeft`

**Want centered input cursor?**

- Set `inputBoxPaddingTop: 1` and `inputBoxPaddingBottom: 1`

### Validation

Layouts are validated when loaded. If you:

- **Misspell a field name**: Warning logged, field ignored
- **Use wrong type** (string instead of number): Warning logged, default used
- **Omit a field**: Default value used
- **Add unknown fields** (future version features): Warning logged, field ignored

This means layouts are forward and backward compatible - old layouts work with new versions, new layouts degrade gracefully on old versions.

## Troubleshooting

**Layout not showing up in `/layout` menu?**

- Check filename ends in `.json` or `.jsonc`
- Check file is in `~/.config/opencode/layout/`
- Check JSON syntax is valid (use a JSON validator)

**Layout loads but looks wrong?**

- Check console for validation warnings
- Compare with built-in layouts in source code
- Try starting with a copy of `default.jsonc` and modifying incrementally

**Changes not taking effect?**

- Switch to a different layout and back to reload
- Or restart OpenCode
- Layouts reload when you open the `/layout` dialog

**Want to reset to defaults?**

- Use `/layout` and select `default`
- Or remove your custom layout file

## Sharing Layouts

If you create a layout others might find useful:

- Share the `.jsonc` file (includes helpful comments)
- Document the use case and terminal size you optimized for
- Consider contributing to a community layouts repository (if one exists)

## Advanced: Programmatic Layouts

For very specific needs, you can:

- Generate layouts programmatically
- Use shell scripts to switch layouts based on terminal size
- Create per-project layouts (place in `.opencode/layout/` in project root)

Example bash script to auto-select layout based on terminal height:

```bash
#!/bin/bash
ROWS=$(tput lines)
if [ $ROWS -lt 30 ]; then
  # Small terminal, use dense
  echo '{"layout": "dense"}' > ~/.config/opencode/config.json
else
  # Normal terminal, use default
  echo '{"layout": "default"}' > ~/.config/opencode/config.json
fi
```

## Accessibility Notes

The layout system was designed with accessibility in mind:

- **Screen readers**: Use minimal layouts to reduce non-content elements
- **Low vision**: Increase spacing and padding for clarity
- **Terminal limitations**: Optimize for your specific terminal size
- **Reduced motion**: No animations, instant layout changes
- **Customization**: Every spacing value is configurable

If you have accessibility needs not addressed by the current system, please open an issue describing your use case.
