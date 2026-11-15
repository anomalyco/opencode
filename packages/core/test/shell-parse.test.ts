import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import os from "os"
import path from "path"
import { ShellParse } from "@opencode/core/shell/parse"

describe("ShellParse", () => {
  test("splits bash commands and derives reusable prefixes", async () => {
    const result = await Effect.runPromise(
      ShellParse.scan("git status && npm run test -- --watch", "/bin/bash", "/workspace"),
    )
    expect(result).toEqual({
      commands: [
        { resource: "git status", save: "git status *" },
        { resource: "npm run test -- --watch", save: "npm run test *" },
      ],
      directories: [],
    })
  })

  test("rejects malformed syntax with an explicit scanner error", async () => {
    const malformed = await Effect.runPromiseExit(ShellParse.scan('echo "', "/bin/bash", "/workspace"))
    expect(malformed).toMatchObject({
      _tag: "Failure",
      cause: {
        reasons: [
          {
            _tag: "Fail",
            error: { message: expect.stringContaining("Portable shell scanner cannot analyze command") },
          },
        ],
      },
    })
  })

  test("preserves command resources and directories across compound forms", async () => {
    const commands = [
      "git status && npm run test -- --watch",
      "echo $(curl evil | sed s/x/y/)",
      "cd /tmp/$USER && git status",
      "if true; then printf yes; else printf no; fi",
      "if true; then export X=$(printf value); unset X; fi",
      "if export X=$(printf value); then printf done; fi",
      "export X=value >$(printf output)",
      "echo $((1 + 1))",
      "cd ~; cd src&&cd ..; pwd",
    ]

    for (const command of commands) {
      const scanned = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
      expect(scanned.commands.length).toBeGreaterThan(0)
    }
  })

  test("handles heredocs with the command permission resource", async () => {
    const command = "cat <<'EOF'\nstatic body\nEOF"
    const scanned = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
    expect(scanned).toEqual({
      commands: [{ resource: command, save: "cat *" }],
      directories: [],
    })
  })

  test.each(['c"\\d" relative', "'cd' /tmp", "c''d /tmp", "c\\\nd /tmp"])(
    "keeps source-shaped command heads under shell authorization: %s",
    async (command) => {
      const scanned = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
      expect(scanned.commands.map((item) => item.resource)).toEqual([command])
      expect(scanned.directories).toEqual([])
    },
  )

  test.each(["declare", "typeset", "export", "readonly", "local", "unset", "unsetenv"])(
    "preserves declaration permission behavior for %s without hiding nested commands",
    async (name) => {
      for (const command of [`${name} X`, `${name} "$(printf X)"; git status`]) {
        const scanned = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
        expect(scanned.commands).toEqual(
          command.includes("$(")
            ? [
                { resource: "printf X", save: "printf *" },
                { resource: "git status", save: "git status *" },
              ]
            : [],
        )
      }

      for (const command of [`"${name}" X`, `FOO=bar ${name} X`, `command ${name} X`, `>${name}.txt ${name} X`]) {
        const scanned = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
        expect(scanned.commands).toHaveLength(1)
      }
    },
  )

  test("declaration filtering retains directory checks inside command substitutions", async () => {
    const command = "export X=$(cd /outside; printf value)"
    const expected = { commands: [{ resource: "printf value", save: "printf *" }], directories: ["/outside"] }
    expect(await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))).toEqual(expected)
  })

  test("does not treat PowerShell commands as Bash declarations", async () => {
    expect(await Effect.runPromise(ShellParse.scan("export X; unset X", "pwsh", "/workspace"))).toEqual({
      commands: [
        { resource: "export X", save: "export *" },
        { resource: "unset X", save: "unset *" },
      ],
      directories: [],
    })
  })

  test("splits PowerShell commands case-insensitively", async () => {
    const result = await Effect.runPromise(
      ShellParse.scan(
        "Get-ChildItem; Write-Output 'done'",
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        "C:\\workspace",
      ),
    )
    expect(result.commands).toEqual([
      { resource: "Get-ChildItem", save: "Get-ChildItem *" },
      { resource: "Write-Output 'done'", save: "Write-Output *" },
    ])
  })

  test("does not permission directory changes separately", async () => {
    const result = await Effect.runPromise(ShellParse.scan("cd 'src dir' && git status", "/bin/bash", "/workspace"))
    expect(result).toEqual({
      commands: [{ resource: "git status", save: "git status *" }],
      directories: ["src dir"],
    })
  })

  test("extracts static directory targets across escapes, end-of-options, literal dollars, and precommands", async () => {
    const escaped = await Effect.runPromise(
      ShellParse.scan(
        'cd .\\./outside && cd escaped\\ space && cd \'../$literal\' && cd "../\\$literal2" && cd before\\\nafter',
        "/bin/bash",
        "/workspace",
      ),
    )
    expect(escaped.directories).toEqual(["../outside", "escaped space", "../$literal", "../$literal2", "beforeafter"])

    const dashArgs = await Effect.runPromise(
      ShellParse.scan("cd -P /first && cd -- -/../../../etc && cd -", "/bin/bash", "/workspace"),
    )
    expect(dashArgs.directories).toEqual(["/first", "-/../../../etc"])

    const wrapped = await Effect.runPromise(
      ShellParse.scan("command cd /outside; builtin cd /elsewhere; command -v cd", "/bin/bash", "/workspace"),
    )
    expect(wrapped).toEqual({
      commands: [
        { resource: "command cd /outside", save: "command *" },
        { resource: "builtin cd /elsewhere", save: "builtin *" },
        { resource: "command -v cd", save: "command *" },
      ],
      directories: ["/outside", "/elsewhere"],
    })

    if (process.platform !== "win32") {
      const rootHome = await Effect.runPromise(
        ShellParse.scan("cd ~root/secret && cd '~root'", "/bin/bash", "/workspace"),
      )
      expect(rootHome.directories).toEqual([
        process.platform === "darwin" ? "/var/root/secret" : "/root/secret",
        "~root",
      ])

      const tildeForms = await Effect.runPromise(
        ShellParse.scan(
          "cd ~+/../outside && cd ~- && cd ~+1 && cd ~0 && cd ~__opencode_nonexistent_user__",
          "/bin/bash",
          "/workspace",
        ),
      )
      expect(tildeForms.directories).toEqual(["/outside"])
      expect(tildeForms.commands).toEqual([
        { resource: "cd ~-", save: "cd *" },
        { resource: "cd ~+1", save: "cd *" },
        { resource: "cd ~0", save: "cd *" },
        { resource: "cd ~__opencode_nonexistent_user__", save: "cd *" },
      ])

      const dynamicCd = await Effect.runPromise(
        ShellParse.scan("cd {..,x} && cd .[.] && cd .? && cd $'\\x2e'[.] && cd '.[.]'", "/bin/bash", "/workspace"),
      )
      expect(dynamicCd.directories).toEqual([".[.]"])
      expect(dynamicCd.commands).toEqual([
        { resource: "cd {..,x}", save: "cd *" },
        { resource: "cd .[.]", save: "cd *" },
        { resource: "cd .?", save: "cd *" },
        { resource: "cd $'\\x2e'[.]", save: "cd *" },
      ])

      const nobodyHome = await Effect.runPromise(
        ShellParse.scan("cd ~nobody", "/bin/bash", "/workspace"),
      )
      expect(nobodyHome.directories).toHaveLength(1)
      expect(nobodyHome.directories[0]).not.toBe(
        path.join(process.platform === "darwin" ? "/Users" : "/home", "nobody"),
      )
    }
  })

  test("retains commandless redirects, redirected declarations, and PowerShell method calls as permission resources", async () => {
    const redirects = await Effect.runPromise(
      ShellParse.scan(">> ~/.zshrc <<< 'x'; export -p > ~/.bashrc", "/bin/zsh", "/workspace"),
    )
    expect(redirects).toEqual({
      commands: [
        { resource: ">> ~/.zshrc <<< 'x'", save: ">> *" },
        { resource: "export -p > ~/.bashrc", save: "export *" },
      ],
      directories: [],
      writes: [path.join(os.homedir(), ".zshrc"), path.join(os.homedir(), ".bashrc")],
    })

    const methods = await Effect.runPromise(
      ShellParse.scan('[IO.File]::Delete("C:\\victim"); $proc.Kill(); "x" >> ~/.bashrc', "pwsh", "C:\\workspace"),
    )
    expect(methods).toEqual({
      commands: [
        { resource: '[IO.File]::Delete("C:\\victim")', save: "[IO.File]::Delete(*" },
        { resource: "$proc.Kill()", save: "$proc.Kill(*" },
        { resource: '"x" >> ~/.bashrc', save: '"x" *' },
      ],
      directories: [],
      writes: [path.join(os.homedir(), ".bashrc")],
    })
  })

  test("extracts the paths a command redirects output into", async () => {
    const writes = async (command: string, shell = "/bin/bash", cwd = "/workspace") =>
      (await Effect.runPromise(ShellParse.scan(command, shell, cwd))).writes

    expect(await writes("git status > /tmp/x")).toEqual(["/tmp/x"])
    expect(await writes("git status >> out")).toEqual(["out"])
    expect(await writes("git status 2> err")).toEqual(["err"])
    expect(await writes("git status &> out")).toEqual(["out"])
    expect(await writes("git status >| out")).toEqual(["out"])
    expect(await writes("git status <> both")).toEqual(["both"])
    expect(await writes("git status > 'out file'")).toEqual(["out file"])
    expect(await writes("git status > ~/out")).toEqual([path.join(os.homedir(), "out")])
    expect(await writes("git status > a > b")).toEqual(["a", "b"])
    expect(await writes("printf hello | cat > marker")).toEqual(["marker"])
    expect(await writes("> out")).toEqual(["out"])
    expect(await writes("Write-Output hi > out.txt", "pwsh", "C:\\workspace")).toEqual(["out.txt"])

    // Descriptor duplication, here-documents, here-strings, and read redirects name no path the command writes.
    expect(await writes("git status 2>&1")).toBeUndefined()
    expect(await writes("git status >&2")).toBeUndefined()
    expect(await writes("git status < in")).toBeUndefined()
    expect(await writes("cat <<< 'x'")).toBeUndefined()
    expect(await writes("cat <<'EOF'\nbody\nEOF")).toBeUndefined()
    expect(await writes("Get-ChildItem 2>&1", "pwsh", "C:\\workspace")).toBeUndefined()
    expect(await writes("git status")).toBeUndefined()
  })

  test("leaves the null and standard devices out of the written paths", async () => {
    const scan = async (command: string, shell = "/bin/bash", cwd = "/workspace") =>
      Effect.runPromise(ShellParse.scan(command, shell, cwd))

    for (const command of ["ls nope 2>/dev/null", "ls > /dev/null", "ls > /dev/stdout", "ls > /dev/stderr", "ls > /dev/tty"])
      expect(await scan(command), command).toEqual({ commands: expect.any(Array), directories: [] })

    expect(await scan("Write-Output hi > $null", "pwsh", "C:\\workspace")).toEqual({
      commands: expect.any(Array),
      directories: [],
    })
    expect(await scan("Write-Output hi > NUL", "pwsh", "C:\\workspace")).toEqual({
      commands: expect.any(Array),
      directories: [],
    })

    // Real devices and descriptors stay gated.
    expect((await scan("ls > /dev/sda")).writes).toEqual(["/dev/sda"])
    expect((await scan("ls > /dev/fd/2")).writes).toEqual(["/dev/fd/2"])
    expect((await scan("ls > /dev/nullx")).writes).toEqual(["/dev/nullx"])
  })

  test("marks a redirect target it cannot attribute to a path as unresolved", async () => {
    const unresolved = async (command: string, shell = "/bin/bash", cwd = "/workspace") =>
      (await Effect.runPromise(ShellParse.scan(command, shell, cwd))).writesUnresolved

    // Targets the shell only knows at run time.
    expect(await unresolved("git status > $HOME/out")).toBe(true)
    expect(await unresolved("git status > $(printf out)")).toBe(true)
    expect(await unresolved('M=~/.bashrc; git status > "$M"')).toBe(true)

    // A directory change rebases later relative targets, which the scan cannot follow.
    expect(await unresolved("cd sub && cmd > x")).toBe(true)
    expect(await unresolved("cd sub; cmd > x")).toBe(true)
    expect(await unresolved("cd /tmp && cmd > x")).toBe(true)

    // Absolute targets and targets before the change keep their own path.
    expect(await unresolved("cd sub && cmd > /tmp/x")).toBeUndefined()
    expect(await unresolved("cd sub && cmd > ~/x")).toBeUndefined()
    expect(await unresolved("cmd > x && cd sub")).toBeUndefined()
    expect(await unresolved("cmd > x")).toBeUndefined()
  })

  test("extracts PowerShell directory parameters", async () => {
    const result = await Effect.runPromise(
      ShellParse.scan("Set-Location -LiteralPath '..\\outside'; Get-ChildItem", "pwsh", "C:\\workspace"),
    )
    expect(result.directories).toEqual(["..\\outside"])
  })

  test("expands deterministic directory variables", async () => {
    const bash = await Effect.runPromise(ShellParse.scan("cd ~/src", "/bin/bash", "/workspace"))
    expect(bash.directories).toEqual([path.join(os.homedir(), "src")])

    const backslash = await Effect.runPromise(ShellParse.scan("cd '~\\src'", "/bin/bash", "/workspace"))
    expect(backslash.directories).toEqual(
      process.platform === "win32" ? [path.join(os.homedir(), "src")] : ["~\\src"],
    )

    const powershell = await Effect.runPromise(
      ShellParse.scan('Set-Location "$PWD/src"; Set-Location $PSHOME', "/usr/local/bin/pwsh", "/workspace"),
    )
    expect(powershell.directories).toEqual(["/workspace/src", "/usr/local/bin"])
  })
})
