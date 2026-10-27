import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import os from "os"
import path from "path"
import { ShellParse } from "@opencode/core/shell/parse"
import { shellParserWasm } from "../src/shell/parser-wasm.workerd"

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

  test("defaults to portable scanning when parser wasm assets are empty", async () => {
    const result = await Effect.runPromise(
      ShellParse.scan("git status && npm run test -- --watch", "/bin/bash", "/workspace", {
        wasm: shellParserWasm,
      }),
    )
    expect(result).toEqual({
      commands: [
        { resource: "git status", save: "git status *" },
        { resource: "npm run test -- --watch", save: "npm run test *" },
      ],
      directories: [],
    })
    const malformed = await Effect.runPromiseExit(
      ShellParse.scan('echo "', "/bin/bash", "/workspace", { wasm: shellParserWasm }),
    )
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

  test("portable scanning preserves supported command resources and directories", async () => {
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
      const legacy = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
      const portable = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))
      expect(portable, command).toEqual(legacy)
      expect(await Effect.runPromise(ShellParse.scanPortable(command, "/bin/bash", "/workspace"))).toEqual(portable)
    }
  })

  test("portable scanning handles heredocs with the existing permission resource", async () => {
    const command = "cat <<'EOF'\nstatic body\nEOF"
    const legacy = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
    expect(legacy.commands).toEqual([{ resource: command, save: "cat *" }])
    expect(await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))).toEqual(
      legacy,
    )
  })

  test.each(['c"\\d" relative', "'cd' /tmp", "c''d /tmp", "c\\\nd /tmp"])(
    "portable scanning keeps source-shaped command heads under shell authorization: %s",
    async (command) => {
      const portable = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))
      expect(portable.commands.map((item) => item.resource)).toEqual([command])
      expect(portable.directories).toEqual([])
    },
  )

  test.each(["declare", "typeset", "export", "readonly", "local", "unset", "unsetenv"])(
    "preserves declaration permission behavior for %s without hiding nested commands",
    async (name) => {
      for (const command of [`${name} X`, `${name} "$(printf X)"; git status`]) {
        const legacy = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
        expect(legacy.commands).toEqual(
          command.includes("$(")
            ? [
                { resource: "printf X", save: "printf *" },
                { resource: "git status", save: "git status *" },
              ]
            : [],
        )
        expect(
          await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true })),
        ).toEqual(legacy)
      }

      for (const command of [`"${name}" X`, `FOO=bar ${name} X`, `command ${name} X`, `>${name}.txt ${name} X`]) {
        const legacy = await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))
        expect(legacy.commands).toHaveLength(1)
        expect(
          await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true })),
        ).toEqual(legacy)
      }
    },
  )

  test("declaration filtering retains directory checks inside command substitutions", async () => {
    const command = "export X=$(cd /outside; printf value)"
    const expected = { commands: [{ resource: "printf value", save: "printf *" }], directories: ["/outside"] }
    expect(await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace"))).toEqual(expected)
    expect(await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable: true }))).toEqual(
      expected,
    )
  })

  test("does not treat PowerShell commands as Bash declarations", async () => {
    expect(await Effect.runPromise(ShellParse.scanPortable("export X; unset X", "pwsh", "/workspace"))).toEqual({
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

  test.each([
    ["git -C /outside status", ["/outside"], "git -C *"],
    ["git '-C' /tmp status", ["/tmp"], "git '-C' *"],
    ["git -C=/tmp status", ["/tmp"], "git -C=/tmp *"],
    ["git -C a -C b status", ["a", path.join("a", "b")], "git -C *"],
    ["git -Ca -Cb status", ["a", path.join("a", "b")], "git -Ca *"],
    ["git -C a -C /outside status", ["a", "/outside"], "git -C *"],
    ["git commit -C HEAD", [], "git commit *"],
    ["git -c user.name=x -C /outside log", ["/outside"], "git -c *"],
    [
      "git --namespace name --config-env user.name=NAME --super-prefix prefix -C /outside log",
      ["/outside"],
      "git --namespace *",
    ],
    ["git --exec-path=/exec --list-cmds=main -C /outside log", ["/outside"], "git --exec-path=/exec *"],
    ["git --exec-path status -C /outside", [], "git --exec-path *"],
    ["git --git-dir /outside status", ["/outside"], "git --git-dir *"],
    ["git --git-dir=/outside status", ["/outside"], "git --git-dir=/outside *"],
    ["git --work-tree /outside status", ["/outside"], "git --work-tree *"],
    ["git --work-tree=/outside status", ["/outside"], "git --work-tree=/outside *"],
    [
      "git -C base --git-dir repo --work-tree=tree status",
      ["base", path.join("base", "repo"), path.join("base", "tree")],
      "git -C *",
    ],
    ["make -C /outside", ["/outside"], "make -C *"],
    ["make -C/outside", ["/outside"], "make -C/outside *"],
    ["make -sC /tmp", ["/tmp"], "make -sC *"],
    ["make -kC/tmp", ["/tmp"], "make -kC/tmp *"],
    ["make -sfC/tmp", [], "make -sfC/tmp *"],
    ["make -sjC/tmp", [], "make -sjC/tmp *"],
    ["make --directory /outside", ["/outside"], "make --directory *"],
    ["make --directory=/outside", ["/outside"], "make --directory=/outside *"],
    ["make --di /tmp", ["/tmp"], "make --di *"],
    ["make --di=/tmp", ["/tmp"], "make --di=/tmp *"],
    ["make --director /tmp", ["/tmp"], "make --director *"],
    ["make --director=/tmp", ["/tmp"], "make --director=/tmp *"],
    ["make -C a --directory=b", ["a", path.join("a", "b")], "make -C *"],
    ["gmake target -C/outside", ["/outside"], "gmake *"],
    ["gmake -bsC/tmp", ["/tmp"], "gmake *"],
    ["gmake --dir=/tmp", ["/tmp"], "gmake *"],
    ["npm --prefix /outside install", ["/outside"], "npm --prefix *"],
    ["npm install --prefix=/outside", ["/outside"], "npm install *"],
    ["npm -C /outside install", ["/outside"], "npm -C *"],
    ["npm -C=/tmp install", ["/tmp"], "npm -C=/tmp *"],
    ["pnpm --dir /outside test", ["/outside"], "pnpm --dir *"],
    ["pnpm test --dir=/outside", ["/outside"], "pnpm test *"],
    ["pnpm -C /outside test", ["/outside"], "pnpm -C *"],
    ["yarn --cwd /outside build", ["/outside"], "yarn --cwd *"],
    ["yarn build --cwd=/outside", ["/outside"], "yarn build *"],
    ["bun --cwd /outside run build", ["/outside"], "bun --cwd *"],
    ["go -C /outside test", ["/outside"], "go -C *"],
    ["go test -C /outside", ["/outside"], "go test *"],
    ["go env -C /tmp GOMOD", ["/tmp"], "go env *"],
    ["go test -C=/tmp", ["/tmp"], "go test *"],
    ["go test --C /tmp", ["/tmp"], "go test *"],
    ["go test --C=/tmp", ["/tmp"], "go test *"],
    ["go test -- -C /outside", [], "go test *"],
    ["uv --directory /outside sync", ["/outside"], "uv *"],
    ["uv run --project=/outside python", ["/outside"], "uv *"],
    ["cargo -C /outside build", ["/outside"], "cargo -C *"],
    ["cargo -Z unstable-options -C /x build", ["/x"], "cargo -Z *"],
    ["cargo +nightly -Z unstable-options -C /x build", ["/x"], "cargo +nightly *"],
    ["cargo run -C /outside", ["/outside"], "cargo run -C *"],
    ["cargo --manifest-path /outside/Cargo.toml build", ["/outside"], "cargo --manifest-path *"],
    ["cargo build --manifest-path=/outside/Cargo.toml", ["/outside"], "cargo build *"],
    ["npm run x -- --prefix /outside", [], "npm run x *"],
    ["make -- -C /outside", [], "make -- *"],
    ["git -C $TARGET status", [], "git -C *"],
    ["git -C ${TARGET} status", [], "git -C *"],
    ['git -C "$HOME/x" status', [], "git -C *"],
    ["git -C '`pwd`/x' status", [], "git -C *"],
    ["git -C '$(pwd)/x' status", [], "git -C *"],
    ["git -C '/out side' status", ["/out side"], "git -C *"],
    ['make --directory="/out side"', ["/out side"], 'make --directory="/out side" *'],
    ["sudo git -C /outside status", [], "sudo *"],
  ])("extracts explicit directory flags without changing shell permissions: %s", async (command, directories, save) => {
    for (const portable of [false, true]) {
      expect(await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable }))).toEqual({
        commands: [{ resource: command, save }],
        directories,
      })
    }
  })

  test.each(["git 2>/dev/null -C /tmp status", "git -C 2>/dev/null /tmp status"])(
    "portable scanning extracts directory flags across redirects: %s",
    async (command) => {
      expect(
        (await Effect.runPromise(ShellParse.scanPortable(command, "/bin/bash", "/workspace"))).directories,
      ).toEqual(["/tmp"])
    },
  )

  test.each(["git -C $(pwd) status", "git -C `pwd` status"])(
    "skips substituted directory flags while retaining nested shell permissions: %s",
    async (command) => {
      for (const portable of [false, true]) {
        expect(await Effect.runPromise(ShellParse.scan(command, "/bin/bash", "/workspace", { portable }))).toEqual({
          commands: [
            { resource: command, save: "git -C *" },
            { resource: "pwd", save: "pwd *" },
          ],
          directories: [],
        })
      }
    },
  )

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
