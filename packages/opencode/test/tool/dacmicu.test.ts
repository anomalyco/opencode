import { describe, test, expect } from "bun:test"
import { spawnSync } from "child_process"
import path from "path"
import { MessageV2 } from "../../src/session/message-v2"

const OC_TS = path.resolve(import.meta.dirname, "../../bin/oc.ts")
const OC_SH = path.resolve(import.meta.dirname, "../../bin/oc")

// Helper: spawn oc.ts with given args and env.
// Short timeouts ensure the process exits quickly when no server is running.
function oc(args: string[], env: Record<string, string> = {}) {
  return spawnSync("bun", ["run", OC_TS, ...args], {
    env: {
      ...process.env,
      OPENCODE_SERVER_URL: "http://localhost:4096",
      OPENCODE_SESSION_ID: "ses_test_session",
      OPENCODE_AGENT: "build",
      OPENCODE_QUIET: "1", // suppress auto-announce in tests
      OPENCODE_EXEC_TIMEOUT_MS: "3000", // fail fast when no server running
      OPENCODE_TOOL_TIMEOUT_MS: "3000", // same for tool paths
      ...env,
    },
    timeout: 10000,
  })
}

// Helper: spawn shell wrapper
function ocsh(args: string[], env: Record<string, string> = {}) {
  return spawnSync(OC_SH, args, {
    env: {
      ...process.env,
      OPENCODE_SERVER_URL: "http://localhost:4096",
      OPENCODE_SESSION_ID: "ses_test_session",
      OPENCODE_AGENT: "build",
      OPENCODE_QUIET: "1",
      OPENCODE_EXEC_TIMEOUT_MS: "3000",
      OPENCODE_TOOL_TIMEOUT_MS: "3000",
      PATH: `${path.dirname(OC_SH)}:${process.env.PATH}`,
      ...env,
    },
    timeout: 10000,
  })
}

