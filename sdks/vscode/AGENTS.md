# VSCODE SDK KNOWLEDGE BASE

## OVERVIEW

VS Code extension package that launches/focuses opencode terminal sessions and injects file refs.

## WHERE TO LOOK

- Extension entry: `sdks/vscode/src/extension.ts`
- Packaging/build scripts: `sdks/vscode/package.json`
- Bundling: `sdks/vscode/esbuild.js`
- Dev workflow: `sdks/vscode/README.md`

## CONVENTIONS

- `main` entry is `dist/extension.js`.
- Build path: `check-types` + `lint` + `esbuild`.
- Extension dev should open `sdks/vscode` directly in VS Code (not repo root).

## ANTI-PATTERNS

- Don’t edit dist output directly.
- Don’t skip lint/type checks before packaging.
- Don’t change keybindings/commands without updating contributes metadata.
