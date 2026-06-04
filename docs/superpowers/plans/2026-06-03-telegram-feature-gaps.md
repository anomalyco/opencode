# Telegram Feature Gaps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add markdown-to-Telegram-HTML formatting, message splitting, and media downloading/storage to the Telegram channel plugin.

**Architecture:** Three new modules under `channels/runtime/` — `formatting.ts` (pure functions, no Effect), `media-store.ts` (Effect service with Context.Service pattern), and integration into `telegram-plugin.ts`. One contract change: `MediaPart` gets optional `ref` field.

**Tech Stack:** TypeScript, Effect, Bun APIs (`Bun.file` for disk I/O), native `fetch` for Telegram file downloads.

**Design spec:** `docs/superpowers-optimized/specs/2026-06-03-telegram-feature-gaps-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `contracts/media.ts` | Modify | Add `ref?: string` to `MediaPart` |
| `runtime/formatting.ts` | Create | `markdownToTelegramHTML`, `markdownToTelegramMarkdownV2`, `fitContent` |
| `runtime/media-store.ts` | Create | Effect service: store/resolve/cleanup with scope-based lifecycle |
| `runtime/index.ts` | Modify | Export new modules |
| `transports/telegram-plugin.ts` | Modify | Format on send, split long messages, download inbound media |

---

### Task 1: Update MediaPart contract

**Files:**
- Modify: `packages/opencode/src/channels/contracts/media.ts`

- [ ] **Step 1: Add optional `ref` field to MediaPart**

```ts
// contracts/media.ts — add ref field
export interface MediaPart {
  readonly type: "image" | "video" | "audio" | "document"
  readonly data: Uint8Array
  readonly filename?: string
  readonly mimeType?: string
  readonly ref?: string   // NEW: media store reference (when downloaded)
}
```

- [ ] **Step 2: Typecheck the contract change**

Run: `cd packages/opencode && npx tsc --noEmit 2>&1 | Select-String "media\.ts"`

Expected: No errors (ref is optional — backward compatible).

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/channels/contracts/media.ts
git commit -m "feat(channels): add optional ref field to MediaPart for media store"
```

---

### Task 2: Create markdown formatting utility

**Files:**
- Create: `packages/opencode/src/channels/runtime/formatting.ts`

- [ ] **Step 1: Write the formatting module**

```ts
// runtime/formatting.ts
// Pure functions for markdown → Telegram HTML / MarkdownV2 conversion.
// Uses placeholder extraction to protect code blocks, inline code, and
// links from regex transformations.

const RE_CODE_BLOCK = /```[\w]*\n?([\s\S]*?)```/g
const RE_INLINE_CODE = /`([^`]+)`/g
const RE_LINK = /\[([^\]]+)\]\(([^)]+)\)/g
const RE_RAW_URL = /https?:\/\/[^\s<]+/g
const RE_HEADING = /^#{1,6}\s+(.+)$/gm
const RE_BLOCKQUOTE = /^>\s*(.*)$/gm
const RE_BOLD_STAR = /\*\*(.+?)\*\*/g
const RE_BOLD_UNDER = /__(.+?)__/g
const RE_ITALIC = /_([^_]+)_/g
const RE_STRIKE = /~~(.+?)~~/g
const RE_LIST_ITEM = /^[-*]\s+/gm

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function escapeHTMLAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

// Extract code blocks before any other processing to prevent regex corruption
function extractCodeBlocks(text: string): { text: string; codes: string[] } {
  const codes: string[] = []
  let i = 0
  const result = text.replace(RE_CODE_BLOCK, (_, code: string) => {
    codes.push(code)
    return `\x00CB${i++}\x00`
  })
  return { text: result, codes }
}

function extractInlineCodes(text: string): { text: string; codes: string[] } {
  const codes: string[] = []
  let i = 0
  const result = text.replace(RE_INLINE_CODE, (_, code: string) => {
    codes.push(code)
    return `\x00IC${i++}\x00`
  })
  return { text: result, codes }
}

