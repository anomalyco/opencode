# Tasks: Attachment File Save

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~320 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr-default |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: Config Schema

- [x] 1.1 Add `save_to_disk` + `save_to_disk_path` to `packages/opencode/src/config/attachment.ts` `Info` struct — optional Bool/String with defaults
- [x] 1.2 Mirror same fields on `packages/core/src/config/attachments.ts` `Info` class via `.pipe(Schema.optional)`
- [x] 1.3 Add `metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any))` to `FilePart` in `packages/core/src/session/legacy.ts`
- [x] 1.4 Write test: config defaults applied when omitted, custom path respected, save disabled (`packages/opencode/test/config/attachment-save.test.ts`)

## Phase 2: Core Save Logic

- [x] 2.1 Create `packages/opencode/src/util/attachment-save.ts` with `saveDataUrlToFile(url, cfg, sessionID)` → `Effect<string | undefined>` — parse base64, mkdir, writeFile, return path or undefined on error
- [x] 2.2 Write unit test: `packages/opencode/test/util/attachment-save.test.ts` — mock fs, cover save enabled/disabled, write error, custom path, existing file conflict, ENOSPC

## Phase 3: Pipeline Integration

- [x] 3.1 Hook save in `packages/opencode/src/session/prompt.ts` `case "data:"` — after text/plain check, call `saveDataUrlToFile()` for `image/*` and `application/pdf`, store path on `metadata.savedPath`
- [x] 3.2 Thread `savedPath` in `packages/opencode/src/session/message-v2.ts` — when building AI SDK file part, pass `part.metadata?.savedPath`
- [x] 3.3 Append path in `packages/opencode/src/provider/transform.ts` `unsupportedParts()` — add `(saved to {savedPath})` when present on part

## Phase 4: Integration Tests

- [x] 4.1 Add integration test in `packages/opencode/test/session/prompt.test.ts` — send data: URL image, verify `metadata.savedPath` on FilePart
- [x] 4.2 Add `unsupportedParts` test in `packages/opencode/test/provider/transform.test.ts` — mock text-only model, verify error contains saved path, and no path when absent
- [x] 4.3 Add non-regression test: vision model receives image transparently with save enabled (R5)

## Phase 5: Cleanup

- [x] 5.1 Verify backward compat — legacy config with no attachment block still works
