# SDK KNOWLEDGE BASE

## OVERVIEW

Published JS SDK package; exports main/client/server plus `v2` surfaces and generated code.

## WHERE TO LOOK

- Public exports: `packages/sdk/js/package.json`
- Main entry: `packages/sdk/js/src/index.ts`
- V2 entrypoints: `packages/sdk/js/src/v2`
- Generated clients/types: `packages/sdk/js/src/gen`, `packages/sdk/js/src/v2/gen`
- Build/regeneration: `packages/sdk/js/script/build.ts`

## CONVENTIONS

- Build script is `./script/build.ts`; root regen also calls this.
- Treat `src/gen` and `src/v2/gen` as generated surfaces.
- Keep export map in `package.json` aligned with source entries.

## ANTI-PATTERNS

- Don’t hand-edit generated SDK files.
- Don’t add exports without updating the `exports` map.
- Don’t skip SDK rebuild after API/schema changes.