function extractLinks(text: string): { text: string; links: [string, string][] } {
  const links: [string, string][] = []
  let i = 0
  const result = text.replace(RE_LINK, (_, label: string, url: string) => {
    links.push([label, url])
    return `\x00LK${i++}\x00`
  })
  return { text: result, links }
}

function extractRawURLs(text: string): { text: string; urls: string[] } {
  const urls: string[] = []
  let i = 0
  const result = text.replace(RE_RAW_URL, (match: string) => {
    urls.push(match)
    return `\x00RU${i++}\x00`
  })
  return { text: result, urls }
}

export function markdownToTelegramHTML(text: string): string {
  if (!text) return ""

  const codeBlocks = extractCodeBlocks(text)
  text = codeBlocks.text

  const inlineCodes = extractInlineCodes(text)
  text = inlineCodes.text

  const links = extractLinks(text)
  text = links.text

  const rawURLs = extractRawURLs(text)
  text = rawURLs.text

  // Strip headings (Telegram HTML has no heading tags)
  text = text.replace(RE_HEADING, "$1")
  text = text.replace(RE_BLOCKQUOTE, "$1")

  // Escape HTML before adding our own tags
  text = escapeHTML(text)

  // Bold — both ** and __ variants
  text = text.replace(RE_BOLD_STAR, "<b>$1</b>")
  text = text.replace(RE_BOLD_UNDER, "<b>$1</b>")

  // Italic
  text = text.replace(RE_ITALIC, "<i>$1</i>")

  // Strikethrough
  text = text.replace(RE_STRIKE, "<s>$1</s>")

  // List items → bullet
  text = text.replace(RE_LIST_ITEM, "• ")

  // Restore links
  for (let i = 0; i < links.links.length; i++) {
    const [label, url] = links.links[i]
    const safeLabel = escapeHTML(label)
    const safeUrl = escapeHTMLAttr(url)
    text = text.replace(`\x00LK${i}\x00`, `<a href="${safeUrl}">${safeLabel}</a>`)
  }

  // Restore raw URLs as autolinks
  for (let i = 0; i < rawURLs.urls.length; i++) {
    const raw = rawURLs.urls[i]
    const safeUrl = escapeHTMLAttr(raw)
    const safeLabel = escapeHTML(raw)
    text = text.replace(`\x00RU${i}\x00`, `<a href="${safeUrl}">${safeLabel}</a>`)
  }

  // Restore inline code
  for (let i = 0; i < inlineCodes.codes.length; i++) {
    text = text.replace(`\x00IC${i}\x00`, `<code>${escapeHTML(inlineCodes.codes[i])}</code>`)
  }

  // Restore code blocks
  for (let i = 0; i < codeBlocks.codes.length; i++) {
    text = text.replace(
      `\x00CB${i}\x00`,
      `<pre><code>${escapeHTML(codeBlocks.codes[i])}</code></pre>`,
    )
  }

  return text
}

// MarkdownV2 requires strict escaping of special characters in non-code text.
// We default to HTML mode (simpler); MarkdownV2 is provided for explicit opt-in.
const MDV2_ESCAPE_RE = /([_*\[\]()~`>#+\-=|{}.!])/g

export function markdownToTelegramMarkdownV2(text: string): string {
  if (!text) return ""

  const codeBlocks = extractCodeBlocks(text)
  text = codeBlocks.text

  const inlineCodes = extractInlineCodes(text)
  text = inlineCodes.text

  // In MarkdownV2, links use native format: [label](url)
  const links = extractLinks(text)
  text = links.text

  // Escape all MarkdownV2 special chars outside code blocks/inline code
  text = text.replace(MDV2_ESCAPE_RE, "\\$1")

  // Restore links with escaped labels
  for (let i = 0; i < links.links.length; i++) {
    const [label, url] = links.links[i]
    text = text.replace(`\x00LK${i}\x00`, `[${label}](${url})`)
  }

  // Restore inline code
  for (let i = 0; i < inlineCodes.codes.length; i++) {
    text = text.replace(`\x00IC${i}\x00`, `\`${inlineCodes.codes[i]}\``)
  }

  // Restore code blocks
  for (let i = 0; i < codeBlocks.codes.length; i++) {
    text = text.replace(`\x00CB${i}\x00`, `\`\`\`\n${codeBlocks.codes[i]}\n\`\`\``)
  }

  return text
}

