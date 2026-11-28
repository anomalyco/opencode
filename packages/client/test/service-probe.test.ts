import { expect, test } from "bun:test"
import { probeResult } from "../src/service-probe"

test("probes keep a path prefix on the service URL", async () => {
  const version = "9.9.9"
  const paths: string[] = []
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      paths.push(url.pathname)
      if (url.pathname.endsWith("/api/info")) return Response.json({ version, pid: process.pid })
      return new Response("Not found", { status: 404 })
    },
  })

  for (const suffix of ["", "/proxy", "/proxy/"]) {
    const result = await probeResult({ url: server.url.origin + suffix, pid: process.pid, version })
    expect(result.service?.compatible).toBe(true)
  }

  expect(paths).toEqual(["/api/info", "/proxy/api/info", "/proxy/api/info"])
})
