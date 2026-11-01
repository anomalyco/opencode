import { expect, test } from "bun:test"
import { Effect, Option } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import list from "../src/commands/handlers/session/list"
import { OPENCODE_VERSION } from "../src/version"

for (const project of ["global", "project"]) {
  test(`session list scopes ${project} sessions`, async () => {
    const queries: URLSearchParams[] = []
    const directory = "/resolved/repo-a"
    const sessions = [directory, "/resolved/repo-b"].map((directory, index) => ({
      id: `ses_${index}`,
      projectID: project,
      title: `session ${index}`,
      location: { directory },
      time: { created: 1, updated: 1 },
    }))
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/api/info") return Response.json({ version: OPENCODE_VERSION })
        if (url.pathname === "/api/location")
          return Response.json({ directory, project: { id: project, directory, canonical: directory } })
        if (url.pathname === "/api/session") {
          queries.push(url.searchParams)
          return Response.json({
            data: sessions.filter(
              (session) =>
                !url.searchParams.has("directory") || session.location.directory === url.searchParams.get("directory"),
            ),
            cursor: {},
          })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    try {
      await Effect.runPromise(
        list({
          server: Option.some(server.url.toString()),
          standalone: false,
          format: "json",
          maxCount: Option.some(2),
        }).pipe(
          Effect.provideService(Global.Service, Global.make()),
          Effect.provide(NodeFileSystem.layer),
          Effect.scoped,
        ),
      )
      expect(queries).toHaveLength(1)
      expect(queries[0].get("directory")).toBe(project === "global" ? directory : null)
      expect(queries[0].get("project")).toBe(project === "global" ? null : project)
      expect(queries[0].get("limit")).toBe("2")
      expect(queries[0].get("order")).toBe("desc")
    } finally {
      await server.stop(true)
    }
  })
}
