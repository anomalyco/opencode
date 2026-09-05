import { describe, expect, test } from "bun:test"
import {
  sshAddPrimaryButton,
  sshConfigHostSuggestions,
  sshOpencodeAction,
  sshProbeForHost,
  sshProbeStatus,
  sshRuntimeDisconnectable,
  sshRuntimeRetryable,
  sshRuntimeStatus,
} from "./settings-model"
import type { SshHostProbe, SshServersState } from "./types"

function probe(overrides: Partial<SshHostProbe> = {}): SshHostProbe {
  return {
    host: "dev@example.com",
    reachable: true,
    opencodePath: "/home/dev/.opencode/bin/opencode",
    opencodeVersion: "1.18.13",
    expectedVersion: "1.18.13",
    matchesDesktop: true,
    error: null,
    ...overrides,
  }
}

function state(overrides: Partial<SshServersState> = {}): SshServersState {
  return {
    configHosts: [],
    hostProbes: {},
    servers: [],
    job: null,
    ...overrides,
  }
}

describe("sshAddPrimaryButton", () => {
  const base = { hostInput: "dev@example.com", probe: undefined, probing: false, installing: false, adding: false }

  test("asks to connect before any probe exists", () => {
    expect(sshAddPrimaryButton(base)).toMatchObject({ action: "probe", disabled: false, loading: false })
    expect(sshAddPrimaryButton({ ...base, hostInput: "  " })).toMatchObject({ action: "probe", disabled: true })
  })

  test("shows progress while probing, installing, or adding", () => {
    expect(sshAddPrimaryButton({ ...base, probing: true })).toMatchObject({ action: "probe", loading: true })
    expect(sshAddPrimaryButton({ ...base, installing: true })).toMatchObject({ action: "install", loading: true })
    expect(sshAddPrimaryButton({ ...base, adding: true })).toMatchObject({ action: "add", loading: true })
  })

  test("offers install or update when opencode is absent or outdated", () => {
    expect(sshAddPrimaryButton({ ...base, probe: probe({ opencodePath: null, opencodeVersion: null }) })).toMatchObject(
      { action: "install", label: { key: "ssh.add.installOpencode" } },
    )
    expect(
      sshAddPrimaryButton({ ...base, probe: probe({ opencodeVersion: "1.0.0", matchesDesktop: false }) }),
    ).toMatchObject({ action: "install", label: { key: "ssh.add.updateOpencode" } })
  })

  test("offers to add once the probe is healthy", () => {
    expect(sshAddPrimaryButton({ ...base, probe: probe() })).toMatchObject({ action: "add" })
  })

  test("falls back to connect when the probe failed", () => {
    expect(sshAddPrimaryButton({ ...base, probe: probe({ reachable: false }) })).toMatchObject({ action: "probe" })
  })
})

describe("sshProbeForHost", () => {
  test("matches trimmed input and bracketed IPv6 variants", () => {
    const probes = {
      "dev@example.com": probe(),
      "dev@[::1]": probe({ host: "dev@[::1]" }),
    }
    const data = state({ hostProbes: probes })
    expect(sshProbeForHost(data, " dev@example.com ")).toBe(probes["dev@example.com"])
    expect(sshProbeForHost(data, "dev@::1")).toBe(probes["dev@[::1]"])
    expect(sshProbeForHost(data, "other")).toBeUndefined()
    expect(sshProbeForHost(undefined, "dev@example.com")).toBeUndefined()
  })
})

describe("sshProbeStatus", () => {
  test("maps probe outcomes to toned status lines", () => {
    expect(sshProbeStatus(undefined, true)).toMatchObject({ tone: "info" })
    expect(sshProbeStatus(undefined, false)).toBeNull()
    expect(sshProbeStatus(probe({ reachable: false, error: "denied" }), false)).toMatchObject({
      tone: "error",
      detail: "denied",
    })
    expect(sshProbeStatus(probe({ opencodePath: null }), false)).toMatchObject({ tone: "warning" })
    expect(sshProbeStatus(probe({ opencodeVersion: "1.0.0", matchesDesktop: false }), false)).toMatchObject({
      tone: "warning",
      text: { key: "ssh.add.status.opencodeMismatch", params: { version: "1.0.0", expected: "1.18.13" } },
    })
    expect(sshProbeStatus(probe(), false)).toMatchObject({
      tone: "success",
      text: { key: "ssh.add.status.opencodeFound", params: { version: "1.18.13" } },
    })
  })
})

describe("sshConfigHostSuggestions", () => {
  test("filters by input and hides already-added hosts", () => {
    const data = state({
      configHosts: ["build", "staging", "prod"],
      servers: [{ config: { id: "ssh:prod", host: "prod" }, runtime: { kind: "stopped" } }],
    })
    expect(sshConfigHostSuggestions(data, "")).toEqual(["build", "staging"])
    expect(sshConfigHostSuggestions(data, "sta")).toEqual(["staging"])
    expect(sshConfigHostSuggestions(undefined, "")).toEqual([])
  })
})

describe("runtime helpers", () => {
  test("classifies retryable, disconnectable, and status text", () => {
    expect(sshRuntimeRetryable({ kind: "failed", message: "x" })).toBe(true)
    expect(sshRuntimeRetryable({ kind: "stopped" })).toBe(true)
    expect(sshRuntimeRetryable({ kind: "ready", url: "", username: null, password: null })).toBe(false)
    expect(sshRuntimeDisconnectable({ kind: "ready", url: "", username: null, password: null })).toBe(true)
    expect(sshRuntimeDisconnectable({ kind: "starting" })).toBe(true)
    expect(sshRuntimeDisconnectable({ kind: "stopped" })).toBe(false)
    expect(sshRuntimeStatus({ kind: "starting" })).toEqual({ text: { key: "ssh.server.status.connecting" } })
    expect(sshRuntimeStatus({ kind: "failed", message: "boom" })).toEqual({ text: null, message: "boom" })
  })

  test("surfaces the install action for missing or outdated opencode", () => {
    expect(sshOpencodeAction(probe({ opencodePath: null }))).toEqual({ key: "ssh.add.installOpencode" })
    expect(sshOpencodeAction(probe({ opencodeVersion: "1.0.0", matchesDesktop: false }))).toEqual({
      key: "ssh.add.updateOpencode",
    })
    expect(sshOpencodeAction(probe())).toBeNull()
    expect(sshOpencodeAction(undefined)).toBeNull()
    expect(sshOpencodeAction(undefined, { kind: "failed", message: "x", reason: "opencode-missing" })).toEqual({
      key: "ssh.add.installOpencode",
    })
  })
})
