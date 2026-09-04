import { describe, expect, test } from "bun:test"
import { buildAddInput, emptyForm, formFromConfig, type McpFormState } from "./mcp-payload"

describe("emptyForm", () => {
  test("defaults to a disabled-oauth local server, enabled", () => {
    const form = emptyForm("github")
    expect(form).toEqual({
      name: "github",
      kind: "local",
      command: [],
      cwd: "",
      environment: [],
      url: "",
      headers: [],
      oauthEnabled: false,
      oauthDisableAutodetect: false,
      clientId: "",
      clientSecret: "",
      clientSecretPlaceholder: undefined,
      scope: "",
      callbackPort: "",
      enabled: true,
      timeout: "",
    } satisfies McpFormState)
  })

  test("name is empty when not provided", () => {
    expect(emptyForm().name).toBe("")
  })
})

describe("formFromConfig", () => {
  test("round-trips a local config", () => {
    const config = {
      type: "local" as const,
      command: ["npx", "-y", "server"],
      cwd: "/tmp/work",
      environment: { DEBUG: "1", KEY: "value" },
      disabled: true,
      timeout: { startup: 5000, catalog: 3000, execution: 3000 },
    }
    const form = formFromConfig("srv", config)
    expect(form.name).toBe("srv")
    expect(form.kind).toBe("local")
    expect(form.command).toEqual(["npx", "-y", "server"])
    expect(form.cwd).toBe("/tmp/work")
    expect(form.environment).toEqual([
      { key: "DEBUG", value: "1" },
      { key: "KEY", value: "value" },
    ])
    expect(form.enabled).toBe(false)
    expect(form.timeout).toBe("3000")
    expect(form.oauthEnabled).toBe(false)
  })

  test("local config without timeout or disabled leaves those blank/enabled", () => {
    const form = formFromConfig("srv", { type: "local", command: ["npx"] })
    expect(form.timeout).toBe("")
    expect(form.enabled).toBe(true)
    expect(form.environment).toEqual([])
  })

  test("remote config without oauth keeps oauth disabled and no sentinel", () => {
    const form = formFromConfig("srv", { type: "remote", url: "https://example.com/mcp" })
    expect(form.kind).toBe("remote")
    expect(form.url).toBe("https://example.com/mcp")
    expect(form.oauthEnabled).toBe(false)
    expect(form.clientSecret).toBe("")
    expect(form.clientSecretPlaceholder).toBeUndefined()
  })

  test("remote config with oauth round-trips fields and blanks the secret", () => {
    const config = {
      type: "remote" as const,
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer x" },
      oauth: { client_id: "abc", client_secret: "shhh", scope: "read", callback_port: 8123 },
      disabled: false,
    }
    const form = formFromConfig("srv", config)
    expect(form.oauthEnabled).toBe(true)
    expect(form.clientId).toBe("abc")
    expect(form.clientSecret).toBe("")
    expect(form.clientSecretPlaceholder).toBe("configured")
    expect(form.scope).toBe("read")
    expect(form.callbackPort).toBe("8123")
    expect(form.headers).toEqual([{ key: "Authorization", value: "Bearer x" }])
    expect(form.enabled).toBe(true)
    expect(form.oauthDisableAutodetect).toBe(false)
  })

  test("oauth: false sets the disable-autodetect flag", () => {
    const form = formFromConfig("srv", { type: "remote", url: "https://example.com/mcp", oauth: false })
    expect(form.oauthEnabled).toBe(true)
    expect(form.oauthDisableAutodetect).toBe(true)
  })
})

