import { describe, expect, test } from "bun:test"
import {
  buildSshInstallScript,
  buildSshProbeScript,
  buildSshServerScript,
  clearSshHostState,
  normalizeSshHost,
  parseSshDestination,
  parseSshProbeOutput,
  requireSshIpcString,
  sshOutputIndicatesOpencodeMissing,
  sshOutputIndicatesPortConflict,
  sshRunArgs,
  sshServerIdForHost,
  sshServerIdToRestart,
  sshTunnelArgs,
  windowsSshTerminalArgs,
  SSH_PROBE_END_MARKER,
  SSH_PROBE_PATH_PREFIX,
  SSH_PROBE_START_MARKER,
  SSH_PROBE_VERSION_PREFIX,
  SSH_SERVER_EXIT_OPENCODE_MISSING,
} from "./policy"

describe("parseSshDestination", () => {
  test("accepts plain hosts, users, and ports", () => {
    expect(parseSshDestination("example.com")).toEqual({
      destination: "example.com",
      user: null,
      host: "example.com",
      port: null,
    })
    expect(parseSshDestination("dev@example.com")).toEqual({
      destination: "dev@example.com",
      user: "dev",
      host: "example.com",
      port: null,
    })
    expect(parseSshDestination("dev@example.com:2222")).toEqual({
      destination: "dev@example.com",
      user: "dev",
      host: "example.com",
      port: 2222,
    })
    expect(parseSshDestination("  build-box  ")).toEqual({
      destination: "build-box",
      user: null,
      host: "build-box",
      port: null,
    })
  })

  test("accepts IPv6 hosts", () => {
    expect(parseSshDestination("[2001:db8::1]:2222")).toEqual({
      destination: "2001:db8::1",
      user: null,
      host: "2001:db8::1",
      port: 2222,
    })
    expect(parseSshDestination("dev@::1")).toEqual({
      destination: "dev@::1",
      user: "dev",
      host: "::1",
      port: null,
    })
  })

  test("rejects anything that could smuggle ssh options or commands", () => {
    expect(parseSshDestination("")).toBeNull()
    expect(parseSshDestination("-oProxyCommand=calc")).toBeNull()
    expect(parseSshDestination("host -oProxyCommand=calc")).toBeNull()
    expect(parseSshDestination("host\nother")).toBeNull()
    expect(parseSshDestination("host;rm -rf /")).toBeNull()
    expect(parseSshDestination("host:99999")).toBeNull()
    expect(parseSshDestination("host:0")).toBeNull()
    expect(parseSshDestination("user name@host")).toBeNull()
    expect(parseSshDestination("-@host")).toBeNull()
  })
})

describe("normalizeSshHost", () => {
  test("keeps common inputs unchanged and brackets bare IPv6", () => {
    expect(normalizeSshHost("dev@example.com:2222")).toBe("dev@example.com:2222")
    expect(normalizeSshHost(" alias ")).toBe("alias")
    expect(normalizeSshHost("::1")).toBe("[::1]")
    expect(normalizeSshHost("dev@::1")).toBe("dev@[::1]")
    expect(normalizeSshHost("not valid!")).toBeNull()
  })
})

describe("ssh argv construction", () => {
  test("separates the destination from options with --", () => {
    const dest = parseSshDestination("dev@example.com:2222")!
    const args = sshRunArgs(dest)
    expect(args).toContain("--")
    expect(args.indexOf("--")).toBeLessThan(args.indexOf("dev@example.com"))
    expect(args.slice(args.indexOf("--") + 1)).toEqual(["dev@example.com", "sh", "-se"])
    expect(args).toContain("BatchMode=yes")
    expect(args.slice(args.indexOf("-p"))[1]).toBe("2222")
  })

  test("builds the tunnel forward before the destination", () => {
    const dest = parseSshDestination("example.com")!
    const args = sshTunnelArgs(dest, 50123, 40321)
    const forward = args.indexOf("-L")
    expect(args[forward + 1]).toBe("127.0.0.1:50123:127.0.0.1:40321")
    expect(args).toContain("ExitOnForwardFailure=yes")
    expect(forward).toBeLessThan(args.indexOf("--"))
  })

  test("opens Windows terminals with the destination last", () => {
    expect(windowsSshTerminalArgs(parseSshDestination("dev@example.com:2222")!)).toEqual([
      "/c",
      "start",
      "",
      "ssh",
      "-p",
      "2222",
      "dev@example.com",
    ])
  })
})

