# UI KNOWLEDGE BASE

## OVERVIEW

Shared UI system: components, theme, icons, fonts, audio, and cross-app hooks/context.

## WHERE TO LOOK

- Components: `packages/ui/src/components`
- Theme engine: `packages/ui/src/theme`
- Shared hooks/context: `packages/ui/src/hooks`, `packages/ui/src/context`
- Assets: `packages/ui/src/assets`
- Tailwind generation: `packages/ui/script/tailwind.ts`

## CONVENTIONS

- Exports are path-based via `package.json` (`./*`, `./theme/*`, `./context/*`, etc.).
- Typecheck uses `tsgo --noEmit`; dev via Vite.
- Theme tokens/icons are reused across app/enterprise/desktop.

## ANTI-PATTERNS

- Don’t break export paths; downstream packages import via mapped subpaths.
- Don’t duplicate shared UI logic in app-specific packages.
- Don’t edit massive asset/icon sets without checking consumer impact.
