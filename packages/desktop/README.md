# OpenCode Desktop

The OpenCode Desktop app, built with Electron.

## Development

```bash
bun install
bun dev
```

## Build

Run the `build` script to build the app's JS assets, then `package` to
bundle the assets as an application. The resulting app will be in `dist/`.

```bash
bun run build && bun run package
```

## Fork Release Updates

The beta and prod desktop channels publish update metadata to
`https://github.com/1134189025/opencode` releases.

```powershell
$env:OPENCODE_CHANNEL = "prod"
$env:GH_TOKEN = "<github-token>"
bun run build
bun run package -- --publish always
```
