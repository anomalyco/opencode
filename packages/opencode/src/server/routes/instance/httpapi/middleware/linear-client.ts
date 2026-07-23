import { LinearClientRef, LinearMcpClient } from "@/issue/mcp-client"
import { MCP } from "@/mcp"
import { Effect, Exit, Layer } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"

/**
 * LinearClientMiddleware — provides `LinearClientRef` (LinearMcpClient | null)
 * for every Issue API request.
 *
 * The Linear client is request-derived (per-request resolution via
 * `MCP.Service.clients()` + cached env-var fallback), so it qualifies for
 * middleware injection per `httpapi/AGENTS.md` line 35: "Use
 * `Effect.provideService(...)` in middleware only for request-derived
 * context."
 *
 * Per `httpapi/AGENTS.md` line 39: "declare endpoint-contract middleware on
 * the owning `HttpApiGroup` and provide its implementation layer at the
 * assembly boundary in `server.ts`." The middleware is declared on `IssueApi`
 * in `groups/issue.ts` and its implementation layer is provided in `server.ts`
 * via `Layer.provide(linearClientLayer)`.
 *
 * Middleware registration order matters: Effect's HttpApi executes middleware
 * in REVERSE of registration order (last registered runs first, outermost).
 * This middleware calls `mcp.clients()` → `InstanceState.get` → `InstanceRef`,
 * so it MUST run AFTER `InstanceContextMiddleware` provides `InstanceRef`.
 * Registering it FIRST makes it the innermost middleware (runs last, just
 * before the handler), by which point `InstanceRef` is available.
 *
 * Cost: every Issue route pays `mcp.clients()` (dict lookup, O(1)) + a cached
 * env-var fallback (runs `LinearMcpClient.create()` at most once per server
 * lifetime). Routes that don't talk to Linear simply don't yield
 * `LinearClientRef` — the provided value is ignored.
 */
export class LinearClientMiddleware extends HttpApiMiddleware.Service<LinearClientMiddleware>()(
  "@opencode/ExperimentalHttpApiLinearClient",
) {}

/**
 * Resolve the per-request Linear MCP client. Path A: shared project MCP
 * client (from `MCP.Service.clients()`); Path B: env-var fallback (cached).
 * Returns null when neither path produces a client.
 */
const resolveClient = Effect.fn("LinearClientMiddleware.resolveClient")(function* (input: {
  mcp: MCP.Interface
  envClientCached: Effect.Effect<Exit.Exit<LinearMcpClient, unknown>, never, never>
}) {
  // Path A: Linear MCP registered in opencode.jsonc → use the project's
  // already-connected MCP client.
  const clients = yield* input.mcp.clients()
  const raw = clients["linear"]
  if (raw) return LinearMcpClient.wrap(raw)
  // Path B: no MCP registration; fall back to a direct connection
  // using LINEAR_API_KEY. The cached Effect returns an Exit — Success
  // on first create() success, Failure after first create() failure
  // (no retry until server restart).
  const exit = yield* input.envClientCached
  if (Exit.isFailure(exit)) return null
  return exit.value
})

function provideLinearClient<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E>,
  mcp: MCP.Interface,
  envClientCached: Effect.Effect<Exit.Exit<LinearMcpClient, unknown>, never, never>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E> {
  return Effect.gen(function* () {
    const client = yield* resolveClient({ mcp, envClientCached })
    return yield* effect.pipe(Effect.provideService(LinearClientRef, client))
  })
}

export const linearClientLayer = Layer.effect(
  LinearClientMiddleware,
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    // Cached fallback client created from LINEAR_API_KEY env var. Lives in
    // the layer closure so it's reused across requests. Both success
    // (Exit.Success) and failure (Exit.Failure) are cached — we never
    // retry after a failure (the user must fix env/config and restart
    // the server). `Effect.exit` keeps the cached value's error type
    // as a concrete Exit — avoids the `unknown` error widening that
    // `Effect.catchTag` would introduce in this Effect version.
    const envClientCached = yield* Effect.cached(
      LinearMcpClient.create().pipe(
        Effect.tapError((e) =>
          Effect.logWarning(`[LinearClientMiddleware] LinearMcpClient.create failed: ${e.message}`),
        ),
        Effect.exit,
      ),
    )
    return LinearClientMiddleware.of((effect) => provideLinearClient(effect, mcp, envClientCached))
  }),
)