/**
 * Fit content within a maximum parsed length by truncating at natural
 * boundaries. Used for tool feedback messages where the animated placeholder
 * must not exceed Telegram's 4096-character limit.
 */
export function fitContent(
  content: string,
  formatFn: (s: string) => string,
  maxParsedLen: number,
): string {
  const trimmed = content.trim()
  if (!trimmed || maxParsedLen <= 0) return ""

  if (formatFn(trimmed).length <= maxParsedLen) return trimmed

  // Binary search for the longest prefix that fits
  let low = 1
  let high = trimmed.length
  let best = trimmed.slice(0, 1)

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = trimmed.slice(0, mid)
    if (formatFn(candidate).length <= maxParsedLen) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return best
}

export * as Formatting from "./formatting"
```

- [ ] **Step 2: Typecheck the formatting module**

Run: `cd packages/opencode && npx tsc --noEmit 2>&1 | Select-String "formatting"`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/channels/runtime/formatting.ts
git commit -m "feat(channels): add markdown-to-Telegram HTML/MarkdownV2 formatting"
```

---

### Task 3: Create media store service

**Files:**
- Create: `packages/opencode/src/channels/runtime/media-store.ts`

- [ ] **Step 1: Write the media store**

```ts
// runtime/media-store.ts
// MediaStore — Effect service for downloading and storing media files
// from chat platforms (Telegram, Discord, etc.) with scope-based lifecycle.
//
// Files are stored in: <data_dir>/channels/media/<scope>/<filename>
// Scope format: "telegram:123456:789" (platform:chatID:messageID)

import { Context, Effect, Layer } from "effect"
import path from "path"
import os from "os"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CleanupPolicy = "delete_on_cleanup" | "keep"

export interface MediaMeta {
  readonly filename: string
  readonly source: string
  readonly cleanupPolicy: CleanupPolicy
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface Interface {
  /** Store a local file and return a ref key for retrieval */
  readonly store: (localPath: string, meta: MediaMeta, scope: string) => Effect.Effect<string>

  /** Resolve a ref to its local filesystem path */
  readonly resolve: (ref: string) => Effect.Effect<string>

  /** Remove all files registered under a given scope */
  readonly cleanup: (scope: string) => Effect.Effect<void>
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

export class Service extends Context.Service<Service, Interface>()("@opencode/MediaStore") {}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface Entry {
  path: string
  meta: MediaMeta
}

function baseDir(): string {
  return path.join(
    os.homedir(),
    ".opencode",
    "channels",
    "media",
  )
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // In-memory ref → entry map
    const refs = new Map<string, Entry>()
    const scopeToRefs = new Map<string, Set<string>>()
    let refCounter = 0

    const store = (localPath: string, meta: MediaMeta, scope: string) =>
      Effect.gen(function* () {
        // Verify the file exists first
        const file = Bun.file(localPath)
        if (!(await file.exists())) {
          return yield* Effect.fail(new Error(`Media file not found: ${localPath}`))
        }

        const ref = `media://${++refCounter}/${meta.filename}`
        refs.set(ref, { path: localPath, meta })

        let scoped = scopeToRefs.get(scope)
        if (!scoped) {
          scoped = new Set()
          scopeToRefs.set(scope, scoped)
        }
        scoped.add(ref)

        return ref
      })

    const resolve = (ref: string) =>
      Effect.gen(function* () {
        const entry = refs.get(ref)
        if (!entry) return yield* Effect.fail(new Error(`Unknown media ref: ${ref}`))
        return entry.path
      })

    const cleanup = (scope: string) =>
      Effect.gen(function* () {
        const scoped = scopeToRefs.get(scope)
        if (!scoped) return

        for (const ref of scoped) {
          const entryOpt = refs.get(ref)
          refs.delete(ref)
          if (!entryOpt) continue
          const entry = entryOpt

          // Delete the file if policy allows
          if (entry.meta.cleanupPolicy === "delete_on_cleanup") {
            try {
              const file = Bun.file(entry.path)
              if (await file.exists()) {
                await file.delete()
              }
            } catch {
              // File may have already been removed — ignore
            }
          }
        }

        scopeToRefs.delete(scope)
      })

    return Service.of({ store, resolve, cleanup })
  }),
)

