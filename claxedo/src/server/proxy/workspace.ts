/**
 * Workspace proxy routes: /w/:workspaceId/*
 * Forwards requests to the workspace's sandbox OpenCode server.
 * Auto-wake is handled by resolveWorkspaceUpstream.
 */
import { Hono } from "hono";
import { lazy } from "../lib/lazy.ts";
import { logJson, nowMs } from "../lib/logging.ts";
import { stripHopByHopHeaders, withDevCors, looksLikeWsUpgrade } from "./headers.ts";
import { fetchFollow } from "./fetch.ts";
import { getConvex } from "../../clients/index.ts";
import { api } from "../../../convex/_generated/api.js";
import {
  resolveWorkspaceUpstream,
  resolveOrganizationIdForWorkspace,
} from "../../services/sandbox-resolver.ts";
import { storeProviderCredential } from "../../services/identity.ts";
import type { GatewayContext } from "../context.ts";
import {
  withSpan,
  SpanKind,
  injectTraceContext,
  proxyRequestDuration,
  proxyResolutionDuration,
  workspaceWakeDuration,
} from "../../observability/index.ts";

export const WorkspaceProxyRoutes = lazy(() =>
  new Hono<GatewayContext>().all("/w/:workspaceId/*", async (c) => {
    const reqId = c.get("reqId");
    (globalThis as any).__claxedo_reqId = reqId;

    if (looksLikeWsUpgrade(c.req.raw)) {
      return c.text("Upgrade required", 426);
    }

    const workspaceId = c.req.param("workspaceId");

    // Handle CORS preflight
    if (c.req.method === "OPTIONS") {
      logJson("info", {
        reqId,
        kind: "proxy.preflight",
        workspaceId,
        origin: c.req.header("origin") ?? undefined,
        acrm: c.req.header("access-control-request-method") ?? undefined,
        acrh: c.req.header("access-control-request-headers") ?? undefined,
      });
      const headers = withDevCors(
        c.req.raw,
        new Headers({
          "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers":
            c.req.header("access-control-request-headers") ??
            "content-type,authorization,x-opencode-directory",
          "access-control-max-age": "600",
        })
      );
      return new Response(null, { status: 204, headers });
    }

    try {
      const t0 = nowMs();

      // Resolve workspace URL (auto-wakes if sleeping) with tracing
      const tResolveStart = nowMs();
      const resolved = await withSpan(
        "gateway.proxy.workspace.resolve",
        async (span) => {
          span.setAttribute("workspace.id", workspaceId);
          const result = await resolveWorkspaceUpstream(workspaceId);
          if (result) {
            span.setAttribute("sandbox.id", result.sandboxId ?? "unknown");
            span.setAttribute("sandbox.url", result.sandboxUrl);
          }
          return result;
        },
        { kind: SpanKind.CLIENT }
      );
      const resolveDuration = nowMs() - tResolveStart;

      // Record resolution metrics (resolution time > 1000ms likely indicates wake)
      const likelyWake = resolveDuration > 1000;
      proxyResolutionDuration.observe(
        { proxy_type: "workspace", cache_hit: resolveDuration < 10 ? "true" : "false" },
        resolveDuration / 1000
      );

      if (!resolved?.sandboxUrl) {
        if (likelyWake) {
          workspaceWakeDuration.observe({ org_id: "unknown", status: "failure" }, resolveDuration / 1000);
        }
        return c.json({ error: "Sandbox not available. It may need to be created." }, 404);
      }

      // Record wake metric with org_id if this was a wake operation
      if (likelyWake) {
        const orgId = await resolveOrganizationIdForWorkspace(workspaceId).catch(() => null);
        workspaceWakeDuration.observe(
          { org_id: orgId || "unknown", status: "success" },
          resolveDuration / 1000
        );
      }

      const upstreamBase = resolved.sandboxUrl.replace(/\/+$/, "");
      const incomingUrl = new URL(c.req.url);
      const prefix = `/w/${workspaceId}`;
      const restPath = incomingUrl.pathname.startsWith(prefix)
        ? incomingUrl.pathname.slice(prefix.length)
        : incomingUrl.pathname;
      const upstreamUrl = `${upstreamBase}${restPath}${incomingUrl.search}`;

      logJson("info", {
        reqId,
        kind: "proxy.request_start",
        workspaceId,
        sandboxId: resolved.sandboxId,
        resolveMs: resolveDuration,
        method: c.req.method,
        restPath,
      });

      const headers = stripHopByHopHeaders(c.req.raw.headers);
      headers.set("host", new URL(upstreamBase).host);
      if (headers.has("origin")) {
        headers.set("origin", upstreamBase);
      }
      headers.delete("referer");
      headers.set("user-agent", "claxedo-gateway/1.0");

      let bodyBytes: ArrayBuffer | undefined;
      if (c.req.method !== "GET" && c.req.method !== "HEAD") {
        bodyBytes = await c.req.raw.arrayBuffer().catch(() => undefined);
      }

      // Intercept /auth/:provider requests to store credentials in Convex
      if (c.req.method === "PUT" && /^\/auth\/[^/]+$/.test(restPath)) {
        try {
          const providerID = restPath.split("/")[2] ?? "";
          if (providerID) {
            const text = bodyBytes ? Buffer.from(bodyBytes).toString("utf8") : "";
            const parsed = text ? JSON.parse(text) : null;
            const orgFromWorkspace = await resolveOrganizationIdForWorkspace(workspaceId);
            if (orgFromWorkspace) {
              await storeProviderCredential({
                providerID,
                authPayload: parsed,
                organizationId: orgFromWorkspace,
              });
            }
          }
        } catch {
          // ignore: upstream still handles auth.set, and Convex storage is best-effort.
        }
      }

      const bodyBuffer = bodyBytes ? Buffer.from(bodyBytes) : undefined;

      // Inject trace context into headers for upstream
      const headersObj: Record<string, string> = {};
      headers.forEach((value, key) => {
        headersObj[key] = value;
      });
      const tracedHeaders = injectTraceContext(headersObj);
      const finalHeaders = new Headers(tracedHeaders);

      const init: RequestInit & { duplex?: "half" } = {
        method: c.req.method,
        headers: finalHeaders,
        body: c.req.method === "GET" || c.req.method === "HEAD" ? undefined : bodyBuffer,
        duplex: "half",
      };

      const tFetch = nowMs();
      const upstreamRes = await withSpan(
        "gateway.proxy.workspace.fetch",
        async (span) => {
          span.setAttribute("http.url", upstreamUrl);
          span.setAttribute("http.method", c.req.method);
          const res = await fetchFollow(upstreamUrl, init);
          span.setAttribute("http.status_code", res.status);
          return res;
        },
        { kind: SpanKind.CLIENT }
      );

      // Record proxy metrics
      proxyRequestDuration.observe(
        { proxy_type: "workspace", status: String(upstreamRes.status) },
        (nowMs() - tFetch) / 1000
      );

      // Log error response bodies for debugging
      let errorBody: string | undefined;
      if (upstreamRes.status >= 400 && upstreamRes.status < 500) {
        try {
          const cloned = upstreamRes.clone();
          errorBody = await cloned.text().catch(() => undefined);
        } catch {}
      }

      logJson("info", {
        reqId,
        kind: "proxy.response",
        workspaceId,
        restPath,
        status: upstreamRes.status,
        durationMs: nowMs() - t0,
        ...(errorBody ? { errorBody: errorBody.slice(0, 500) } : {}),
      });

      // Augment /provider response with connected providers from Convex
      if (c.req.method === "GET" && restPath === "/provider" && upstreamRes.ok) {
        try {
          const json = (await upstreamRes.json()) as any;
          const organizationId = await resolveOrganizationIdForWorkspace(workspaceId);
          if (organizationId) {
            const rows = await getConvex().query(api.aiCredentials.listProviders, {
              organizationId,
            });
            const connected = (rows ?? [])
              .filter((x: any) => x?.hasKey)
              .map((x: any) => String(x.provider));
            json.connected = connected;
          }

          const resHeaders = new Headers(upstreamRes.headers);
          resHeaders.set("content-type", "application/json");
          resHeaders.delete("content-length");
          resHeaders.delete("set-cookie");
          withDevCors(c.req.raw, resHeaders);
          return new Response(JSON.stringify(json), {
            status: upstreamRes.status,
            headers: resHeaders,
          });
        } catch {
          // fall through to streaming response
        }
      }

      const resHeaders = new Headers(upstreamRes.headers);
      resHeaders.delete("set-cookie");
      // Add smart caching headers
      resHeaders.set("cache-control", "public, max-age=5, stale-while-revalidate=900");
      withDevCors(c.req.raw, resHeaders);

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: resHeaders,
      });
    } catch (err: any) {
      // Record error metric
      proxyRequestDuration.observe({ proxy_type: "workspace", status: "502" }, 0);

      const headers = withDevCors(
        c.req.raw,
        new Headers({
          "content-type": "application/json",
        })
      );
      return new Response(
        JSON.stringify({
          error: "Gateway request failed",
          message: err?.message || String(err),
          reqId,
        }),
        { status: 502, headers }
      );
    } finally {
      try {
        delete (globalThis as any).__claxedo_reqId;
      } catch {}
    }
  })
);
