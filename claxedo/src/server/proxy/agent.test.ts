import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

// 1. Setup Mocks
const mocks = {
  getSandboxAgentUrl: mock(() => null as string | null),
  getSandboxAgentToken: mock(() => null as string | null),
  proxyRequest: mock(() => Promise.resolve(new Response("proxied"))),
  handleCorsPreflight: mock(() => new Response("cors", { status: 204 })),
  shouldDirectoryProxy: mock((path: string) => {
    const root = path.split("/").filter(Boolean)[0];
    return ["agent", "opencode"].includes(root);
  }),
  directoryProxyRoots: new Set(["agent", "opencode"]),
};

// Mock modules
mock.module("../routes/sandbox-agent.ts", () => ({
  getSandboxAgentUrl: mocks.getSandboxAgentUrl,
  getSandboxAgentToken: mocks.getSandboxAgentToken,
}));
mock.module("./forward.ts", () => ({
  proxyRequest: mocks.proxyRequest,
  handleCorsPreflight: mocks.handleCorsPreflight,
}));
mock.module("../routes/index.ts", () => ({
  directoryProxyRoots: mocks.directoryProxyRoots,
  shouldDirectoryProxy: mocks.shouldDirectoryProxy,
}));

import { SandboxAgentProxyMiddleware } from "./agent.ts";

describe("SandboxAgentProxyMiddleware", () => {
  beforeEach(() => {
    mocks.getSandboxAgentUrl.mockClear();
    mocks.proxyRequest.mockClear();
    mocks.getSandboxAgentUrl.mockReturnValue(null);
    SandboxAgentProxyMiddleware.reset();
  });

  const request = async (path: string) => {
    const app = SandboxAgentProxyMiddleware();
    return app.request(new Request(`http://localhost${path}`));
  };

  it("skips if Agent URL is null", async () => {
    // Unlike LocalBackendProxy which fell back, this one just next()'s
    const res = await request("/agent/info");
    expect(res.status).toBe(404); // Default 404 from Hono
    expect(mocks.proxyRequest).not.toHaveBeenCalled();
  });

  it("forwards to Agent if running", async () => {
    mocks.getSandboxAgentUrl.mockReturnValue("http://agent:1234");
    const res = await request("/agent/info");
    
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("proxied");
    
    expect(mocks.proxyRequest).toHaveBeenCalledTimes(1);
    const [, opts] = mocks.proxyRequest.mock.calls[0];
    expect(opts.upstreamBase).toBe("http://agent:1234");
    expect(opts.pathPrefix).toBe("/opencode");
    expect(opts.responseTag).toBe("x-sandbox-agent");
  });

  it("skips paths not in directory proxy roots", async () => {
    mocks.getSandboxAgentUrl.mockReturnValue("http://agent:1234");
    const res = await request("/unknown/path");
    expect(res.status).toBe(404);
    expect(mocks.proxyRequest).not.toHaveBeenCalled();
  });
});
