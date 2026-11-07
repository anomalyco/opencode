export * as SessionMedia from "./session-media.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"
import { optional } from "./schema.js"

/** Who put an item into the session. */
export const Sender = Schema.Literals(["user", "agent"])
export type Sender = typeof Sender.Type

/** Where an item's bytes come from. Inline bytes stay in their message, so a page never carries them. */
export const Source = Schema.Union([
  /** A URL an `<img>` or `<video>` loads as is: http(s), or a `data:` URL without bytes worth holding back. */
  Schema.Struct({ type: Schema.Literal("url"), url: Schema.String }),
  /** A `media:<hash>` ref whose bytes `experimental.media.get` reads. */
  Schema.Struct({ type: Schema.Literal("media"), uri: Schema.String }),
  /** A file the server reads, absolute or relative to the session's directory. */
  Schema.Struct({ type: Schema.Literal("path"), path: Schema.String }),
  /** A user message's attachment, at its index in the message's files. */
  Schema.Struct({ type: Schema.Literal("attachment"), messageID: Schema.String, index: Schema.Number }),
  /** A tool's output file, at its index in the tool's content. */
  Schema.Struct({
    type: Schema.Literal("tool"),
    messageID: Schema.String,
    toolID: Schema.String,
    index: Schema.Number,
  }),
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SessionMedia.Source" })
export type Source = typeof Source.Type

const Base = {
  id: Schema.String,
  /** Items that share a key are one thing, such as an image read twice; the newest stands for all of them. */
  key: Schema.String.pipe(optional),
  from: Sender,
  messageID: Schema.String,
  /** When the item's message was created, in milliseconds. */
  time: Schema.Number,
}

export interface Media extends Schema.Schema.Type<typeof Media> {}
export const Media = Schema.Struct({
  ...Base,
  kind: Schema.Literals(["image", "video"]),
  mime: Schema.String,
  name: Schema.String.pipe(optional),
  source: Source,
}).annotate({ identifier: "SessionMedia.Media" })

export interface Link extends Schema.Schema.Type<typeof Link> {}
export const Link = Schema.Struct({
  ...Base,
  url: Schema.String,
  title: Schema.String.pipe(optional),
  /** The hostname without `www.`. */
  site: Schema.String,
  host: Schema.String,
  /** Written in a message, opened by the agent's web fetch, or found by its web search. */
  via: Schema.Literals(["text", "fetch", "search"]),
}).annotate({ identifier: "SessionMedia.Link" })

/**
 * The items of a run of a session's messages, newest first. `newest` and `oldest` are the creation times of the first
 * and last message the page read, and `next` continues past the last one while older messages remain.
 */
export interface Page extends Schema.Schema.Type<typeof Page> {}
export const Page = Schema.Struct({
  media: Schema.Array(Media),
  links: Schema.Array(Link),
  newest: Schema.Number.pipe(optional),
  oldest: Schema.Number.pipe(optional),
  next: Schema.String.pipe(optional),
}).annotate({ identifier: "SessionMedia.Page" })

/** The most messages one page reads. */
export const MAX_LIMIT = 500

/**
 * Experimental: may change without compatibility guarantees.
 *
 * The Media panel's RPC, behind the `session_media` flag. `list` reads up to `limit` of a session's messages, newest
 * first, from the newest or from `cursor` (a page's `next`), and returns the images, videos and links they carry. The
 * schemas are Standard Schemas too, so Promise clients can call it.
 */
export const Definition = Rpc.define({
  id: "experimental.media",
  methods: {
    list: {
      input: Schema.toStandardSchemaV1(
        Schema.Struct({
          sessionID: Schema.String,
          cursor: Schema.String.pipe(optional),
          limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_LIMIT })).pipe(optional),
        }),
      ),
      output: Schema.toStandardSchemaV1(Page),
    },
  },
  events: {},
})
