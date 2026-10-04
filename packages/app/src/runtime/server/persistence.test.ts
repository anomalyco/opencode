import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ModelState, serverState } from "./persistence"
import { Persistence } from "@/runtime/persistence/schema"

const initial = { list: [], hidden: {}, projects: {}, lastProject: {}, recentlyClosed: {} }

function serverSchema(canonical?: () => string | undefined) {
  return Persistence.withInitial(serverState(canonical), initial)
}

describe("server persistence schema", () => {
  test("migrates legacy auth and writes only current server objects", () => {
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
      projects: input.projects,
      lastProject: {},
      recentlyClosed: {},
    })
    expect(input.list[1]).toHaveProperty("username", "legacy")
    const encoded = Schema.encodeSync(schema)(state)
    expect(encoded).toEqual(state)
    expect(Schema.decodeUnknownSync(schema)(encoded)).toEqual(state)
  })

  test("defaults missing or malformed fields and drops invalid entries independently", () => {
    const decode = Schema.decodeUnknownSync(serverSchema())
    const empty = { list: [], hidden: {}, projects: {}, lastProject: {}, recentlyClosed: {} }
    expect(decode({})).toEqual(empty)
    expect(decode({ list: null, hidden: [], projects: false, lastProject: 1, recentlyClosed: "bad" })).toEqual(empty)
    expect(
      decode({
        list: [null, 1, {}, { type: "http", http: { url: 12 } }, "https://valid.example"],
        projects: { local: [null, {}, { worktree: 1 }, { worktree: "/project" }], remote: false },
        recentlyClosed: { local: [null, 1, "/closed"], remote: null },
      }),
    ).toEqual({
      ...empty,
      list: [{ type: "http", http: { url: "https://valid.example" } }],
      projects: { local: [{ worktree: "/project", expanded: true }], remote: [] },
      recentlyClosed: { local: ["/closed"], remote: [] },
    })
  })

  test("moves canonical project buckets without changing server keys or unrelated scopes", () => {
    const schema = serverSchema(() => "https://opencode.example.com")
    const state = Schema.decodeUnknownSync(schema)({
      list: ["https://opencode.example.com"],
      hidden: { "https://opencode.example.com": true },
      projects: {
        local: [{ worktree: "/local", expanded: false }],
        "https://opencode.example.com": [
          { worktree: "/local", expanded: true },
          { worktree: "/remote", expanded: true },
          { worktree: "/remote", expanded: false },
        ],
        other: [{ worktree: "/other", expanded: true }],
      },
      lastProject: { local: "/local", "https://opencode.example.com": "/remote", other: "/other" },
      recentlyClosed: { local: ["/closed"], "https://opencode.example.com": ["/old-closed"] },
    })
    expect(state.projects).toEqual({
      local: [
        { worktree: "/local", expanded: false },
        { worktree: "/remote", expanded: true },
      ],
      other: [{ worktree: "/other", expanded: true }],
    })
    expect(state.lastProject).toEqual({ local: "/local", other: "/other" })
    expect(state.list[0]?.http.url).toBe("https://opencode.example.com")
    expect(state.hidden).toEqual({ "https://opencode.example.com": true })
    expect(state.recentlyClosed).toEqual({ local: ["/closed"], "https://opencode.example.com": ["/old-closed"] })
    expect(Schema.encodeSync(schema)(state)).toEqual(state)
    expect(Schema.decodeUnknownSync(schema)(state)).toEqual(state)
  })

  test("reads the latest canonical local prop on each decode", () => {
    const props: { canonicalLocalServer?: string } = {}
    const schema = serverSchema(() => props.canonicalLocalServer)
    const decode = Schema.decodeUnknownSync(schema)
    const input = {
      projects: { remote: [{ worktree: "/project", expanded: true }] },
      lastProject: { remote: "/project" },
    }
    expect(decode(input).projects).toEqual(input.projects)
    props.canonicalLocalServer = "remote"
    expect(decode(input).projects).toEqual({ local: [{ worktree: "/project", expanded: true }] })
    expect(decode(input).lastProject).toEqual({ local: "/project" })
    props.canonicalLocalServer = "local"
    expect(decode(input).projects).toEqual(input.projects)
    expect(input.lastProject).toEqual({ remote: "/project" })
    props.canonicalLocalServer = "remote"
    expect(decode({ lastProject: { remote: "/project" } })).toEqual({ ...initial, lastProject: { local: "/project" } })
  })
})

describe("model persistence schema", () => {
  test("defaults missing state and keeps valid entries beside malformed entries", () => {
    const decode = Schema.decodeUnknownSync(Persistence.withInitial(ModelState, { user: [], recent: [], variant: {} }))
    expect(decode({})).toEqual({ user: [], recent: [], variant: {} })
    expect(decode({ user: null, recent: 1, variant: [] })).toEqual({ user: [], recent: [], variant: {} })
    const state = decode({
      user: [
        null,
        { providerID: "provider", modelID: "model", visibility: "show", favorite: true },
        { providerID: "provider", modelID: "invalid", visibility: "invalid" },
        { providerID: "provider", modelID: "hidden", visibility: "hide" },
      ],
      recent: [false, { providerID: "provider", modelID: "model" }, { providerID: "missing-model" }],
      variant: { model: "high" },
    })
    expect(state).toEqual({
      user: [
        {
          providerID: Provider.ID.make("provider", { disableChecks: true }),
          modelID: Model.ID.make("model", { disableChecks: true }),
          visibility: "show",
          favorite: true,
        },
        {
          providerID: Provider.ID.make("provider", { disableChecks: true }),
          modelID: Model.ID.make("hidden", { disableChecks: true }),
          visibility: "hide",
        },
      ],
      recent: [
        {
          providerID: Provider.ID.make("provider", { disableChecks: true }),
          modelID: Model.ID.make("model", { disableChecks: true }),
        },
      ],
      variant: { model: Model.VariantID.make("high", { disableChecks: true }) },
    })
    expect(Schema.encodeSync(ModelState)(state)).toEqual(state)
  })
})
