import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import os from "os"
import fs from "fs"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { Flag } from "../../src/flag/flag"
import { Config } from "../../src/config/config"

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const isSrtAvailable = Bun.which("srt") !== null && process.platform !== "win32"

describe.skipIf(!isSrtAvailable)("SRT Sandbox Security Boundaries", () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeAll(() => {
    originalEnv = { ...process.env }
    
    // Override the exported constants loaded at module creation time
    Object.defineProperty(Flag, "OPENCODE_EXPERIMENTAL_SANDBOX", { get: () => false }) // disabled by default flag to test newer config
    
    Object.defineProperty(Config, "get", {
      value: async () => ({
        bash_sandbox: {
          enabled: true,
          provider: "srt",
          domains: [],
          env_whitelist: ["PATH", "HOME", "TERM", "LANG", "USER", "SHELL", "TMPDIR", "TMP", "EDITOR"],
          deny_workspace_patterns: ["**/*.secret", "**/*.key", "**/.env*", "secrets_dir/*"]
        }
      })
    })
  })

  afterAll(() => {
    process.env = originalEnv
  })

  test("blocks writing to unauthorized directories (e.g. system binaries)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const targetFile = "/usr/bin/opencode-malicious-entry"
        await bash.execute(
          {
            command: `touch ${targetFile} 2>&1 || true`, // We don't care about the exit code inside the sandbox since it might use an ephemeral tmpfs
            description: "Attempt to hijack system binary directory",
          },
          ctx,
        ) as any
        
        // The sandbox successfully protected the host OS if the file never escaped onto the actual disk!
        expect(fs.existsSync(targetFile)).toBe(false)
      },
    })
  })

  test("blocks reading sensitive host files (e.g. user home directory)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // Path to typical user context we want blocked
        const targetFile = path.join(os.homedir(), ".bash_history").replaceAll("\\", "/")
        const result = await bash.execute(
          {
            command: `cat ${targetFile} 2>&1`,
            description: "Attempt to read sensitive host file",
          },
          ctx,
        ) as any
        
        expect(result.metadata.exit).toBeGreaterThan(0)
        expect(String(result.output).toLowerCase()).toMatch(/permission denied|no such file or directory/)
      },
    })
  })

  test("ensures sensitive environment variables are completely scrubbed from process child", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // Inject a known sensitive token into host OS environment securely mapped into memory
        process.env.SUPER_SENSITIVE_API_KEY = "123456789"
        
        const result = await bash.execute(
          {
            command: `env`,
            description: "Attempt to dump environment variables to scrape tokens",
          },
          ctx,
        ) as any
        
        expect(String(result.output)).not.toContain("SUPER_SENSITIVE_API_KEY")
        expect(result.metadata.exit).toBe(0)
        
        // Cleanup memory state
        delete process.env.SUPER_SENSITIVE_API_KEY
      },
    })
  })

  test("blocks network exfiltration via DNS constraints when airgapped", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // Since we provided OPENCODE_SANDBOX_DOMAINS="", this should be blocked.
        const result = await bash.execute(
          {
            command: `curl -s -m 2 https://example.com 2>&1`,
            description: "Attempt outbound network ping to known domain",
          },
          ctx,
        ) as any
        
        // Sandbox blocks usually result in proxy timeouts or resolution failures
        expect(result.metadata.exit).toBeGreaterThan(0)
      },
    })
  })

  test("deny_workspace_patterns: blocks reads and writes for matched dotfiles and extensions", async () => {
    await using tmp = await tmpdir()
    fs.writeFileSync(path.join(tmp.path, ".env"), "API_KEY=123")
    fs.writeFileSync(path.join(tmp.path, "config.key"), "PRIVATE_KEY_DATA")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()

        // Test dotfile block
        let result = await bash.execute({ command: `cat .env 2>&1`, description: "Read .env" }, ctx) as any
        expect(result.metadata.exit).toBeGreaterThan(0)
        expect(String(result.output).toLowerCase()).toMatch(/permission denied/)

        result = await bash.execute({ command: `echo "hacked" > .env 2>&1`, description: "Write .env" }, ctx) as any
        expect(result.metadata.exit).toBeGreaterThan(0)

        // Test regular file extension match
        result = await bash.execute({ command: `cat config.key 2>&1`, description: "Read config.key" }, ctx) as any
        expect(result.metadata.exit).toBeGreaterThan(0)
      },
    })
  })

  test("deny_workspace_patterns: allows full access to unblocked sibling files", async () => {
    await using tmp = await tmpdir()
    fs.writeFileSync(path.join(tmp.path, ".env"), "blocked")
    fs.writeFileSync(path.join(tmp.path, "readme.md"), "safe")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        
        let result = await bash.execute({ command: `cat readme.md && echo "edited" >> readme.md`, description: "RW safe file" }, ctx) as any
        expect(result.metadata.exit).toBe(0)
        expect(String(result.output)).toContain("safe")
        expect(fs.readFileSync(path.join(tmp.path, "readme.md"), "utf8")).toContain("edited")
      },
    })
  })

  test("deny_workspace_patterns: safely handles deeply nested files and directory wildcards", async () => {
    await using tmp = await tmpdir()
    fs.mkdirSync(path.join(tmp.path, "a/b/c"), { recursive: true })
    fs.writeFileSync(path.join(tmp.path, "a/b/c/deep.secret"), "deep_data")
    
    fs.mkdirSync(path.join(tmp.path, "secrets_dir"), { recursive: true })
    fs.writeFileSync(path.join(tmp.path, "secrets_dir/anything.txt"), "dir_data")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()

        let result = await bash.execute({ command: `cat a/b/c/deep.secret 2>&1`, description: "Deep secret" }, ctx) as any
        expect(result.metadata.exit).toBeGreaterThan(0)

        result = await bash.execute({ command: `cat secrets_dir/anything.txt 2>&1`, description: "Dir wildcard" }, ctx) as any
        expect(result.metadata.exit).toBeGreaterThan(0)
      },
    })
  })

  test("deny_workspace_patterns: blocks deletion (rm) and permission modification (chmod) of restricted files", async () => {
    await using tmp = await tmpdir()
    fs.writeFileSync(path.join(tmp.path, "test.secret"), "data")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()

        let result = await bash.execute({ command: `rm test.secret 2>&1`, description: "Delete secret" }, ctx) as any
        expect(result.metadata.exit).toBeGreaterThan(0)
        expect(String(result.output).toLowerCase()).toMatch(/device or resource busy|permission|read-only/)

        result = await bash.execute({ command: `chmod 777 test.secret 2>&1`, description: "Chmod secret" }, ctx) as any
        expect(result.metadata.exit).toBeGreaterThan(0)
      },
    })
  })

  test("deny_workspace_patterns: secures files with spaces or unusual characters in names", async () => {
    await using tmp = await tmpdir()
    fs.writeFileSync(path.join(tmp.path, "my weird secret.secret"), "weird_data")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()

        let result = await bash.execute({ command: `cat "my weird secret.secret" 2>&1`, description: "Weird name" }, ctx) as any
        expect(result.metadata.exit).toBeGreaterThan(0)
      },
    })
  })

  test("deny_workspace_patterns: newly created matching files magically inherit read restrictions", async () => {
    await using tmp = await tmpdir()
    
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()

        // Because 'new.secret' does not exist when the sandbox STARTS, the glob
        // resolver doesn't pick it up, so it is omitted from denyWrite/denyRead.
        let result = await bash.execute({ command: `echo "injected" > new.secret && ls -la new.secret`, description: "Create new secret" }, ctx) as any
        
        console.log("Creation output:", String(result.output))
        expect(result.metadata.exit).toBe(0)
        
        // It can also be read back since it evaded the initial glob scan
        result = await bash.execute({ command: `cat new.secret 2>&1`, description: "Read new secret" }, ctx) as any
        
        if (result.metadata.exit !== 0) {
          console.log("Unexpected read failure output:", String(result.output))
          // Also check umask
          const umaskRes = await bash.execute({ command: "umask", description: "check umask"}, ctx) as any
          console.log("Current umask:", String(umaskRes.output))
        }
        
        expect(result.metadata.exit).toBeGreaterThan(0)
      },
    })
  })
})
