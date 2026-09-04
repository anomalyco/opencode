# Desktop Large Paste

## Status

Proposed.

## Summary

OpenCode Desktop's current V2 prompt editor stores pasted text in a `contenteditable` element. A large multiline paste is inserted into the DOM, parsed back into prompt parts, copied into SolidJS state, and serialized for draft persistence. The Renderer can become unresponsive and eventually exit with an out-of-memory error.

The proposed design treats sufficiently large plain-text paste as a deferred text attachment. The editor renders only a small attachment representation; the full text is stored out of band and materialized or uploaded only when the prompt is submitted.

This preserves the complete pasted content while removing the large text from the live `contenteditable` DOM.

## Evidence and current behavior

The affected production path is the V2 prompt input:

- `packages/session-ui/src/v2/components/prompt-input/index.tsx`
- `packages/session-ui/src/v2/components/prompt-input/interaction.ts`
- `packages/app/src/components/prompt-input-v2.tsx`

The current input event performs a full editor parse and prompt update. The paste path can call `document.execCommand("insertText", false, text)` for ordinary plain text. The legacy implementation has an 8,000-character large-paste classifier, but the V2 plain-text path does not consistently apply that protection.

Observed debug reports for OpenCode `1.18.27` on Windows show:

- repeated `renderer unresponsive` events;
- samples in `parsePromptInputV2Editor`, `setPrompt`, `JSON.stringify`, and `encode`;
- a final `renderer process gone` event with `reason: oom`.

The currently reproducible test input is approximately 140--170 KB of multiline text. This is an observed failure range, not a guaranteed universal threshold.

## Goals

1. Prevent large plain-text paste from causing Renderer OOM or an unbounded main-thread stall.
2. Preserve the complete text without truncation or lossy normalization beyond line-ending normalization.
3. Keep the draft recoverable across application restarts.
4. Make the pasted content explicit and removable in the prompt UI.
5. Support both local and remote OpenCode Servers.
6. Preserve normal short-paste behavior and existing file/image attachment behavior.
7. Keep all Renderer-to-native operations behind the typed `window.api` preload bridge.

## Non-goals

- Changing model context-window or provider token limits.
- Automatically summarizing or truncating pasted text.
- Parsing pasted text as Markdown, source code, or rich HTML in the editor.
- Replacing normal file attachments.
- Introducing a new durable user-visible project file for every paste.

## User experience

### Short paste

Short plain text continues to be inserted into the editor normally.

### Large paste

When the text exceeds the configured large-paste policy, the paste handler must:

1. prevent the browser's default paste operation;
2. normalize CRLF/CR line endings to LF;
3. store the text as a draft text attachment;
4. add a compact attachment part to the prompt;
5. leave the editor containing only the attachment representation;
6. show a localized non-blocking confirmation, including the approximate size.

The attachment card should show:

- a text-file icon;
- a generated filename such as `pasted-text-<short-id>.txt`;
- size;
- remove action;
- optional preview/open action if supported by the platform.

The complete text must not be rendered inside the `contenteditable` element.

### Failure behavior

If the text cannot be stored, the paste must not partially insert it. The UI should show a localized error and leave the previous prompt unchanged. The failure must not result in an unhandled Promise rejection.

## Threshold policy

The classifier should be implemented as a pure shared utility so the legacy and V2 paths do not maintain different thresholds.

Initial policy:

```ts
const LARGE_PASTE_CHARS = 64 * 1024
const LARGE_PASTE_LINES = 500
```

A paste is classified as large when either threshold is reached. The values are implementation defaults and may be tuned after benchmarking. The policy must be based on JavaScript string length and line count, and must not iterate over the DOM before classification.

The current legacy 8,000-character behavior should not be silently removed until the V2 path has equivalent protection. The final implementation may use the same classifier with a lower manual-insertion threshold and a higher attachment threshold, but those two decisions must be explicit.

## Data model

Add a text attachment variant to the shared prompt state used by V2. It must be distinct from an ordinary text part and from an image attachment.

Conceptual shape:

```ts
type TextAttachmentPart = {
  type: "text-attachment"
  id: string
  filename: string
  mime: "text/plain"
  size: number
  lineCount: number
  blob: {
    id: string
  }
}
```

The persisted prompt contains metadata and a Blob reference, never a data URL containing the complete text. The Blob reference must be stable across draft reloads.

The shared type should be added at the lowest package that owns the V2 prompt model. Do not make `session-ui` depend on `app` to reuse the classifier or attachment type.

## Storage

### Desktop

Use the existing desktop draft Blob store backed by SQLite:

- `packages/app/src/utils/draft-store.ts`
- `packages/desktop/src/main/draft-store.ts`
- `packages/desktop/src/preload/index.ts`

The Renderer may call only the typed platform/draft-store API. It must not access SQLite or the filesystem directly.

