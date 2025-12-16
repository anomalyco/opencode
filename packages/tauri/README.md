# Tauri + Vanilla TS

This template should help get you started developing with Tauri in vanilla HTML, CSS and Typescript.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Making Builds

First you need to make a build of the opencode cli tool.

```bash
bun -F opencode build
```

Then you need to prepare for making a Tauri build by running:

```bash
cd packages/tauri; bun ./scripts/prepare.ts; cd ../..
```

Now you can create a local build with:

```bash
# for rpm only build
env TAURI_CONFIG_BUNDLE_CREATEUPDATERARTIFACTS=false \
  bun -F @opencode-ai/tuari tauri build --bundles rpm
```

