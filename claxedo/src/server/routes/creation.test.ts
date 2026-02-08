import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

// 1. Setup Mocks
const orchestratorMock = {
    createSandbox: mock(() => Promise.resolve({ workspaceId: "ws-new", url: "http://sandbox" }))
};

const convexMock = {
    // Return an object that satisfies both workspace and project shapes
    query: mock(() => Promise.resolve({ 
        _id: "ws-1", 
        directory: "/ws", 
        projectId: "proj-1",
        organizationId: "org-1" // Added for project check
    })),
    mutation: mock(() => Promise.resolve())
};

const mocks = {
  getOrchestrator: mock(() => orchestratorMock),
  getConvex: mock(() => convexMock),
  getIdentity: mock(() => ({ organizationId: "org-1", userId: "user-1" })),
  Config: {
    gatewayBaseUrl: "http://gateway",
    AUTH_ENABLED: true
  }
};

// Mock modules
mock.module("../../orchestrator/index.ts", () => ({ getOrchestrator: mocks.getOrchestrator }));
mock.module("../../clients/index.ts", () => ({ getConvex: mocks.getConvex }));
mock.module("../middleware/auth.ts", () => ({ getIdentity: mocks.getIdentity }));
mock.module("../../config/index.ts", () => ({ Config: mocks.Config }));
mock.module("../lib/logging.ts", () => ({
  logJson: (type: string, data: any) => console.log(`[LOG:${type}]`, data),
  nowMs: () => Date.now(),
}));
mock.module("../events/upstream.ts", () => ({
  touchDirectory: () => {},
}));
mock.module("../lib/lazy.ts", () => ({ lazy: (fn: any) => fn }));

import { WorkspaceCreateHandler, WorkspaceResolveHandler } from "./workspace.ts";

describe("Workspace Logic", () => {
    
    describe("Create Handler", () => {
        it("calls Orchestrator and returns workspace info", async () => {
            const ctx = {
                req: { json: () => Promise.resolve({ projectName: "New Proj" }) },
                json: (data: any, status = 200) => ({ status, data })
            };
            
            // @ts-ignore
            const res = await WorkspaceCreateHandler()(ctx);
            const body = res.data;
            
            if (body?.error) {
                console.error("Handler returned error:", body.error);
            }
            if (!mocks.getOrchestrator().createSandbox.mock.calls.length) {
                console.error("Orchestrator not called.");
            }

            expect(body.workspaceId).toBe("ws-new");
            expect(body.workspaceBaseUrl).toBe("http://gateway/w/ws-new");
            expect(orchestratorMock.createSandbox).toHaveBeenCalled();
        });
    });

    describe("Resolve Handler", () => {
        it("resolves directory to workspace via Convex", async () => {
             const ctx = {
                req: { query: () => "/ws" },
                json: (data: any) => ({ status: 200, data })
            };

            const res = await WorkspaceResolveHandler()(ctx as any, () => Promise.resolve());
            const body = res.data;

            expect(body.workspaceId).toBe("ws-1");
            expect(body.directory).toBe("/ws");
        });
    });
});
