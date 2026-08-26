import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { browserSuites, sharedAppFile } from "./browser-suites"

const root = path.resolve(import.meta.dir, "../..")
const cwd = mkdtempSync(path.join(tmpdir(), "browser-suites-"))
const all = { app: true, appComponents: true, sessionComponents: true }
const app = { app: true, appComponents: true, sessionComponents: false }
const components = { app: false, appComponents: true, sessionComponents: true }
const none = { app: false, appComponents: false, sessionComponents: false }

function git(...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd })
  if (result.exitCode) throw new Error(result.stderr.toString())
  return result.stdout.toString().trim()
}

git("init", "-q")
git("config", "user.name", "fixture")
git("config", "user.email", "fixture@example.com")
const files = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root }).stdout.toString().split("\0")
for (const file of files.filter(
  (file) => file.endsWith("/package.json") || ["package.json", "bun.lock", "turbo.json"].includes(file),
)) {
  await Bun.write(path.join(cwd, file), Bun.file(path.join(root, file)))
}
await Bun.write(path.join(cwd, "packages/app/src/runtime/i18n/deleted.ts"), "export const old = true")
await Bun.write(path.join(cwd, "packages/app/src/runtime/i18n/renamed.ts"), "export const renamed = true")
git("add", ".")
git("commit", "-qm", "base")
afterAll(() => rmSync(cwd, { recursive: true, force: true }))

test.each([
  ["packages/app/component-tests/new.spec.ts", app],
  ["packages/app/src/composer/new.tsx", app],
  ["packages/app/src/shell/new.tsx", app],
  ["packages/app/src/composer/new.stories.tsx", app],
  ["packages/session-ui/src/timeline/new.tsx", all],
  ["packages/session-ui/component-tests/new.spec.ts", all],
  ["packages/ui/src/new.tsx", all],
  ["packages/client/src/new.ts", all],
  ["packages/util/src/new.ts", all],
  ["packages/storybook/.storybook/main.ts", components],
  ["packages/storybook/.storybook/preview.tsx", components],
  ["packages/storybook/playwright/story.ts", components],
  ["packages/storybook/playwright/config.ts", components],
  ["packages/storybook/new.stories.tsx", components],
  ["packages/app/src/index.css", all],
  ["packages/app/public/assets/new.woff2", all],
  ["packages/app/src/runtime/i18n/en.ts", all],
  ["packages/app/src/runtime/i18n/fr.ts", all],
  ["packages/app/src/runtime/persistence/storage.ts", all],
  ["packages/app/src/runtime/server/scope.ts", all],
  ["packages/app/src/workspaces/path-key.ts", all],
  ["bun.lock", all],
  ["package.json", all],
  ["turbo.json", all],
  ["packages/app/package.json", all],
  [".github/actions/setup-bun/action.yml", all],
  ["unknown-config", all],
  ["packages/unknown/shared.ts", all],
  ["packages/app/tsconfig.json", all],
  ["patches/shared.patch", all],
  ["README.md", none],
  ["docs/guide.md", none],
  ["packages/www/content/docs/guide.mdx", none],
] as const)(
  "selects suites for %s with the real workspace graph",
  async (file, expected) => {
    const base = git("rev-parse", "HEAD")
    const target = Bun.file(path.join(cwd, file))
    // Keep manifests valid; changing whitespace still participates in the Git diff.
    await Bun.write(target, ((await target.exists()) ? await target.text() : "") + "\n")
    git("add", ".")
    git("commit", "-qm", file)
    expect(browserSuites({ cwd, event: "pull_request", base, head: "HEAD" })).toEqual(expected)
  },
  30_000,
)

test("deletions participate", () => {
  const base = git("rev-parse", "HEAD")
  git("rm", "packages/app/src/runtime/i18n/deleted.ts")
  git("commit", "-qm", "remove shared input")
  expect(browserSuites({ cwd, event: "push", base, head: "HEAD" })).toEqual(all)
}, 30_000)

