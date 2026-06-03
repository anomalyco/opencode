<!-- Context: openagents-repo/overview | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# OpenCode Plugins Overview

OpenCode plugins are JavaScript or TypeScript modules that hook into **25+ events** across the entire OpenCode lifecycle—from when you type a prompt, to when tools execute, to when sessions complete.

## Key Concepts

- **Zero-Config**: No build step or compilation required. Just drop `.ts` or `.js` files into the plugin folder.
- **Middleware Pattern**: Plugins subscribe to events and execute logic, similar to Express.js middleware.
- **Access**: Plugins receive a `context` object with:
  - `project`: Current project metadata.
  - `client`: OpenCode SDK client for programmatic control.
  - `$`: Bun's shell API for running commands.
  - `directory`: Current working directory.
  - `worktree`: Git worktree path.

## Plugin Registration

OpenCode looks for plugins in:
1. **Project-level**: `.opencode/plugin/` (project root)
2. **Global**: `~/.config/opencode/plugin/` (home directory)

## Basic Structure

```typescript
export const MyPlugin = async (context) => {
  const { project, client, $, directory, worktree } = context;

  return {
    event: async ({ event }) => {
      // Handle events here
    }
  };
};
```

Each exported function becomes a separate plugin instance. The name of the export is used as the plugin name.

## Build and Development

OpenCode plugins are typically written in TypeScript and bundled into a single JavaScript file for execution.

### Build Command
Use Bun to bundle the plugin into the `dist` directory:

```bash
bun build src/index.ts --outdir dist --target bun --format esm
```

The output will be a single file (e.g., `./index.js`) containing all dependencies.

### Development Workflow
1. **Source Code**: Write your plugin in `src/index.ts`.
2. **Bundle**: Run the build command to generate `dist/index.js`.
3. **Load**: Point OpenCode to the bundled file or the directory containing the manifest.
4. **Watch Mode**: For rapid development, use the `--watch` flag with Bun build:
   ```bash
   bun build src/index.ts --outdir dist --target bun --format esm --watch
   ```
