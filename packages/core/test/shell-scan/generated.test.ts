import { describe, expect, test } from "bun:test"
import { ShellScan } from "../../src/shell/scan.js"

const staticCommands = [
  ["git status", ["git", "status"]],
  ["printf ok", ["printf", "ok"]],
  ["curl example.com", ["curl", "example.com"]],
] as const

describe("ShellScan generated properties", () => {
  test("decomposes every combination of static commands and separators", () => {
    const separators = [" ; ", " && ", " || ", " | ", " |& ", "\n"]

    for (const [left, leftWords] of staticCommands) {
      for (const separator of separators) {
        for (const [right, rightWords] of staticCommands) {
          expect(ShellScan.scan(left + separator + right)).toMatchObject({
            kind: "scanned",
            commands: [
              { resource: left, words: [...leftWords] },
              { resource: right, words: [...rightWords] },
            ],
          })
        }
      }
    }
  })

  test("keeps quoted and escaped separators in arguments", () => {
    const literals = [";", "|", "&", "#", "<", ">"]
    const forms = literals.flatMap((literal) => [
      { source: `'left${literal}right'`, word: `left${literal}right` },
      { source: `"left${literal}right"`, word: `left${literal}right` },
      { source: `left\\${literal}right`, word: `left${literal}right` },
    ])

    for (const form of forms) {
      expect(ShellScan.scan(`printf %s ${form.source}`)).toMatchObject({
        kind: "scanned",
        commands: [{ resource: `printf %s ${form.source}`, words: ["printf", "%s", form.word] }],
      })
    }
  })

  test("fails closed when valid commands are mutated with malformed syntax", () => {
    const mutate = [
      (command: string) => `${command} "unterminated`,
      (command: string) => `${command} 'unterminated`,
      (command: string) => `${command} \\`,
      (command: string) => `${command} &&`,
      (command: string) => `| ${command}`,
      (command: string) => `${command} || || printf reached`,
      (command: string) => `${command} >`,
      (command: string) => `${command} > > output`,
    ]

    for (const [command] of staticCommands) {
      for (const mutation of mutate) expect(ShellScan.scan(mutation(command)).kind).toBe("opaque")
    }
  })

  test("retains generated dynamic command heads without resolving them", () => {
    const heads = ["$COMMAND", "${COMMAND}", "pre$COMMAND", '"$COMMAND"', "$(printf git)", "`printf git`"]
    const tails = ["status", "--version", "-rf /"]

    for (const head of heads) {
      for (const tail of tails) {
        const result = ShellScan.scan(`${head} ${tail}`)
        expect(result.kind).toBe("scanned")
        if (result.kind === "opaque") return
        expect(result.commands[0]?.rawWords[0]).toBe(head)
        expect(result.commands[0]?.words[0]).toBe(head.replaceAll('"', ""))
      }
    }
  })

  test("keeps wrappers and shell evaluators at their delegated boundary", () => {
    const prefixes = ["", "FOO=bar ", "FOO=bar BAR=baz "]
    const wrapped = [
      "command git status",
      "builtin printf ok",
      "exec git status",
      "env FOO=bar git status",
      "sudo git status",
      "nice git status",
      "nohup git status",
      "xargs rm",
      "source ./script.sh",
      ". ./script.sh",
      "trap 'git status' EXIT",
      "eval 'git status'",
      "bash -c 'git status'",
      "/bin/sh ./script.sh",
    ]

    for (const prefix of prefixes) {
      for (const command of wrapped) expect(ShellScan.scan(prefix + command).kind).toBe("scanned")
      expect(ShellScan.scan(`${prefix}time git status`).kind).toBe("scanned")
    }
  })
})

describe("ShellScan generated PowerShell properties", () => {
  test("decomposes every combination of static commands and separators", () => {
    const commands = [
      ["Get-ChildItem", ["Get-ChildItem"]],
      ["Write-Output ok", ["Write-Output", "ok"]],
      ["Get-Content input.txt", ["Get-Content", "input.txt"]],
    ] as const
    const separators = ["; ", " | ", "\n"]

    for (const [left, leftWords] of commands) {
      for (const separator of separators) {
        for (const [right, rightWords] of commands) {
          expect(ShellScan.scanPowerShell(left + separator + right)).toMatchObject({
            kind: "scanned",
            commands: [
              { resource: left, words: [...leftWords] },
              { resource: right, words: [...rightWords] },
            ],
          })
        }
      }
    }
  })

  test("keeps quoted and escaped separators in arguments", () => {
    const literals = [";", "|", "&", "#", "<", ">"]
    const forms = literals.flatMap((literal) => [
      { source: `'left${literal}right'`, word: `left${literal}right` },
      { source: `"left${literal}right"`, word: `left${literal}right` },
      { source: `left\`${literal}right`, word: `left${literal}right` },
    ])

    for (const form of forms) {
      expect(ShellScan.scanPowerShell(`Write-Output ${form.source}`)).toMatchObject({
        kind: "scanned",
        commands: [{ resource: `Write-Output ${form.source}`, words: ["Write-Output", form.word] }],
      })
    }
  })

  test("fails closed when valid commands are mutated with malformed syntax", () => {
    const mutations = [
      'Write-Output ok "unterminated',
      "Write-Output ok 'unterminated",
      "Write-Output ok`",
      "Write-Output ok |",
      "Write-Output ok || || Write-Output reached",
      "Write-Output ok >",
    ]

    for (const command of mutations) expect(ShellScan.scanPowerShell(command).kind).toBe("opaque")
  })

  test("distinguishes variable expressions from delegated execution", () => {
    const expressions = ["$Command", "${Command}"]
    const delegated = [
      "& git status",
      "& $Command status",
      ". ./script.ps1",
      "Invoke-Expression 'git status'",
      "iex 'git status'",
      "Import-Module ./module.psm1",
      "./script.ps1 -Force",
    ]
    const shells = ["powershell", "powershell.exe", "pwsh", "pwsh.exe"]
    const switches = ["-Command", "-c", "-EncodedCommand", "-e", "-File", "-f"]

    for (const command of expressions)
      expect(ShellScan.scanPowerShell(command)).toEqual({ kind: "scanned", commands: [] })
    for (const command of delegated) expect(ShellScan.scanPowerShell(command).kind).toBe("scanned")
    for (const shell of shells) {
      for (const flag of switches) {
        expect(ShellScan.scanPowerShell(`${shell} ${flag} 'git status'`).kind).toBe("scanned")
      }
    }
  })

  test("extracts nested commands in directory expressions without evaluating variables", () => {
    const locations = ["Set-Location", "cd", "chdir", "sl", "Push-Location"]
    const expressions = ["$(Resolve-Path ..)", "(Resolve-Path ..)"]
    const variables = ["$target", "$PWD/project", "$HOME/project", "$PSHOME/Modules", "$env:TEMP/project"]

    for (const location of locations) {
      for (const target of expressions)
        expect(ShellScan.scanPowerShell(`${location} ${target}`)).toMatchObject({
          kind: "scanned",
          commands: [
            { resource: `${location} ${target}`, words: [location, target] },
            { resource: "Resolve-Path ..", words: ["Resolve-Path", ".."] },
          ],
        })
      for (const target of variables)
        expect(ShellScan.scanPowerShell(`${location} ${target}`)).toMatchObject({
          kind: "scanned",
          commands: [{ resource: `${location} ${target}`, words: [location, target] }],
        })
    }
  })
})