test("both sides of renames participate", () => {
  const base = git("rev-parse", "HEAD")
  git("mv", "packages/app/src/runtime/i18n/renamed.ts", "packages/app/src/renamed.ts")
  git("commit", "-qm", "rename shared input")
  expect(browserSuites({ cwd, event: "push", base, head: "HEAD" })).toEqual(all)
}, 30_000)

test("manual dispatch and unavailable diffs fail safe", () => {
  expect(browserSuites({ cwd, event: "workflow_dispatch" })).toEqual(all)
  expect(browserSuites({ cwd, event: "push", base: "0".repeat(40), head: "HEAD" })).toEqual(all)
  expect(browserSuites({ cwd, event: "pull_request", base: "missing", head: "HEAD" })).toEqual(all)
  expect(browserSuites({ cwd, event: "push" })).toEqual(all)
  expect(browserSuites({ cwd, base: "HEAD", head: "HEAD" })).toEqual(none)
})

test("uses the merge base, not the tip of a diverged comparison branch", async () => {
  const base = git("rev-parse", "HEAD")
  await Bun.write(path.join(cwd, "packages/app/src/branch.ts"), "// app branch")
  git("add", ".")
  git("commit", "-qm", "app branch")
  const head = git("rev-parse", "HEAD")
  git("switch", "--detach", base)
  await Bun.write(path.join(cwd, "packages/session-ui/src/other.ts"), "// base branch only")
  git("add", ".")
  git("commit", "-qm", "diverged base")
  const other = git("rev-parse", "HEAD")
  git("switch", "--detach", head)
  expect(browserSuites({ cwd, event: "pull_request", base: other, head })).toEqual(app)
  expect(browserSuites({ cwd, event: "push", base, head })).toEqual(app)
  const merge = git("commit-tree", `${head}^{tree}`, "-p", base, "-p", head, "-m", "PR merge ref")
  expect(browserSuites({ cwd, event: "pull_request", base: `${merge}^1`, head: merge })).toEqual(app)
}, 30_000)

test("Turbo failures run everything instead of silently skipping suites", async () => {
  const file = Bun.file(path.join(cwd, "turbo.json"))
  const original = await file.text()
  try {
    await Bun.write(file, "not json")
    expect(browserSuites({ cwd, event: "push", base: "HEAD^", head: "HEAD" })).toEqual(all)
  } finally {
    await Bun.write(file, original)
  }
}, 30_000)

test("shared app exceptions cover the preview's transitive runtime imports", async () => {
  const seen = new Set<string>()
  const pending = ["packages/storybook/.storybook/preview.tsx"]
  while (pending.length) {
    const file = pending.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    if (file.startsWith("packages/app/")) expect(sharedAppFile(file), file).toBe(true)
    const source = await Bun.file(path.join(root, file)).text()
    const imports = file.endsWith(".css")
      ? Array.from(source.matchAll(/@import\s+["']([^"']+)["']/g), (match) => match[1]!)
      : new Bun.Transpiler({ loader: "tsx" }).scanImports(source).map((item) => item.path)
    for (const name of imports) {
      if (name.startsWith("@opencode-ai/")) {
        // These packages and their dependents are covered by the Turbo graph.
        expect(["ui", "session-ui", "client", "util"]).toContain(name.split("/")[1]!)
        continue
      }
      if (!name.startsWith(".") && !name.startsWith("@/")) continue
      // Follow the real platform too: conservative, without duplicating Vite's mock aliases.
      const target = name.startsWith("@/")
        ? path.join(root, "packages/app/src", name.slice(2))
        : path.resolve(root, path.dirname(file), name)
      pending.push(path.relative(root, Bun.resolveSync(target, root)))
    }
  }
  expect(seen.has("packages/app/src/runtime/persistence/storage.ts")).toBe(true)
  expect(seen.has("packages/app/src/workspaces/path-key.ts")).toBe(true)
})
