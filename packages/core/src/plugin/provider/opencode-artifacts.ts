export * as OpencodeArtifacts from "./opencode-artifacts.js"

import { createHash } from "node:crypto"
import path from "node:path"
import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { ConsoleAccess } from "../../console-access.js"
import { Environment } from "../../environment/index.js"
import { FileAccess } from "../../file-access.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Permission } from "../../permission.js"

/** The `GET /api/v2/config` response header Console sends while the caller may share artifacts. */
export const header = "x-opencode-artifacts"
const MAX_FILE = 25 * 1024 * 1024
const MAX_TOTAL = 100 * 1024 * 1024

type Connection = NonNullable<Effect.Success<ReturnType<Context["integration"]["connection"]["active"]>>>

const Shared = Schema.Struct({
  url: Schema.String,
  slug: Schema.String,
  updated: Schema.Boolean,
  revision: Schema.Number,
  expiresAt: Schema.NullOr(Schema.String),
  /** Whether this session now watches the artifact's comments. */
  watching: Schema.Boolean,
})
const Prepared = Schema.Struct({ missing: Schema.Array(Schema.String) })
const Problem = Schema.Struct({ message: Schema.optional(Schema.String), owner: Schema.optional(Schema.String) })

/**
 * `artifacts.share` for one Location, while `sync` is given the Console connection that may share. It joins the tools
 * of the Console's built-in `artifacts` MCP server, which read and answer the comments.
 */
export const make = Effect.fnUntraced(function* (ctx: Context, http: HttpClient.HttpClient) {
  const environment = yield* Environment.Service
  const access = yield* FileAccess.Service
  const permission = yield* Permission.Service
  let current: Connection | undefined

  yield* ctx.tool
    .transform((editor) => {
      const connection = current
      if (!connection) return
      editor.add({
        name: "share",
        description:
          "Publish a local folder of static files with an index.html as an OpenCode Console artifact the workspace's members can open and comment on, and return its URL. Sharing the same name again updates it at the same URL, uploading only changed files. This session wakes when someone comments.",
        input: Schema.Struct({
          folder: Schema.String.annotate({ description: "The folder to share" }),
          name: Schema.optional(
            Schema.String.annotate({ description: "The artifact's name in its URL; the folder's name otherwise" }),
          ),
          ttl: Schema.optional(
            Schema.String.check(Schema.isPattern(/^[1-9]\d*[hdw]$/)).annotate({
              description: "How long it stays up, like 12h, 7d or 2w; until it's deleted otherwise",
            }),
          ),
          replace: Schema.optional(
            Schema.Boolean.annotate({ description: "Share over an artifact of the same name someone else shared" }),
          ),
        }),
        output: Shared,
        options: { namespace: "artifacts", codemode: true, pinned: true },
        execute: (input, context) =>
          Effect.gen(function* () {
            const credential = yield* ctx.integration.connection.resolve(connection)
            if (!credential || credential.type === "external")
              return yield* new ToolFailure({ message: "OpenCode Console is not connected" })
            const server = ConsoleAccess.server(credential)
            const folder = yield* access.authorizeRead(input.folder, context)
            yield* permission.assert({
              action: "artifacts_share",
              resources: ["*"],
              save: ["*"],
              metadata: { input },
              ...Permission.invocation(context),
            })
            const slug = (input.name ?? path.basename(folder.absolute))
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")
              .slice(0, 54)
              .replace(/-$/, "")
            if (!slug) return yield* new ToolFailure({ message: "Pass a name with letters or digits" })
            const listed = yield* walk(environment.files, folder.absolute, "")
            if (!listed.some((file) => file.path === "index.html"))
              return yield* new ToolFailure({ message: `${input.folder} has no index.html` })
            const big = listed.find((file) => file.size > MAX_FILE)
            if (big) return yield* new ToolFailure({ message: `${big.path} is over 25 MB, the per-file limit` })
            const total = listed.reduce((sum, file) => sum + file.size, 0)
            if (total > MAX_TOTAL)
              return yield* new ToolFailure({
                message: `${input.folder} is ${(total / 1024 / 1024).toFixed(1)} MB; keep a share under 100 MB`,
              })
            const files = yield* Effect.forEach(
              listed,
              (file) =>
                environment.files.read(file.absolute).pipe(
                  Effect.map((read) => ({
                    path: file.path,
                    bytes: read.bytes,
                    sha256: createHash("sha256").update(read.bytes).digest("hex"),
                  })),
                ),
              { concurrency: 8 },
            )
            const title = new TextDecoder()
              .decode(files.find((file) => file.path === "index.html")?.bytes)
              .match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
              ?.trim()
              .slice(0, 200)
            const replace = input.replace ? { replace: true } : {}
            const send = (request: HttpClientRequest.HttpClientRequest) =>
              HttpClient.withScope(http)
                .execute(
                  request.pipe(
                    HttpClientRequest.acceptJson,
                    HttpClientRequest.setHeaders(ConsoleAccess.headers(credential)),
                  ),
                )
                .pipe(
                  Effect.flatMap((response) =>
                    response.status < 300 ? Effect.succeed(response) : refused(response, slug),
                  ),
                )
            const prepared = yield* send(
              HttpClientRequest.bodyJsonUnsafe(HttpClientRequest.post(`${server}/api/artifacts/prepare`), {
                slug,
                files: files.map((file) => ({ path: file.path, sha256: file.sha256, bytes: file.bytes.length })),
                ...replace,
              }),
            ).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Prepared)))
            const missing = new Set(prepared.missing)
            // Files with the same bytes upload once.
            yield* Effect.forEach(
              new Map(files.filter((file) => missing.has(file.sha256)).map((file) => [file.sha256, file.bytes])),
              ([sha256, bytes]) =>
                send(
                  HttpClientRequest.put(`${server}/api/artifacts/blobs/${sha256}`).pipe(
                    HttpClientRequest.bodyUint8Array(bytes, "application/octet-stream"),
                  ),
                ),
              { concurrency: 4, discard: true },
            )
            // Publishing with the session makes Console wake it with the artifact's comments.
            const shared = yield* send(
              HttpClientRequest.bodyJsonUnsafe(HttpClientRequest.put(`${server}/api/artifacts/${slug}`), {
                ...(title ? { title } : {}),
                files: files.map((file) => ({ path: file.path, sha256: file.sha256 })),
                ...(input.ttl === undefined
                  ? {}
                  : {
                      ttlSeconds:
                        Number(input.ttl.slice(0, -1)) *
                        (input.ttl.endsWith("h") ? 3600 : input.ttl.endsWith("d") ? 86_400 : 604_800),
                    }),
                ...replace,
                sessionID: context.sessionID,
              }),
            ).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Shared)))
            return {
              output: shared,
              content: `${shared.updated ? "Updated" : "Shared"} ${shared.url}${shared.watching ? ". This session wakes when someone comments." : ""}`,
            }
          }).pipe(
            Effect.scoped,
            Effect.mapError((error) =>
              error instanceof ToolFailure
                ? error
                : new ToolFailure({
                    message:
                      error instanceof Environment.NotFound || error instanceof Environment.WrongKind
                        ? `${input.folder} isn't a folder`
                        : error instanceof Permission.BlockedError || error instanceof Permission.CorrectedError
                          ? error.message
                          : `Couldn't share ${input.folder}`,
                    error,
                  }),
            ),
          ),
      })
    })
    .pipe(Effect.orDie)

  /** Offers `share` through `next`, or nothing when it is undefined. */
  const sync = Effect.fnUntraced(function* (next: Connection | undefined) {
    if (IntegrationConnection.key(next) === IntegrationConnection.key(current)) return
    current = next
    yield* ctx.tool.reload()
  })

  return { sync }
})

