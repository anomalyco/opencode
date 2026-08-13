import { describe, expect, test } from "bun:test"
import { ShellScan } from "../src/index.js"

type Mutation = {
  name: string
  apply: (source: string) => string
}

const head = (source: string, mutate: (value: string) => string) =>
  source.replace(/^\S+/, (value) => mutate(value))

const contexts: Mutation[] = [
  { name: "leading spaces", apply: (source) => `  ${source}` },
  { name: "leading tab", apply: (source) => `\t${source}` },
  { name: "semicolon prefix", apply: (source) => `printf safe; ${source}` },
  { name: "and prefix", apply: (source) => `printf safe && ${source}` },
  { name: "or suffix", apply: (source) => `${source} || printf safe` },
  { name: "newline suffix", apply: (source) => `${source}\nprintf safe` },
]

const bashSeeds = [
  ["evaluator", `eval 'printf pwn'`],
  ["shell", `bash -c 'printf pwn'`],
  ["wrapper", "env MODE=test printf pwn"],
  ["dynamic builtin", "alias harmless='printf pwn'"],
  ["find callback", "find . -exec printf pwn ;"],
  ["awk source", `awk 'BEGIN { system("printf pwn") }'`],
  ["git alias", `git -c alias.pwn='!printf pwn' pwn`],
  ["python source", `python3 -c 'print(1)'`],
  ["node source", `node --eval='process.exit()'`],
] as const

describe("ShellScan opaque mutation closure", () => {
  const headMutations: Mutation[] = [
    { name: "absolute path", apply: (source) => head(source, (value) => `/usr/bin/${value}`) },
    { name: "relative path", apply: (source) => head(source, (value) => `./${value}`) },
    { name: "single-quoted head", apply: (source) => head(source, (value) => `'${value}'`) },
    { name: "double-quoted head", apply: (source) => head(source, (value) => `"${value}"`) },
    {
      name: "escaped head",
      apply: (source) => head(source, (value) => `${value[0]}\\${value.slice(1)}`),
    },
  ]

  for (const [seed, source] of bashSeeds) {
    for (const mutation of [...headMutations, ...contexts]) {
      test(`${seed} remains opaque after ${mutation.name}`, () => {
        expect(ShellScan.scan(mutation.apply(source)).kind).toBe("opaque")
      })
    }
  }

  test.each([
    ["python short option cluster", `python3 -Ic'print(1)'`],
    ["perl short option cluster", `perl -we'print 1'`],
    ["ruby short option cluster", `ruby -we'puts 1'`],
    ["node attached long option", `node --eval='process.exit()'`],
  ])("attached source flag remains opaque: %s", (_name, source) => {
    expect(ShellScan.scan(source).kind).toBe("opaque")
  })
})

const powerShellContexts: Mutation[] = [
  { name: "leading spaces", apply: (source) => `  ${source}` },
  { name: "leading tab", apply: (source) => `\t${source}` },
  { name: "semicolon prefix", apply: (source) => `Write-Output safe; ${source}` },
  { name: "pipeline prefix", apply: (source) => `Write-Output safe | ${source}` },
  { name: "newline suffix", apply: (source) => `${source}\nWrite-Output safe` },
]

const powerShellSeeds = [
  ["expression evaluator", `Invoke-Expression 'Write-Output pwn'`],
  ["expression alias", `iex 'Write-Output pwn'`],
  ["process launcher", "Start-Process pwsh -ArgumentList -Command,pwn"],
  ["process alias", "saps pwsh -ArgumentList -Command,pwn"],
  ["module importer", "Import-Module ./evil.psm1"],
  ["module alias", "ipmo ./evil.psm1"],
  ["alias mutation", "Set-Alias harmless Remove-Item"],
  ["alias mutation alias", "sal harmless Remove-Item"],
  ["shell", "pwsh -Command Write-Output,pwn"],
  ["script", "./evil.ps1 -Force"],
] as const

describe("ShellScan PowerShell opaque mutation closure", () => {
  for (const [seed, source] of powerShellSeeds) {
    const mutations: Mutation[] = [
      { name: "case change", apply: (value) => head(value, (name) => name.toUpperCase()) },
      { name: "single-quoted head", apply: (value) => head(value, (name) => `'${name}'`) },
      { name: "double-quoted head", apply: (value) => head(value, (name) => `"${name}"`) },
      {
        name: "escaped head",
        apply: (value) => head(value, (name) => `${name[0]}\`${name.slice(1)}`),
      },
      ...powerShellContexts,
    ]

    for (const mutation of mutations) {
      test(`${seed} remains opaque after ${mutation.name}`, () => {
        expect(ShellScan.scanPowerShell(mutation.apply(source)).kind).toBe("opaque")
      })
    }
  }

  test.each([
    ["evaluator", `Microsoft.PowerShell.Utility\\Invoke-Expression 'Write-Output pwn'`],
    ["process launcher", "Microsoft.PowerShell.Management\\Start-Process pwsh"],
    ["module importer", "Microsoft.PowerShell.Core\\Import-Module ./evil.psm1"],
    ["alias mutation", "Microsoft.PowerShell.Utility\\Set-Alias harmless Remove-Item"],
  ])("module-qualified command remains opaque: %s", (_name, source) => {
    expect(ShellScan.scanPowerShell(source).kind).toBe("opaque")
  })

  test.each([
    ["powershell path", `C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -Command pwn`],
    ["cmd path", `C:\\Windows\\System32\\cmd.exe /c pwn`],
    ["script path", `C:\\work\\evil.ps1 -Force`],
  ])("path-qualified command remains opaque: %s", (_name, source) => {
    expect(ShellScan.scanPowerShell(source).kind).toBe("opaque")
  })
})
