import { describe, expect, test } from "bun:test"
import { PwshArity } from "../../src/permission/pwsh-arity"

test("arity 1 - PowerShell cmdlets", () => {
  expect(PwshArity.prefix(["Get-ChildItem", "-Path", "C:\\"])).toEqual(["Get-ChildItem"])
  expect(PwshArity.prefix(["Remove-Item", "-Recurse", "-Force", "./temp"])).toEqual(["Remove-Item"])
  expect(PwshArity.prefix(["Invoke-MyCustomThing", "arg1"])).toEqual(["Invoke-MyCustomThing"])
})

test("arity 1 - PowerShell aliases", () => {
  expect(PwshArity.prefix(["ls", "-la"])).toEqual(["ls"])
  expect(PwshArity.prefix(["cd", "C:\\Users"])).toEqual(["cd"])
  expect(PwshArity.prefix(["rm", "file.txt"])).toEqual(["rm"])
  expect(PwshArity.prefix(["gci", "C:\\"])).toEqual(["gci"])
})

test("arity 2 - two token external commands", () => {
  expect(PwshArity.prefix(["git", "checkout", "main"])).toEqual(["git", "checkout"])
  expect(PwshArity.prefix(["docker", "run", "nginx"])).toEqual(["docker", "run"])
  expect(PwshArity.prefix(["dotnet", "build"])).toEqual(["dotnet", "build"])
  expect(PwshArity.prefix(["npm", "install", "react"])).toEqual(["npm", "install"])
})

test("arity 3 - three token external commands", () => {
  expect(PwshArity.prefix(["docker", "compose", "up", "-d"])).toEqual(["docker", "compose", "up"])
  expect(PwshArity.prefix(["npm", "run", "dev"])).toEqual(["npm", "run", "dev"])
  expect(PwshArity.prefix(["git", "config", "user.name", "John"])).toEqual(["git", "config", "user.name"])
  expect(PwshArity.prefix(["az", "storage", "blob", "list"])).toEqual(["az", "storage", "blob"])
})

test("longest match wins - nested prefixes", () => {
  expect(PwshArity.prefix(["docker", "compose", "up", "service"])).toEqual(["docker", "compose", "up"])
  expect(PwshArity.prefix(["git", "remote", "add", "origin"])).toEqual(["git", "remote", "add"])
})

test("exact length matches", () => {
  expect(PwshArity.prefix(["git", "checkout"])).toEqual(["git", "checkout"])
  expect(PwshArity.prefix(["npm", "run", "dev"])).toEqual(["npm", "run", "dev"])
})

test("edge cases", () => {
  expect(PwshArity.prefix([])).toEqual([])
  expect(PwshArity.prefix(["single"])).toEqual(["single"])
  expect(PwshArity.prefix(["git"])).toEqual(["git"])
})

test("unknown commands default to arity 1", () => {
  expect(PwshArity.prefix(["unknown", "command", "subcommand"])).toEqual(["unknown"])
  expect(PwshArity.prefix(["my-custom-script", "arg1", "arg2"])).toEqual(["my-custom-script"])
})

test("case-insensitive matching - external tools", () => {
  expect(PwshArity.prefix(["Git", "remote", "add", "origin"])).toEqual(["Git", "remote", "add"])
  expect(PwshArity.prefix(["GIT", "REMOTE", "ADD", "ORIGIN"])).toEqual(["GIT", "REMOTE", "ADD"])
  expect(PwshArity.prefix(["Docker", "Compose", "Up", "-d"])).toEqual(["Docker", "Compose", "Up"])
})

test("case-insensitive matching - PowerShell cmdlets", () => {
  expect(PwshArity.prefix(["get-childitem", "-Path", "C:\\"])).toEqual(["get-childitem"])
  expect(PwshArity.prefix(["GET-CHILDITEM", "-Path", "C:\\"])).toEqual(["GET-CHILDITEM"])
})

test("arity 1 - expanded aliases", () => {
  expect(PwshArity.prefix(["ac", "file.txt", "content"])).toEqual(["ac"])
  expect(PwshArity.prefix(["clc", "file.txt"])).toEqual(["clc"])
  expect(PwshArity.prefix(["ren", "old.txt", "new.txt"])).toEqual(["ren"])
  expect(PwshArity.prefix(["rni", "old.txt", "new.txt"])).toEqual(["rni"])
  expect(PwshArity.prefix(["ii", "file.txt"])).toEqual(["ii"])
})

test("case-insensitive matching preserves original casing", () => {
  expect(PwshArity.prefix(["AC", "file.txt"])).toEqual(["AC"])
  expect(PwshArity.prefix(["Ren", "old.txt", "new.txt"])).toEqual(["Ren"])
  expect(PwshArity.prefix(["NPM", "run", "dev"])).toEqual(["NPM", "run", "dev"])
})
