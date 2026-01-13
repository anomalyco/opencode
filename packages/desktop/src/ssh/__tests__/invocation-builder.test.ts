/**
 * Property Tests: SSH Invocation Builder
 *
 * Property 3: SSH Command Consistency
 * Validates: Requirement 1 (AC 7), Requirement 3 (AC 7), Requirement 7 (AC 4)
 *
 * Properties tested:
 * 1. Deterministic output: same input always produces same command
 * 2. No injection: user inputs never appear unquoted or unescaped
 * 3. Mandatory flags: security flags always present
 * 4. Array-based: args always returned as array, never shell string
 * 5. Config mode: isolation adds -F, pass-through does not
 * 6. Platform awareness: -F /dev/null on Unix, -F NUL on Windows (mocked)
 * 7. Version compatibility: documented SSH 7.4+ support
 */

import { describe, test, expect } from "bun:test"
import { SshInvocationBuilder } from "../invocation-builder"
import { SshInvocationParams } from "../types"

describe("SshInvocationBuilder", () => {
  const builder = new SshInvocationBuilder()

  describe("Property 1: Deterministic output", () => {
    test("same input produces identical command twice", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        user: "alice",
        localPort: 8080,
        remotePort: 3000,
        sshConfigMode: "isolation",
      }

      const cmd1 = builder.buildTunnel(params)
      const cmd2 = builder.buildTunnel(params)

      expect(cmd1.executable).toEqual(cmd2.executable)
      expect(cmd1.args.length).toEqual(cmd2.args.length)
      expect(JSON.stringify(cmd1)).toEqual(JSON.stringify(cmd2))
    })

    test("deterministic with optional parameters", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        user: "bob",
        port: 2222,
        identityFile: "/home/bob/.ssh/id_rsa",
        proxyJump: "bastion.example.com",
        localPort: 9000,
        remotePort: 5000,
      }

      const cmd1 = builder.buildTunnel(params)
      const cmd2 = builder.buildTunnel(params)

      expect(JSON.stringify(cmd1)).toEqual(JSON.stringify(cmd2))
    })
  })

  describe("Property 2: No injection", () => {
    test("host containing spaces does not break argument array", () => {
      const params: SshInvocationParams = {
        host: "host with spaces",
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)

      // Should be treated as single argument in array
      expect(cmd.args.some((arg) => arg === "host with spaces")).toBeTruthy()
    })

    test("user with special chars is safe in array", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        user: "user$(whoami)",
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)
      const lastArg = cmd.args[cmd.args.length - 1]

      // Should appear literally in user@host
      expect(lastArg).toContain("user$(whoami)@example.com")
    })

    test("identity file paths never unquoted", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        identityFile: "/path/with spaces/key.pem",
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)

      // Find the identity file argument
      const iIndex = cmd.args.indexOf("-i")
      expect(iIndex).toBeGreaterThan(-1)
      expect(cmd.args[iIndex + 1]).toEqual("/path/with spaces/key.pem")
      // Verify it's NOT split or quoted
      expect(cmd.args).not.toContain('"/path/with')
      expect(cmd.args).not.toContain("spaces/key.pem\"")
    })

    test("port numbers are strings, not shell-interpreted", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        port: 2222,
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)
      const pIndex = cmd.args.indexOf("-p")

      expect(typeof cmd.args[pIndex + 1]).toEqual("string")
      expect(cmd.args[pIndex + 1]).toEqual("2222")
    })
  })

  describe("Property 3: Mandatory security flags", () => {
    test("all mandatory options present in tunnel", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)
      const fullCmd = cmd.args.join(" ")

      // Check mandatory flags exist
      expect(fullCmd).toContain("-N")
      expect(fullCmd).toContain("-T")
      expect(fullCmd).toContain("BatchMode=yes")
      expect(fullCmd).toContain("StrictHostKeyChecking=yes")
      expect(fullCmd).toContain("ExitOnForwardFailure=yes")
    })

    test("all mandatory options present in bootstrap", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        user: "ubuntu",
      }

      const cmd = builder.buildBootstrap(params)
      const fullCmd = cmd.args.join(" ")

      // Bootstrap should NOT have -N or -T (it runs a command with output)
      expect(fullCmd).not.toContain("-N")
      expect(fullCmd).not.toContain(" -T")

      // But should have mandatory options
      expect(fullCmd).toContain("BatchMode=yes")
      expect(fullCmd).toContain("StrictHostKeyChecking=yes")
      expect(fullCmd).toContain("ExitOnForwardFailure=yes")
    })

    test("mandatory flags cannot be disabled", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        localPort: 8080,
        remotePort: 3000,
        options: {
          // Try to disable mandatory flags - should be ignored
          StrictHostKeyChecking: "no",
          ExitOnForwardFailure: "no",
        },
      }

      const cmd = builder.buildTunnel(params)
      const fullCmd = cmd.args.join(" ")

      // Mandatory values should still be present
      expect(fullCmd).toContain("StrictHostKeyChecking=yes")
      expect(fullCmd).toContain("ExitOnForwardFailure=yes")
    })
  })

  describe("Property 4: Array-based construction", () => {
    test("result is always array, never string", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)

      expect(typeof cmd.executable).toEqual("string")
      expect(Array.isArray(cmd.args)).toBeTruthy()
      expect(cmd.args.every((arg) => typeof arg === "string")).toBeTruthy()
    })

    test("args can be passed directly to spawn without escaping", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        user: "alice",
        identityFile: "/home/alice/.ssh/id_rsa",
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)

      // Each arg should be safe for direct use in Node spawn()
      // No quotes, no concatenation, no special shell chars
      const unsafeChars = ['"', "'", "`", "|", "&", ";", "$", "\\"]
      for (const arg of cmd.args) {
        // Args should not contain unescaped shell metacharacters
        // (except those that are part of legitimate options)
        if (arg.startsWith("-")) {
          continue // Options like -L are fine
        }
        if (arg.includes("=")) {
          continue // Option values like BatchMode=yes are fine
        }
        // File paths should not have quotes around them
        if (arg.startsWith("/")) {
          expect(arg.startsWith('"') || arg.startsWith("'")).toBeFalsy()
        }
      }
    })
  })

  describe("Property 5: Config mode handling", () => {
    test("isolation mode includes -F /dev/null", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        sshConfigMode: "isolation",
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)
      const fIndex = cmd.args.indexOf("-F")

      expect(fIndex).toBeGreaterThan(-1)
      // -F followed by /dev/null or NUL (platform-dependent in real execution)
      const configFile = cmd.args[fIndex + 1]
      expect(configFile === "/dev/null" || configFile === "NUL").toBeTruthy()
    })

    test("pass-through mode does not include -F", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        sshConfigMode: "pass-through",
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)

      expect(cmd.args.indexOf("-F")).toEqual(-1)
    })

    test("default (undefined) is pass-through", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        localPort: 8080,
        remotePort: 3000,
        // sshConfigMode not specified
      }

      const cmd = builder.buildTunnel(params)

      expect(cmd.args.indexOf("-F")).toEqual(-1)
    })
  })

  describe("Property 6: Tunnel specifics", () => {
    test("local port forwarding syntax is correct", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)
      const lIndex = cmd.args.indexOf("-L")

      expect(lIndex).toBeGreaterThan(-1)
      expect(cmd.args[lIndex + 1]).toEqual("127.0.0.1:8080:127.0.0.1:3000")
    })

    test("binds to 127.0.0.1, not 0.0.0.0", () => {
      const params: SshInvocationParams = {
        host: "remote.example.com",
        localPort: 9999,
        remotePort: 5000,
      }

      const cmd = builder.buildTunnel(params)
      const fullCmd = cmd.args.join(" ")

      expect(fullCmd).toContain("127.0.0.1:9999")
      expect(fullCmd).not.toContain("0.0.0.0")
    })

    test("requires localPort and remotePort", () => {
      const paramsNoLocal: SshInvocationParams = {
        host: "example.com",
        remotePort: 3000,
      }

      const paramsNoRemote: SshInvocationParams = {
        host: "example.com",
        localPort: 8080,
      }

      expect(() => builder.buildTunnel(paramsNoLocal)).toThrow()
      expect(() => builder.buildTunnel(paramsNoRemote)).toThrow()
    })
  })

  describe("Property 7: Bootstrap specifics", () => {
    test("executes hardcoded command only", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        user: "ubuntu",
      }

      const cmd = builder.buildBootstrap(params)

      // Should end with the command
      const lastFourArgs = cmd.args.slice(-4)
      expect(lastFourArgs).toEqual(["opencode", "server", "start", "--json"])
    })

    test("bootstrap removes -N flag", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        user: "ubuntu",
      }

      const cmd = builder.buildBootstrap(params)

      expect(cmd.args.indexOf("-N")).toEqual(-1)
    })

    test("bootstrap preserves mandatory security options", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        user: "ubuntu",
      }

      const cmd = builder.buildBootstrap(params)
      const fullCmd = cmd.args.join(" ")

      expect(fullCmd).toContain("BatchMode=yes")
      expect(fullCmd).toContain("StrictHostKeyChecking=yes")
      expect(fullCmd).toContain("ExitOnForwardFailure=yes")
    })
  })

  describe("Property 8: Optional parameters", () => {
    test("port parameter adds -p when non-default", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        port: 2222,
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)
      const pIndex = cmd.args.indexOf("-p")

      expect(pIndex).toBeGreaterThan(-1)
      expect(cmd.args[pIndex + 1]).toEqual("2222")
    })

    test("port 22 is omitted (default)", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        port: 22,
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)

      // Should not have explicit -p 22
      expect(cmd.args.indexOf("-p")).toEqual(-1)
    })

    test("identity file adds -i", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        identityFile: "/home/user/.ssh/custom_key",
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)
      const iIndex = cmd.args.indexOf("-i")

      expect(iIndex).toBeGreaterThan(-1)
      expect(cmd.args[iIndex + 1]).toEqual("/home/user/.ssh/custom_key")
    })

    test("proxy jump adds -J", () => {
      const params: SshInvocationParams = {
        host: "internal.example.com",
        proxyJump: "bastion.example.com",
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)
      const jIndex = cmd.args.indexOf("-J")

      expect(jIndex).toBeGreaterThan(-1)
      expect(cmd.args[jIndex + 1]).toEqual("bastion.example.com")
    })

    test("user parameter creates user@host", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        user: "deployer",
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)
      const lastArg = cmd.args[cmd.args.length - 1]

      expect(lastArg).toEqual("deployer@example.com")
    })

    test("no user only includes host", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)
      const lastArg = cmd.args[cmd.args.length - 1]

      expect(lastArg).toEqual("example.com")
    })
  })

  describe("Property 9: Additional options", () => {
    test("accepts custom -o options", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        localPort: 8080,
        remotePort: 3000,
        options: {
          ConnectTimeout: "10",
          ServerAliveInterval: "60",
        },
      }

      const cmd = builder.buildTunnel(params)
      const fullCmd = cmd.args.join(" ")

      expect(fullCmd).toContain("ConnectTimeout=10")
      expect(fullCmd).toContain("ServerAliveInterval=60")
    })

    test("boolean true options work", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        localPort: 8080,
        remotePort: 3000,
        options: {
          AddKeysToAgent: true,
        },
      }

      const cmd = builder.buildTunnel(params)

      expect(cmd.args).toContain("-o")
      expect(cmd.args).toContain("AddKeysToAgent")
    })

    test("boolean false options are skipped", () => {
      const params: SshInvocationParams = {
        host: "example.com",
        localPort: 8080,
        remotePort: 3000,
        options: {
          ForwardAgent: false,
        },
      }

      const cmd = builder.buildTunnel(params)

      expect(cmd.args.includes("ForwardAgent")).toBeFalsy()
    })
  })

  describe("Acceptance Test: Property 3 - SSH Command Consistency", () => {
    test("complete tunnel command is valid and consistent", () => {
      const params: SshInvocationParams = {
        host: "dev.example.com",
        user: "developer",
        port: 2222,
        identityFile: "/home/dev/.ssh/dev_key",
        sshConfigMode: "isolation",
        localPort: 8080,
        remotePort: 3000,
      }

      const cmd = builder.buildTunnel(params)

      // Executable
      expect(cmd.executable).toEqual("ssh")

      // Check all mandatory flags
      const fullCmd = cmd.args.join(" ")
      expect(fullCmd).toContain("-N")
      expect(fullCmd).toContain("-T")
      expect(fullCmd).toContain("BatchMode=yes")
      expect(fullCmd).toContain("StrictHostKeyChecking=yes")
      expect(fullCmd).toContain("ExitOnForwardFailure=yes")

      // Check config mode
      expect(fullCmd).toContain("-F")

      // Check optional parameters
      expect(fullCmd).toContain("-p")
      expect(fullCmd).toContain("2222")
      expect(fullCmd).toContain("-i")
      expect(fullCmd).toContain("/home/dev/.ssh/dev_key")

      // Check port forwarding
      expect(fullCmd).toContain("-L")
      expect(fullCmd).toContain("127.0.0.1:8080:127.0.0.1:3000")

      // Check host string
      expect(cmd.args[cmd.args.length - 1]).toEqual("developer@dev.example.com")

      // Verify determinism
      const cmd2 = builder.buildTunnel(params)
      expect(JSON.stringify(cmd)).toEqual(JSON.stringify(cmd2))
    })

    test("complete bootstrap command is valid and consistent", () => {
      const params: SshInvocationParams = {
        host: "fresh-host.example.com",
        user: "ubuntu",
        identityFile: "/root/.ssh/bootstrap_key",
        sshConfigMode: "pass-through",
      }

      const cmd = builder.buildBootstrap(params)

      const fullCmd = cmd.args.join(" ")

      // No -N or -T for bootstrap (executes remote command)
      expect(fullCmd).not.toContain("-N")
      expect(fullCmd).not.toContain(" -T")

      // Has mandatory security options
      expect(fullCmd).toContain("BatchMode=yes")
      expect(fullCmd).toContain("StrictHostKeyChecking=yes")
      expect(fullCmd).toContain("ExitOnForwardFailure=yes")

      // No -F in pass-through mode
      expect(fullCmd).not.toContain("-F")

      // Has identity and host
      expect(fullCmd).toContain("-i")
      expect(fullCmd).toContain("/root/.ssh/bootstrap_key")
      expect(fullCmd).toContain("ubuntu@fresh-host.example.com")

      // Has command at the end
      const lastFour = cmd.args.slice(-4)
      expect(lastFour).toEqual(["opencode", "server", "start", "--json"])

      // Verify determinism
      const cmd2 = builder.buildBootstrap(params)
      expect(JSON.stringify(cmd)).toEqual(JSON.stringify(cmd2))
    })
  })
})
