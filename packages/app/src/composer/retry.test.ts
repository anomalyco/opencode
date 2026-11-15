import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@opencode/schema/session-message"
import { claimRetry, retryFingerprint, type ComposerRetryPayload } from "./retry"
import { contextItemKey, durableNote, type ContextItem, type ImageAttachmentPart } from "./schema"

const note = {
  type: "note" as const,
  origin: "browser",
  label: "button#save",
  icon: "select-element",
  subject: 'the "button#save" element',
  href: "tab_1",
  live: { subject: 'the "button#save" element (browser ref @e42)', href: "tab_1#e42" },
  comment: "Rename this",
  commentID: "note",
}

const image: ImageAttachmentPart = {
  type: "image",
  id: "shot",
  filename: "shot.png",
  mime: "image/png",
  blob: { id: "media:abc", url: "blob:resolved" },
}

const keyed = (items: ContextItem[]) => items.map((item) => ({ ...item, key: contextItemKey(item) }))

const text = (content: string) => ({ type: "text" as const, content, start: 0, end: content.length })

const payload: ComposerRetryPayload = {
  mode: "normal",
  delivery: "steer",
  selection: { agent: "build", model: { providerID: "anthropic", modelID: "claude" }, variant: "high" },
  prompt: [text("first"), image],
  context: keyed([note, { type: "file", path: "src/app.ts", comment: "Check this", commentID: "c1" }]),
}

const id = SessionMessage.ID.create()

const fresh = SessionMessage.ID.create()

const armed = { id, fingerprint: retryFingerprint(payload) }

describe("composer retry", () => {
  test("resends an unchanged payload under the failed prompt's ID", () => {
    expect(claimRetry(armed, payload, fresh)).toBe(id)
    expect(claimRetry(undefined, payload, fresh)).toBe(fresh)
  })

  test.each<{ name: string; next: ComposerRetryPayload }>([
    // The server keeps the first payload under an ID, so each of these would silently drop the change.
    {
      name: "a note whose live subject changed",
      next: { ...payload, context: keyed([{ ...note, live: { subject: "the button (browser ref @e7)" } }]) },
    },
    { name: "a note that lost its live subject on reload", next: { ...payload, context: keyed([durableNote(note)]) } },
    { name: "another delivery", next: { ...payload, delivery: "queue" } },
    { name: "a queue edit merged into the prompt", next: { ...payload, prompt: [text("first\n\nsecond"), image] } },
    { name: "another agent", next: { ...payload, selection: { ...payload.selection, agent: "plan" } } },
    {
      name: "another model",
      next: { ...payload, selection: { ...payload.selection, model: { providerID: "openai", modelID: "gpt" } } },
    },
    { name: "another variant", next: { ...payload, selection: { ...payload.selection, variant: undefined } } },
    {
      name: "another mention",
      next: {
        ...payload,
        prompt: [text("first "), { type: "agent", name: "review", content: "@review", start: 6, end: 13 }, image],
      },
    },
    {
      name: "another path attachment",
      next: {
        ...payload,
        prompt: [...payload.prompt, { type: "path", id: "log", filename: "log.txt", mime: "text/plain", path: "/log" }],
      },
    },
    {
      name: "an edited line comment",
      next: {
        ...payload,
        context: keyed([note, { type: "file", path: "src/app.ts", comment: "Changed", commentID: "c1" }]),
      },
    },
    {
      name: "an edited quote comment",
      next: {
        ...payload,
        context: keyed([...payload.context, { type: "quote", text: "x", comment: "y", commentID: "q" }]),
      },
    },
    {
      name: "another image",
      next: { ...payload, prompt: [text("first"), { ...image, blob: { id: "media:def", url: "" } }] },
    },
    { name: "a renamed image", next: { ...payload, prompt: [text("first"), { ...image, filename: "other.png" }] } },
  ])("sends $name under a new ID", (row) => {
    expect(claimRetry(armed, row.next, fresh)).toBe(fresh)
  })

  test("an image reloaded from the draft store matches the one that failed", () => {
    const reloaded = { ...payload, prompt: [text("first"), { ...image, blob: { id: "media:abc", url: "" } }] }

    expect(claimRetry(armed, reloaded, fresh)).toBe(id)
  })
})
