import { getAdaptor } from "@/control-plane/adaptors"
import { WorkspaceID } from "@/control-plane/schema"
import type { Target } from "@/control-plane/types"
import { Workspace } from "@/control-plane/workspace"
import { Instance } from "@/project/instance"
import { Session } from "@/session/session"
import { HttpApiProxy, sourceRequest } from "./proxy"
import { getWorkspaceRouteSessionID, isLocalWorkspaceRoute, workspaceProxyURL } from "@/server/workspace"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"

type RemoteTarget = Extract<Target, { type: "remote" }>
type RequestPlan =
  | { readonly type: "missing-workspace"; readonly workspaceID: WorkspaceID }
  | { readonly type: "local"; readonly directory: string; readonly workspaceID?: WorkspaceID }
  | {
      readonly type: "remote"
      readonly request: HttpServerRequest.HttpServerRequest
      readonly workspace: Workspace.Info
      readonly target: RemoteTarget
      readonly url: URL
    }

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

function requestHeaders(request: HttpServerRequest.HttpServerRequest): Headers {
  return sourceRequest(request).headers
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
  return url.searchParams.get("directory") || requestHeaders(request).get("x-opencode-directory") || currentDirectory()
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
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  const proxyURL = workspaceProxyURL(target.url, url)
  const source = sourceRequest(request)
  if (source.headers.get("upgrade")?.toLowerCase() === "websocket") return HttpApiProxy.websocket(request, proxyURL)
  return HttpApiProxy.http(proxyURL, target.headers, source, workspace.id).pipe(Effect.map(HttpServerResponse.raw))
}

function planWorkspaceRequest(
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
  workspace: Workspace.Info,
): Effect.Effect<RequestPlan> {
  return Effect.gen(function* () {
    const target = yield* resolveTarget(workspace)
    if (target.type === "remote") {
      return {
        type: "remote",
        request,
        workspace,
        target,
        url,
      } satisfies RequestPlan
    }
    return {
      type: "local",
      directory: target.directory,
      workspaceID: workspace.id,
    } satisfies RequestPlan
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
      return { type: "missing-workspace", workspaceID } satisfies RequestPlan
    }

    if (workspace !== undefined && !envWorkspaceID && !shouldStayOnControlPlane(request, url)) {
      return yield* planWorkspaceRequest(request, url, workspace)
    }

    return {
      type: "local",
      directory: defaultDirectory(request, url),
      workspaceID: envWorkspaceID ?? workspaceID,
    } satisfies RequestPlan
  })
}

function routeWorkspace<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext>,
  plan: RequestPlan,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E> {
  return Effect.gen(function* () {
    switch (plan.type) {
      case "missing-workspace":
        return missingWorkspaceResponse(plan.workspaceID)
      case "remote":
        return yield* proxyRemote(plan.request, plan.workspace, plan.target, plan.url)
      case "local":
        return yield* effect.pipe(
          Effect.provideService(WorkspaceRouteContext, WorkspaceRouteContext.of({
            directory: plan.directory,
            workspaceID: plan.workspaceID,
          })),
        )
    }
  })
}

function routeWorkspaceRequest<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext>,
  request: HttpServerRequest.HttpServerRequest,
  sessionWorkspaceID?: WorkspaceID,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E> {
  return Effect.flatMap(planRequest(request, sessionWorkspaceID), (plan) => routeWorkspace(effect, plan))
}

function routeHttpApiWorkspace<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, Session.Service | HttpServerRequest.HttpServerRequest> {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const sessionID = getWorkspaceRouteSessionID(requestURL(request))
    const session = sessionID
      ? yield* Session.Service.use((svc) => svc.get(sessionID)).pipe(Effect.catchDefect(() => Effect.void))
      : undefined
    return yield* routeWorkspaceRequest(effect, request, session?.workspaceID)
  })
}

export const workspaceRoutingLayer = Layer.succeed(
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingMiddleware.of((effect) => routeHttpApiWorkspace(effect)),
)

export const workspaceRouterMiddleware = HttpRouter.middleware<{ provides: WorkspaceRouteContext }>()((effect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    return yield* routeWorkspaceRequest(effect, request)
  }),
)
