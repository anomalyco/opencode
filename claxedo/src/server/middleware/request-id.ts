/**
 * Request ID and timing middleware
 */
import type { MiddlewareHandler } from "hono";
import { makeReqId, nowMs, logJson } from "../lib/logging.ts";
import type { GatewayContext } from "../context.ts";

export const requestIdMiddleware = (): MiddlewareHandler<GatewayContext> => {
  return async (c, next) => {
    const reqId = makeReqId();
    const start = nowMs();

    c.set("reqId", reqId);
    c.set("startTime", start);

    try {
      await next();
    } finally {
      const durationMs = nowMs() - start;
      const status = c.res?.status ?? undefined;
      logJson("info", {
        reqId,
        kind: "http",
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status,
        durationMs,
      });
    }
  };
};
