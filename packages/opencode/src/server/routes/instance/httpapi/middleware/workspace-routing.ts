import { getAdaptor } from "@/control-plane/adaptors"
import { WorkspaceID } from "@/control-plane/schema"
import type { Target } from "@/control-plane/types"
import { Workspace } from "@/control-plane/workspace"
import { Instance } from "@/project/instance"
import { Session } from "@/session/session"
import { HttpApiProxy } from "./proxy"
import * as Fence from "@/server/fence"
import { getWorkspaceRouteSessionID, isLocalWorkspaceRoute, workspaceProxyURL } from "@/server/workspace"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Context, Data, Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"

type RemoteTarget = Extract<Target, { type: "remote" }>

type RequestPlan = Data.TaggedEnum<{
  MissingWorkspace: { readonly workspaceID: WorkspaceID }
  Local: { readonly directory: string; readonly workspaceID?: WorkspaceID }
  Remote: {
    readonly request: HttpServerRequest.HttpServerRequest
    readonly workspace: Workspace.Info
    readonly target: RemoteTarget
    readonly url: URL
  }
}>
const RequestPlan = Data.taggedEnum<RequestPlan>()

export class WorkspaceRouteContext extends Context.Service<WorkspaceRouteContext, {
  readonly directory: string
  readonly workspaceID?: WorkspaceID
}>()("@opencode/ExperimentalHttpApiWorkspaceRouteContext") {}

export class WorkspaceRoutingMiddleware extends HttpApiMiddleware.Service<
  WorkspaceRoutingMiddleware,
  {
    provides: WorkspaceRouteContext
    requires: Session.Service
  }
>()("@opencode/ExperimentalHttpApiWorkspaceRouting") {}

function currentDirectory(): string {
  try {
    return Instance.directory
  } catch {
    return process.cwd()
  }
}

function requestURL(request: HttpServerRequest.HttpServerRequest): URL {
  return new URL(request.url, "http://localhost")
}

function configuredWorkspaceID(): WorkspaceID | undefined {
  return Flag.OPENCODE_WORKSPACE_ID ? WorkspaceID.make(Flag.OPENCODE_WORKSPACE_ID) : undefined
}

function selectedWorkspaceID(url: URL, sessionWorkspaceID?: WorkspaceID): WorkspaceID | undefined {
  const workspaceParam = url.searchParams.get("workspace")
  return sessionWorkspaceID ?? (workspaceParam ? WorkspaceID.make(workspaceParam) : undefined)
}

function defaultDirectory(request: HttpServerRequest.HttpServerRequest, url: URL): string {
  return url.searchParams.get("directory") || request.headers["x-opencode-directory"] || currentDirectory()
}

function shouldStayOnControlPlane(request: HttpServerRequest.HttpServerRequest, url: URL): boolean {
  return isLocalWorkspaceRoute(request.method, url.pathname) || url.pathname.startsWith("/console")
}

function resolveWorkspace(
  id: WorkspaceID | undefined,
  envWorkspaceID: WorkspaceID | undefined,
): Effect.Effect<Workspace.Info | void> {
  if (!id || envWorkspaceID) return Effect.void
  return Effect.promise(() => Workspace.get(id))
}

function missingWorkspaceResponse(id: WorkspaceID): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.text(`Workspace not found: ${id}`, {
    status: 500,
    contentType: "text/plain; charset=utf-8",
  })
}

function resolveTarget(workspace: Workspace.Info): Effect.Effect<Target> {
  return Effect.gen(function* () {
    const adaptor = yield* Effect.promise(() => getAdaptor(workspace.projectID, workspace.type))
    return yield* Effect.promise(() => Promise.resolve(adaptor.target(workspace)))
  })
}

