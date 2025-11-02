# Computer Use Tool (`cc_computer_use`)

Production-ready implementation of Anthropic's computer use capability for desktop automation.

## Overview

The `cc_computer_use` tool allows Claude to interact with your desktop by:

- Taking screenshots
- Moving the mouse
- Clicking (left, right, double)
- Typing text
- Pressing keyboard keys
- Getting cursor position

## Requirements

### macOS

- `screencapture` (built-in) - for screenshots
- `osascript` (built-in) - for keyboard/typing
- `cliclick` (optional) - for enhanced mouse control
  ```bash
  brew install cliclick
  ```

### Linux

- `import` (ImageMagick) - for screenshots
  ```bash
  sudo apt-get install imagemagick
  ```
- `xdotool` - for mouse and keyboard control
  ```bash
  sudo apt-get install xdotool
  ```

### Windows

- PowerShell (built-in) - all functionality

## Configuration

Enable in your `opencode.json`:

```jsonc
{
  "anthropic": {
    "computerUseTool": true,
  },
}
```

## Actions

### Screenshot

Captures the current screen state.

```json
{
  "action": "screenshot"
}
```

**Returns**: Base64 encoded PNG image

### Mouse Move

Move cursor to specific coordinates.

```json
{
  "action": "mouse_move",
  "coordinate": [100, 200] // [x, y] from top-left
}
```

### Clicks

Perform mouse clicks at current position.

```json
{
  "action": "left_click" // or "right_click", "double_click"
}
```

### Type Text

Type text at current cursor position.

```json
{
  "action": "type",
  "text": "Hello, World!"
}
```

### Press Key

Press a specific keyboard key.

```json
{
  "action": "key",
  "text": "Return" // or "Tab", "Escape", "Space", etc.
}
```

### Get Cursor Position

Get current mouse coordinates.

```json
{
  "action": "cursor_position"
}
```

## Usage Examples

### Take a Screenshot

```typescript
const result = await cc_computer_use({
  action: "screenshot",
})
// Result contains base64 PNG image
```

### Click at Specific Location

```typescript
// First move the mouse
await cc_computer_use({
  action: "mouse_move",
  coordinate: [500, 300],
})

// Then click
await cc_computer_use({
  action: "left_click",
})
```

### Type and Submit

```typescript
// Type text
await cc_computer_use({
  action: "type",
  text: "opencode is awesome",
})

// Press Return
await cc_computer_use({
  action: "key",
  text: "Return",
})
```

## Security & Permissions

### macOS Permissions

On first use, macOS will request:

1. **Screen Recording** permission
   - Go to System Preferences > Security & Privacy > Privacy > Screen Recording
   - Enable for Terminal or your application

2. **Accessibility** permission (for mouse/keyboard)
   - Go to System Preferences > Security & Privacy > Privacy > Accessibility
   - Enable for Terminal or your application

### Security Best Practices

1. **User Awareness**: Always inform users when computer use is enabled
2. **Logging**: All actions are logged for security audit
3. **Permission Prompts**: Consider implementing permission confirmations
4. **Scope Limiting**: Only enable when absolutely necessary
5. **Testing**: Test in isolated environments first

## Limitations

### Current Limitations

- Screenshot size can be large (500KB-2MB)
- No multi-monitor support (captures primary screen only)
- Coordinate precision depends on screen resolution
- No window management (minimize, maximize, etc.)
- No clipboard access

### Platform Differences

| Feature    | macOS                | Linux                   | Windows     |
| ---------- | -------------------- | ----------------------- | ----------- |
| Screenshot | ✅ Built-in          | ✅ Requires ImageMagick | ✅ Built-in |
| Mouse      | ⚠️ Requires cliclick | ✅ Built-in             | ✅ Built-in |
| Keyboard   | ✅ Built-in          | ✅ Built-in             | ✅ Built-in |
| Typing     | ✅ Built-in          | ✅ Built-in             | ✅ Built-in |

## Error Handling

The tool handles errors gracefully:

```typescript
{
  title: "Action Failed",
  output: "Failed: <error message>",
  metadata: {}
}
```

Common errors:

- **Permission Denied**: Missing screen recording/accessibility permissions
- **Platform Not Supported**: Feature not available on current OS
- **Command Not Found**: Required tool not installed (cliclick, xdotool, etc.)
- **Invalid Coordinates**: Coordinates outside screen bounds

## Performance Considerations

### Screenshot Performance

- Screenshots can be 500KB-2MB in size
- Each screenshot takes ~100-500ms to capture
- Consider caching screenshots when possible
- Use lower resolutions for faster processing

### Action Delays

- Small delay (~100ms) between actions recommended
- Prevents actions from executing too quickly
- Allows UI to respond between actions

## Debugging

Enable debug logging:

```bash
export LOG_LEVEL=debug
```

Check logs for:

- Action execution details
- Permission errors
- Platform-specific issues
- Tool availability

## Best Practices

### When to Use Computer Use

✅ **Good Use Cases:**

- GUI testing and automation
- Screen capture and analysis
- Legacy app interaction (no API)
- Visual workflow recording

❌ **Better Alternatives:**

- File operations → Use `cc_edit`, `cc_write`, `cc_read`
- Command execution → Use `cc_bash`
- Web scraping → Use `cc_webfetch`
- Code analysis → Use `cc_grep`, `cc_glob`

### Workflow Recommendations

1. **Always screenshot first**

   ```typescript
   await cc_computer_use({ action: "screenshot" })
   // Analyze screen before taking action
   ```

2. **Verify before clicking**

   ```typescript
   const pos = await cc_computer_use({ action: "cursor_position" })
   // Confirm position before clicking
   ```

3. **Use descriptive sequences**

   ```typescript
   // Bad: Just click
   await cc_computer_use({ action: "left_click" })

   // Good: Move then click
   await cc_computer_use({
     action: "mouse_move",
     coordinate: [x, y],
   })
   await cc_computer_use({ action: "left_click" })
   ```

## Troubleshooting

### macOS: Permission Issues

```bash
# Check if permissions are granted
tccutil reset ScreenCapture
tccutil reset Accessibility
```

### Linux: xdotool Not Working

```bash
# Install xdotool
sudo apt-get install xdotool

# Test it
xdotool getmouselocation
```

### Screenshots Not Working

```bash
# macOS
screencapture -x test.png

# Linux
import -window root test.png
```

## Future Enhancements

Planned improvements:

- Multi-monitor support
- Window management (activate, minimize, maximize)
- Clipboard integration
- Drag and drop support
- OCR integration for text extraction
- Configurable screenshot quality/size
- Action recording and playback

## Related Tools

- `cc_bash` - Command-line automation
- `cc_edit` - File editing
- `cc_webfetch` - Web content fetching
- MCP servers - Extended capabilities

## References

- [Anthropic Computer Use](https://docs.claude.com/en/docs/agents-and-tools/tool-use/code-execution-tool)
- [cliclick Documentation](https://github.com/BlueM/cliclick)
- [xdotool Documentation](https://www.semicomplete.com/projects/xdotool/)
