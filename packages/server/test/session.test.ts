import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

it.live("resolves configured agent models after plugin initialization", () =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir("opencode-session-endpoint-")),
    (tmp) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(tmp.path, "opencode.json"),
            JSON.stringify({
              agents: {
                modelprobe: {
                  description: "Model resolution probe",
                  mode: "primary",
                  model: "opencode/nemotron-3.5-lightning-free",
                },
                plain: { description: "No configured model", mode: "primary" },
              },
            }),
          ),
        )
        const server = yield* ServerProcess.start<never, never>({
          hostname: "127.0.0.1",
          port: 0,
          password: "secret",
          app: { version: "test-version" },
          database: { path: ":memory:" },
          config: { directory: tmp.path },
          fs: { filewatcher: false },
        })
        const base = HttpServer.formatAddress(server.address)
        const created = yield* request(base, "/api/session", {
          agent: "modelprobe",
          location: { directory: tmp.path },
        })
        if (!isRecord(created) || !isRecord(created["data"])) throw new Error("Expected a created session")
        expect(created["data"]["model"]).toBeUndefined()
        const sessionID = created["data"]["id"]
        if (typeof sessionID !== "string") throw new Error("Expected a Session ID")

        expect(
          yield* request(base, `/api/session/${sessionID}/selection`, {
            agent: "modelprobe",
            model: { type: "configured" },
          }),
        ).toBeUndefined()
        const configured = yield* get(base, `/api/session/${sessionID}`)
        if (!isRecord(configured) || !isRecord(configured["data"])) throw new Error("Expected a Session")
        expect(configured["data"]).toMatchObject({
          agent: "modelprobe",
          model: {
            providerID: "opencode",
            id: "nemotron-3.5-lightning-free",
            variant: "default",
          },
        })

        expect(
          yield* request(base, `/api/session/${sessionID}/selection`, {
            agent: "plain",
            model: { type: "configured" },
          }),
        ).toBeUndefined()
        const preserved = yield* get(base, `/api/session/${sessionID}`)
        if (!isRecord(preserved) || !isRecord(preserved["data"])) throw new Error("Expected a Session")
        expect(preserved["data"]).toMatchObject({ agent: "plain", model: configured["data"]["model"] })

        expect(
          yield* request(base, `/api/session/${sessionID}/selection`, {
            agent: "missing",
            model: { type: "configured" },
          }),
        ).toBeUndefined()
        const missing = yield* get(base, `/api/session/${sessionID}`)
        if (!isRecord(missing) || !isRecord(missing["data"])) throw new Error("Expected a Session")
        expect(missing["data"]).toMatchObject({ agent: "missing", model: configured["data"]["model"] })
      }),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ),
)

function request(base: string, pathname: string, body: unknown) {
  return Effect.promise(() =>
    fetch(new URL(pathname, base), {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa("opencode:secret")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }).then(async (response) => {
      expect(response.status).toBe(pathname === "/api/session" ? 200 : 204)
      return response.status === 204 ? undefined : response.json()
    }),
  )
}

function get(base: string, pathname: string) {
  return Effect.promise(() =>
    fetch(new URL(pathname, base), {
      headers: { authorization: `Basic ${btoa("opencode:secret")}` },
    }).then((response) => {
      expect(response.status).toBe(200)
      return response.json()
    }),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