function proxyRemote(
  request: HttpServerRequest.HttpServerRequest,
  workspace: Workspace.Info,
  target: RemoteTarget,
  url: URL,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, Socket.WebSocketConstructor> {
  return Effect.gen(function* () {
    const syncing = yield* Effect.promise(() => Workspace.isSyncing(workspace.id))
    if (!syncing) {
      return HttpServerResponse.text(`broken sync connection for workspace: ${workspace.id}`, {
        status: 503,
        contentType: "text/plain; charset=utf-8",
      })
    }
    const proxyURL = workspaceProxyURL(target.url, url)
    const headers = request.headers as Record<string, string>
    if (headers["upgrade"]?.toLowerCase() === "websocket") return yield* HttpApiProxy.websocket(request, proxyURL)
    const response = yield* HttpApiProxy.http(proxyURL, target.headers, request)
    const sync = Fence.parse(new Headers(response.headers))
    if (sync) yield* Effect.promise(() => Fence.wait(workspace.id, sync, request.source instanceof Request ? request.source.signal : undefined))
    return response
  })
}

function planWorkspaceRequest(
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
  workspace: Workspace.Info,
): Effect.Effect<RequestPlan> {
  return Effect.gen(function* () {
    const target = yield* resolveTarget(workspace)
    if (target.type === "remote") return RequestPlan.Remote({ request, workspace, target, url })
    return RequestPlan.Local({ directory: target.directory, workspaceID: workspace.id })
  })
}

function planRequest(
  request: HttpServerRequest.HttpServerRequest,
  sessionWorkspaceID?: WorkspaceID,
): Effect.Effect<RequestPlan> {
  return Effect.gen(function* () {
    const url = requestURL(request)
    const envWorkspaceID = configuredWorkspaceID()
    const workspaceID = selectedWorkspaceID(url, sessionWorkspaceID)
    const workspace = yield* resolveWorkspace(workspaceID, envWorkspaceID)

    if (workspaceID && workspace === undefined && !envWorkspaceID) {
      return RequestPlan.MissingWorkspace({ workspaceID })
    }

    if (workspace !== undefined && !envWorkspaceID && !shouldStayOnControlPlane(request, url)) {
      return yield* planWorkspaceRequest(request, url, workspace)
    }

    return RequestPlan.Local({ directory: defaultDirectory(request, url), workspaceID: envWorkspaceID ?? workspaceID })
  })
}

function routeWorkspace<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext>,
  plan: RequestPlan,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, Socket.WebSocketConstructor> {
  return RequestPlan.$match(plan, {
    MissingWorkspace: ({ workspaceID }) => Effect.succeed(missingWorkspaceResponse(workspaceID)),
    Remote: ({ request, workspace, target, url }) => proxyRemote(request, workspace, target, url),
    Local: ({ directory, workspaceID }) =>
      effect.pipe(
        Effect.provideService(WorkspaceRouteContext, WorkspaceRouteContext.of({ directory, workspaceID })),
      ),
  })
}

function routeWorkspaceRequest<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext>,
  request: HttpServerRequest.HttpServerRequest,
  sessionWorkspaceID?: WorkspaceID,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, Socket.WebSocketConstructor> {
  return Effect.flatMap(planRequest(request, sessionWorkspaceID), (plan) => routeWorkspace(effect, plan))
}

function routeHttpApiWorkspace<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext>,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E,
  Session.Service | HttpServerRequest.HttpServerRequest | Socket.WebSocketConstructor
> {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const sessionID = getWorkspaceRouteSessionID(requestURL(request))
    const session = sessionID
      ? yield* Session.Service.use((svc) => svc.get(sessionID)).pipe(Effect.catchDefect(() => Effect.void))
      : undefined
    return yield* routeWorkspaceRequest(effect, request, session?.workspaceID)
  })
}

export const workspaceRoutingLayer = Layer.effect(
  WorkspaceRoutingMiddleware,
  Effect.gen(function* () {
    const makeWebSocket = yield* Socket.WebSocketConstructor
    return WorkspaceRoutingMiddleware.of((effect) =>
      routeHttpApiWorkspace(effect).pipe(Effect.provideService(Socket.WebSocketConstructor, makeWebSocket)),
    )
  }),
)

export const workspaceRouterMiddleware = HttpRouter.middleware<{ provides: WorkspaceRouteContext }>()(
  Effect.gen(function* () {
    const makeWebSocket = yield* Socket.WebSocketConstructor
    return (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        return yield* routeWorkspaceRequest(effect, request).pipe(
          Effect.provideService(Socket.WebSocketConstructor, makeWebSocket),
        )
      })
  }),
)
