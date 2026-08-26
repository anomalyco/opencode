import { appendFileSync } from "node:fs"

const all = { app: true, appComponents: true, sessionComponents: true }

// The preview imports app CSS and LanguageProvider outside the workspace graph.
// The import-closure test below guards this bounded exception against drift.
export function sharedAppFile(file: string) {
  return (
    file.startsWith("packages/app/public/") ||
    (file.startsWith("packages/app/") && file.endsWith(".css")) ||
    file.startsWith("packages/app/src/runtime/i18n/") ||
    [
      "packages/app/package.json",
      "packages/app/tsconfig.json",
      "packages/app/src/runtime/persistence/storage.ts",
      "packages/app/src/runtime/platform/platform.tsx",
      "packages/app/src/runtime/server/registry.tsx",
      "packages/app/src/runtime/server/scope.ts",
      "packages/app/src/workspaces/path-key.ts",
    ].includes(file)
  )
}

export function browserSuites(input: { event?: string; base?: string; head?: string; cwd: string }) {
  if (input.event === "workflow_dispatch") return all
  try {
    if (!input.base || !input.head) throw new Error("missing comparison refs")
    const run = (cmd: string[], env = {}) => {
      const result = Bun.spawnSync(cmd, { cwd: input.cwd, env: { ...process.env, ...env }, stderr: "pipe" })
      if (result.exitCode !== 0) throw new Error(`${cmd[0]} failed: ${result.stderr.toString()}`)
      return result.stdout.toString()
    }
    const base = run(["git", "merge-base", input.base, input.head]).trim()
    // Disable rename detection so both old and new paths participate, including deletions.
    const files = run(["git", "diff", "--name-only", "--no-renames", "-z", base, input.head, "--"])
      .split("\0")
      .filter(Boolean)
    if (!files.length) return { app: false, appComponents: false, sessionComponents: false }
    // Root config, lockfiles, CI tooling and unknown paths are global. Only known
    // documentation outside workspaces can bypass Turbo's root-package invalidation.
    const docs = (file: string) => /^(?:README(?:\.[^/]+)?\.md|AGENTS\.md|LICENSE|docs\/.*\.mdx?)$/.test(file)
    if (files.every(docs)) return { app: false, appComponents: false, sessionComponents: false }
    if (files.some((file) => !file.startsWith("packages/") && !docs(file))) return all
    if (files.some((file) => /(?:^|\/)(?:bun\.lockb?|package\.json|turbo\.json|tsconfig[^/]*\.json)$/.test(file))) {
      return all
    }
    const packages = run(["git", "ls-tree", "-r", "--name-only", "-z", input.head, "--", "packages"])
      .split("\0")
      .filter((file) => file.endsWith("/package.json"))
      .map((file) => file.slice(0, -"package.json".length))
    if (files.some((file) => !docs(file) && !packages.some((directory) => file.startsWith(directory)))) return all
    const result = JSON.parse(
      run(["bun", "x", "turbo@2.10.2", "ls", "--affected", "--output=json"], {
        TURBO_SCM_BASE: base,
        TURBO_SCM_HEAD: input.head,
      }),
    )
    if (
      !Array.isArray(result.packages?.items) ||
      result.packages.items.some((item: { name?: unknown }) => typeof item.name !== "string")
    ) {
      throw new Error("unexpected Turbo package output")
    }
    const names = new Set(result.packages.items.map((item: { name: string }) => item.name))
    const app = names.has("@opencode-ai/app")
    const shared = names.has("@opencode-ai/storybook") || files.some(sharedAppFile)
    return {
      app,
      appComponents: app || shared,
      sessionComponents: names.has("@opencode-ai/session-ui") || shared,
    }
  } catch (error) {
    console.warn("Unable to select browser suites; running all suites.", error)
    return all
  }
}

if (import.meta.main) {
  const result = browserSuites({
    event: process.env.GITHUB_EVENT_NAME,
    base: process.env.TURBO_SCM_BASE,
    head: process.env.TURBO_SCM_HEAD,
    cwd: process.cwd(),
  })
  const output =
    Object.entries(result)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n"
  console.log(output.trim())
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output)
}
