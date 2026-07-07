# fix(desktop): prevent prompt hangs for UNC workspace file references

Closes #31627

## Summary
- Fixes UNC/network workspace file references being serialized as `file:////...`, which led to `ERR_INVALID_FILE_URL_PATH` during prompt part resolution.
- Adds server-side guards so invalid file URLs degrade into a surfaced read failure instead of failing the whole async prompt flow.
- Prevents the desktop UI from being stuck in loading when a file URL cannot be resolved.

## Root cause
- File parts were built from:
  - `url = file://${encodeFilePath(path)}`
- For UNC paths like `\\server\share\project\src\file.ts`, this produced `file:////server/share/...`.
- `fileURLToPath(...)` then failed in prompt resolution, causing `prompt_async` to error before normal status transitions and leaving optimistic busy state in place.

## Changes
- `packages/app/src/components/prompt-input/build-request-parts.ts`
  - Added UNC-aware file URL construction:
    - UNC paths now use `file:${encodeFilePath(path)}` (resulting in `file://server/share/...`).
    - Non-UNC behavior remains `file://${encodeFilePath(path)}`.
- `packages/opencode/src/session/prompt.ts`
  - Added defensive handling for malformed/invalid file URLs:
    - Invalid `part.url` parsing now emits a `session.error` event and a synthetic read-failure text part.
    - `fileURLToPath(...)` failures now emit `session.error` and return a synthetic read-failure text part instead of throwing.

## Tests
- `packages/app/src/components/prompt-input/build-request-parts.test.ts`
  - Added regression for UNC workspace path URL generation:
    - ensures generated URLs are `file://server/share/project/...`
    - ensures URLs do not start with `file:////`
- `packages/app/src/context/file/path.test.ts`
  - Added UNC path encoding coverage for `encodeFilePath`.
- `packages/opencode/test/session/prompt.test.ts`
  - Added regression ensuring invalid file URL parts do not fail prompt creation and instead surface a read failure.

## Validation
Attempted:
- `bun --cwd /home/calelin/dev/opencode/packages/app test src/components/prompt-input/build-request-parts.test.ts src/context/file/path.test.ts`
- `bun --cwd /home/calelin/dev/opencode/packages/opencode test test/session/prompt.test.ts --filter "invalid file URL"`
- `bun --cwd /home/calelin/dev/opencode/packages/app typecheck`
- `bun --cwd /home/calelin/dev/opencode/packages/opencode typecheck`

Result in current environment:
- `bun` is not installed (`Command 'bun' not found`).

---

Branch: `private/clear-session-context`
Base: `dev`
