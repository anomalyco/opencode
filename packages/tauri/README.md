# Tauri + Vanilla TS

This template should help get you started developing with Tauri in vanilla HTML, CSS and Typescript.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Making Builds

First you need to make a build of the opencode cli tool.

```bash
bun -F opencode build
```

To create a production build, run the following command:

```bash

# for rpm only build
bun -F @opencode-ai/tuari tauri build --bundles rpm
```

