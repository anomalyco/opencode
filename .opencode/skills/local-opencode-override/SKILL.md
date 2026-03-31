---
name: local-opencode-override
description: Use when a repo-local opencode build should replace the installed `opencode` command in your shell, especially after rebuilding `packages/opencode/dist` during local development.
compatibility: opencode
---

# Local opencode override

Use this when you want `opencode` in your shell to run the binary built from this repo instead of a globally installed copy.

## Preferred approach

Follow the existing OpenCode convention and point `~/.opencode/bin/opencode` at the repo build output.

Why this path:

- the install flow already uses `~/.opencode/bin`
- desktop code and GitHub actions already expect that location
- your shell can keep using `opencode` with no extra alias

## Steps

1. Build the current-platform CLI:

   ```bash
   bun run --cwd packages/opencode build --single --skip-embed-web-ui
   ```

2. Link the built binary into the standard user bin location:

   ```bash
   mkdir -p "$HOME/.opencode/bin"
   ln -sf \
     "/absolute/path/to/repo/packages/opencode/dist/opencode-<platform>/bin/opencode" \
     "$HOME/.opencode/bin/opencode"
   ```

   Example for this repo on Apple Silicon:

   ```bash
   ln -sf \
     "/Users/jairadhakrishnan/github.com/jairad26/opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode" \
     "$HOME/.opencode/bin/opencode"
   ```

3. Make sure `~/.opencode/bin` is early in `PATH`.

   For zsh:

   ```bash
   export PATH="$HOME/.opencode/bin:$PATH"
   ```

4. Reload the shell and verify:

   ```bash
   zsh -lc 'hash -r && command -v opencode && opencode --version'
   ```

## Rebuild behavior

The symlink target path stays the same across rebuilds for the same platform, so rerunning the build replaces the binary in place.

## Alternative

If you only want a temporary override, use the launcher support built into `packages/opencode/bin/opencode`:

```bash
OPENCODE_BIN_PATH="/absolute/path/to/repo/packages/opencode/dist/opencode-<platform>/bin/opencode" opencode
```

## Revert

To stop using the repo build:

```bash
rm -f "$HOME/.opencode/bin/opencode"
```

Then reinstall or relink the version you want.