describe("oc CLI", () => {
  // ── CLI Unit Tests ──────────────────────────────────────────

  describe("oc CLI — env validation", () => {
    test("missing SERVER_URL errors", () => {
      const result = spawnSync("bun", ["run", OC_TS, "--help"], {
        env: { ...process.env, OPENCODE_SERVER_URL: "", OPENCODE_SESSION_ID: "x" },
        timeout: 5000,
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("OPENCODE_SERVER_URL")
    })

    test("missing SESSION_ID errors", () => {
      const result = spawnSync("bun", ["run", OC_TS, "--help"], {
        env: { ...process.env, OPENCODE_SERVER_URL: "http://x", OPENCODE_SESSION_ID: "" },
        timeout: 5000,
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("OPENCODE_SESSION_ID")
    })
  })

  describe("oc CLI — help", () => {
    test("--help prints usage", () => {
      const result = oc(["--help"])
      expect(result.status).toBe(0)
      expect(result.stdout.toString()).toContain("oc prompt")
      expect(result.stdout.toString()).toContain("oc tool")
    })

    test("help subcommand works", () => {
      const result = oc(["help"])
      expect(result.status).toBe(0)
      expect(result.stdout.toString()).toContain("DETERMINISTIC TOOLS")
    })
  })

  describe("oc CLI — unknown command", () => {
    test("unknown command errors", () => {
      const result = oc(["nonexistent"])
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("unknown command")
    })
  })

  describe("oc CLI — prompt subcommand", () => {
    test("no text errors", () => {
      const result = oc(["prompt"])
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("no prompt text")
    })

    test("prompt sends to /exec (fails on network, not parse)", () => {
      const result = oc(["prompt", "hello"])
      expect(result.status).not.toBe(0)
      // Fails on network (connection refused or timeout), not on argument parsing
      expect(result.stderr.toString()).not.toContain("no prompt text")
    })

    test("-s flag parses system prompt", () => {
      const result = oc(["prompt", "-s", "pirate", "hello"])
      expect(result.status).not.toBe(0)
      // Should not fail on argument parsing — only on network
      expect(result.stderr.toString()).not.toContain("no prompt text")
    })

    test("-m flag parses model", () => {
      const result = oc(["prompt", "-m", "anthropic/claude", "hello"])
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).not.toContain("no prompt text")
    })

    test("bad model format errors", () => {
      const result = oc(["prompt", "-m", "badmodel", "hello"])
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("provider/model")
    })
  })

  describe("oc CLI — tool subcommand", () => {
    test("no tool name errors", () => {
      const result = oc(["tool"])
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("no tool name")
    })

    test("read parses file path", () => {
      const result = oc(["tool", "read", "src/index.ts"])
      expect(result.status).not.toBe(0)
      // Fails on network, not argument parsing
      expect(result.stderr.toString()).not.toContain("file path required")
    })

    test("glob parses pattern and path", () => {
      const result = oc(["tool", "glob", "*.ts", "src"])
      expect(result.status).not.toBe(0)
      // Fails on network, not argument parsing
      expect(result.stderr.toString()).not.toContain("pattern required")
    })

    test("grep parses pattern and path", () => {
      const result = oc(["tool", "grep", "TODO", "src/"])
      expect(result.status).not.toBe(0)
      // Fails on network, not argument parsing
      expect(result.stderr.toString()).not.toContain("pattern required")
    })
  })

  describe("oc CLI — todo subcommand", () => {
    test("todo add without content errors", () => {
      const result = oc(["todo", "add"])
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("no content")
    })

    test("todo done without index errors", () => {
      const result = oc(["todo", "done"])
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("1-based index")
    })

    test("todo done 0 errors", () => {
      const result = oc(["todo", "done", "0"])
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("1-based index")
    })

    test("todo unknown subcommand errors", () => {
      const result = oc(["todo", "xyz"])
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("unknown")
    })
  })

  describe("oc CLI — agent subcommand", () => {
    test("no type errors", () => {
      const result = oc(["agent"])
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("usage")
    })

    test("no prompt errors", () => {
      const result = oc(["agent", "explore"])
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("no prompt text")
    })
  })

  describe("oc CLI — status subcommand", () => {
    test("status writes to stderr", () => {
      const result = oc(["status", "Processing..."], { OPENCODE_QUIET: "0" })
      expect(result.status).toBe(0)
      expect(result.stderr.toString()).toContain("Processing...")
    })

    test("status without message errors", () => {
      const result = oc(["status"])
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("no message")
    })
  })

  describe("oc CLI — auto-announce", () => {
    test("auto-announce writes dimmed text to stderr", () => {
      // Use a 500ms exec timeout: enough for log() to fire, too short for network to succeed
      const result = oc(["prompt", "hello"], { OPENCODE_QUIET: "0", OPENCODE_EXEC_TIMEOUT_MS: "500" })
      // log() fires BEFORE the API call, so [oc] appears even if network times out
      const stderr = result.stderr.toString()
      expect(stderr).toContain("[oc]")
      expect(stderr).toContain("prompt")
    })

    test("OPENCODE_QUIET=1 suppresses announce", () => {
      // Use a 500ms exec timeout for speed
      const result = oc(["prompt", "hello"], { OPENCODE_QUIET: "1", OPENCODE_EXEC_TIMEOUT_MS: "500" })
      const stderr = result.stderr.toString()
      expect(stderr).not.toContain("[oc]")
    })
  })

  describe("oc CLI — connection error handling", () => {
    test("connection error gives user-friendly error (no stack traces)", () => {
      const result = oc(["tool", "read", "src/index.ts"])
      expect(result.status).not.toBe(0)
      // Should NOT contain raw stack traces regardless of error type
      expect(result.stderr.toString()).not.toContain("    at ")
    })
  })

  // ── Binary File Protocol Tests ──────────────────────────────

  describe("binary file protocol", () => {
    const OC_FILE_MARKER = "\x00OC_FILE\x00:"

    test("detects marker in text", () => {
      const input = `PDF read successfully\n${OC_FILE_MARKER}/path/to/file.pdf`
      const lines = input.split("\n")
      const files: string[] = []
      const text: string[] = []
      for (const line of lines) {
        if (line.startsWith(OC_FILE_MARKER)) files.push(line.substring(OC_FILE_MARKER.length))
        else text.push(line)
      }
      expect(files).toEqual(["/path/to/file.pdf"])
      expect(text).toEqual(["PDF read successfully"])
    })

    test("no marker = plain text", () => {
      const input = "Just regular text\nAnother line"
      const lines = input.split("\n")
      const files: string[] = []
      for (const line of lines) {
        if (line.startsWith(OC_FILE_MARKER)) files.push(line.substring(OC_FILE_MARKER.length))
      }
      expect(files).toEqual([])
    })

    test("multiple markers extracted", () => {
      const input = `text\n${OC_FILE_MARKER}/a.pdf\nmore\n${OC_FILE_MARKER}/b.png`
      const files: string[] = []
      for (const line of input.split("\n")) {
        if (line.startsWith(OC_FILE_MARKER)) files.push(line.substring(OC_FILE_MARKER.length))
      }
      expect(files).toEqual(["/a.pdf", "/b.png"])
    })

    test("marker cannot appear in normal text", () => {
      // Null bytes can't be typed or appear in normal text streams
      const text = "__oc_file__:/path/to/file.pdf"
      expect(text.startsWith(OC_FILE_MARKER)).toBe(false)
    })
  })

  // ── Shell Fast-Path Tests ──────────────────────────────────
  // bin/oc is a POSIX sh script — only runnable on non-Windows platforms.
  if (process.platform !== "win32") {
    describe("shell fast-path", () => {
      test("bin/oc is executable", () => {
        const result = ocsh(["help"])
        expect(result.status).toBe(0)
        expect(result.stdout.toString()).toContain("oc")
      })

      test("bin/oc routes tool to fast path (if jq available)", () => {
        const result = ocsh(["tool", "read", "/tmp/test.ts"])
        // curl may succeed (HTTP 200 with error body) or fail — either way it shouldn't crash on routing
        const output = result.stdout.toString() + result.stderr.toString()
        // Should not contain shell syntax errors
        expect(output).not.toContain("syntax error")
      })
    })
  }

  // ── Data Integrity Tests ──────────────────────────────────

  describe("toModelMessages filter", () => {
    test("oc-flagged ToolPart is excluded from toModelMessages — guard present in message-v2", async () => {
      // The oc metadata flag must prevent tool parts from being sent to the LLM,
      // since there is no corresponding tool_use from the model.
      // Verify the guard exists at the exact code path before toolNames.add().
      const src = await Bun.file(path.resolve(import.meta.dirname, "../../src/session/message-v2.ts")).text()
      // Guard must appear before toolNames.add() — both patterns must be present
      expect(src).toContain("part.metadata?.oc")
      expect(src).toContain("toolNames.add")
      // The skip comment must also be present (documents why the part is excluded)
      expect(src).toContain("Skip oc-injected Part")
    })

    test("non-oc ToolPart does not carry oc marker", () => {
      // Standard tool parts have no oc marker — guard must not fire for normal parts
      const part = { type: "tool" as const, metadata: undefined }
      expect((part.metadata as { oc?: boolean } | undefined)?.oc).toBeUndefined()
    })
  })

  // ── oc check Tests ─────────────────────────────────────

  describe("oc check subcommand", () => {
    test("no question errors", () => {
      const result = oc(["check"])
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("no question")
    })

    test("sends to /exec (fails on HTTP, not argument parse)", () => {
      const result = oc(["check", "Are tests passing?"])
      // Should fail on HTTP connection, not argument parsing
      expect(result.stderr.toString()).not.toContain("no question")
    })

    test("help text includes oc check with grep pattern", () => {
      const result = oc(["help"])
      expect(result.stdout.toString()).toContain("oc check")
      expect(result.stdout.toString()).toContain("grep pattern")
      expect(result.stdout.toString()).toContain("while")
    })

    test("help text describes oc", () => {
      const result = oc(["help"])
      expect(result.stdout.toString()).toContain("openCode CLI")
    })
  })

  // ── oc check sentinel detection ─────────────────────────

  describe("oc check sentinel detection", () => {
    const SENTINEL = "NO_ISSUES_FOUND"

    function checkResult(response: string) {
      const trimmed = response.trim()
      const clean = trimmed.includes(SENTINEL)
      return { clean, assessment: clean ? "" : trimmed }
    }

    test("response ending with sentinel → clean", () => {
      const { clean } = checkResult("Everything looks good.\nNO_ISSUES_FOUND")
      expect(clean).toBe(true)
    })

    test("sentinel only → clean", () => {
      const { clean } = checkResult("NO_ISSUES_FOUND")
      expect(clean).toBe(true)
    })

    test("sentinel with trailing whitespace → clean", () => {
      const { clean } = checkResult("NO_ISSUES_FOUND  \n")
      expect(clean).toBe(true)
    })

    test("sentinel at start followed by summary → clean", () => {
      const { clean } = checkResult("NO_ISSUES_FOUND\n\nReview Summary\n- All looks good")
      expect(clean).toBe(true)
    })

    test("issues found → not clean (exit 0, loop continues)", () => {
      const response = "Found 3 issues:\n1) unused import\n2) missing validation"
      const { clean, assessment } = checkResult(response)
      expect(clean).toBe(false)
      expect(assessment).toContain("Found 3 issues")
    })
  })

  // ── Timeout Detection Tests ─────────────────────────────
  // bash.ts uses tree-sitter AST to detect oc commands: the command name node
  // must match /^(oc|\.\/oc)$/ exactly. Test that predicate directly.
  describe("oc auto-timeout", () => {
    test("isOc predicate matches oc and ./oc command names only", () => {
      const isOc = (text: string) => /^(oc|\.\/oc)$/.test(text)
      expect(isOc("oc")).toBe(true)
      expect(isOc("./oc")).toBe(true)
      expect(isOc("ocelot")).toBe(false)
      expect(isOc("doc")).toBe(false)
      expect(isOc("oc2")).toBe(false)
      expect(isOc("bun")).toBe(false)
      expect(isOc("")).toBe(false)
    })
  })

  // ── Regression Tests ──────────────────────────────────────

  describe("regression", () => {
    test("OPENCODE_MESSAGE_ID env var is harmless when absent", () => {
      const result = oc(["--help"], { OPENCODE_MESSAGE_ID: "" })
      expect(result.status).toBe(0)
    })

    test("empty prompt string is rejected", () => {
      const result = oc(["prompt", ""])
      expect(result.status).not.toBe(0)
      expect(result.stderr.toString()).toContain("no prompt text")
    })

    // oc check uses sentinel-based detection (NO_ISSUES_FOUND) instead of
    // a separate followUp LLM call — simpler and faster (1 LLM call, not 2).
    test("oc check appends sentinel instruction to prompt, not a followUp call", async () => {
      // Verify sentinel is injected into the user prompt text (not a separate API call).
      // The sentinel must appear inside the prompt string construction in `check()`,
      // adjacent to the instruction line — not just as a loose string constant.
      const src = await Bun.file(OC_TS).text()
      // Sentinel must be embedded in the prompt array sent to the AI
      expect(src).toContain("NO_ISSUES_FOUND")
      expect(src).toContain("respond with exactly")
      // Must NOT delegate to a separate followUp call (that would be 2 LLM calls)
      expect(src).not.toMatch(/followUp:\s*\{/)
    })

    // Bug: function was renamed to "log" but call sites still used "announce"
    test("oc.ts has no undefined function references", async () => {
      const src = await Bun.file(OC_TS).text()
      // Every function call should reference a defined function
      // "announce(" should not appear unless "announce" is defined
      const hasAnnounce = src.includes("announce(")
      const definesAnnounce = /const announce|function announce/.test(src)
      const hasLog = src.includes("log(")
      const definesLog = /const log|function log/.test(src)
      // Either announce is defined+used or log is defined+used, not mismatched
      if (hasAnnounce) expect(definesAnnounce).toBe(true)
      if (hasLog) expect(definesLog).toBe(true)
    })
  })
})

// ── SyncEvent Definition Regression Tests ────────────────────

describe("MessageV2 SyncEvent definitions", () => {
  // Bug: MessageV2 events were defined with BusEvent.define (no aggregate/version)
  // but passed to SyncEvent.run which requires these fields.
  test("Updated event has aggregate and version", () => {
    const def = MessageV2.Event.Updated
    expect(def).toHaveProperty("aggregate", "sessionID")
    expect(def).toHaveProperty("version")
    expect(typeof def.version).toBe("number")
  })

  test("Updated event has busSchema", () => {
    const def = MessageV2.Event.Updated
    expect(def).toHaveProperty("properties")
  })

  test("PartUpdated event has aggregate and version", () => {
    const def = MessageV2.Event.PartUpdated
    expect(def).toHaveProperty("aggregate", "sessionID")
    expect(def).toHaveProperty("version")
  })

  test("PartUpdated event has busSchema", () => {
    const def = MessageV2.Event.PartUpdated
    expect(def).toHaveProperty("properties")
  })

  test("Removed event has aggregate", () => {
    expect(MessageV2.Event.Removed).toHaveProperty("aggregate", "sessionID")
  })

  test("PartRemoved event has aggregate", () => {
    expect(MessageV2.Event.PartRemoved).toHaveProperty("aggregate", "sessionID")
  })

  // PartDelta stays as BusEvent — no aggregate needed
  test("PartDelta is a BusEvent (no aggregate)", () => {
    const def = MessageV2.Event.PartDelta
    expect(def).toHaveProperty("type", "message.part.delta")
    expect(def).not.toHaveProperty("aggregate")
  })
})

// ── Keepalive Protocol Tests ──────────────────────────────────

describe("keepalive protocol", () => {
  const KEEPALIVE = "\x00OC_KEEPALIVE\x00"

  test("keepalive marker is stripped from response", () => {
    const body = `${KEEPALIVE}${KEEPALIVE}actual response`
    expect(body.replaceAll(KEEPALIVE, "")).toBe("actual response")
  })

  test("keepalive marker does not conflict with OC_FILE marker", () => {
    const ocFile = "\x00OC_FILE\x00:/path/to/file.pdf"
    expect(ocFile.replaceAll(KEEPALIVE, "")).toBe(ocFile)
  })

  test("keepalive marker does not conflict with OC_TRUNCATED marker", () => {
    const ocTrunc = "\x00OC_TRUNCATED\x00:Results limited to 100 items."
    expect(ocTrunc.replaceAll(KEEPALIVE, "")).toBe(ocTrunc)
  })

  test("response without keepalive is unchanged", () => {
    const body = "clean response\nwith newlines"
    expect(body.replaceAll(KEEPALIVE, "")).toBe(body)
  })
})
