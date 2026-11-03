import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ModelState, ServerState } from "./persistence"
import { Persistence } from "@/runtime/persistence/schema"

const initial = { list: [], hidden: {}, lastProjectID: {}, usedProjectIDs: {}, hostnames: {}, projects: {} }

function serverSchema() {
  return Persistence.withInitial(ServerState, initial)
}

describe("server persistence schema", () => {
  test("migrates legacy auth, keeps the old project directories for migration and writes only current server objects", () => {
    const schema = serverSchema()

    const input = {
      list: [
        "http://localhost:4096",
        { url: "https://flat.example", username: "legacy", password: "first" },
        {
          type: "http",
          displayName: "Remote",
          label: "Production",
          authToken: true,
          http: { url: "https://nested.example", username: "legacy", password: "second" },
        },
      ],
      projects: { local: [{ worktree: "/project", expanded: true }] },
      recentlyClosed: { local: ["/closed"] },
      lastProject: { local: "/project" },
      lastProjectID: { local: "project" },
    }

    const state = Schema.decodeUnknownSync(schema)(input)
    expect(state).toEqual({
      list: [
        { type: "http", http: { url: "http://localhost:4096" } },
        { type: "http", http: { url: "https://flat.example", password: "first" } },
        {
          type: "http",
          displayName: "Remote",
          label: "Production",
          authToken: true,
          http: { url: "https://nested.example", password: "second" },
        },
      ],
      hidden: {},
      lastProjectID: { local: "project" },
      usedProjectIDs: {},
      hostnames: {},
      projects: { local: [{ worktree: "/project" }] },
    })
    expect(input.list[1]).toHaveProperty("username", "legacy")
    const encoded = Schema.encodeSync(schema)(state)
    expect(encoded).toEqual(state)
    expect(Schema.decodeUnknownSync(schema)(encoded)).toEqual(state)
  })

  test("defaults missing or malformed fields and drops invalid entries independently", () => {
    const decode = Schema.decodeUnknownSync(serverSchema())
    expect(decode({})).toEqual(initial)
    expect(decode({ list: null, hidden: [], lastProjectID: 1, usedProjectIDs: [], projects: "bad" })).toEqual(initial)
    expect(
      decode({
        list: [null, 1, {}, { type: "http", http: { url: 12 } }, "https://valid.example"],
        lastProjectID: { local: "project", remote: 1 },
        usedProjectIDs: { local: ["project", 1, null], remote: "bad" },
        projects: { local: [null, {}, { worktree: 1 }, { worktree: "/project", expanded: true }], remote: false },
      }),
    ).toEqual({
      ...initial,
      list: [{ type: "http", http: { url: "https://valid.example" } }],
      lastProjectID: { local: "project" },
      usedProjectIDs: { local: ["project"], remote: [] },
      projects: { local: [{ worktree: "/project" }], remote: [] },
    })
  })
})

describe("model persistence schema", () => {
  test("defaults missing state and keeps valid entries beside malformed entries", () => {
    const decode = Schema.decodeUnknownSync(
      Persistence.withInitial(ModelState, { user: [], recent: [], favorite: [], variant: {} }),
    )

    expect(decode({})).toEqual({ user: [], recent: [], favorite: [], variant: {} })
    expect(decode({ user: null, recent: 1, favorite: "x", variant: [] })).toEqual({
      user: [],
      recent: [],
      favorite: [],
      variant: {},
    })

    const state = decode({
      user: [
        null,
        { providerID: "provider", modelID: "model", visibility: "show", favorite: true },
        { providerID: "provider", modelID: "invalid", visibility: "invalid" },
        { providerID: "provider", modelID: "hidden", visibility: "hide" },
      ],
      recent: [false, { providerID: "provider", modelID: "model" }, { providerID: "missing-model" }],
      favorite: [{ providerID: "provider", modelID: "model" }, { modelID: "missing-provider" }],
      variant: { model: "high" },
    })

    expect(state).toEqual({
      user: [
        { providerID: "provider", modelID: "model", visibility: "show", favorite: true },
        { providerID: "provider", modelID: "hidden", visibility: "hide" },
      ],
      recent: [{ providerID: "provider", modelID: "model" }],
      favorite: [{ providerID: "provider", modelID: "model" }],
      variant: { model: "high" },
    })
    expect(Schema.encodeSync(ModelState)(state)).toEqual(state)
  })
})
