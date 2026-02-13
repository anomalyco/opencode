import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

// 1. Setup Mocks
const mocks = {
  Config: {
    OPENCODE_PORT: 3000,
  },
  proxyRequest: mock(() => Promise.resolve(new Response("proxied"))),
  handleCorsPreflight: mock(() => new Response("cors", { status: 204 })),
  shouldDirectoryProxy: mock((path: string) => {
    const root = path.split("/").filter(Boolean)[0];
    return ["agent", "opencode"].includes(root);
  }),
  directoryProxyRoots: new Set(["agent", "opencode"]),
  localOnlyProxyRoots: new Set(["auth"]),
};

// Mock modules
mock.module("../../config/index.ts", () => ({ Config: mocks.Config }));
mock.module("./forward.ts", () => ({
  proxyRequest: mocks.proxyRequest,
  handleCorsPreflight: mocks.handleCorsPreflight,
}));
mock.module("../routes/index.ts", () => ({
  directoryProxyRoots: mocks.directoryProxyRoots,
  shouldDirectoryProxy: mocks.shouldDirectoryProxy,
  localOnlyProxyRoots: mocks.localOnlyProxyRoots,
}));

import { LocalProxyMiddleware } from "./local.ts";

describe("LocalProxyMiddleware", () => {
  beforeEach(() => {
    mocks.proxyRequest.mockClear();
    LocalProxyMiddleware.reset();
  });

  const request = async (path: string) => {
    const app = LocalProxyMiddleware();
    return app.request(new Request(`http://localhost${path}`));
  };

  it("forwards proxy roots to localhost", async () => {
    const res = await request("/agent/info");
    
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("proxied");
    
    expect(mocks.proxyRequest).toHaveBeenCalledTimes(1);
    const [, opts] = mocks.proxyRequest.mock.calls[0];
    expect(opts.upstreamBase).toBe("http://127.0.0.1:3000");
    expect(opts.pathPrefix).toBe(""); 
    expect(opts.responseTag).toBe("x-opencode-local");
  });

  it("forwards local-only roots to localhost", async () => {
    const res = await request("/auth/login");
    expect(res.status).toBe(200);
    
    expect(mocks.proxyRequest).toHaveBeenCalledTimes(1);
    const [, opts] = mocks.proxyRequest.mock.calls[0];
    expect(opts.upstreamBase).toBe("http://127.0.0.1:3000");
  });

  it("skips internal API routes", async () => {
    const res = await request("/api/something");
    expect(res.status).toBe(404);
    expect(mocks.proxyRequest).not.toHaveBeenCalled();
  });
});
