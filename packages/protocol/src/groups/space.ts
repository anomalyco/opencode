import { Space } from "@opencode/schema/space"
import { InvalidRequestError } from "../errors.js"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"

const annotations = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({
    identifier: `experimental.space.${identifier}`,
    summary,
    description: `${description} To follow a space, a client opens /api/event and reads its stream ID from server.connected, syncs with experimental.space.sync until no \`next\` remains, then subscribes the stream with the saved cursor through experimental.space.subscribe and applies the stream's events in order. On experimental.space.resync it syncs and subscribes that space again; after a reconnect it subscribes again with its latest cursor. Experimental: may change without compatibility guarantees.`,
    // The routes share the `server.experimental` group with the persistent PTY prototype; tag them on their own.
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  })

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const SpaceEndpoints = [
  HttpApiEndpoint.post("space.write", "/api/experimental/space/:space/write", {
    params: { space: Space.Name },
    payload: Schema.Struct({
      changes: Schema.Array(Space.Change).check(Schema.isMinLength(1), Schema.isMaxLength(Space.MaxChanges)),
    }),
    error: InvalidRequestError,
    success: Schema.Struct({
      revision: Space.Revision,
      cursor: Space.Cursor.annotate({ description: "Covers this write and every change before it." }),
    }),
  }).annotateMerge(
    annotations(
      "write",
      "Write values",
      "Commit 1 to 1024 changes in one transaction, their values at most 1 MiB of UTF-8 in total. A string value sets the key, replacing any previous value; null deletes it, and deleting an unset key changes nothing. In request order, each change that changes a key takes the space's next revision and goes to its subscribers as its own experimental.space.updated or experimental.space.deleted event, so a key that appears twice keeps its last value. Values are client-defined, such as JSON text, and sent back unchanged. Returns the space's revision after the write.",
    ),
  ),
  HttpApiEndpoint.get("space.sync", "/api/experimental/space/:space", {
    params: { space: Space.Name },
    query: Schema.Struct({
      cursor: Schema.optional(Space.Cursor).annotate({
        description:
          "A page's `next`, or a saved `cursor`. Without one, or with one this database cannot use, sync starts from a snapshot.",
      }),
    }),
    success: Space.Page,
  }).annotateMerge(
    annotations(
      "sync",
      "Sync space",
      "Read one page of at most 500 keys: a snapshot that replaces what the client holds, or a delta of the keys changed and deleted since the cursor. A delta whose deletions were purged comes back as a snapshot.",
    ),
  ),
  HttpApiEndpoint.post("space.subscribe", "/api/experimental/space/subscribe", {
    payload: Schema.Struct({
      stream: Schema.String.annotate({ description: "The stream ID from the stream's server.connected event." }),
      spaces: Schema.Array(Schema.Struct({ space: Space.Name, cursor: Space.Cursor })),
    }),
    error: InvalidRequestError,
    success: HttpApiSchema.NoContent,
  }).annotateMerge(
    annotations(
      "subscribe",
      "Subscribe stream",
      "Send a space's changes to an open event stream, replacing any earlier subscription of that space on it: first the changes since the cursor as experimental.space.updated and experimental.space.deleted events in revision order, or experimental.space.resync when they do not fit one page or the cursor is unusable, then every later change the same way, none missed or repeated.",
    ),
  ),
  HttpApiEndpoint.post("space.unsubscribe", "/api/experimental/space/unsubscribe", {
    payload: Schema.Struct({
      stream: Schema.String.annotate({ description: "The stream ID from the stream's server.connected event." }),
      spaces: Schema.Array(Space.Name),
    }),
    error: InvalidRequestError,
    success: HttpApiSchema.NoContent,
  }).annotateMerge(
    annotations(
      "unsubscribe",
      "Unsubscribe stream",
      "Stop sending these spaces' changes to an open event stream, including a catch-up still going out. Spaces it does not follow are ignored.",
    ),
  ),
  HttpApiEndpoint.post("space.reset", "/api/experimental/space/reset", {
    success: HttpApiSchema.NoContent,
  }).annotateMerge(
    annotations(
      "reset",
      "Reset revisions",
      "Replace the epoch, so every client's saved cursor becomes unusable and its next sync starts from a snapshot. A restored backup brings back its old epoch, and cursors issued after the backup would then get wrong deltas: after restoring one, call this before clients reconnect, and do not serve writes or subscribers until it has run.",
    ),
  ),
] as const
