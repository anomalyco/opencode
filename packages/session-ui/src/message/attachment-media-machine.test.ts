import { describe, expect, test } from "bun:test"
import type { PromptAttachment } from "@opencode/client/promise"
import {
  ATTACHMENT_MEDIA_TIMEOUT_MS,
  DISPOSED_ATTACHMENT_MEDIA_EVENT,
  INITIAL_ATTACHMENT_MEDIA_STATE,
  resolveAttachmentMediaTarget,
  transitionAttachmentMedia,
  viewAttachmentMedia,
  type AttachmentMediaEvent,
  type AttachmentMediaState,
} from "./attachment-media-machine"

const hashA = `media:${"a".repeat(64)}`
const hashB = `media:${"b".repeat(64)}`

function media(uri: string, mime = "image/png"): PromptAttachment {
  return { mime, source: { type: "inline" }, name: "screenshot.png", uri }
}

const reader = { hasReader: true }
const targetA = resolveAttachmentMediaTarget(media(hashA), reader)
const targetB = resolveAttachmentMediaTarget(media(hashB), reader)

function replay(events: AttachmentMediaEvent[], state = INITIAL_ATTACHMENT_MEDIA_STATE) {
  return events.reduce<AttachmentMediaState>((current, event) => transitionAttachmentMedia(current, event).state, state)
}

const readyA = replay([
  { type: "target.synced", target: targetA },
  { type: "read.succeeded", attempt: 1, src: "blob:a" },
])