describe("buildAddInput", () => {
  test("local minimal", () => {
    const form: McpFormState = { ...emptyForm("local-one"), command: ["node", "server.js"] }
    const result = buildAddInput(form)
    expect(result).toEqual({
      ok: true,
      input: { server: "local-one", config: { type: "local", command: ["node", "server.js"] } },
    })
  })

  test("local full: env rows, cwd, disabled, timeout coerced", () => {
    const form: McpFormState = {
      ...emptyForm("local-two"),
      command: ["npx", "srv"],
      cwd: "/tmp",
      environment: [
        { key: "A", value: "1" },
        { key: "B", value: "2" },
      ],
      enabled: false,
      timeout: "2500",
    }
    const result = buildAddInput(form)
    expect(result).toEqual({
      ok: true,
      input: {
        server: "local-two",
        config: {
          type: "local",
          command: ["npx", "srv"],
          cwd: "/tmp",
          environment: { A: "1", B: "2" },
          disabled: true,
          timeout: { startup: 2500, catalog: 2500, execution: 2500 },
        },
      },
    })
  })

  test("remote with headers and oauth", () => {
    const form: McpFormState = {
      ...emptyForm("remote-one"),
      kind: "remote",
      url: "https://mcp.example.com",
      headers: [{ key: "Authorization", value: "Bearer tok" }],
      oauthEnabled: true,
      clientId: "cid",
      clientSecret: "sec",
      scope: "openid",
      callbackPort: "19876",
    }
    const result = buildAddInput(form)
    expect(result).toEqual({
      ok: true,
      input: {
        server: "remote-one",
        config: {
          type: "remote",
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer tok" },
          oauth: { client_id: "cid", client_secret: "sec", scope: "openid", callback_port: 19876 },
        },
      },
    })
  })

  test("oauthDisableAutodetect maps to oauth: false", () => {
    const form: McpFormState = {
      ...emptyForm("remote-two"),
      kind: "remote",
      url: "https://mcp.example.com",
      oauthEnabled: true,
      oauthDisableAutodetect: true,
    }
    expect(buildAddInput(form)).toEqual({
      ok: true,
      input: { server: "remote-two", config: { type: "remote", url: "https://mcp.example.com", oauth: false } },
    })
  })

  test("keepSecret with blank secret omits client_secret but keeps other oauth fields", () => {
    const form: McpFormState = {
      ...emptyForm("remote-three"),
      kind: "remote",
      url: "https://mcp.example.com",
      oauthEnabled: true,
      clientId: "cid",
      clientSecret: "",
      clientSecretPlaceholder: "configured",
      scope: "openid",
    }
    const result = buildAddInput(form, { keepSecret: true })
    expect(result).toEqual({
      ok: true,
      input: {
        server: "remote-three",
        config: {
          type: "remote",
          url: "https://mcp.example.com",
          oauth: { client_id: "cid", scope: "openid" },
        },
      },
    })
  })

  test("blank secret without keepSecret omits the whole client_secret field too", () => {
    const form: McpFormState = {
      ...emptyForm("remote-four"),
      kind: "remote",
      url: "https://mcp.example.com",
      oauthEnabled: true,
      clientId: "cid",
      clientSecret: "",
    }
    expect(buildAddInput(form)).toEqual({
      ok: true,
      input: {
        server: "remote-four",
        config: { type: "remote", url: "https://mcp.example.com", oauth: { client_id: "cid" } },
      },
    })
  })

  test("timeout and callbackPort blank are omitted", () => {
    const form: McpFormState = {
      ...emptyForm("remote-five"),
      kind: "remote",
      url: "https://mcp.example.com",
      oauthEnabled: true,
    }
    expect(buildAddInput(form)).toEqual({
      ok: true,
      input: {
        server: "remote-five",
        config: { type: "remote", url: "https://mcp.example.com", oauth: {} },
      },
    })
  })

  test("timeout and callbackPort numbers are coerced", () => {
    const form: McpFormState = {
      ...emptyForm("local-three"),
      command: ["node", "x"],
      timeout: "7000",
    }
    expect(buildAddInput(form)).toEqual({
      ok: true,
      input: {
        server: "local-three",
        config: {
          type: "local",
          command: ["node", "x"],
          timeout: { startup: 7000, catalog: 7000, execution: 7000 },
        },
      },
    })
  })

  test("empty-key env/header rows are dropped; empty-value rows are kept", () => {
    const localForm: McpFormState = {
      ...emptyForm("local-four"),
      command: ["node", "x"],
      environment: [
        { key: "", value: "orphan" },
        { key: "REAL", value: "v" },
        { key: "NOVAL", value: "" },
      ],
    }
    const local = buildAddInput(localForm)
    expect(local).toEqual({
      ok: true,
      input: {
        server: "local-four",
        config: { type: "local", command: ["node", "x"], environment: { REAL: "v", NOVAL: "" } },
      },
    })

    const remoteForm: McpFormState = {
      ...emptyForm("remote-six"),
      kind: "remote",
      url: "https://mcp.example.com",
      headers: [
        { key: "", value: "x" },
        { key: "REAL", value: "v" },
      ],
    }
    expect(buildAddInput(remoteForm)).toEqual({
      ok: true,
      input: {
        server: "remote-six",
        config: { type: "remote", url: "https://mcp.example.com", headers: { REAL: "v" } },
      },
    })
  })

  test("all-empty env/header rows produce no environment/headers keys", () => {
    const form: McpFormState = {
      ...emptyForm("local-five"),
      command: ["node", "x"],
      environment: [{ key: "", value: "" }],
      headers: [{ key: "", value: "" }],
    }
    const result = buildAddInput(form)
    expect(result).toEqual({
      ok: true,
      input: { server: "local-five", config: { type: "local", command: ["node", "x"] } },
    })
  })

  test("local command whitespace is trimmed and empty array rejected", () => {
    const form: McpFormState = { ...emptyForm("local-six"), command: ["  node  ", "server"] }
    expect(buildAddInput(form)).toEqual({
      ok: true,
      input: { server: "local-six", config: { type: "local", command: ["node", "server"] } },
    })
    expect(buildAddInput({ ...emptyForm("local-six"), command: ["   "] }).ok).toBe(false)
  })

  test("validation: empty name", () => {
    expect(buildAddInput({ ...emptyForm(""), command: ["node"] })).toEqual({ ok: false, error: "name" })
  })

  test("validation: name whitespace-only", () => {
    expect(buildAddInput({ ...emptyForm("   "), command: ["node"] }).ok).toBe(false)
  })

  test("validation: local without command", () => {
    const form = emptyForm("x")
    expect(buildAddInput(form)).toEqual({ ok: false, error: "command" })
  })

  test("validation: remote without url", () => {
    const form: McpFormState = { ...emptyForm("x"), kind: "remote" }
    expect(buildAddInput(form)).toEqual({ ok: false, error: "url" })
  })

  test("validation: non-numeric callbackPort", () => {
    const form: McpFormState = {
      ...emptyForm("x"),
      kind: "remote",
      url: "https://mcp.example.com",
      oauthEnabled: true,
      callbackPort: "abc",
    }
    expect(buildAddInput(form)).toEqual({ ok: false, error: "callbackPort" })
  })

  test("validation: non-numeric timeout", () => {
    const form: McpFormState = { ...emptyForm("x"), command: ["node"], timeout: "fast" }
    expect(buildAddInput(form)).toEqual({ ok: false, error: "timeout" })
  })

  test("validation: negative timeout", () => {
    const form: McpFormState = { ...emptyForm("x"), command: ["node"], timeout: "-5" }
    expect(buildAddInput(form).ok).toBe(false)
  })

  test("validation: callbackPort out of 1..65535 range", () => {
    const form: McpFormState = {
      ...emptyForm("x"),
      kind: "remote",
      url: "https://mcp.example.com",
      oauthEnabled: true,
      callbackPort: "70000",
    }
    expect(buildAddInput(form).ok).toBe(false)
  })
})