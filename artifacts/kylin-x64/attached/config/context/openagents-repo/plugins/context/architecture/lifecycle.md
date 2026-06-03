<!-- Context: openagents-repo/lifecycle | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# Plugin Lifecycle & Packaging

## File Structure for Complex Plugins

For larger plugins, follow this recommended structure:

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # Manifest (required for packaging)
├── commands/                # Custom slash commands
├── agents/                  # Custom agents
├── hooks/                   # Event handlers
└── README.md               # Documentation
```

## The Manifest (`plugin.json`)

```json
{
  "name": "my-plugin",
  "description": "A custom plugin",
  "version": "1.0.0",
  "author": {
    "name": "Your Name"
  }
}
```

The `name` becomes the namespace prefix for commands: `/my-plugin:command`.

## SDK Access

Plugins have full access to the OpenCode SDK via `context.client`. This allows:
- Sending prompts programmatically: `client.session.prompt()`
- Managing sessions: `client.session.list()`, `client.session.get()`
- Showing UI elements: `client.tui.showToast()`
- Appending to prompt: `client.tui.appendPrompt()`
