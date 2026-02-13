
import { describe, it, expect } from "bun:test";
import { proxyRequest } from "./forward.ts";

// Minimal mock for Hono Context
const mockContext = (url: string) => ({
  req: {
    url,
    method: "GET",
    raw: {
      headers: new Headers(),
      signal: new AbortController().signal,
      arrayBuffer: async () => new ArrayBuffer(0)
    },
    header: () => undefined
  }
} as any);

// We need to mock fetchFollow to capture the URL it receives
import { mock } from "bun:test";
const fetchFollowMock = mock(() => Promise.resolve(new Response("ok")));
mock.module("./fetch.ts", () => ({ fetchFollow: fetchFollowMock }));

describe("forward.ts URL Construction", () => {
  it("Preserves query parameters", async () => {
    const incomingUrl = "http://localhost:3000/find/file?directory=%2FUsers%2Ftest&query=op&type=directory&limit=50";
    const c = mockContext(incomingUrl);
    
    await proxyRequest(c, {
      upstreamBase: "http://127.0.0.1:4096",
    });

    expect(fetchFollowMock).toHaveBeenCalled();
    const [url] = fetchFollowMock.mock.calls[0];
    
    // Check that the query string is intact and correctly appended
    expect(url).toBe("http://127.0.0.1:4096/find/file?directory=%2FUsers%2Ftest&query=op&type=directory&limit=50");
  });
});