The stored Blob should contain UTF-8 text. The generated filename and metadata are stored in the prompt draft document. Blob cleanup must follow existing draft cleanup semantics and remove unreferenced blobs.

### Browser

Use the existing IndexedDB-backed draft store. The same prompt model and attachment behavior should work without a desktop-only branch in the V2 component.

## Submission transport

The attachment must be converted into a file-like request part at submission time. The conversion must happen once, outside the editor input loop.

### Local Server

For a local Server, materialize the Blob as an application-owned temporary `.txt` file and submit a file reference that the local Server can read. The temporary file must:

- use an application-owned directory;
- use a generated name, never user-controlled path components;
- be created atomically;
- be cleaned up after submission or by age-based cleanup;
- remain available long enough for the Server to consume it.

The materialization operation must be exposed through the preload bridge and registered in `packages/desktop/src/main/ipc.ts`.

### Remote Server

A local filesystem path must never be sent to a remote Server. The attachment must be uploaded through an explicit attachment/upload API and the request must reference the returned remote attachment ID or URL.

If the existing protocol cannot represent uploaded text attachments, add the smallest protocol extension needed. After changing the public Protocol or Server `HttpApi`, regenerate the client output from `packages/client` using the repository's generation command; never edit generated files directly.

The upload path should avoid creating a base64 data URL in the prompt state. Streaming or bounded chunked upload is preferred for future larger limits.

## Prompt request semantics

The user must be able to ask the Agent to analyze the pasted text without relying on the Agent guessing that a local path should be opened.

The submitted request should represent the item as an explicit text file part with:

- `mime: "text/plain"`;
- generated filename;
- file/blob source metadata;
- the original attachment identity for optimistic UI and retry handling.

The prompt text itself should remain the user's typed text around the attachment. The implementation must not silently duplicate the complete attachment text into a normal `TextPartInput`.

## Component changes

### V2 input

Update the V2 paste handler so classification occurs before either `execCommand` or DOM insertion. Large text must take the attachment path and return immediately.

Update the V2 editor renderer/parser so `text-attachment` parts have a compact non-editable representation and are never expanded into the editor DOM.

The editor's `onInput` handler must not parse attachment content. Its input value should contain only the visible marker/metadata representation.

### Attachment UI

Extend the V2 attachment card list to render text attachments separately from images. Reuse existing attachment removal and draft identity patterns where possible.

All new visible copy, accessible labels, tooltips, errors, and confirmation messages must use the typed localization APIs. Do not hardcode English strings.

### Legacy input

Keep legacy behavior compatible. Move the pure classifier into a shared lower-level module or export it from the package that owns the shared input behavior. Avoid two independently maintained implementations of the character and line thresholds.

## Security and privacy

- Treat clipboard text as untrusted data.
- Store pasted text only in the application draft store or the explicitly created temporary attachment.
- Do not interpret pasted text as HTML or execute it.
- Do not use clipboard text to construct a path.
- Do not expose local temporary paths to remote Servers.
- Apply per-attachment and total-draft size limits.
- Clean up orphaned and expired temporary materializations.
- Preserve the existing authorization boundary for file reads and uploads.

## Performance requirements

For a large paste, the critical paste event must not:

- insert the complete text into `contenteditable`;
- call `parsePromptInputV2Editor` over the complete text;
- call `document.execCommand` with the complete text;
- synchronously JSON serialize the complete text as part of prompt state updates.

The visible editor update should remain bounded by attachment metadata size. Blob persistence may be asynchronous, but the UI must expose a pending state and must not submit an attachment before storage succeeds.

## Testing

Testing is part of the implementation for every phase. The model or developer implementing a phase must add or update the phase-specific test scripts, run them locally, and report the exact commands and results before declaring that phase complete. A test plan without an executable test or an executed result is not completion evidence.

Tests must run from the affected package directories, not from the repository root. Do not restart the application or Server process as part of automated verification.

### Unit tests

Add tests for:

- short single-line paste classification;
- multiline classification;
- exactly-at-threshold and just-over-threshold values;
- CRLF normalization;
- preservation of text length and content after storage/reload;
- generated filename and metadata;
- duplicate attachment identity where applicable;
- failed Blob storage leaving the prompt unchanged.

### Component tests

Verify that:

- a large paste does not call `execCommand`;
- a large paste does not insert the full string into the editor DOM;
- the editor contains only the attachment representation;
- removing the attachment restores an empty/valid prompt state;
- short paste still behaves as before;
- attachment drafts survive a reload.

### Integration tests

Verify local submission and remote submission independently:

- local submission materializes and reads the complete text;
- remote submission uploads the complete text and sends no local path;
- retries do not duplicate the attachment;
- expired temporary files are cleaned up;
- failed uploads do not leave the prompt in a falsely submitted state.

### Regression input

