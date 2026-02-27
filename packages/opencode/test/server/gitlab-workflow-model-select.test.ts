import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { GitLabWorkflowModelSelect } from "../../src/session/gitlab-workflow-model-select"
import { Bus } from "../../src/bus"
import { tmpdir } from "../fixture/fixture"
import { Env } from "../../src/env"

describe("gitlab-workflow-model-select routes", () => {
  describe("GET /gitlab-workflow-model-select", () => {
    test("returns empty array when no pending requests", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const app = Server.App()
          const res = await app.request("/gitlab-workflow-model-select", {
            headers: { "x-opencode-directory": tmp.path },
          })
          expect(res.status).toBe(200)
          expect(await res.json()).toEqual([])
        },
      })
    })
  })

  describe("POST /gitlab-workflow-model-select/clear", () => {
    test("returns true on success", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.set("GITLAB_INSTANCE_URL", "https://gitlab.example.com")
        },
        fn: async () => {
          await GitLabWorkflowModelSelect.setLastSelection("cached-ref", "Cached")

          const app = Server.App()
          const res = await app.request("/gitlab-workflow-model-select/clear", {
            method: "POST",
            headers: { "x-opencode-directory": tmp.path },
          })
          expect(res.status).toBe(200)
          expect(await res.json()).toBe(true)

          expect(await GitLabWorkflowModelSelect.getLastSelection()).toBeNull()
        },
      })
    })
  })

  describe("POST /gitlab-workflow-model-select/discover", () => {
    test("returns no_provider when gitlab provider is unavailable", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({ $schema: "https://opencode.ai/config.json" }),
          )
        },
      })
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.set("GITLAB_TOKEN", "")
        },
        fn: async () => {
          const app = Server.App()
          const res = await app.request("/gitlab-workflow-model-select/discover", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-opencode-directory": tmp.path },
            body: JSON.stringify({}),
          })
          expect(res.status).toBe(200)
          const body = (await res.json()) as { status: string; modelRef: string | null }
          expect(["no_provider", "default"]).toContain(body.status)
        },
      })
    })
  })

  describe("POST /gitlab-workflow-model-select/:requestID/reply", () => {
    test("replies to a pending request via HTTP", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const models = [
            { name: "Model X", ref: "ref-x", isDefault: true },
            { name: "Model Y", ref: "ref-y" },
          ]

          let requestID: string | undefined
          const unsub = Bus.subscribe(GitLabWorkflowModelSelect.Event.Asked, (e) => {
            requestID = e.properties.id
          })

          const promise = GitLabWorkflowModelSelect.ask({ sessionID: "s1", models })
          await new Promise((r) => setTimeout(r, 100))
          expect(requestID).toBeDefined()

          const app = Server.App()
          const res = await app.request(`/gitlab-workflow-model-select/${requestID}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-opencode-directory": tmp.path },
            body: JSON.stringify({ modelRef: "ref-y", modelName: "Model Y" }),
          })
          expect(res.status).toBe(200)
          expect(await res.json()).toBe(true)

          const selected = await promise
          expect(selected).toBe("ref-y")
          unsub()
        },
      })
    })

    test("reply with null modelRef resolves to null", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const models = [{ name: "M", ref: "r" }]

          let requestID: string | undefined
          const unsub = Bus.subscribe(GitLabWorkflowModelSelect.Event.Asked, (e) => {
            requestID = e.properties.id
          })

          const promise = GitLabWorkflowModelSelect.ask({ sessionID: "s2", models })
          await new Promise((r) => setTimeout(r, 100))
          expect(requestID).toBeDefined()

          const app = Server.App()
          const res = await app.request(`/gitlab-workflow-model-select/${requestID}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-opencode-directory": tmp.path },
            body: JSON.stringify({ modelRef: null }),
          })
          expect(res.status).toBe(200)

          const selected = await promise
          expect(selected).toBeNull()
          unsub()
        },
      })
    })
  })
})
