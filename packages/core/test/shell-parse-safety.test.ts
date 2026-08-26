import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "../src/shell/parse.js"

describe("portable shell authorization", () => {
  test("preserves legacy Zsh chdir directory authorization", async () => {
    const result = await Effect.runPromise(ShellParse.scan("chdir /outside; pwd", "zsh", "/workspace"))
    expect(result.directories).toEqual(["/outside"])
    expect(result.commands.map((item) => item.resource)).toEqual(["pwd"])
  })

  test.each([
    ["pwsh", "Write-Output ok\rRemove-Item victim", ["Write-Output ok", "Remove-Item victim"]],
    ["pwsh", "ForEach-Object { Remove-Item victim }", ["ForEach-Object { Remove-Item victim }", "Remove-Item victim"]],
    ["bash", "printf ok && git status > output", ["printf ok", "git status > output"]],
    ["bash", "printf ok | cat < input > output", ["printf ok", "cat < input > output"]],
    ["bash", "cd /workspace > output", ["cd /workspace > output"]],
  ])("retains every command and redirection: %s %s", async (shell, command, resources) => {
    const result = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace", { portable: true, env: {} }))
    expect(result.analysis).toBe("complete")
    expect(result.commands.map((item) => item.resource)).toEqual(resources)
  })

  test.each([
    "cd $DESTINATION",
    "cd -",
    "pushd",
    "popd",
    "cd */outside",
    "cd a && cd ../outside",
    "cd -P symlink/..",
    "CDPATH=/outside cd child",
    "export CDPATH=/outside; cd child",
    "printf -vHOME /etc; cd",
    "printf -v HOME /etc; cd",
    "command cd /outside",
    "builtin cd /outside",
    "command builtin cd /outside",
    "builtin command cd /outside",
  ])("keeps explicit commands visible when directory analysis is uncertain: %s", async (source) => {
    const result = await Effect.runPromise(
      ShellParse.scan(`${source}; rm victim`, "bash", "/workspace", { portable: true, env: { HOME: "/workspace" } }),
    )
    expect(result.analysis).toBe("complete")
    expect(result.directoryUnknown).toBe(true)
    expect(result.commands).toContainEqual({ resource: "rm victim", save: "rm *" })
    expect(result.commands.length).toBeGreaterThan(1)
  })

  test.each([
    "Set-Location $target",
    "cd $HOME",
    "chdir $env:TEMP",
    "sl $target",
    "Microsoft.PowerShell.Management\\sl $target",
    "Push-Location /outside",
    "pushd /outside",
    "Pop-Location",
    "popd",
    "Microsoft.PowerShell.Management\\Pop-Location",
    "Set-Location -",
    "Set-Location +",
    "Set-Location -StackName old",
    "Set-Location -st old",
    "Set-Location -p:/outside",
    "Set-Location -Path:C:relative",
    "Set-Location C:relative",
    "Set-Location Registry::HKEY_CURRENT_USER",
    "Set-Location */outside",
    "Set-Location 'one'two",
    "Set-Location /outside; Set-Location ../elsewhere",
  ])("preserves PowerShell commands independently of unresolved directory policy: %s", async (command) => {
    const result = await Effect.runPromise(
      ShellParse.scan(`${command}; Remove-Item victim`, "pwsh", "/workspace", { portable: true, env: {} }),
    )
    expect(result.analysis).toBe("complete")
    expect(result.directoryUnknown).toBe(true)
    expect(result.commands).toContainEqual({ resource: "Remove-Item victim", save: "Remove-Item *" })
    expect(result.commands.length).toBeGreaterThan(1)
  })

  test.each(["bash", "dash", "sh", "powershell", "pwsh"])(
    "supports the tested interpreter families: %s",
    async (shell) => {
      const result = await Effect.runPromise(
        ShellParse.scan("git status", shell, "/workspace", { portable: true, env: {} }),
      )
      expect(result).toEqual({
        commands: [{ resource: "git status", save: "git status *" }],
        directories: [],
        analysis: "complete",
        directoryUnknown: false,
      })
    },
  )

  test.each(["CDPATH=/usr; cd bin; rm victim", "HOME=/etc; cd; rm victim"])(
    "keeps standalone assignment-state boundaries opaque: %s",
    async (command) => {
      const result = await Effect.runPromise(
        ShellParse.scan(command, "bash", "/workspace", { portable: true, env: { HOME: "/workspace" } }),
      )
      expect(result).toEqual({
        commands: [{ resource: command }],
        directories: [],
        analysis: "opaque",
        directoryUnknown: true,
      })
    },
  )

  test.each([
    ["bash", "cd 'src dir'", "src dir"],
    ["bash", "c''d /outside", "/outside"],
    ["bash", "cd escaped\\ space", "escaped space"],
    ["pwsh", "sl -LiteralPath '../outside'", "../outside"],
    ["pwsh", "Set-Location -Path '../outside'", "../outside"],
    ["pwsh", "Microsoft.PowerShell.Management\\Set-Location ../outside", "../outside"],
  ])("uses decoded literal directory operands without dropping commands: %s %s", async (shell, command, directory) => {
    const result = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace", { portable: true, env: {} }))
    expect(result.directories).toEqual([directory])
    expect(result.directoryUnknown).toBe(false)
    expect(result.commands.map((item) => item.resource)).toEqual([command])
  })

  test.each(["cd '$HOME'", "cd '~/outside'", "cd '*/outside'", "cd /tmp/$USER"])(
    "does not guess expansions from decoded directory words: %s",
    async (command) => {
      const result = await Effect.runPromise(
        ShellParse.scan(`${command}; rm victim`, "bash", "/workspace", { portable: true, env: { HOME: "/workspace" } }),
      )
      expect(result.analysis).toBe("complete")
      expect(result.directoryUnknown).toBe(true)
      expect(result.directories).toEqual([])
      expect(result.commands.map((item) => item.resource)).toEqual([command, "rm victim"])
    },
  )

  test("distinguishes CDPATH-dependent operands from explicit relative paths", async () => {
    for (const [command, directory] of [
      ["cd child", undefined],
      ["cd ./child", "./child"],
      ["cd ../child", "../child"],
    ] as const) {
      const result = await Effect.runPromise(
        ShellParse.scan(command, "bash", "/workspace", { portable: true, env: { CDPATH: "/outside" } }),
      )
      expect(result.analysis).toBe("complete")
      expect(result.commands.map((item) => item.resource)).toEqual([command])
      expect(result.directories).toEqual(directory ? [directory] : [])
      expect(result.directoryUnknown).toBe(!directory)
    }
  })

  test.each([
    "git '*'",
    "git '?'",
    "npm run '$TASK'",
    "'weird*command' value",
    "'git status' value",
    "git 'two words'",
  ])("does not turn unsafe decoded prefix tokens into permission globs: %s", async (command) => {
    const result = await Effect.runPromise(ShellParse.scan(command, "bash", "/workspace", { portable: true, env: {} }))
    expect(result.commands.every((item) => item.save === undefined)).toBe(true)
  })

  test.each(["git $(printf status) diff", "git <(printf status) diff", "git `printf status` diff"])(
    "never drops substitutions to derive a later saved prefix: %s",
    async (command) => {
      const result = await Effect.runPromise(
        ShellParse.scan(command, "bash", "/workspace", { portable: true, env: {} }),
      )
      expect(result.commands[0]).toEqual({ resource: command })
      expect(result.commands.map((item) => item.resource)).toContain("printf status")
    },
  )

  test.each([
    ["bash", "echo ok", { BASH_ENV: "/startup" }],
    ["bash", "echo ok", { "BASH_FUNC_cd%%": "() { :; }" }],
    ["ksh", "echo ok", { ENV: "/startup" }],
    ["ksh", "echo ok", {}],
    ["zsh", "echo ok", {}],
    ["cmd.exe", "echo ok & echo hidden", {}],
    ["bash", "cat <<'EOF'\nstatic body\nEOF", {}],
    ["bash", "echo $((1 + $(printf hidden)))", {}],
  ] as const)("never offers a saved pattern for opaque input: %s %s", async (shell, command, env) => {
    const result = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace", { portable: true, env }))
    expect(result).toEqual({
      commands: [{ resource: command }],
      directories: [],
      analysis: "opaque",
      directoryUnknown: true,
    })
  })

  test.each([false, true])(
    "keeps PowerShell-only location aliases under Bash authorization (portable=%s)",
    async (portable) => {
      for (const command of ["sl .", "chdir .", "Set-Location .", "pop-location"]) {
        const result = await Effect.runPromise(ShellParse.scan(command, "bash", "/workspace", { portable, env: {} }))
        expect(result.commands).toEqual([{ resource: command, save: `${command.split(" ")[0]} *` }])
        expect(result.directories).toEqual([])
      }
    },
  )
})
