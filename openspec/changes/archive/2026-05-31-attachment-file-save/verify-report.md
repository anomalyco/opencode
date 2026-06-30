# Verification Report: Attachment File Save

**Change:** `attachment-file-save`  
**Date:** 2026-05-31  
**Status:** PASS (with warnings)

---

## Summary

| Area | Result |
|------|--------|
| Config schema (R1) | ✅ PASS |
| File save on receipt (R2) | ✅ PASS |
| Error message enhancement (R3) | ✅ PASS |
| Vision model non-regression (R5) | ✅ PASS |
| Edge cases (R4) | ⚠️ PASS (minor gap) |
| Tests pass | ✅ 18/18 relevant tests pass |
| Code review | ⚠️ Warnings |

---

## Test Results

| Test file | Tests | Result |
|-----------|-------|--------|
| `test/config/attachment-save.test.ts` | 7/7 | ✅ PASS |
| `test/util/attachment-save.test.ts` | 6/6 | ✅ PASS |
| `test/provider/transform.test.ts` (unsupportedParts) | 4/4 | ✅ PASS |
| `test/session/prompt.test.ts` (attachment save) | 1/1 | ✅ PASS |
| **Total** | **18/18** | **✅ PASS** |

---

## Requirements Verification

### R1: Config Schema — ✅ PASS

- `save_to_disk: Schema.optional(Schema.Boolean)` in `packages/opencode/src/config/attachment.ts` line 24 ✅
- `save_to_disk_path: Schema.optional(Schema.String)` in `packages/opencode/src/config/attachment.ts` line 27 ✅
- Mirrored in `packages/core/src/config/attachments.ts` lines 15-16 ✅
- `metadata` field added to `FilePart` in `packages/core/src/session/legacy.ts` line 166 ✅
- Defaults applied when omitted: schema allows `undefined`, application-layer treats `undefined` as `true` ✅
- Custom path respected: tested ✅
- Save disabled (`false`): code returns `undefined` before writing ✅

### R2: File Save on Receipt — ✅ PASS

- `resolvePart()` `case "data:"` in `prompt.ts` lines 874-887 hooks binary mime types ✅
- `Buffer.from(body, "base64")` decodes payload ✅
- `fs.writeFile()` writes to `{base}/{sessionID}/{timestamp}-{filename}` ✅
- Saved path stored as `metadata.savedPath` on the part ✅
- `text/plain` handled in separate early-return branch, no file written ✅

### R3: Error Message Enhancement — ✅ PASS

- `transform.ts` `unsupportedParts()` line 424-428 appends `(saved to {path})` when `savedPath` present ✅
- No suffix appended when `savedPath` absent ✅
- Both cases tested ✅

### R4: Edge Cases — ⚠️ PASS

| Spec scenario | Implementation | Status |
|--------------|----------------|--------|
| No write permission | `writeFileSafe` catches all errors, returns `undefined` | ✅ PASS |
| Disk full (ENOSPC) | Caught by `Effect.catch` on writeFileSafe | ✅ PASS |
| Existing file conflict | Timestamp prefix guarantees uniqueness | ✅ PASS |
| Warning logged on failure | `log.warn("failed to save attachment to disk", ...)` | ✅ PASS |

**Minor gap:** "PDF saved to disk" is implemented (condition includes `application/pdf`) but no explicit test with a PDF data URL exists. Only image/png is tested.

### R5: Vision Model Non-Regression — ✅ PASS

- `transform.ts` checks `model.capabilities.input[modality]` before reaching `savedPath` logic ✅
- Vision model test passes file through unchanged ✅
- Integration verified at the transform layer ✅

---

## Code Review

### ✅ Good Practices

- All new/modified code uses `const` (no `let`)
- No `else` blocks — early return pattern throughout
- No `try-catch` — uses `Effect.catch` for error handling
- Public functions have type annotations
- Named exports used consistently
- ASCII-only identifiers, no hardcoded secrets

### ⚠️ Warnings

| Severity | Finding | Location |
|----------|---------|----------|
| WARNING | `as any` cast used (by design per SDD design doc, but violates project TypeScript convention of no `any`) | `prompt.ts:884`, `message-v2.ts:245`, `transform.ts:424-425` |
| WARNING | Spec says "save_to_disk MUST be `true`" when omitted, but schema returns `undefined` — defaulting is at application layer, not schema layer | `attachment-save.test.ts:11`, `attachment.ts:24` |
| WARNING | No explicit test for PDF attachment save (R2 — PDF scenario) | missing from `attachment-save.test.ts` |

### 💡 Suggestions

| Severity | Finding | Location |
|----------|---------|----------|
| SUGGESTION | `metadata` assignment overwrites existing metadata on the part instead of merging — consider `{ ...metadata, savedPath }` | `prompt.ts:884` |
| SUGGESTION | `extractFileName` uses `url.indexOf(",")` from position 0 instead of `url.indexOf(",", semicolon + 1)` — works for valid data URLs but fragile for malformed input | `attachment-save.ts:58` |
| SUGGESTION | Consider adding a PDF attachment test with `application/pdf` data URL to fully cover R2 | `attachment-save.test.ts` |

---

## Verdict

**NEXT: ready-for-archive**

Implementation matches the spec, design, and tasks. All 18 relevant tests pass. The `as any` casts are by design (documented in the SDD design). Minor test gap for PDF is acceptable since the code path is identical to image (same condition, same save function).
