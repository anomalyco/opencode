# opencode VS Code Extension

A VS Code extension that integrates [opencode](https://opencode.ai) directly into your development environment.

## Prerequisites

This extension requires [opencode](https://opencode.ai) to be installed on your system. Visit [opencode.ai](https://opencode.ai) for installation instructions.

## Features

- **Cmd+Escape**: Launch opencode in a split terminal view
- **Alt+Cmd+K**: Send selected code to opencode's prompt
- **Tab awareness**: opencode automatically detects which files you have open

## Support

This is an early release. If you encounter issues or have feedback, please create an issue at https://github.com/sst/opencode/issues.

## Development

1. `code sdks/vscode` - Open the `sdks/vscode` directory in VS Code. **Do not open from repo root.**
2. `bun install` - Run inside the `sdks/vscode` directory.
3. Press `F5` to start debugging - This launches a new VS Code window with the extension loaded.

#### Making Changes

`tsc` and `esbuild` watchers run automatically during debugging (visible in the Terminal tab). Changes to the extension are automatically rebuilt in the background.

To test your changes:

1. In the debug VS Code window, press `Cmd+Shift+P`
2. Search for `Developer: Reload Window`
3. Reload to see your changes without restarting the debug session
