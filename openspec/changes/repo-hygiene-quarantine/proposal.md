## Why

The repo tracks 5 file(s) that are also gitignored, under: .opencode/, .vscode/, packages/.
This guarantees merge-integrity failures ("working tree not clean") on
every publish once those paths are regenerated locally (the psychobabble
incident: 6,646 tracked node_modules/ files broke every merge).

## What Changes

Untrack the offending paths with `git rm --cached` so the working tree
matches .gitignore. No file content changes — this only removes paths from
git's index.

## Non-Goals

- Does not change .gitignore itself (assumed already correct, or update it
  alongside if any listed path should in fact remain tracked).

## Offending paths (sample)

- `.opencode/.gitignore`
- `.opencode/themes/.gitignore`
- `.vscode/launch.example.json`
- `.vscode/settings.example.json`
- `packages/opencode/script/build-node.ts`

