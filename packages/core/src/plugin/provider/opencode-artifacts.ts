export * as OpencodeArtifacts from "./opencode-artifacts.js"

import { createHash } from "node:crypto"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Session } from "@opencode/schema/session"
import { Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { ConsoleAccess } from "../../console-access.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { OpencodeWatches } from "./opencode-watches.js"

/** The `GET /api/v2/config` response header Console sends while the caller may share artifacts. */
export const header = "x-opencode-artifacts"
const providerID = "console"

type Connection = NonNullable<Effect.Success<ReturnType<Context["integration"]["connection"]["active"]>>>

const Prepared = Schema.Struct({ missing: Schema.Array(Schema.String) })
const Published = Schema.Struct({ url: Schema.String })
const Files = Schema.Struct({
  revision: Schema.Number,
  files: Schema.Array(
    Schema.Struct({ path: Schema.String, sha256: Schema.String, text: Schema.optional(Schema.String) }),
  ),
})
const Problem = Schema.Struct({ message: Schema.optional(Schema.String), owner: Schema.optional(Schema.String) })

/**
 * The `console` artifact provider for one Location, the default while `sync` is given the Console connection that may
 * share. While event watches run (`wakes`), publishing makes the session watch the artifact's comments: a subagent's
 * root session, the one a person talks to.
 */
export const make = Effect.fnUntraced(function* (ctx: Context, http: HttpClient.HttpClient) {
  let current: { readonly connection: Connection; readonly wakes: boolean } | undefined
  // Console names an artifact by slug; it comes from the title once, so a retitled update stays the same artifact.
  const slugKey = (id: string) => `artifact-slug:${id}`

  yield* ctx.experimental.artifact.transform((editor) => {
    if (!current) return
    const connection = current.connection
    const wakes = current.wakes
    // Uploads only the files Console doesn't store yet, then publishes them as the artifact `slug`.
    const publish = Effect.fnUntraced(function* (
      slug: string,
      input: {
        readonly title: string
        readonly files: Readonly<Record<string, Uint8Array>>
        readonly sessionID?: string
      },
      replace: boolean,
    ) {
      const send = yield* sender(ctx, http, connection, slug)
      const files = Object.entries(input.files).map(([path, bytes]) => ({
        path,
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }))
      const prepared = yield* send("POST", "/api/artifacts/prepare", {
        slug,
        files: files.map((file) => ({ path: file.path, sha256: file.sha256, bytes: file.bytes.length })),
        ...(replace ? { replace } : {}),
      }).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Prepared)))
      const sessionID =
        wakes && input.sessionID ? yield* OpencodeWatches.rootSession(ctx, Session.ID.make(input.sessionID)) : undefined
      const missing = new Set(prepared.missing)
      // Files with the same bytes upload once.
      yield* Effect.forEach(
        new Map(files.filter((file) => missing.has(file.sha256)).map((file) => [file.sha256, file.bytes])),
        ([sha256, bytes]) => send("PUT", `/api/artifacts/blobs/${sha256}`, bytes),
        { concurrency: 4, discard: true },
      )
      return yield* send("PUT", `/api/artifacts/${slug}`, {
        title: input.title.slice(0, 200).trim(),
        files: files.map((file) => ({ path: file.path, sha256: file.sha256 })),
        ...(replace ? { replace } : {}),
        ...(sessionID ? { sessionID } : {}),
      }).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Published)))
    }, Effect.scoped)
    const slugOf = (id: string) =>
      ctx.storage
        .get(slugKey(id))
        .pipe(
          Effect.flatMap((slug) =>
            typeof slug === "string"
              ? Effect.succeed(slug)
              : Effect.fail(new Error(`No OpenCode Console artifact for ${id}`)),
          ),
        )

    editor.add({
      id: providerID,
      name: "OpenCode Console",
      capabilities: ["static"],
      prompt:
        "Artifacts are private pages the workspace's members open and comment on inside OpenCode Console. Each needs an index.html." +
        (wakes ? " Comments wake this session." : ""),
      create: (input) =>
        Effect.gen(function* () {
          // A suffix from the ID, so two artifacts with one title never publish over each other.
          const slug = `${slugify(input.title)?.slice(0, 47).replace(/-+$/, "") ?? "artifact"}-${input.id.slice(-6).toLowerCase()}`
          const published = yield* publish(slug, input, false)
          yield* ctx.storage.set(slugKey(input.id), slug)
          return { url: published.url }
        }),
      // It's the same artifact, so it shares over the name whoever shared it last.
      update: (id, input) =>
        slugOf(id).pipe(
          Effect.flatMap((slug) => publish(slug, input, true)),
          Effect.map((published) => ({ url: published.url })),
        ),
      // Console inlines UTF-8 text files up to a limit; the rest download as blobs of the same revision.
      read: (id) =>
        Effect.gen(function* () {
          const slug = yield* slugOf(id)
          const send = yield* sender(ctx, http, connection, slug)
          const listing = yield* send("GET", `/api/artifacts/${slug}/files`).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Files)),
          )
          const files = yield* Effect.forEach(
            listing.files,
            (file) =>
              file.text !== undefined
                ? Effect.succeed([file.path, new TextEncoder().encode(file.text)] as const)
                : send("GET", `/api/artifacts/${slug}/blobs/${file.sha256}?revision=${listing.revision}`).pipe(
                    Effect.flatMap((response) => response.arrayBuffer),
                    Effect.map((bytes) => [file.path, new Uint8Array(bytes)] as const),
                  ),
            { concurrency: 4 },
          )
          return Object.fromEntries(files)
        }).pipe(Effect.scoped),
      delete: (id) =>
        Effect.gen(function* () {
          const slug = yield* slugOf(id)
          const send = yield* sender(ctx, http, connection, slug)
          yield* send("DELETE", `/api/artifacts/${slug}`)
          yield* ctx.storage.remove(slugKey(id))
        }).pipe(Effect.scoped),
    })
    editor.default.set(providerID)
  })

  /** Offers the provider through `connection`, or removes it when it is undefined. */
  const sync = Effect.fnUntraced(function* (connection: Connection | undefined, wakes: boolean) {
    const next = connection && { connection, wakes }
    if (
      IntegrationConnection.key(next?.connection) === IntegrationConnection.key(current?.connection) &&
      next?.wakes === current?.wakes
    )
      return
    current = next
    yield* ctx.experimental.artifact.reload()
  })

  return { sync }
})