/** Every file below `directory` except dotfiles, as the Console CLI shares them; symlinks are skipped. */
function walk(
  files: Environment.Files,
  directory: string,
  prefix: string,
): Effect.Effect<
  { path: string; absolute: string; size: number }[],
  Environment.NotFound | Environment.WrongKind | Environment.Failed
> {
  return files.list(directory).pipe(
    Effect.flatMap((entries) =>
      Effect.forEach(
        entries.filter((entry) => !entry.name.startsWith(".")),
        (entry) => {
          const absolute = path.join(directory, entry.name)
          if (entry.type === "directory") return walk(files, absolute, `${prefix}${entry.name}/`)
          if (entry.type !== "file") return Effect.succeed([])
          return files
            .stat(absolute)
            .pipe(Effect.map((info) => [{ path: `${prefix}${entry.name}`, absolute, size: info.size }]))
        },
        { concurrency: 8 },
      ),
    ),
    Effect.map((nested) => nested.flat()),
  )
}

/** Console's refusal in plain words: a name someone else shared names them and says how to share over it. */
function refused(response: HttpClientResponse.HttpClientResponse, slug: string) {
  return HttpClientResponse.schemaBodyJson(Problem)(response).pipe(
    Effect.option,
    Effect.map(Option.getOrUndefined),
    Effect.flatMap((problem) =>
      Effect.fail(
        new ToolFailure({
          message:
            problem?.owner !== undefined
              ? `${problem.owner} already shared ${slug}. Pick another name, or pass replace: true to share over it.`
              : response.status === 404
                ? "Artifacts are off for this OpenCode Console workspace."
                : (problem?.message ?? `OpenCode Console answered ${response.status}`),
        }),
      ),
    ),
  )
}
