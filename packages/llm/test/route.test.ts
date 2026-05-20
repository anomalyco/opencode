import { describe, expect, test } from "bun:test"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { Auth } from "../src/route"

describe("Route.with", () => {
  test("merges endpoint query and header defaults while replacing auth and id", () => {
    const auth = Auth.headers({ "x-auth": "new" })
    const route = OpenAIChat.route
      .with({
        id: "base-chat",
        endpoint: {
          baseURL: "https://api.example.test/v1",
          query: { keep: "base", base: "1" },
        },
        headers: { "x-base": "base", "x-override": "base" },
        auth: Auth.headers({ "x-auth": "old" }),
      })
      .with({
        id: "patched-chat",
        endpoint: { query: { keep: "patch", patch: "1" } },
        headers: { "x-override": "patch", "x-patch": "patch" },
        auth,
      })

    expect(route.id).toBe("patched-chat")
    expect(route.auth).toBe(auth)
    expect(route.endpoint).toMatchObject({
      baseURL: "https://api.example.test/v1",
      path: "/chat/completions",
      query: { keep: "patch", base: "1", patch: "1" },
    })
    expect(route.defaults.headers).toEqual({
      "x-base": "base",
      "x-override": "patch",
      "x-patch": "patch",
    })
    expect(route.defaults.http?.headers).toEqual({
      "x-base": "base",
      "x-override": "patch",
      "x-patch": "patch",
    })
  })
})