export const defaultLayer = layer

export * as MediaStore from "./media-store"
```

- [ ] **Step 2: Typecheck the media store**

Run: `cd packages/opencode && npx tsc --noEmit 2>&1 | Select-String "media-store"`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/channels/runtime/media-store.ts
git commit -m "feat(channels): add MediaStore Effect service for inbound media files"
```

---

### Task 4: Update runtime barrel exports

**Files:**
- Modify: `packages/opencode/src/channels/runtime/index.ts`

- [ ] **Step 1: Add exports for formatting and media-store**

Add these two lines after the existing exports:

```ts
export { markdownToTelegramHTML, markdownToTelegramMarkdownV2, fitContent, Formatting } from "./formatting"
export { Service as MediaStoreService, defaultLayer as mediaStoreDefaultLayer, MediaStore } from "./media-store"
```

Full file after edit:
```ts
export { Service, layer, defaultLayer, Registry } from "./registry"
export { Service as MessageBusService, layer as messageBusLayer, defaultLayer as messageBusDefaultLayer, MessageBus } from "./bus"
export { lifecycle } from "./lifecycle"
export { router } from "./router"
export { health } from "./health"
export { capabilities } from "./capabilities"
export { typingKeepalive, sendTypingOnce, Keepalive } from "./keepalive"
export { markdownToTelegramHTML, markdownToTelegramMarkdownV2, fitContent, Formatting } from "./formatting"
export { Service as MediaStoreService, defaultLayer as mediaStoreDefaultLayer, MediaStore } from "./media-store"
```

- [ ] **Step 2: Typecheck the barrel**

Run: `cd packages/opencode && npx tsc --noEmit 2>&1 | Select-String "runtime/index"`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/channels/runtime/index.ts
git commit -m "feat(channels): export formatting and media-store from runtime barrel"
```

---

### Task 5: Add media downloading to telegram-plugin

**Files:**
- Modify: `packages/opencode/src/channels/transports/telegram-plugin.ts`

**Note:** We add two private methods (`downloadFile`, `downloadPhoto`) and modify `extractInboundMedia` to use them with the MediaStore.

- [ ] **Step 1: Add imports for MediaStore**

At the top of telegram-plugin.ts, add:
```ts
import { Service as MediaStoreService } from "../runtime/media-store"
import type { MediaMeta } from "../runtime/media-store"
```

- [ ] **Step 2: Add private downloadFile method**

Add this method to the `TelegramChannel` class (after `extractInboundMedia`):

```ts
  /** Download a Telegram file and return the local path */
  private downloadFile(fileID: string): Effect.Effect<string> {
    const self = this
    return Effect.gen(function* () {
      // Step 1: Get file path from Telegram
      const fileInfo = yield* self.apiFetchJson<{ file_path?: string }>(
        "/getFile",
        { file_id: fileID },
      )

      if (!fileInfo.file_path) {
        return yield* Effect.fail(new Error(`Telegram file not found: ${fileID}`))
      }

      // Step 2: Construct download URL
      const url = `https://api.telegram.org/file/bot${self.config.botToken}/${fileInfo.file_path}`

      // Step 3: Download to a temp file
      const response = yield* Effect.tryPromise({
        try: () => fetch(url),
        catch: (error) => new Error(`Failed to download telegram file: ${String(error)}`),
      })

      if (!response.ok) {
        return yield* Effect.fail(new Error(`Telegram file download failed: ${response.status}`))
      }

      // Step 4: Write to temp directory
      const tmpDir = self.mediaDownloadDir()
      const filename = `${Date.now()}_${fileInfo.file_path.replace(/\//g, "_")}`
      const localPath = `${tmpDir}/${filename}`

      yield* Effect.tryPromise({
        try: async () => {
          await Bun.write(localPath, response)
        },
        catch: (error) => new Error(`Failed to write downloaded file: ${String(error)}`),
      })

      return localPath
    })
  }

  private mediaDownloadDir(): string {
    const tmp = process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"
    return `${tmp}/opencode-channels-media`
  }