/** Console's slug rules: lowercase letters, digits and single dashes, at most 54 characters. */
function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 54)
      .replace(/-+$/, "") || undefined
  )
}

/**
 * Sends Console requests as the connection's member; a refusal fails in plain words about the artifact `slug`. Deleting
 * one Console no longer has, such as one deleted in Console, succeeds.
 */
const sender = Effect.fnUntraced(function* (
  ctx: Context,
  http: HttpClient.HttpClient,
  connection: Connection,
  slug: string,
) {
  const credential = yield* ctx.integration.connection.resolve(connection)
  if (!credential || credential.type === "external")
    return yield* Effect.fail(new Error("OpenCode Console is not connected"))
  return (method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: Uint8Array | object) => {
    const request = HttpClientRequest.make(method)(`${ConsoleAccess.server(credential)}${path}`).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeaders(ConsoleAccess.headers(credential)),
    )
    return HttpClient.withScope(http)
      .execute(
        body instanceof Uint8Array
          ? HttpClientRequest.bodyUint8Array(request, body, "application/octet-stream")
          : body === undefined
            ? request
            : HttpClientRequest.bodyJsonUnsafe(request, body),
      )
      .pipe(
        Effect.flatMap((response) =>
          response.status < 300 || (method === "DELETE" && response.status === 404)
            ? Effect.succeed(response)
            : HttpClientResponse.schemaBodyJson(Problem)(response).pipe(
                Effect.option,
                Effect.map(Option.getOrUndefined),
                Effect.flatMap((problem) =>
                  Effect.fail(
                    new Error(
                      problem?.owner !== undefined
                        ? `${problem.owner} already shared an OpenCode Console artifact named ${slug}; give this one another title`
                        : response.status === 404
                          ? method === "GET"
                            ? `OpenCode Console has no artifact named ${slug}`
                            : "Artifacts are off for this OpenCode Console workspace"
                          : (problem?.message ?? `OpenCode Console answered ${response.status}`),
                    ),
                  ),
                ),
              ),
        ),
      )
  }
})
