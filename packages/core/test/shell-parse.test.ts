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
    })
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

  test("derives reusable prefixes for escalation wrappers", async () => {
    const dumpsys = await Effect.runPromise(
      ShellParse.scan("sudo dumpsys service | grep -E pattern", "/bin/bash", "/workspace"),
    )
    expect(dumpsys.commands[0]?.save).toBe("sudo dumpsys *")

    const ls = await Effect.runPromise(ShellParse.scan("sudo ls", "/bin/bash", "/workspace"))
    expect(ls.commands[0]?.save).toBe("sudo ls *")
  })

  test("unwraps sudo and doas options before the wrapped command's prefix", async () => {
    const sudoUser = await Effect.runPromise(ShellParse.scan("sudo -u root rm -rf /", "/bin/bash", "/workspace"))
    expect(sudoUser.commands[0]?.save).toBe("sudo -u root rm *")

    const sudoEnv = await Effect.runPromise(ShellParse.scan("sudo -E apt install x", "/bin/bash", "/workspace"))
    expect(sudoEnv.commands[0]?.save).toBe("sudo -E apt install *")

    const doasUser = await Effect.runPromise(
      ShellParse.scan("doas -u root git push origin", "/bin/bash", "/workspace"),
    )
    expect(doasUser.commands[0]?.save).toBe("doas -u root git push *")

    const sudoAssign = await Effect.runPromise(
      ShellParse.scan("sudo FOO=bar rm -rf /", "/bin/bash", "/workspace"),
    )
    expect(sudoAssign.commands[0]?.save).toBe("sudo FOO=bar rm *")
  })

  test("saves the exact command when a wrapper's options cannot be unwrapped", async () => {
    const su = await Effect.runPromise(ShellParse.scan("su -c 'rm -rf /'", "/bin/bash", "/workspace"))
    expect(su.commands).toEqual([{ resource: "su -c 'rm -rf /'", save: "su -c 'rm -rf /'" }])

    const bash = await Effect.runPromise(ShellParse.scan('sudo bash -c "rm -rf /"', "/bin/bash", "/workspace"))
    expect(bash.commands).toEqual([{ resource: 'sudo bash -c "rm -rf /"', save: 'sudo bash -c "rm -rf /"' }])

    const bashPath = await Effect.runPromise(ShellParse.scan('sudo /bin/bash -c "rm -rf /"', "/bin/bash", "/workspace"))
    expect(bashPath.commands).toEqual([{ resource: 'sudo /bin/bash -c "rm -rf /"', save: 'sudo /bin/bash -c "rm -rf /"' }])

    const pythonVersion = await Effect.runPromise(
      ShellParse.scan('sudo python3.13 -c "print(1)"', "/bin/bash", "/workspace"),
    )
    expect(pythonVersion.commands).toEqual([
      { resource: 'sudo python3.13 -c "print(1)"', save: 'sudo python3.13 -c "print(1)"' },
    ])
  })

  test("normalizes a path-qualified escalation wrapper before the wrapper check", async () => {
    const nested = await Effect.runPromise(ShellParse.scan("sudo /usr/bin/sudo rm -rf /", "/bin/bash", "/workspace"))
    expect(nested.commands[0]?.save).toBe("sudo /usr/bin/sudo rm *")

    const direct = await Effect.runPromise(ShellParse.scan("/usr/bin/sudo rm -rf /", "/bin/bash", "/workspace"))
    expect(direct.commands[0]?.save).toBe("/usr/bin/sudo rm *")
  })

  test("normalizes a quoted escalation wrapper before the wrapper check", async () => {
    const quotedPath = await Effect.runPromise(ShellParse.scan('"/usr/bin/sudo" rm -rf /', "/bin/bash", "/workspace"))
    expect(quotedPath.commands[0]?.save).toBe('"/usr/bin/sudo" rm *')

    const quotedBare = await Effect.runPromise(ShellParse.scan('"sudo" rm -rf /', "/bin/bash", "/workspace"))
    expect(quotedBare.commands[0]?.save).toBe('"sudo" rm *')

    const trailingSlash = await Effect.runPromise(ShellParse.scan("/usr/bin/sudo/ rm -rf /", "/bin/bash", "/workspace"))
    expect(trailingSlash.commands[0]?.save).toBe("/usr/bin/sudo/ rm *")

    const quotedArity = await Effect.runPromise(ShellParse.scan('"git" status', "/bin/bash", "/workspace"))
    expect(quotedArity.commands[0]?.save).toBe('"git" status *')

    const interiorQuotes = await Effect.runPromise(ShellParse.scan('s""udo rm -rf /', "/bin/bash", "/workspace"))
    expect(interiorQuotes.commands[0]?.save).toBe('s""udo rm *')

    const quotedOption = await Effect.runPromise(
      ShellParse.scan('"/usr/bin/sudo" "-u" root rm -rf /', "/bin/bash", "/workspace"),
    )
    expect(quotedOption.commands[0]?.save).toBe('"/usr/bin/sudo" "-u" root rm *')
  })

  test("saves nothing when the exact command contains a wildcard character", async () => {
    // Wildcard.match has no escape for `*` or `?`, so an exact save containing them would still match other
    // commands; the caller persists no rule when the save is empty.
    const star = await Effect.runPromise(ShellParse.scan("sudo bash -c 'rm /tmp/*.log'", "/bin/bash", "/workspace"))
    expect(star.commands).toEqual([{ resource: "sudo bash -c 'rm /tmp/*.log'", save: "" }])

    const question = await Effect.runPromise(ShellParse.scan("su -c 'rm /tmp/file?.log'", "/bin/bash", "/workspace"))
    expect(question.commands).toEqual([{ resource: "su -c 'rm /tmp/file?.log'", save: "" }])
  })
})
