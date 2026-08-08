# Desktop icons

## Source

- Brand source: `packages/desktop/app-icon.png` (square, generated from `packages/ui/src/assets/brand/jarvis-icon.png`)
- UI brand assets: `packages/ui/src/assets/brand/`
  - `jarvis-icon.png` — app mark / splash
  - `jarvis-wordmark.png` — chat / header wordmark

## Regenerate

```bash
# From packages/desktop
python scripts/generate-icons.py
bun run scripts/copy-icons.ts prod
```

Channels: `dev`, `beta`, `prod` under `icons/`. `copy-icons.ts` copies the active channel into `resources/icons`.