Use at least these fixtures:

- 8 KB single-line text;
- 64 KB multiline text;
- 140--170 KB multiline text matching the current reproduction;
- a Spring Boot/IDEA-style error log with stack traces and mixed punctuation;
- text containing CRLF, Unicode, tabs, blank lines, and long single lines.

## Phase-specific test scripts and self-verification

Each phase must leave behind a repeatable test entry point. The implementation model must run the relevant checks after making changes, inspect failures, and either fix them or clearly report the blocking failure. It must not claim that a test passed when the command was not run.

### Phase 1 test script: Renderer safety

Add focused unit/component coverage for the shared classifier and the V2 paste boundary. The script must verify that the 140--170 KB multiline fixture is classified before DOM insertion and that the large-paste path does not call `execCommand` or insert the complete text into `contenteditable`.

Required checks:

```text
packages/session-ui: bun typecheck
packages/session-ui: bun test src/v2/components/prompt-input
packages/app:        bun typecheck
packages/app:        bun test test-browser/prompt-attachments.test.ts
```

If the V2 paste tests are placed in `packages/app`, run the equivalent focused test path there and document the actual command. The phase is not complete until the regression fixture passes and a manual smoke test confirms that the editor remains responsive.

### Phase 2 test script: Local text attachments

Add a repeatable local attachment test covering storage, reload, rendering, removal, materialization, and submission. The test must assert byte-for-byte or character-for-character preservation of the pasted text and verify that the live editor DOM contains only attachment metadata.

Required checks:

```text
packages/session-ui: bun typecheck
packages/session-ui: bun test src/v2/components/prompt-input
packages/app:        bun typecheck
packages/app:        bun test test-browser/prompt-attachments.test.ts
packages/desktop:    bun typecheck
packages/desktop:    bun test src/main/draft-store.test.ts src/main/ipc.test.ts
```

If a listed test file does not exist yet, create the appropriate focused test file rather than silently omitting the check. Add a scripted fixture runner for the current large-paste file so the same 140--170 KB input can be used in local and CI verification.

### Phase 3 test script: Remote attachments

Add an integration test that exercises the complete remote flow: create draft Blob, upload, receive attachment identity, submit a prompt, and verify that the remote Server can read the complete text. The test must explicitly assert that no local Windows path is sent to the remote Server.

Required checks:

```text
packages/client:   bun typecheck
packages/client:   bun test
packages/server:   bun typecheck
packages/opencode: bun typecheck
packages/app:      bun typecheck
packages/app:      bun test test-browser/prompt-attachments.test.ts
```

If the public Protocol or Server `HttpApi` changes, the phase test script must run `bun run generate` from `packages/client` and verify that generated output is clean. Generated files must not be edited directly.

### Self-verification report

Every implementation turn must end with a concise verification report containing:

1. files changed;
2. test scripts added or updated;
3. exact commands run, including working directories;
4. pass/fail result for each command;
5. manual reproduction result for the 140--170 KB fixture when the phase affects the paste path;
6. known limitations or tests not run.

The model must perform this verification before handing off the change. If a test cannot run because dependencies or environment setup are missing, the model must report that fact and must not present the phase as fully verified.

## Rollout plan

### Phase 1: Renderer safety

1. Share the paste classifier.
2. Apply the classifier to V2 before DOM insertion.
3. Add a safe attachment or, if storage is unavailable, reject large paste with a localized error.
4. Add regression tests for the current 140--170 KB reproduction.
5. Add and run the Phase 1 test script and include its self-verification report.

### Phase 2: Local text attachments

1. Add the text attachment prompt model.
2. Persist text as a draft Blob.
3. Render and remove the attachment in V2.
4. Materialize local temporary files through Main/Preload IPC.
5. Convert local attachments into existing file request parts.
6. Add and run the Phase 2 test script and include its self-verification report.

### Phase 3: Remote attachments

1. Define the upload/attachment protocol.
2. Generate the client from the public API definition.
3. Add remote upload, retry, cleanup, and authorization behavior.
4. Run local and remote end-to-end tests.
5. Add and run the Phase 3 test script and include its self-verification report.

## Acceptance criteria

The change is complete when:

1. Pasting the current 140--170 KB reproduction into a fresh Desktop session does not make the Renderer unresponsive or cause OOM.
2. The full pasted text can be submitted and is readable by the target Server.
3. Draft reload restores the text attachment without expanding it into the editor DOM.
4. Remote submissions never depend on a local filesystem path.
5. Short paste and normal image/file attachments remain compatible.
6. New UI copy is localized and the relevant package type checks and tests pass.

## Open decisions

- Final character and line thresholds after a production-like benchmark.
- Whether the first release exposes an attachment preview/open action.
- Exact remote upload API shape and retention policy.
- Whether local materialization should occur at paste time or just before submission.