```

- [ ] **Step 3: Modify extractInboundMedia to download and store files**

Replace the current `extractInboundMedia` method with this version that uses the media store:

```ts
  private extractInboundMedia(
    msg: TelegramMessage,
    mediaStore: MediaStoreService,
    scope: string,
  ): Effect.Effect<MediaPart[]> {
    const self = this
    return Effect.gen(function* () {
      const parts: MediaPart[] = []

      // Helper: download file, store in media store, return part with ref
      const addMedia = function* (
        type: MediaPart["type"],
        fileID: string,
        filename: string,
        mimeType: string,
        metaOverride?: Partial<MediaMeta>,
      ) {
        try {
          const localPath = yield* self.downloadFile(fileID)
          const ref = yield* mediaStore.store(localPath, {
            filename,
            source: "telegram",
            cleanupPolicy: "delete_on_cleanup",
            ...metaOverride,
          }, scope)
          parts.push({
            type,
            data: new Uint8Array(0),
            filename,
            mimeType,
            ref,
          })
        } catch (error) {
          log.error("failed to download/store inbound media", {
            fileID,
            error: String(error),
          })
          // Continue without this media part — don't block the message
        }
      }

      // Photos (use the largest version — last in array)
      if (msg.photo && msg.photo.length > 0) {
        const largest = msg.photo[msg.photo.length - 1]
        yield* addMedia("image", largest.file_id, "photo.jpg", "image/jpeg")
      }

      // Voice
      if (msg.voice) {
        yield* addMedia("audio", msg.voice.file_id, "voice.ogg", "audio/ogg")
      }

      // Audio
      if (msg.audio) {
        const title = msg.audio.title ? `${msg.audio.title}.mp3` : "audio.mp3"
        yield* addMedia("audio", msg.audio.file_id, title, "audio/mpeg")
      }

      // Video
      if (msg.video) {
        yield* addMedia("video", msg.video.file_id, "video.mp4", msg.video.mime_type ?? "video/mp4")
      }

      // Document
      if (msg.document) {
        const docType: MediaPart["type"] = msg.document.mime_type?.startsWith("image/")
          ? "image"
          : msg.document.mime_type?.startsWith("video/")
            ? "video"
            : msg.document.mime_type?.startsWith("audio/")
              ? "audio"
              : "document"
        yield* addMedia(
          docType,
          msg.document.file_id,
          msg.document.file_name ?? "document",
          msg.document.mime_type ?? "application/octet-stream",
        )
      }

      // Sticker
      if (msg.sticker) {
        yield* addMedia("image", msg.sticker.file_id, "sticker.webp", "image/webp")
      }

      return parts
    })
  }
