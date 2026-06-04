# Design: Telegram Feature Gaps — Formatting, Splitting, Media Store

**Status**: Approved
**Date**: 2026-06-03

## Scope

Implement three missing Telegram features identified by comparison with PicoClaw:
1. Markdown → Telegram HTML/MarkdownV2 formatting (shared utility for all plugins)
2. Message splitting at Telegram's 4096-char boundary
3. Media Store for downloading and referencing inbound media files

**Non-goals**: Tool feedback animation, placeholder messages, streaming, command registration, proxy support.

## Architecture

```
channels/
  runtime/
    formatting.ts        ← NEW: markdownToTelegramHTML, markdownToTelegramMarkdownV2
    media-store.ts       ← NEW: Effect service for download + store + resolve
    index.ts             ← MODIFIED: export new modules
  transports/
    telegram-plugin.ts   ← MODIFIED: use formatting on send, download media on inbound
```

Data flow for send:
```
LLM text (markdown) → markdownToTelegramHTML() → HTML string → Telegram API (parse_mode=HTML)
```

Data flow for inbound media:
```
Telegram API (file_id) → downloadFile() → local path → mediaStore.store(ref) → InboundMessage.media[].ref
```

## Module 1: Markdown Formatting (`runtime/formatting.ts`)

### Design

Pure functions (no Effect, no service layer). Follows PicoClaw's proven placeholder-extraction regex pipeline:

1. Extract code blocks (` ``` `) → placeholders
2. Extract inline code (` ` `) → placeholders
3. Extract markdown links (`[label](url)`) → placeholders
4. Extract raw URLs → placeholders
5. Convert headings → plain text
6. Convert blockquotes → plain text
7. Escape remaining HTML (`&`, `<`, `>`)
8. Convert `**bold**`, `__bold__` → `<b>`
9. Convert `_italic_` → `<i>`
10. Convert `~~strikethrough~~` → `<s>`
11. Convert list items → `• `
12. Restore placeholders: code blocks as `<pre><code>`, inline as `<code>`, links as `<a href>`

### Exports

```ts
// Default parse mode (recommended): HTML
export function markdownToTelegramHTML(text: string): string

// Alternative: MarkdownV2 (stricter escaping required)
export function markdownToTelegramMarkdownV2(text: string): string

// Fit content within parsed-length limit for tool feedback
export function fitContent(
  content: string,
  formatFn: (s: string) => string,
  maxParsedLen: number,
): string
```

### Default: HTML parse mode

- Simpler escaping: only `&`, `<`, `>`
- Telegram HTML supports: `<b>`, `<i>`, `<s>`, `<code>`, `<pre>`, `<a href>`, `<u>`, `<ins>`, `<del>`
- Covers >95% of markdown use cases
- MarkdownV2 requires escaping 15+ special characters in text — error-prone

## Module 2: Message Splitting

### Location

Inline in `telegram-plugin.ts` as a private method. Telegram's 4096-char limit is platform-specific.

### Algorithm (`splitMessage(text: string, targetLen: number): string[]`)

1. If `text.length <= targetLen`, return `[text]`
2. Find newline before `targetLen` — split there
3. If no newline, find space before `targetLen` — split there
4. Fallback: hard split at `targetLen`
5. Recurse on remainder

Respects code blocks: never split inside ` ``` ` fences.

### Integration

In `send()`: if formatted content exceeds 4096 chars, split and send as multiple messages. First chunk preserves `reply_to_message_id`; subsequent chunks omit it.

## Module 3: Media Store (`runtime/media-store.ts`)

### Design

Effect service following project convention (`Context.Service`, `Layer.effect`).

### Interface

```ts
export interface MediaMeta {
  filename: string
  source: string         // "telegram", "discord", etc.
  cleanupPolicy: "delete_on_cleanup" | "keep"
}

export interface Interface {
  /** Store a local file and return a ref key */
  readonly store: (localPath: string, meta: MediaMeta, scope: string) => Effect.Effect<string>
  /** Resolve a ref to its local filesystem path */
  readonly resolve: (ref: string) => Effect.Effect<string>
  /** Remove all files under the given scope */
  readonly cleanup: (scope: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MediaStore") {}
```

### Storage

- Root: `<opencode_data>/channels/media/`
- Structure: `<root>/<scope>/<filename>`
- Scope format: `telegram:123456:789` (platform:chatID:messageID)
- Ref is the relative path from root

### Integration in telegram-plugin.ts

Current stub in `extractInboundMedia()`:
```ts
{ type: "image", data: new Uint8Array(0), mimeType: "image/jpeg" }
```

New pattern with media store:
```ts
// 1. Download file from Telegram
const localPath = yield* downloadFile(fileID, ".jpg")
// 2. Store in media store with scope
const ref = yield* mediaStore.store(localPath, {
  filename: "photo.jpg",
  source: "telegram",
  cleanupPolicy: "delete_on_cleanup",
}, scope)
// 3. Use ref in media part
{ type: "image", ref, mimeType: "image/jpeg" }
```

### Downloading

New private methods on TelegramChannel:
```ts
private downloadFile(fileID: string, ext: string): Effect.Effect<string>
private downloadPhoto(fileID: string): Effect.Effect<string>
```

Flow: `bot.getFile(fileID)` → extract `file_path` → construct download URL → fetch → write to temp dir → return path.

### InboundMessage contract update

`MediaPart` already has `data: Uint8Array`. We add optional `ref` for store-backed media:
```ts
// contracts/media.ts
export interface MediaPart {
  type: "image" | "video" | "audio" | "document"
  data: Uint8Array
  filename?: string
  mimeType?: string
  ref?: string          // NEW: media store reference
}
```

## Error Handling

### Formatting
- Empty input → return `""`
- Parse failure (shouldn't happen with regex pipeline) → fallback to raw markdown
- Code block extraction failure → treat text as-is

### Media Store
- File not found on resolve → `Effect.fail`
- Download failure → log, skip media, continue with text-only message
- Disk full → `Effect.fail` (OS error)
- Telegram file not found (expired) → skip, log warning

### Message Splitting
- Content with only code blocks longer than 4096 → hard split inside code block (rare edge case)
- Zero-length chunk after split → skip

## Testing Strategy

- `formatting.test.ts`: Unit tests for each regex conversion, edge cases (nested bold in italic, URLs in code blocks, empty input)
- `media-store.test.ts`: Store/resolve/cleanup with temp directory
- Telegram plugin: Existing structure — no test harness yet

## Rollout

All changes are additive — no breaking changes to existing interfaces:
- `MediaPart.ref` is optional — existing code ignores it
- Formatting is opt-in per plugin — only telegram-plugin.ts calls it initially
- Media store is a new service — `defaultLayer` provides it when consumed

## Failure Mode Check

1. **Regex formatting corrupts valid markdown**: Code blocks and inline code are extracted first, so `**bold**` inside `code` is safe. Links inside code blocks are extracted as text. Severity: minor.
2. **Large media downloads OOM**: Download streams to disk via `Bun.file(path).writer()`, not buffered in memory. Severity: mitigated.
3. **MarkdownV2 strict escaping**: MarkdownV2 requires escaping `_ * [ ] ( ) ~ \` > # + - = | { } . !`. If user configures MarkdownV2 but LLM outputs unescaped special chars, messages fail. Mitigation: Default to HTML parse mode (simpler escaping). Severity: minor — documented as config option.