import { Session } from "@opencode/core/session"
import { FileAccess } from "@opencode/core/file-access"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Agent } from "@opencode/schema/agent"
import { openPreviewFile, previewRoot } from "@opencode/util/preview-scope"
import { FileVerificationError } from "@opencode/util/file-verification"
import { Effect, Stream } from "effect"
import path from "node:path"
import { type HttpServerRequest, HttpServerResponse } from "effect/http"
import { ContentHeaders } from "../content-headers"
import { ByteRange } from "../range"
import { missingSession } from "./session-error"

export const makePreviewRead = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const locations = yield* LocationServiceMap.Service
  return Effect.fn("Preview.read")(function* (
    query: { sessionID: Session.ID; path: string; document: string; root: string; entry?: "1"; location?: { directory?: string; workspace?: string } },
    req: HttpServerRequest.HttpServerRequest,
  ) {
    const session = yield* sessions.get(query.sessionID).pipe(Effect.mapError(missingSession))
    // Set by the authenticated desktop transport, not copied from the page's request.
    const guarded = req.headers["x-opencode-preview-policy"] === "agent"
    const headers = {
      "x-opencode-preview": "3",
      ...(guarded && { "x-opencode-preview-policy": "agent" }),
      "cache-control": "no-store, no-transform",
      "accept-ranges": "bytes",
      ...ContentHeaders.download({ path: query.path, mime: "application/octet-stream" }),
    }
    if (
      new URL(req.url, "http://localhost").searchParams.get("location[directory]") !== session.location.directory ||
      (new URL(req.url, "http://localhost").searchParams.get("location[workspace]") ?? undefined) !==
        session.location.workspaceID
    )
      return HttpServerResponse.empty({ status: 404, headers })
    if (query.root === "bind" && req.method === "HEAD") {
      const root = yield* Effect.promise(() => previewRoot(session.location.directory).catch(() => undefined))
      return root ? HttpServerResponse.empty({headers:{...headers,"x-opencode-preview-root":root.id}}) : HttpServerResponse.empty({status:404,headers})
    }
    if (!/^[a-f0-9]{64}$/.test(query.root)) return HttpServerResponse.empty({status:404,headers})
    const opened = yield* Effect.acquireRelease(
      Effect.promise(() =>
        openPreviewFile(session.location.directory, query.document, query.path, query.entry === "1", query.root)
          .catch((cause) => cause instanceof FileVerificationError ? cause : undefined),
      ),
      (opened) =>
        Effect.promise(async () => {
          if (opened && opened !== "denied" && !(opened instanceof FileVerificationError)) await opened.file.close()
        }),
    )
    if (opened instanceof FileVerificationError)
      return HttpServerResponse.empty({ status: 503, headers: { ...headers, [FileVerificationError.header]: opened._tag } })
    if (opened === "denied") return HttpServerResponse.empty({ status: 404, headers: {...headers,"x-opencode-preview-denied":"1"} })
    if (!opened) return HttpServerResponse.empty({ status: 404, headers })
    if (guarded) {
      // Authorize the spelling requested AND the physical name of the handle that supplies the bytes.
      // Evaluate anew for HEAD and GET, including ranges. Never turn an ask into a page-initiated prompt.
      const allowed = yield* Effect.gen(function* () {
        // A cold Location can already list the built-in agent before its configured read policy exists.
        const plugins = yield* Plugin.Service
        if (!(yield* plugins.list()).some(item => item.id === "opencode.config.agent" && item.state.status === "active")) return false
        const access = yield* FileAccess.Service
        const permission = yield* Permission.Service
        const id = req.headers["x-opencode-preview-agent"]
        const agent = id ? Agent.ID.make(decodeURIComponent(id)) : session.agent
        // Both names are inside the pinned root. Only their suffixes are permission resources;
        // an absolute kernel name (e.g. /private/var/...) need not start with the session's spelling.
        const paths = [query.path, opened.relativePath].map(name => path.join(session.location.directory, name))
        const resources = new Set<string>()
        const external = new Set<string>()
        for (const path of new Set(paths)) {
          const target = yield* access.resolve({ path, kind: "file" })
          resources.add(target.resource)
          if (target.externalDirectory) external.add(target.externalDirectory.resource)
        }
        const input = { sessionID: session.id, agent }
        const passive = { requireConfiguredAllow: true }
        if (external.size && !(yield* permission.allows({ ...input, action: "external_directory", resources: [...external] }, passive))) return false
        return yield* permission.allows({ ...input, action: "read", resources: [...resources] }, passive)
      }).pipe(Effect.provide(locations.get(session.location)), Effect.orElseSucceed(() => false))
      if (!allowed) return HttpServerResponse.empty({ status: 404, headers: { ...headers, "x-opencode-preview-denied": "1" } })
    }
    const range = req.headers.range ? ByteRange.parse(req.headers.range, opened.size) : undefined
    if (range === "unsatisfiable")
      return HttpServerResponse.empty({
        status: 416,
        headers: { ...headers, "content-range": `bytes */${opened.size}` },
      })
    const length = range ? range.end - range.start + 1 : opened.size
    const options = {
      status: range ? 206 : 200,
      headers: range ? { ...headers, "content-range": `bytes ${range.start}-${range.end}/${opened.size}` } : headers,
      contentLength: length,
    }
    if (req.method === "HEAD" || !length)
      return HttpServerResponse.empty({ ...options, headers: { ...options.headers, "content-length": String(length) } })
    return HttpServerResponse.stream(
      Stream.fromAsyncIterable(
        opened.file.createReadStream({ ...range, autoClose: false }),
        () => new Error("Preview read failed"),
      ),
      options,
    )
  })
})
