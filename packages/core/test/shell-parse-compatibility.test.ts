import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "../src/shell/parse.js"

describe("portable shell parser compatibility", () => {
  test.each([
    ["bash", "echo $((1+1))", {}],
    ["bash", "echo $((1 + $(printf hidden)))", {}],
    ["bash", "cd ~/project", {}],
    ["bash", "cd src&&cd..", {}],
    ["bash", "cd src && cd .. && git status", {}],
    ["zsh", "git status", {}],
    ["fish", "git status", {}],
    ["bash", "git status", { BASH_ENV: "/startup" }],
    ["bash", "git status", { "BASH_FUNC_cd%%": "() { :; }" }],
    ["bash", "cd $HOME; pwd", { HOME: "/session-home" }],
    ["bash", "cd; pwd", { HOME: "/session-home" }],
    ["bash", 'target=/outside; cd "$target"; pwd', {}],
    ["bash", "cd 'src dir' && git status", {}],
    ["bash", 'cd "src dir"; cd escaped\\ space', {}],
    ["bash", "cd '$HOME'; cd '~/outside'", {}],
    ["bash", "cd before\\\nafter", {}],
    ["bash", 'g""it status', {}],
    ["bash", 'npm "run" test', {}],
    ["bash", "git '*'", {}],
    ["bash", "git $(printf status) diff", {}],
    ["bash", "FOO=bar git status", {}],
    ["bash", "HOME=/outside; cd; pwd", {}],
    ["bash", "CDPATH=/outside cd child", {}],
    ["bash", "cd child; pwd", { CDPATH: "/outside" }],
    ["bash", "FOO=bar > output", {}],
    ["bash", "echo ok; for x in 1; do printf '%s' \"$x\"; done", {}],
    ["bash", "cat <<EOF\n$(printf dynamic)\nEOF", {}],
    ["bash", "printf ok && git status > output", {}],
    ["bash", "printf ok | cat < input > output", {}],
    ["bash", "cd /workspace > output", {}],
    ["bash", "cd -- -/../../../etc; pwd", {}],
    ["bash", "cd -; pushd; popd; pwd", {}],
    ["bash", "command cd /outside; builtin cd /elsewhere", {}],
    ["pwsh", "Write-Output ok\rRemove-Item victim", {}],
    ["pwsh", "ForEach-Object { Remove-Item victim }", {}],
    ["pwsh", "Get-ChildItem | ForEach-Object { Write-Output $_ }", {}],
    ["pwsh", "Set-Location -LiteralPath '../outside'; Get-ChildItem", {}],
    ["pwsh", "Set-Location -LiteralPath:/outside", {}],
    ["pwsh", "Set-Location $HOME; Set-Location $PWD; Set-Location $target", { HOME: "/session-home" }],
    ["pwsh", "Set-Item Env:T /outside; Set-Location $env:T", { T: "/workspace" }],
    ["pwsh", "sl /outside; Microsoft.PowerShell.Management\\Set-Location /outside", {}],
  ] as const)("matches legacy resources, saved prefixes, and directories: %s %s %j", async (shell, command, env) => {
    if (Object.keys(env).length > 0) {
      const child = Bun.spawn({
        cmd: [
          process.execPath,
          "--eval",
          `
          import { Effect } from "effect"
          import { ShellParse } from "./src/shell/parse.ts"
          const command = ${JSON.stringify(command)}
          const shell = ${JSON.stringify(shell)}
          const legacy = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace"))
          const portable = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace", { portable: true }))
          console.log(JSON.stringify([legacy, portable]))
        `,
        ],
        cwd: `${import.meta.dir}/..`,
        env: { ...process.env, ...env },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [output, error, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(code, error).toBe(0)
      const [legacy, portable] = JSON.parse(output)
      expect(portable).toEqual(legacy)
      return
    }
    const legacy = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace"))
    const portable = await Effect.runPromise(ShellParse.scan(command, shell, "/workspace", { portable: true }))
    expect(portable).toEqual(legacy)
  })

  test("derives the legacy prefix for long argument lists", async () => {
    const command = `echo ${"x ".repeat(16_000)}`.trimEnd()
    const result = await Effect.runPromise(ShellParse.scan(command, "bash", "/workspace", { portable: true }))
    expect(result).toEqual({ commands: [{ resource: command, save: "echo *" }], directories: [] })
  })
})

describe("legacy directory command behavior", () => {
  test.each(["bash", "zsh", "pwsh"])("retains the original shared directory command set: %s", async (shell) => {
    const result = await Effect.runPromise(
      ShellParse.scan(
        "chdir /outside; set-location /elsewhere; push-location /stack; sl .; pop-location",
        shell,
        "/workspace",
      ),
    )
    expect(result).toEqual({
      commands: [
        { resource: "sl .", save: "sl *" },
        { resource: "pop-location", save: "pop-location *" },
      ],
      directories: ["/outside", "/elsewhere", "/stack"],
    })
  })
})