describe("remote scripts", () => {
  test("wraps the server script in one compound block for stdin safety", () => {
    const script = buildSshServerScript({ password: "secret", remotePort: 40321, logLevel: "WARN" })
    expect(script.startsWith("{\n")).toBe(true)
    expect(script.endsWith("}\n")).toBe(true)
    expect(script).toContain("--port 40321")
    expect(script).toContain("OPENCODE_SERVER_PASSWORD='secret'")
    expect(script).toContain(`exit ${SSH_SERVER_EXIT_OPENCODE_MISSING}`)
    // The watchdog must read the saved fd 9 — POSIX gives backgrounded
    // commands /dev/null as fd 0, which would otherwise kill the server
    // immediately on startup.
    expect(script).toContain("exec 9<&0")
    expect(script).toContain('cat 0<&9 >/dev/null 2>&1; kill "$OC_PID"')
  })

  test("escapes shell metacharacters in the password", () => {
    const script = buildSshServerScript({ password: "a'b$c", remotePort: 1, logLevel: "WARN" })
    expect(script).toContain(`OPENCODE_SERVER_PASSWORD='a'"'"'b$c'`)
  })

  test("pins the installer to the desktop version", () => {
    expect(buildSshInstallScript("1.18.13")).toContain("--version '1.18.13'")
  })

  test("probe script emits parseable markers", () => {
    const script = buildSshProbeScript()
    expect(script).toContain(SSH_PROBE_START_MARKER)
    expect(script).toContain(SSH_PROBE_END_MARKER)
    expect(script).toContain(SSH_PROBE_PATH_PREFIX)
    expect(script).toContain(SSH_PROBE_VERSION_PREFIX)
  })
})

describe("parseSshProbeOutput", () => {
  test("reads path and version from marker lines, ignoring banners", () => {
    const output = [
      "Welcome to the jump box!",
      SSH_PROBE_START_MARKER,
      `${SSH_PROBE_PATH_PREFIX}/home/dev/.opencode/bin/opencode`,
      `${SSH_PROBE_VERSION_PREFIX}1.18.13`,
      SSH_PROBE_END_MARKER,
    ].join("\n")
    expect(parseSshProbeOutput(output)).toEqual({
      reachable: true,
      opencodePath: "/home/dev/.opencode/bin/opencode",
      opencodeVersion: "1.18.13",
    })
  })

  test("reports missing opencode and unreachable hosts", () => {
    const missing = [SSH_PROBE_START_MARKER, SSH_PROBE_PATH_PREFIX, SSH_PROBE_END_MARKER].join("\n")
    expect(parseSshProbeOutput(missing)).toEqual({ reachable: true, opencodePath: null, opencodeVersion: null })
    expect(parseSshProbeOutput("Permission denied (publickey).")).toEqual({
      reachable: false,
      opencodePath: null,
      opencodeVersion: null,
    })
  })
})

describe("failure classification", () => {
  test("detects the opencode-missing marker and exit code", () => {
    expect(sshOutputIndicatesOpencodeMissing([], SSH_SERVER_EXIT_OPENCODE_MISSING)).toBe(true)
    expect(sshOutputIndicatesOpencodeMissing(["[stderr] OC_SSH_OPENCODE_MISSING"], 1)).toBe(true)
    expect(sshOutputIndicatesOpencodeMissing(["[stderr] boom"], 1)).toBe(false)
  })

  test("detects remote port conflicts", () => {
    expect(sshOutputIndicatesPortConflict(["[stderr] error: Failed to start server. Is port 40321 in use?"])).toBe(true)
    expect(sshOutputIndicatesPortConflict(["[stderr] listen EADDRINUSE: address already in use"])).toBe(true)
    expect(sshOutputIndicatesPortConflict(["[stderr] Permission denied (publickey)."])).toBe(false)
  })
})

describe("controller helpers", () => {
  test("derives ids, restart targets, and cleared probe state", () => {
    expect(sshServerIdForHost("dev@example.com")).toBe("ssh:dev@example.com")
    expect(
      sshServerIdToRestart(
        [
          {
            config: { id: "ssh:dev@example.com", host: "dev@example.com" },
            runtime: { kind: "ready", url: "", username: null, password: null },
          },
        ],
        "dev@example.com",
      ),
    ).toBe("ssh:dev@example.com")
    expect(sshServerIdToRestart([], "dev@example.com")).toBeUndefined()
    expect(
      clearSshHostState(
        {
          "dev@example.com": {
            host: "dev@example.com",
            reachable: true,
            opencodePath: null,
            opencodeVersion: null,
            expectedVersion: "1.18.13",
            matchesDesktop: null,
            error: null,
          },
        },
        "dev@example.com",
      ),
    ).toEqual({ hostProbes: {} })
  })

  test("validates SSH IPC identifiers at the module boundary", () => {
    expect(requireSshIpcString("host", "example.com")).toBe("example.com")
    expect(() => requireSshIpcString("host", "")).toThrow("Invalid host")
    expect(() => requireSshIpcString("server id", undefined)).toThrow("Invalid server id")
  })
})
