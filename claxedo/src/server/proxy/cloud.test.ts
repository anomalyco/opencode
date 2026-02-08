import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

// 1. Setup Mocks
const mocks = {
  resolveDirectoryUpstream: mock(() => Promise.resolve(null as any)),
  resolveIdentity: mock(() => Promise.resolve({ ok: true, organizationId: "org-123" } as any)),
  resolveOrganizationIdForWorkspace: mock(() => Promise.resolve("org-123")),
  fetchFollow: mock(() => Promise.resolve(new Response("cloud-response"))),
  shouldDirectoryProxy: mock((path: string) => true),
  Config: {
    CONVEX_URL: "https://mock.convex.cloud",
    AUTH_ENABLED: true,
  }
};

// Mock modules
mock.module("../../services/sandbox-resolver.ts", () => ({
  resolveDirectoryUpstream: mocks.resolveDirectoryUpstream,
  resolveOrganizationIdForWorkspace: mocks.resolveOrganizationIdForWorkspace,
}));
mock.module("../../services/identity.ts", () => ({
  resolveIdentity: mocks.resolveIdentity,
}));
mock.module("./fetch.ts", () => ({
  fetchFollow: mocks.fetchFollow,
}));
mock.module("../routes/index.ts", () => ({
  shouldDirectoryProxy: mocks.shouldDirectoryProxy,
}));
mock.module("../../config/index.ts", () => ({ Config: mocks.Config }));
mock.module("../lib/logging.ts", () => ({
  logJson: () => {},
  nowMs: () => Date.now(),
}));
mock.module("../events/upstream.ts", () => ({
  touchDirectory: () => {},
}));
mock.module("../../observability/index.ts", () => ({
  withSpan: (_: any, fn: any) => fn({ setAttribute: () => {} }),
  SpanKind: { CLIENT: "CLIENT" },
  injectTraceContext: (h: any) => h,
  proxyRequestDuration: { observe: () => {} },
  proxyResolutionDuration: { observe: () => {} },
  setSpanAttributes: () => {},
}));

import { DirectoryProxyMiddleware } from "./directory.ts";

describe("DirectoryProxyMiddleware (Cloud Mode)", () => {
  beforeEach(() => {
    mocks.resolveDirectoryUpstream.mockClear();
    mocks.fetchFollow.mockClear();
    DirectoryProxyMiddleware.reset();
  });

  const request = async (path: string, headers: Record<string, string> = {}) => {
    const app = DirectoryProxyMiddleware();
    // Simulate valid directory header
    const reqHeaders = new Headers(headers);
    if (!reqHeaders.has("x-opencode-directory")) {
        reqHeaders.set("x-opencode-directory", "/home/daytona/workspace");
    }
    return app.request(new Request(`http://gateway${path}`, { headers: reqHeaders }));
  };

  it("forwards to Sandbox when directory resolves", async () => {
    mocks.resolveDirectoryUpstream.mockResolvedValue({
      workspaceId: "ws-123",
      sandboxId: "sb-456",
      sandboxUrl: "http://sandbox-vm:4096",
      directory: "/home/daytona/workspace",
    });

    const res = await request("/foo");
    
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("cloud-response");
    
    expect(mocks.resolveDirectoryUpstream).toHaveBeenCalledWith("/home/daytona/workspace");
    expect(mocks.fetchFollow).toHaveBeenCalled();
    const [url] = mocks.fetchFollow.mock.calls[0];
    expect(url).toBe("http://sandbox-vm:4096/foo");
  });

  it("falls through (404) if directory does NOT resolve (Fail Fast)", async () => {
    // This confirms we removed the `tryForward` fallback
    mocks.resolveDirectoryUpstream.mockResolvedValue(null);

    const res = await request("/foo");
    expect(res.status).toBe(404); // Next -> 404
    expect(mocks.fetchFollow).not.toHaveBeenCalled();
  });

  it("denies access if workspace belongs to different org", async () => {
     mocks.resolveDirectoryUpstream.mockResolvedValue({
      workspaceId: "ws-123",
      sandboxId: "sb-456",
      sandboxUrl: "http://sandbox-vm:4096",
      directory: "/home/daytona/workspace",
    });
    // Identity is org-123 (default mock)
    // Workspace belongs to org-999
    mocks.resolveOrganizationIdForWorkspace.mockResolvedValue("org-999");

    const res = await request("/foo");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Forbidden");
    expect(mocks.fetchFollow).not.toHaveBeenCalled();
  });
});
