import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"

function evaluate(module: "jsonc" | "bun-lock", input?: string, target = { os: "linux", cpu: "x64" }) {
  const text = input === undefined ? "builtins.readFile ./bun.lock" : 'builtins.getEnv "OPENCODE_NIX_LOCK_TEST_INPUT"'
  const parsed = `import ./nix/jsonc.nix (${text})`
  return Bun.spawnSync(
    [
      "nix",
      "eval",
      "--json",
      "--impure",
      "--expr",
      module === "jsonc"
        ? parsed
        : `import ./nix/bun-lock.nix (builtins.fromJSON (builtins.getEnv "OPENCODE_NIX_LOCK_TEST_TARGET")) (${parsed})`,
    ],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: {
        ...process.env,
        OPENCODE_NIX_LOCK_TEST_INPUT: input ?? "",
        OPENCODE_NIX_LOCK_TEST_TARGET: JSON.stringify(target),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
}

const valid = [
  "{}",
  '[1, true, null, {"nested": [2,],},]',
  '{"url":"https://example.test/path", "comment":"/* not a comment */", "comma":",}", "array":",]",}',
  String.raw`{"escape":"a\\b\"//literal", "unicode":"\u00e9",}`,
  '{"${notCode}":"literal",}',
  '/* header */ {"a": 1, /* trailing */ "b": [2, /* trailing */],} // EOF',
  '{\r\n // comment containing r and n\r\n "a": 1,\r\n}',
  '{"a": /* ** stars **/ 1,}',
]
for (const input of valid) {
  const result = evaluate("jsonc", input)
  assert.equal(result.exitCode, 0, result.stderr.toString())
  assert.deepEqual(JSON.parse(result.stdout.toString()), Bun.JSONC.parse(input))
}

const invalid = [
  "[,]",
  "{,}",
  "[1,,]",
  '{"a":1,,}',
  '{"a":1/* separator */2}',
  '{"a":tru/* separator */e}',
  String.raw`{"a":"\q"}`,
  '{"a":"//unterminated}',
  "/* unterminated",
  '{"a":1} trailing',
  "[1 2]",
]
for (const input of invalid) {
  assert.notEqual(evaluate("jsonc", input).exitCode, 0, input)
}

const actual = evaluate("jsonc")
assert.equal(actual.exitCode, 0, actual.stderr.toString())
assert.deepEqual(
  JSON.parse(actual.stdout.toString()),
  Bun.JSONC.parse(await Bun.file(new URL("../bun.lock", import.meta.url)).text()),
)

const hash = `sha512-${Buffer.alloc(64, 1).toString("base64")}`
const otherHash = `sha512-${Buffer.alloc(64, 2).toString("base64")}`
const lock = {
  lockfileVersion: 1,
  packages: {
    alias: ["@scope/lib@1.2.3", "", { peerDependencies: { zod: "^3" } }, hash],
    "consumer/lib": ["@scope/lib@1.2.3", "", { peerDependencies: { zod: "^4" } }, hash],
    workspace: ["local@workspace:packages/local"],
    bundle: ["bundle@https://example.test/archive", {}, hash],
    editor: ["editor@github:example/editor#abc1234", {}, "example-editor-abc1234", hash],
  },
}
const expected = {
  "@scope/lib@1.2.3": { url: "https://registry.npmjs.org/@scope/lib/-/lib-1.2.3.tgz", hash },
  "tarball:https://example.test/archive": { url: "https://example.test/archive", hash, name: "package.tgz" },
  "github:example-editor-abc1234": {
    url: "https://api.github.com/repos/example/editor/tarball/abc1234",
    hash,
    name: "package.tgz",
  },
}
const projected = evaluate("bun-lock", JSON.stringify(lock))
assert.equal(projected.exitCode, 0, projected.stderr.toString())
assert.deepEqual(JSON.parse(projected.stdout.toString()), expected)

// A changed lock must change fetches directly, without regenerating a second file.
const updated = evaluate(
  "bun-lock",
  JSON.stringify({
    ...lock,
    packages: { ...lock.packages, alias: ["@scope/lib@2.0.0", "", {}, otherHash] },
  }),
)
assert.equal(updated.exitCode, 0, updated.stderr.toString())
assert.deepEqual(JSON.parse(updated.stdout.toString()), {
  ...expected,
  "@scope/lib@2.0.0": { url: "https://registry.npmjs.org/@scope/lib/-/lib-2.0.0.tgz", hash: otherHash },
})

const platforms = [
  { os: "linux", cpu: "x64" },
  { os: "linux", cpu: "arm64" },
  { os: "darwin", cpu: "arm64" },
]
const platformCases = [
  { name: "linux-x64", metadata: { os: "linux", cpu: "x64" }, allowed: [true, false, false] },
  { name: "darwin-arm64", metadata: { os: "darwin", cpu: "arm64" }, allowed: [false, false, true] },
  {
    name: "allow-lists",
    metadata: { os: ["linux", "android", "freebsd"], cpu: ["x64", "arm64"] },
    allowed: [true, true, false],
  },
  { name: "deny-list", metadata: { os: ["!aix", "!sunos", "!freebsd", "!openbsd"] }, allowed: [true, true, true] },
  { name: "empty", metadata: { os: [], cpu: [] }, allowed: [true, true, true] },
  { name: "no-os", metadata: { os: "none" }, allowed: [false, false, false] },
  { name: "no-cpu", metadata: { cpu: "none" }, allowed: [false, false, false] },
  { name: "unknown-os", metadata: { os: "new-os" }, allowed: [false, false, false] },
  { name: "unknown-negated", metadata: { os: "!new-os" }, allowed: [true, true, true] },
  { name: "deny-host", metadata: { os: "!linux" }, allowed: [false, false, true] },
  { name: "negative-wins", metadata: { os: ["linux", "!linux"] }, allowed: [false, false, false] },
  { name: "wildcard-first", metadata: { os: ["any", "darwin"] }, allowed: [false, false, true] },
  { name: "wildcard-last", metadata: { os: ["darwin", "any"] }, allowed: [true, true, true] },
  { name: "reset-unknown", metadata: { os: ["none", "linux"] }, allowed: [true, true, false] },
  { name: "ignored-values", metadata: { os: [null, false, "linux"] }, allowed: [true, true, false] },
  { name: "libc-retained", metadata: { os: "linux", cpu: "x64", libc: "musl" }, allowed: [true, false, false] },
  { name: "unknown-after-any", metadata: { os: ["any", "new-os"] }, allowed: [true, true, true] },
  { name: "none-after-positive", metadata: { os: ["linux", "none"] }, allowed: [true, true, false] },
  { name: "negative-after-any", metadata: { os: ["darwin", "any", "!darwin"] }, allowed: [false, false, false] },
] as const
const platformLock = {
  lockfileVersion: 1,
  packages: {
    ...Object.fromEntries(platformCases.map((item) => [item.name, [`${item.name}@1.0.0`, "", item.metadata, hash]])),
    bundle: ["bundle@https://example.test/archive", { os: "linux", cpu: "x64" }, hash],
    editor: ["editor@github:example/editor#abc1234", { os: "darwin", cpu: "arm64" }, "example-editor-abc1234", hash],
  },
}
platforms.forEach((target, index) => {
  const result = evaluate("bun-lock", JSON.stringify(platformLock), target)
  assert.equal(result.exitCode, 0, result.stderr.toString())
  assert.deepEqual(
    Object.keys(JSON.parse(result.stdout.toString())).sort(),
    [
      ...platformCases.filter((item) => item.allowed[index]).map((item) => `${item.name}@1.0.0`),
      ...(index === 0 ? ["tarball:https://example.test/archive"] : []),
      ...(index === 2 ? ["github:example-editor-abc1234"] : []),
    ].sort(),
    `${target.os}/${target.cpu}`,
  )
})

for (const entry of [
  ["@scope/lib@1.2.3", "", {}, otherHash],
  ["@scope/lib@1.2.3", "https://mirror.test/lib.tgz", {}, hash],
]) {
  const result = evaluate(
    "bun-lock",
    JSON.stringify({ ...lock, packages: { ...lock.packages, "consumer/lib": entry } }),
  )
  assert.notEqual(result.exitCode, 0)
  assert.match(result.stderr.toString(), /Conflicting Bun sources: @scope\/lib@1\.2\.3/)
}
for (const [entry, error] of [
  [["bundle@https://example.test/archive", {}, ""], /Missing Bun source integrity/],
  [["bundle@git+https://example.test/repo", {}, hash], /Unsupported Bun source/],
] as const) {
  const result = evaluate("bun-lock", JSON.stringify({ lockfileVersion: 1, packages: { bundle: entry } }))
  assert.notEqual(result.exitCode, 0)
  assert.match(result.stderr.toString(), error)
}
const version = evaluate("bun-lock", JSON.stringify({ lockfileVersion: 2, packages: {} }))
assert.notEqual(version.exitCode, 0)
assert.match(version.stderr.toString(), /Unsupported Bun lockfile version/)

console.log(
  `Bun lock: ${valid.length} JSONC fixtures, ${invalid.length} invalid inputs, ${platformCases.length} platform cases on ${platforms.length} targets, full-lock JSONC parity, source contexts, conflicts and automatic updates passed`,
)
