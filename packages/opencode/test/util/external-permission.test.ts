import { test, expect, describe } from "bun:test"
import { ExternalPermission } from "../../src/util/external-permission"
import { Global } from "../../src/global"

describe("ExternalPermission.resolve", () => {
  const homedir = Global.Path.home

  describe("Type 1 - Simple string config", () => {
    test("returns string value for read operation", () => {
      expect(ExternalPermission.resolve("allow", "/etc/hosts", "read")).toBe("allow")
      expect(ExternalPermission.resolve("ask", "/etc/hosts", "read")).toBe("ask")
      expect(ExternalPermission.resolve("deny", "/etc/hosts", "read")).toBe("deny")
    })

    test("returns string value for write operation", () => {
      expect(ExternalPermission.resolve("allow", "/etc/hosts", "write")).toBe("allow")
      expect(ExternalPermission.resolve("ask", "/etc/hosts", "write")).toBe("ask")
      expect(ExternalPermission.resolve("deny", "/etc/hosts", "write")).toBe("deny")
    })
  })

  describe("Type 2 - Object with read/write split (simple strings)", () => {
    test("returns operation-specific permission", () => {
      const config = { read: "allow" as const, write: "deny" as const }
      expect(ExternalPermission.resolve(config, "/etc/hosts", "read")).toBe("allow")
      expect(ExternalPermission.resolve(config, "/etc/hosts", "write")).toBe("deny")
    })

    test("defaults to ask when operation not specified", () => {
      const configReadOnly = { read: "allow" as const }
      expect(ExternalPermission.resolve(configReadOnly, "/etc/hosts", "read")).toBe("allow")
      expect(ExternalPermission.resolve(configReadOnly, "/etc/hosts", "write")).toBe("ask")

      const configWriteOnly = { write: "deny" as const }
      expect(ExternalPermission.resolve(configWriteOnly, "/etc/hosts", "read")).toBe("ask")
      expect(ExternalPermission.resolve(configWriteOnly, "/etc/hosts", "write")).toBe("deny")
    })

    test("handles empty object config", () => {
      const config = {}
      expect(ExternalPermission.resolve(config, "/etc/hosts", "read")).toBe("ask")
      expect(ExternalPermission.resolve(config, "/etc/hosts", "write")).toBe("ask")
    })
  })

  describe("Type 3 - Object with directory rules", () => {
    test("matches directory patterns", () => {
      const config = {
        read: {
          directories: { "/etc/*": "deny" as const, "/tmp/*": "allow" as const },
          default: "ask" as const,
        },
      }
      expect(ExternalPermission.resolve(config, "/etc/hosts", "read")).toBe("deny")
      expect(ExternalPermission.resolve(config, "/tmp/file.txt", "read")).toBe("allow")
      expect(ExternalPermission.resolve(config, "/var/log/syslog", "read")).toBe("ask")
    })

    test("uses default when no pattern matches", () => {
      const config = {
        read: {
          directories: { "/etc/*": "deny" as const },
          default: "allow" as const,
        },
      }
      expect(ExternalPermission.resolve(config, "/var/log/syslog", "read")).toBe("allow")
    })

    test("defaults to ask when default not specified", () => {
      const config = {
        read: {
          directories: { "/etc/*": "deny" as const },
        },
      }
      expect(ExternalPermission.resolve(config, "/var/log/syslog", "read")).toBe("ask")
    })

    test("longer patterns take precedence", () => {
      const config = {
        read: {
          directories: {
            "/etc/*": "deny" as const,
            "/etc/hosts": "allow" as const,
          },
        },
      }
      expect(ExternalPermission.resolve(config, "/etc/hosts", "read")).toBe("allow")
      expect(ExternalPermission.resolve(config, "/etc/passwd", "read")).toBe("deny")
    })
  })

  describe("Type 4 - Mixed configurations", () => {
    test("simple read with complex write", () => {
      const config = {
        read: "allow" as const,
        write: {
          directories: { "/etc/*": "deny" as const },
          default: "ask" as const,
        },
      }
      expect(ExternalPermission.resolve(config, "/etc/hosts", "read")).toBe("allow")
      expect(ExternalPermission.resolve(config, "/etc/hosts", "write")).toBe("deny")
      expect(ExternalPermission.resolve(config, "/tmp/file", "write")).toBe("ask")
    })

    test("complex read with simple write", () => {
      const config = {
        read: {
          directories: { "/var/log/*": "allow" as const },
          default: "deny" as const,
        },
        write: "deny" as const,
      }
      expect(ExternalPermission.resolve(config, "/var/log/syslog", "read")).toBe("allow")
      expect(ExternalPermission.resolve(config, "/etc/passwd", "read")).toBe("deny")
      expect(ExternalPermission.resolve(config, "/var/log/syslog", "write")).toBe("deny")
    })
  })

  describe("Tilde expansion", () => {
    test("expands tilde in directory patterns", () => {
      const config = {
        read: {
          directories: { "~/.ssh/*": "deny" as const },
          default: "allow" as const,
        },
      }
      expect(ExternalPermission.resolve(config, `${homedir}/.ssh/id_rsa`, "read")).toBe("deny")
      expect(ExternalPermission.resolve(config, `${homedir}/.config/settings`, "read")).toBe("allow")
    })

    test("handles multiple tilde patterns", () => {
      const config = {
        write: {
          directories: {
            "~/.ssh/*": "deny" as const,
            "~/.config/*": "ask" as const,
            "~/Documents/*": "allow" as const,
          },
          default: "deny" as const,
        },
      }
      expect(ExternalPermission.resolve(config, `${homedir}/.ssh/id_rsa`, "write")).toBe("deny")
      expect(ExternalPermission.resolve(config, `${homedir}/.config/settings`, "write")).toBe("ask")
      expect(ExternalPermission.resolve(config, `${homedir}/Documents/file.txt`, "write")).toBe("allow")
      expect(ExternalPermission.resolve(config, `/etc/passwd`, "write")).toBe("deny")
    })

    test("non-tilde patterns still work", () => {
      const config = {
        read: {
          directories: {
            "/etc/*": "deny" as const,
            "~/.config/*": "allow" as const,
          },
        },
      }
      expect(ExternalPermission.resolve(config, "/etc/hosts", "read")).toBe("deny")
      expect(ExternalPermission.resolve(config, `${homedir}/.config/settings`, "read")).toBe("allow")
    })
  })

  describe("Default behavior", () => {
    test("returns ask when config is undefined", () => {
      expect(ExternalPermission.resolve(undefined, "/etc/hosts", "read")).toBe("ask")
      expect(ExternalPermission.resolve(undefined, "/etc/hosts", "write")).toBe("ask")
    })

    test("handles undefined gracefully", () => {
      expect(ExternalPermission.resolve(undefined, "/any/path", "read")).toBe("ask")
      expect(ExternalPermission.resolve(undefined, "/any/path", "write")).toBe("ask")
    })
  })

  describe("Wildcard patterns", () => {
    test("* does not cross directory boundaries", () => {
      const config = {
        read: {
          directories: { "/etc/*": "deny" as const },
          default: "allow" as const,
        },
      }
      expect(ExternalPermission.resolve(config, "/etc/hosts", "read")).toBe("deny")
      expect(ExternalPermission.resolve(config, "/etc/ssh/config", "read")).toBe("allow") // * doesn't cross /
      expect(ExternalPermission.resolve(config, "/var/log/syslog", "read")).toBe("allow")
    })

    test("** matches across directory boundaries", () => {
      const config = {
        read: {
          directories: { "/etc/**": "deny" as const },
          default: "allow" as const,
        },
      }
      expect(ExternalPermission.resolve(config, "/etc/hosts", "read")).toBe("deny")
      expect(ExternalPermission.resolve(config, "/etc/ssh/config", "read")).toBe("deny")
      expect(ExternalPermission.resolve(config, "/var/log/syslog", "read")).toBe("allow")
    })

    test("handles ? single character wildcard", () => {
      const config = {
        read: {
          directories: { "/tmp/file?.txt": "allow" as const },
          default: "deny" as const,
        },
      }
      expect(ExternalPermission.resolve(config, "/tmp/file1.txt", "read")).toBe("allow")
      expect(ExternalPermission.resolve(config, "/tmp/fileA.txt", "read")).toBe("allow")
      expect(ExternalPermission.resolve(config, "/tmp/file12.txt", "read")).toBe("deny")
    })
  })

  describe("Directory pattern normalization", () => {
    test("plain directory paths match files inside", () => {
      const config = {
        read: {
          directories: { "/Users/test/projects/myapp": "allow" as const },
          default: "deny" as const,
        },
      }
      expect(ExternalPermission.resolve(config, "/Users/test/projects/myapp/src/main.ts", "read")).toBe("allow")
      expect(ExternalPermission.resolve(config, "/Users/test/projects/myapp/package.json", "read")).toBe("allow")
      expect(ExternalPermission.resolve(config, "/Users/test/projects/other/file.ts", "read")).toBe("deny")
    })

    test("plain directory paths match nested subdirectories", () => {
      const config = {
        read: {
          directories: { "/home/user/code": "allow" as const },
          default: "deny" as const,
        },
      }
      expect(ExternalPermission.resolve(config, "/home/user/code/project/src/deep/file.ts", "read")).toBe("allow")
    })

    test("tilde directory paths match contents", () => {
      const config = {
        read: {
          directories: { "~/projects/spring-petclinic": "allow" as const },
          default: "deny" as const,
        },
      }
      expect(ExternalPermission.resolve(config, `${homedir}/projects/spring-petclinic/Pet.java`, "read")).toBe("allow")
      expect(ExternalPermission.resolve(config, `${homedir}/projects/other/File.java`, "read")).toBe("deny")
    })

    test("patterns with existing wildcards are not modified", () => {
      const config = {
        read: {
          directories: {
            "/etc/*": "deny" as const,
            "/var/**": "allow" as const,
          },
          default: "ask" as const,
        },
      }
      expect(ExternalPermission.resolve(config, "/etc/hosts", "read")).toBe("deny")
      expect(ExternalPermission.resolve(config, "/etc/ssh/config", "read")).toBe("ask") // * doesn't match /
      expect(ExternalPermission.resolve(config, "/var/log/deep/file.log", "read")).toBe("allow")
    })
  })

  describe("Edge cases", () => {
    test("handles empty directories object", () => {
      const config = {
        read: {
          directories: {},
          default: "allow" as const,
        },
      }
      expect(ExternalPermission.resolve(config, "/etc/hosts", "read")).toBe("allow")
    })

    test("handles config with only directories (no default)", () => {
      const config = {
        read: {
          directories: { "/etc/*": "deny" as const },
        },
      }
      expect(ExternalPermission.resolve(config, "/etc/hosts", "read")).toBe("deny")
      expect(ExternalPermission.resolve(config, "/var/log/syslog", "read")).toBe("ask")
    })

    test("handles config with only default (no directories)", () => {
      const config = {
        read: {
          default: "allow" as const,
        },
      }
      expect(ExternalPermission.resolve(config, "/any/path", "read")).toBe("allow")
    })
  })
})
