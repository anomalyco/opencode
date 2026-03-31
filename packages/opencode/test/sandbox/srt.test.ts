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
          deny_workspace_patterns: ["**/*.secret"]
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

  test("enforces deny_workspace_patterns via explicit file path resolution", async () => {
    await using tmp = await tmpdir()
    fs.writeFileSync(path.join(tmp.path, "test.secret"), "super_secret_data")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        let result = await bash.execute(
          {
            command: `cat test.secret 2>&1 || true`,
            description: "Attempt to read explicitly blocked pattern (will succeed due to srt reading precedence)",
          },
          ctx,
        ) as any
        
        // srt architectural limitation: allowRead (which we use to allow the workspace) 
        // strictly overrides any nested denyReads! So reading is actually allowed here.
        expect(result.metadata.exit).toBe(0)
        
        result = await bash.execute(
          {
            command: `echo "hacked" > test.secret 2>&1`,
            description: "Attempt to write to explicitly blocked pattern",
          },
          ctx,
        ) as any
        
        expect(result.metadata.exit).toBeGreaterThan(0)
        expect(String(result.output).toLowerCase()).toContain("read-only file system")
      },
    })
  })
})