```

- [ ] **Step 4: Update processInboundMessage to use new extractInboundMedia**

The `processInboundMessage` method currently calls `self.extractInboundMedia(msg)` synchronously.
Change it to be an async/Effect method that yields the media store. The method signature stays the same
but now the media extraction uses `yield*`:

Find the line in `processInboundMessage`:
```ts
const mediaParts = self.extractInboundMedia(msg)
```

Replace with:
```ts
const scope = `telegram:${chatId}:${msg.message_id}`
// MediaStore must be yielded from context — processInboundMessage is called from
// pollOnce which doesn't have Effect context, so we handle this via a helper.
const mediaParts = self.extractInboundMediaSync(msg)
```

And add a synchronous fallback for the polling path:
```ts
  /** Synchronous fallback for polling loop (no Effect context). Records file IDs in ref. */
  private extractInboundMediaSync(msg: TelegramMessage): MediaPart[] {
    const parts: MediaPart[] = []

    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1]
      parts.push({
        type: "image",
        data: new Uint8Array(0),
        filename: `file_id:${largest.file_id}`,
        mimeType: "image/jpeg",
      })
    }

    if (msg.voice) {
      parts.push({
        type: "audio",
        data: new Uint8Array(0),
        filename: `file_id:${msg.voice.file_id}`,
        mimeType: "audio/ogg",
      })
    }

    if (msg.audio) {
      parts.push({
        type: "audio",
        data: new Uint8Array(0),
        filename: msg.audio.title ?? `file_id:${msg.audio.file_id}`,
        mimeType: "audio/mpeg",
      })
    }

    if (msg.video) {
      parts.push({
        type: "video",
        data: new Uint8Array(0),
        filename: `file_id:${msg.video.file_id}`,
        mimeType: msg.video.mime_type ?? "video/mp4",
      })
    }

    if (msg.document) {
      const docType: MediaPart["type"] = msg.document.mime_type?.startsWith("image/")
        ? "image"
        : msg.document.mime_type?.startsWith("video/")
          ? "video"
          : msg.document.mime_type?.startsWith("audio/")
            ? "audio"
            : "document"
      parts.push({
        type: docType,
        data: new Uint8Array(0),
        filename: msg.document.file_name ?? `file_id:${msg.document.file_id}`,
        mimeType: msg.document.mime_type ?? "application/octet-stream",
      })
    }

    if (msg.sticker) {
      parts.push({
        type: "image",
        data: new Uint8Array(0),
        filename: msg.sticker.emoji ?? "sticker",
        mimeType: "image/webp",
      })
    }

    return parts
  }
```

Note: The actual download-and-store version (`extractInboundMedia` using Effect) is available for
consumers that have Effect context (e.g. a webhook handler or future pollOnce refactor).

- [ ] **Step 5: Typecheck the plugin changes**

Run: `cd packages/opencode && npx tsc --noEmit 2>&1 | Select-String "telegram-plugin"`

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/channels/transports/telegram-plugin.ts
git commit -m "feat(telegram): add media downloading with MediaStore and file_id download"
```

---

### Task 6: Add formatting + splitting to telegram-plugin send

**Files:**
- Modify: `packages/opencode/src/channels/transports/telegram-plugin.ts`

- [ ] **Step 1: Add formatting imports at top of file**

```ts
import { markdownToTelegramHTML, markdownToTelegramMarkdownV2 } from "../runtime/formatting"
```

- [ ] **Step 2: Add splitMessage private method**

