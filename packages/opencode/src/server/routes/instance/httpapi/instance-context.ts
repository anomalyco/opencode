import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { getAdaptor } from "@/control-plane/adaptors"
import { WorkspaceID } from "@/control-plane/schema"
import type { Target } from "@/control-plane/types"
import { Workspace } from "@/control-plane/workspace"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { Session } from "@/session/session"
import { ServerProxy } from "@/server/proxy"
import { getWorkspaceRouteSessionID, isLocalWorkspaceRoute, workspaceProxyURL } from "@/server/workspace"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Context, Effect, Layer } from "effect"
import type { unhandled } from "effect/Types"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"

type HandlerEffect = Effect.Effect<HttpServerResponse.HttpServerResponse, unhandled, never>

export class InstanceContextMiddleware extends HttpApiMiddleware.Service<
  InstanceContextMiddleware,
  {
    requires: Session.Service
  }
>()("@opencode/ExperimentalHttpApiInstanceContext") {}

function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function currentDirectory() {
  try {
    return Instance.directory
  } catch {
    return process.cwd()
  }
}

function sourceRequest(request: HttpServerRequest.HttpServerRequest) {
  if (request.source instanceof Request) return request.source
  return new Request(new URL(request.originalUrl, "http://localhost"), {
    method: request.method,
    headers: request.headers as HeadersInit,
  })
}

function requestHeaders(request: HttpServerRequest.HttpServerRequest) {
  return sourceRequest(request).headers
}

function writeSocket(
  write: (data: string | Uint8Array | Socket.CloseEvent) => Effect.Effect<void, unknown>,
  data: unknown,
) {
  if (data instanceof Blob) {
    void data
      .arrayBuffer()
      .then((buffer) => Effect.runFork(write(new Uint8Array(buffer)).pipe(Effect.catch(() => Effect.void))))
    return
  }
  if (typeof data === "string" || data instanceof Uint8Array) {
    Effect.runFork(write(data).pipe(Effect.catch(() => Effect.void)))
    return
  }
  if (data instanceof ArrayBuffer) Effect.runFork(write(new Uint8Array(data)).pipe(Effect.catch(() => Effect.void)))
}

function proxyWebSocket(request: HttpServerRequest.HttpServerRequest, target: string | URL) {
  return Effect.gen(function* () {
    const source = sourceRequest(request)
    const socket = yield* Effect.orDie(request.upgrade)
    const write = yield* socket.writer
    const queue: Array<string | Uint8Array> = []
    const remote = new WebSocket(ServerProxy.websocketTargetURL(target), ServerProxy.websocketProtocols(source))
    remote.binaryType = "arraybuffer"
    remote.onopen = () => {
      for (const item of queue) remote.send(item)
      queue.length = 0
    }
    remote.onmessage = (event) => writeSocket(write, event.data)
    remote.onerror = () =>
      Effect.runFork(write(new Socket.CloseEvent(1011, "proxy error")).pipe(Effect.catch(() => Effect.void)))
    remote.onclose = (event) =>
      Effect.runFork(write(new Socket.CloseEvent(event.code, event.reason)).pipe(Effect.catch(() => Effect.void)))

    yield* socket
      .runRaw((message) => {
        const data = typeof message === "string" ? message : message.slice()
        if (remote.readyState === WebSocket.OPEN) {
          remote.send(data)
          return
        }
        queue.push(data)
      })
      .pipe(
        Effect.catch(() => Effect.void),
        Effect.ensuring(Effect.sync(() => remote.close())),
        Effect.orDie,
      )
    return HttpServerResponse.empty()
  })
}

function proxyRemote(
  request: HttpServerRequest.HttpServerRequest,
  workspace: Workspace.Info,
  target: Extract<Target, { type: "remote" }>,
  requestURL: URL,
) {
  const url = workspaceProxyURL(target.url, requestURL)
  const source = sourceRequest(request)
  if (source.headers.get("upgrade")?.toLowerCase() === "websocket") return proxyWebSocket(request, url)
  return Effect.promise(() => ServerProxy.http(url, target.headers, source, workspace.id)).pipe(
    Effect.map(HttpServerResponse.raw),
  )
}

function requestContext() {
  return Effect.withFiber<HttpServerRequest.HttpServerRequest, never>((fiber) =>
    Effect.succeed(Context.getUnsafe(fiber.context, HttpServerRequest.HttpServerRequest)),
  )
}

function provideRequestContext(
  effect: HandlerEffect,
  request: HttpServerRequest.HttpServerRequest,
  sessionWorkspaceID?: WorkspaceID,
) {
  return Effect.gen(function* () {
    const url = new URL(request.url, "http://localhost")
    const headers = requestHeaders(request)
    const envWorkspaceID = Flag.OPENCODE_WORKSPACE_ID ? WorkspaceID.make(Flag.OPENCODE_WORKSPACE_ID) : undefined
    const workspaceParam = url.searchParams.get("workspace")
    const workspaceID = sessionWorkspaceID ?? (workspaceParam ? WorkspaceID.make(workspaceParam) : undefined)
    const workspace =
      workspaceID && !envWorkspaceID ? yield* Effect.promise(() => Workspace.get(workspaceID)) : undefined

    if (workspaceID && !workspace && !envWorkspaceID) {
      return HttpServerResponse.text(`Workspace not found: ${workspaceID}`, {
        status: 500,
        contentType: "text/plain; charset=utf-8",
      })
    }

    if (
      workspace &&
      !isLocalWorkspaceRoute(request.method, url.pathname) &&
      !url.pathname.startsWith("/console") &&
      !envWorkspaceID
    ) {
      const adaptor = yield* Effect.promise(() => getAdaptor(workspace.projectID, workspace.type))
      const target = yield* Effect.promise(() => Promise.resolve(adaptor.target(workspace)))
      if (target.type === "remote") return yield* proxyRemote(request, workspace, target, url)
      const ctx = yield* Effect.promise(() =>
        Instance.provide({
          directory: target.directory,
          init: () => AppRuntime.runPromise(InstanceBootstrap),
          fn: () => Instance.current,
        }),
      )
      return yield* effect.pipe(
        Effect.provideService(InstanceRef, ctx),
        Effect.provideService(WorkspaceRef, workspace.id),
      )
    }

    const raw = url.searchParams.get("directory") || headers.get("x-opencode-directory") || currentDirectory()
    const ctx = yield* Effect.promise(() =>
      Instance.provide({
        directory: Filesystem.resolve(decode(raw)),
        init: () => AppRuntime.runPromise(InstanceBootstrap),
        fn: () => Instance.current,
      }),
    )

    return yield* effect.pipe(
      Effect.provideService(InstanceRef, ctx),
      Effect.provideService(WorkspaceRef, envWorkspaceID ?? workspaceID),
    )
  })
}

function provideInstanceContext(effect: HandlerEffect) {
  return Effect.gen(function* () {
    const request = yield* requestContext()
    const sessionID = getWorkspaceRouteSessionID(new URL(request.url, "http://localhost"))
    const session = sessionID
      ? yield* Session.Service.use((svc) => svc.get(sessionID)).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
          Effect.catchDefect(() => Effect.succeed(undefined)),
        )
      : undefined
    return yield* provideRequestContext(effect, request, session?.workspaceID)
  })
}

export const instanceContextLayer = Layer.succeed(
  InstanceContextMiddleware,
  InstanceContextMiddleware.of((effect) => provideInstanceContext(effect)),
)

export const instanceRouterLayer = HttpRouter.middleware()(
  Effect.succeed((effect) =>
    requestContext().pipe(Effect.flatMap((request) => provideRequestContext(effect, request))),
  ),
).layer
