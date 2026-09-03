import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { IconState, ModelState, ProjectState, VcsState, serverState } from "./persistence"
import { createRoot } from "solid-js"
import { isServer } from "solid-js/web"
import { Persist, persisted } from "@/runtime/persistence/storage"
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
  })

  test("migrates a last project without a project list", () => {
    expect(Schema.decodeUnknownSync(serverSchema(() => "remote"))({ lastProject: { remote: "/project" } })).toEqual({
      list: [],
      hidden: {},
      projects: {},
      lastProject: { local: "/project" },
      recentlyClosed: {},
    })
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
        { providerID: "provider", modelID: "model", visibility: "show", favorite: true },
        { providerID: "provider", modelID: "hidden", visibility: "hide" },
      ],
      recent: [{ providerID: "provider", modelID: "model" }],
      variant: { model: "high" },
    })
    expect(Schema.encodeSync(ModelState)(state)).toEqual(state)
  })
})

describe("directory cache schemas", () => {
  test("defaults missing and malformed VCS caches but retains optional branch metadata", () => {
    const decode = Schema.decodeUnknownSync(Persistence.withInitial(VcsState, { value: undefined }))
    expect(decode({})).toEqual({ value: undefined })
    expect(decode({ value: null })).toEqual({ value: undefined })
    expect(decode({ value: { branch: 1 } })).toEqual({ value: undefined })
    expect(decode({ value: { default_branch: "main" } })).toEqual({ value: { default_branch: "main" } })
    const state = decode({ value: { branch: "feature", default_branch: "main", obsolete: true } })
    expect(state).toEqual({ value: { branch: "feature", default_branch: "main" } })
    expect(Schema.encodeSync(VcsState)(state)).toEqual(state)
  })

  test("validates project name, icon overrides and startup commands", () => {
    const decode = Schema.decodeUnknownSync(Persistence.withInitial(ProjectState, { value: undefined }))
    expect(decode({})).toEqual({ value: undefined })
    expect(decode({ value: [] })).toEqual({ value: undefined })
    expect(decode({ value: { icon: { override: 1 } } })).toEqual({ value: undefined })
    expect(decode({ value: { commands: { start: false } } })).toEqual({ value: undefined })
    expect(decode({ value: {} })).toEqual({ value: {} })
    const state = decode({
      value: {
        name: "Project",
        icon: { override: "data:image/png;base64,abc", color: "blue" },
        commands: { start: "bun dev" },
      },
    })
    expect(Schema.encodeSync(ProjectState)(state)).toEqual(state)
    expect(state.value).toEqual({
      name: "Project",
      icon: { override: "data:image/png;base64,abc", color: "blue" },
      commands: { start: "bun dev" },
    })
  })

  test("validates optional icon strings", () => {
    const decode = Schema.decodeUnknownSync(Persistence.withInitial(IconState, { value: undefined }))
    expect(decode({})).toEqual({ value: undefined })
    expect(decode({ value: 42 })).toEqual({ value: undefined })
    expect(decode({ value: null })).toEqual({ value: undefined })
    expect(decode({ value: "" })).toEqual({ value: "" })
    expect(Schema.encodeSync(IconState)(decode({ value: "data:image/png;base64,abc" }))).toEqual({
      value: "data:image/png;base64,abc",
    })
  })
})

test.skipIf(isServer)(
  "persisted server relocation hydrates migrated state and writes current schema on updates",
  async () => {
    const values = new Map([
      [
        "default:server.v3",
        JSON.stringify({
          list: [{ url: "https://remote.example", username: "legacy", password: "secret" }],
          projects: { "https://remote.example": [{ worktree: "/project", expanded: false }] },
          lastProject: { "https://remote.example": "/project" },
        }),
      ],
    ])
    const root = createRoot((dispose) => ({
      dispose,
      state: persisted(
        { ...Persist.global("server"), previousKey: "server.v3" },
        serverState(() => "https://remote.example"),
        initial,
        {
          platform: "desktop",
          windowID: "test",
          openExternal() {},
          restart: async () => {},
          notify: async () => {},
          openDirectoryPickerDialog: async () => null,
          storage: (name = "default") => ({
            getItem: async (key) => values.get(`${name}:${key}`) ?? null,
            setItem: async (key, value) => {
              values.set(`${name}:${key}`, value)
            },
            removeItem: async (key) => {
              values.delete(`${name}:${key}`)
            },
          }),
        },
      ),
    }))
    try {
      await root.state[3].promise
      expect(values.has("default:server.v3")).toBe(false)
      expect(root.state[0].list).toEqual([
        { type: "http", http: { url: "https://remote.example", password: "secret" } },
      ])
      expect(root.state[0].projects).toEqual({ local: [{ worktree: "/project", expanded: false }] })
      expect(root.state[0].lastProject).toEqual({ local: "/project" })
      root.state[1]("projects", "local", 0, "expanded", true)
      const stored = values.get("opencode.global.dat:server")
      expect(stored).toBeDefined()
      if (!stored) throw new Error("server state was not written")
      const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(serverSchema()))(stored)
      expect(decoded.projects.local).toEqual([{ worktree: "/project", expanded: true }])
      expect(stored).not.toContain("username")
      expect(decoded.list).toEqual(root.state[0].list)
    } finally {
      root.dispose()
    }
  },
)