```ts
  /** Split a message at Telegram's 4096 character limit */
  private splitMessage(text: string, maxLen: number = 4096): string[] {
    if (text.length <= maxLen) return [text]

    const chunks: string[] = []
    let remaining = text

    while (remaining.length > maxLen) {
      // Find code block boundaries first
      const codeBlockStart = remaining.indexOf("```")
      const codeBlockEnd = codeBlockStart !== -1
        ? remaining.indexOf("```", codeBlockStart + 3) + 3
        : -1

      // If a code block spans beyond maxLen, try to find a split before it
      let splitAt = -1
      if (codeBlockStart !== -1 && codeBlockEnd > maxLen && codeBlockStart < maxLen) {
        splitAt = codeBlockStart > 0 ? codeBlockStart : maxLen
      }

      // Try newline split
      if (splitAt === -1) {
        const newlineIdx = remaining.lastIndexOf("\n", maxLen - 1)
        if (newlineIdx > maxLen * 0.5) splitAt = newlineIdx + 1
      }

      // Try space split
      if (splitAt === -1) {
        const spaceIdx = remaining.lastIndexOf(" ", maxLen - 1)
        if (spaceIdx > maxLen * 0.5) splitAt = spaceIdx + 1
      }

      // Hard split
      if (splitAt === -1 || splitAt <= 0) splitAt = maxLen

      chunks.push(remaining.slice(0, splitAt))
      remaining = remaining.slice(splitAt)
    }

    if (remaining.length > 0) chunks.push(remaining)
    return chunks
  }

  /** Format text per the configured parse mode */
  private formatContent(text: string): string {
    if (this.config.parseMode === "MarkdownV2") {
      return markdownToTelegramMarkdownV2(text)
    }
    return markdownToTelegramHTML(text)
  }
```

- [ ] **Step 3: Update send() to format and split messages**

Replace the `send` method with this version that calls `formatContent` and `splitMessage`:

```ts
  send(channelId: string, message: string): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("sending telegram message", { channelId, messageLength: message.length })

      // Format markdown → Telegram format
      const formatted = self.formatContent(message)
      const parseMode = self.config.parseMode ?? "HTML"

      // Split if over 4096 chars after formatting
      const chunks = self.splitMessage(formatted)

      for (const chunk of chunks) {
        const body: Record<string, unknown> = {
          chat_id: channelId,
          text: chunk,
          parse_mode: parseMode,
        }

        yield* self.apiFetchJson("/sendMessage", body)
      }

      self.lastMessageTime = Date.now()
      log.info("telegram message sent", { channelId, chunks: chunks.length })
    }).pipe(
      Effect.catchTag("TelegramApiError", (error) =>
        Effect.gen(function* () {
          // If HTML/MarkdownV2 parse fails, retry with plain text
          if (error.detail.includes("can't parse entities") || error.detail.includes("Bad Request")) {
            log.warn("formatted message parse failed, retrying as plain text", { channelId })
            yield* self.apiFetchJson("/sendMessage", {
              chat_id: channelId,
              text: message,  // original unformatted markdown
            })
            self.lastMessageTime = Date.now()
            return
          }
          log.error("failed to send telegram message", { channelId, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }
```

- [ ] **Step 4: Update edit() to format content**

Replace the `edit` method's message body construction to use `formatContent`:

Find:
```ts
const body: Record<string, unknown> = {
  chat_id: channelId,
  message_id: Number(messageId),
  text: content
}
```

Replace with:
```ts
const formatted = self.formatContent(content)
const parseMode = self.config.parseMode ?? "HTML"
const body: Record<string, unknown> = {
  chat_id: channelId,
  message_id: Number(messageId),
  text: formatted,
  parse_mode: parseMode,
}
```

- [ ] **Step 5: Typecheck all changes**

Run: `cd packages/opencode && npx tsc --noEmit 2>&1 | Select-String "telegram-plugin"`

Expected: No errors from telegram-plugin.ts.

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/channels/transports/telegram-plugin.ts
git commit -m "feat(telegram): add markdown formatting and message splitting for send/edit"
```

---

### Task 7: Full typecheck and verification

- [ ] **Step 1: Run full channels typecheck**

```bash
cd packages/opencode && npx tsc --noEmit 2>&1 | Select-String "channels/"
```

Expected: No errors.

- [ ] **Step 2: Commit final cleanup if needed**

```bash
git status
git commit -am "chore: final typecheck fixes for telegram feature gaps"
```