import { expect, test } from "bun:test"
import { SandboxApproval } from "../src/sandbox/approval"

test("session escape prefixes use literal token boundaries and upstream command arity", () => {
  expect(SandboxApproval.parse("npm install package --save-dev", "/bin/zsh")).toEqual({
    tokens: ["npm", "install", "package", "--save-dev"],
    prefix: ["npm", "install"],
  })
  expect(SandboxApproval.parse("git fetch origin", "/bin/bash")?.prefix).toEqual(["git", "fetch"])
  expect(SandboxApproval.parse("bun run test unit", "/bin/sh")?.prefix).toEqual(["bun", "run", "test"])
  expect(SandboxApproval.parse("/usr/bin/curl https://example.com", "/bin/zsh")?.prefix).toEqual(["/usr/bin/curl"])
})

test.each([
  "npm install; touch outside",
  "npm install && touch outside",
  "npm install | sh",
  "npm install > outside",
  "npm install < input",
  "npm install $(touch outside)",
  "npm install `touch outside`",
  "npm install $PACKAGE",
  "npm install *",
  "npm install ~/package",
  "npm install {one,two}",
  "npm install package\ntouch outside",
  "npm install # comment",
  "npm install 'package'",
  "npm install pack\\age",
  "PATH=/outside npm install",
  "env npm install",
  "sh script",
  "python3 script.py",
  "node script.js",
  "deno run hello.ts",
  "deno run -A script.ts",
  "deno eval code",
  "nodejs script.js",
  "pypy3 script.py",
  "bun run ./script.ts",
  "bun run script.js",
  "bun run scripts/tool",
  "bun -e code",
  "awk -f script.awk file",
  "eval npm install",
  "if true",
  "",
])("complex or general-purpose escape remains one-time only: %s", (command) => {
  expect(SandboxApproval.parse(command, "/bin/zsh")).toBeUndefined()
})

test("unknown shell syntax cannot acquire a prefix grant", () => {
  expect(SandboxApproval.parse("npm install package", "/usr/bin/fish")).toBeUndefined()
})