describe("transitionAttachmentMedia", () => {
  test("reads a media reference with a bounded timeout", () => {
    const next = transitionAttachmentMedia(INITIAL_ATTACHMENT_MEDIA_STATE, { type: "target.synced", target: targetA })

    expect(next.effects).toEqual([
      { type: "read", attempt: 1, uri: hashA, mime: "image/png", timeoutMs: ATTACHMENT_MEDIA_TIMEOUT_MS },
    ])
    expect(viewAttachmentMedia(next.state, targetA)).toMatchObject({ status: "loading", placeholder: true })
    expect(viewAttachmentMedia(readyA, targetA)).toEqual({
      status: "ready",
      src: "blob:a",
      placeholder: false,
      clickable: true,
      canRetry: false,
    })
  })

  // An <Index> slot that moves from attachment A to B used to show and preview A's image until B's read settled.
  test("a slot that switches attachments never shows the previous image", () => {
    expect(viewAttachmentMedia(readyA, targetB)).toEqual({
      status: "loading",
      src: undefined,
      placeholder: true,
      clickable: false,
      canRetry: false,
    })

    const switched = transitionAttachmentMedia(readyA, { type: "target.synced", target: targetB })

    expect(switched.effects).toEqual([
      { type: "read", attempt: 2, uri: hashB, mime: "image/png", timeoutMs: ATTACHMENT_MEDIA_TIMEOUT_MS },
    ])
    expect(viewAttachmentMedia(switched.state, targetB).src).toBeUndefined()
  })

  test("a read for the previous attachment cannot settle the next one", () => {
    const loadingA = transitionAttachmentMedia(INITIAL_ATTACHMENT_MEDIA_STATE, {
      type: "target.synced",
      target: targetA,
    }).state
    const switched = transitionAttachmentMedia(loadingA, { type: "target.synced", target: targetB })

    expect(switched.effects[0]).toEqual({ type: "cancel" })

    const stale = transitionAttachmentMedia(switched.state, { type: "read.succeeded", attempt: 1, src: "blob:a" })

    expect(stale.state).toBe(switched.state)
    expect(viewAttachmentMedia(stale.state, targetB).status).toBe("loading")
  })

  // A read that failed, found nothing or hung used to leave the loading placeholder forever.
  for (const failure of [
    { type: "read.failed", attempt: 1 },
    { type: "read.succeeded", attempt: 1, src: "" },
    { type: "read.timed-out", attempt: 1 },
  ] as const) {
    test(`${failure.type}${failure.type === "read.succeeded" ? " with no URL" : ""} shows a failed tile with retry`, () => {
      const settled = transitionAttachmentMedia(
        transitionAttachmentMedia(INITIAL_ATTACHMENT_MEDIA_STATE, { type: "target.synced", target: targetA }).state,
        failure,
      )

      expect(settled.effects).toEqual([{ type: "cancel" }])
      expect(viewAttachmentMedia(settled.state, targetA)).toEqual({
        status: "failed",
        src: undefined,
        placeholder: false,
        clickable: true,
        canRetry: true,
      })

      const retry = transitionAttachmentMedia(settled.state, { type: "retry.requested", target: targetA })

      expect(retry.effects).toEqual([
        { type: "read", attempt: 2, uri: hashA, mime: "image/png", timeoutMs: ATTACHMENT_MEDIA_TIMEOUT_MS },
      ])
      expect(viewAttachmentMedia(retry.state, targetA).status).toBe("loading")
    })
  }

  // Without a reader, a `media:` reference used to go straight into <img src> as a broken, clickable image.
  test("a media reference with no reader shows a failed tile without retry", () => {
    const target = resolveAttachmentMediaTarget(media(hashA), { hasReader: false })
    const synced = transitionAttachmentMedia(INITIAL_ATTACHMENT_MEDIA_STATE, { type: "target.synced", target })

    expect(synced.effects).toEqual([])
    expect(viewAttachmentMedia(synced.state, target)).toEqual({
      status: "failed",
      src: undefined,
      placeholder: false,
      clickable: false,
      canRetry: false,
    })
    expect(transitionAttachmentMedia(synced.state, { type: "retry.requested", target }).effects).toEqual([])
  })

  test("syncing the same target again changes nothing", () => {
    const loading = transitionAttachmentMedia(INITIAL_ATTACHMENT_MEDIA_STATE, {
      type: "target.synced",
      target: targetA,
    }).state
    const failed = transitionAttachmentMedia(loading, { type: "read.failed", attempt: 1 }).state

    for (const state of [loading, readyA, failed]) {
      const again = transitionAttachmentMedia(state, { type: "target.synced", target: targetA })

      expect(again.state).toBe(state)
      expect(again.effects).toEqual([])
    }

    expect(transitionAttachmentMedia(readyA, { type: "retry.requested", target: targetA }).state).toBe(readyA)
  })

  test("inline, URI, peeked and non-image attachments read nothing", () => {
    const inline: PromptAttachment = { mime: "image/png", source: { type: "inline" }, data: "AAAA" }
    const blob: PromptAttachment = { mime: "image/png", source: { type: "uri", uri: "blob:x" }, data: "AAAA" }
    const pdf = media(hashA, "application/pdf")
    const peeked = resolveAttachmentMediaTarget(media(hashA), { hasReader: true, peekMedia: () => "blob:cached" })

    expect(resolveAttachmentMediaTarget(inline, reader)).toEqual({ kind: "direct", src: "data:image/png;base64,AAAA" })
    expect(resolveAttachmentMediaTarget(blob, reader)).toEqual({ kind: "direct", src: "blob:x" })
    expect(peeked).toEqual({ kind: "direct", src: "blob:cached" })
    expect(resolveAttachmentMediaTarget(pdf, reader)).toEqual({ kind: "none" })

    for (const target of [peeked, resolveAttachmentMediaTarget(pdf, reader)]) {
      expect(transitionAttachmentMedia(INITIAL_ATTACHMENT_MEDIA_STATE, { type: "target.synced", target }).effects).toEqual(
        [],
      )
    }

    expect(viewAttachmentMedia(INITIAL_ATTACHMENT_MEDIA_STATE, peeked).src).toBe("blob:cached")
  })

  test("leaving a read for a direct URL or unmounting cancels it, and nothing settles after", () => {
    const loading = transitionAttachmentMedia(INITIAL_ATTACHMENT_MEDIA_STATE, {
      type: "target.synced",
      target: targetA,
    }).state
    const direct = transitionAttachmentMedia(loading, {
      type: "target.synced",
      target: { kind: "direct", src: "blob:x" },
    })

    expect(direct.state).toEqual({ status: "idle", attempt: 1 })
    expect(direct.effects).toEqual([{ type: "cancel" }])

    const disposed = transitionAttachmentMedia(loading, DISPOSED_ATTACHMENT_MEDIA_EVENT)

    expect(disposed.effects).toEqual([{ type: "cancel" }])
    expect(transitionAttachmentMedia(disposed.state, { type: "read.succeeded", attempt: 1, src: "blob:a" })).toEqual({
      state: disposed.state,
      effects: [],
    })
    expect(transitionAttachmentMedia(readyA, DISPOSED_ATTACHMENT_MEDIA_EVENT).effects).toEqual([])
  })
})
