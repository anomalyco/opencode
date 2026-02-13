import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

// 1. Setup Mocks
const mocks = {
  Config: {
    AUTH_ENABLED: true,
  },
  resolveIdentity: mock(() => Promise.resolve({ ok: true, role: "member", organizationId: "org-1", userId: "user-1" })),
  resolveOrganizationIdForWorkspace: mock(() => Promise.resolve("org-1"))
};

// Mock modules
mock.module("../../config/index.ts", () => ({ Config: mocks.Config }));
mock.module("../../services/identity.ts", () => ({ resolveIdentity: mocks.resolveIdentity }));
mock.module("../../services/sandbox-resolver.ts", () => ({ resolveOrganizationIdForWorkspace: mocks.resolveOrganizationIdForWorkspace }));
mock.module("../types/roles.ts", () => ({ hasRole: (role: string, min: string) => role === min || role === "admin" }));

import { requireAuth, requireWorkspaceAccess } from "../middleware/auth.ts";

describe("Auth Middleware", () => {
    
    beforeEach(() => {
        mocks.Config.AUTH_ENABLED = true;
        mocks.resolveIdentity.mockClear();
        mocks.resolveOrganizationIdForWorkspace.mockClear();
        // Default happy path
        mocks.resolveIdentity.mockResolvedValue({ ok: true, role: "member", organizationId: "org-1", userId: "user-1" });
    });

    describe("requireAuth", () => {
        const app = new Hono();
        app.get("/protected", requireAuth("member"), (c) => c.text("ok"));

        it("allows valid member", async () => {
            const res = await app.request(new Request("http://localhost/protected"));
            expect(res.status).toBe(200);
            expect(await res.text()).toBe("ok");
        });

        it("blocks invalid identity", async () => {
            mocks.resolveIdentity.mockResolvedValue({ ok: false, error: "Invalid token", status: 401 });
            const res = await app.request(new Request("http://localhost/protected"));
            expect(res.status).toBe(401);
        });

        it("bypasses if AUTH_ENABLED=false (Local Mode)", async () => {
            mocks.Config.AUTH_ENABLED = false;
            // Even if identity would fail, it shouldn't be called or checked rigidly
            mocks.resolveIdentity.mockResolvedValue({ ok: false }); 
            
            const res = await app.request(new Request("http://localhost/protected"));
            expect(res.status).toBe(200);
        });
    });

    describe("requireWorkspaceAccess", () => {
        const app = new Hono();
        app.get("/w/:workspaceId", requireWorkspaceAccess(), (c) => c.text("ok"));

        it("allows owner (same org)", async () => {
            mocks.resolveOrganizationIdForWorkspace.mockResolvedValue("org-1");
            const res = await app.request(new Request("http://localhost/w/ws-1"));
            expect(res.status).toBe(200);
        });

        it("blocks non-owner (diff org)", async () => {
            mocks.resolveOrganizationIdForWorkspace.mockResolvedValue("org-999");
            const res = await app.request(new Request("http://localhost/w/ws-1"));
            expect(res.status).toBe(403);
        });

        it("blocks if workspace ownership unknown", async () => {
            mocks.resolveOrganizationIdForWorkspace.mockResolvedValue(null);
            const res = await app.request(new Request("http://localhost/w/ws-1"));
            expect(res.status).toBe(403);
        });
    });
});
