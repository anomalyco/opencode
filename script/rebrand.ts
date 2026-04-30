#!/usr/bin/env bun

// upstream merge 後に securecode の branding 文字列を再適用するための codemod。
//
// scope:
//   - upstream の元ファイルに存在する公開向けテキスト（CLI describe / log / TUI 表示）の textual replace のみ
//   - asset 追加・JSX 構造書き換え・テーマ色変更・upstream に無い独自関数追加は対象外
//   - 配列拡張系（mcp.ts や config.ts での securecode.json/jsonc の path candidates 追加）は
//     path 受容の機能変更扱いで対象外。手動マージで対応する
//
// idempotency:
//   - find が見つかれば replace を適用
//   - find が無くても replace が既に存在すれば「適用済み」として無視
//   - どちらも無ければ MISSING として exit 1（upstream が当該箇所を refactor した可能性が高い）
//   - find の出現回数が rule.count と一致しなければ MISMATCH として exit 1
//
// usage:
//   bun script/rebrand.ts            # apply
//   bun script/rebrand.ts --check    # dry-run

import path from "node:path"

type Rule = {
  file: string
  find: string
  replace: string
  count?: number
}

const RULES: Rule[] = [
  {
    file: "packages/opencode/src/cli/cmd/mcp.ts",
    find: `          prompts.outro("Add servers with: opencode mcp add")`,
    replace: `          prompts.outro("Add servers with: securecode mcp add")`,
  },

  {
    file: "packages/opencode/src/cli/cmd/run.ts",
    find: `  describe: "run opencode with a message",`,
    replace: `  describe: "run securecode with a message",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/run.ts",
    find: `        describe: "attach to a running opencode server (e.g., http://localhost:4096)",`,
    replace: `        describe: "attach to a running securecode server (e.g., http://localhost:4096)",`,
  },

  {
    file: "packages/opencode/src/cli/cmd/serve.ts",
    find: `  describe: "starts a headless opencode server",`,
    replace: `  describe: "starts a headless securecode server",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/serve.ts",
    find: "    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)",
    replace: "    console.log(`securecode server listening on http://${server.hostname}:${server.port}`)",
  },

  {
    file: "packages/opencode/src/cli/cmd/tui/app.tsx",
    find: `      renderer.setTerminalTitle("OpenCode")`,
    replace: `      renderer.setTerminalTitle("securecode")`,
    count: 2,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/app.tsx",
    find: "      renderer.setTerminalTitle(`OC | ${title}`)",
    replace: "      renderer.setTerminalTitle(`securecode | ${title}`)",
  },
  // app.tsx の "OpenCode v... Run 'opencode upgrade' to update manually" toast は
  // upstream v1.4.x で完全書き換え (`A new release v... Would you like to update now?`)。
  // branding 対象行ごと消えたためルールも削除。
  {
    file: "packages/opencode/src/cli/cmd/tui/app.tsx",
    find: "      `Successfully updated to OpenCode v${result.data.version}. Please restart the application.`,",
    replace: "      `Successfully updated to securecode v${result.data.version}. Please restart the application.`,",
  },

  {
    file: "packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx",
    find: `                <TextBody title={"This will allow " + props.request.permission + " until OpenCode is restarted."} />`,
    replace: `                <TextBody title={"This will allow " + props.request.permission + " until securecode is restarted."} />`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx",
    find: `                  <text fg={theme.textMuted}>This will allow the following patterns until OpenCode is restarted</text>`,
    replace: `                  <text fg={theme.textMuted}>This will allow the following patterns until securecode is restarted</text>`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx",
    find: `          <text fg={theme.textMuted}>Tell OpenCode what to do differently</text>`,
    replace: `          <text fg={theme.textMuted}>Tell securecode what to do differently</text>`,
  },

  {
    file: "packages/opencode/src/cli/cmd/tui/attach.ts",
    find: `  describe: "attach to a running opencode server",`,
    replace: `  describe: "attach to a running securecode server",`,
  },

  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Run {highlight}/share{/highlight} to create a public link to your conversation at opencode.ai",`,
    replace: `  "Run {highlight}/share{/highlight} to create a public link to your conversation",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Create {highlight}opencode.json{/highlight} for server settings and {highlight}tui.json{/highlight} for TUI settings",`,
    replace: `  "Create {highlight}securecode.json{/highlight} (or {highlight}opencode.json{/highlight}) for server settings and {highlight}tui.json{/highlight} for TUI settings",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Place TUI settings in {highlight}~/.config/opencode/tui.json{/highlight} for global config",`,
    replace: `  "Place TUI settings in {highlight}~/.config/securecode/tui.json{/highlight} for global config",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "OpenCode auto-handles OAuth for remote MCP servers requiring auth",`,
    replace: `  "SecureCode auto-handles OAuth for remote MCP servers requiring auth",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "OpenCode auto-formats files using prettier, gofmt, ruff, and more",`,
    replace: `  "SecureCode auto-formats files using prettier, gofmt, ruff, and more",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "OpenCode uses LSP servers for intelligent code analysis",`,
    replace: `  "SecureCode uses LSP servers for intelligent code analysis",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Create a plugin to prevent OpenCode from reading sensitive files",`,
    replace: `  "Create a plugin to prevent SecureCode from reading sensitive files",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Run {highlight}docker run -it --rm ghcr.io/anomalyco/opencode{/highlight} for containerized use",`,
    replace: `  "Run {highlight}docker run -it --rm ghcr.io/acompany-develop/securecode{/highlight} for containerized use",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Use {highlight}/connect{/highlight} with OpenCode Zen for curated, tested models",`,
    replace: `  "Use {highlight}/connect{/highlight} with SecureCode for curated, tested models",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Use {highlight}opencode run{/highlight} for non-interactive scripting",`,
    replace: `  "Use {highlight}securecode run{/highlight} for non-interactive scripting",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Use {highlight}opencode --continue{/highlight} to resume the last session",`,
    replace: `  "Use {highlight}securecode --continue{/highlight} to resume the last session",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Use {highlight}opencode run -f file.ts{/highlight} to attach files via CLI",`,
    replace: `  "Use {highlight}securecode run -f file.ts{/highlight} to attach files via CLI",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Run {highlight}opencode serve{/highlight} for headless API access to OpenCode",`,
    replace: `  "Run {highlight}securecode serve{/highlight} for headless API access to securecode",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Use {highlight}opencode run --attach{/highlight} to connect to a running server",`,
    replace: `  "Use {highlight}securecode run --attach{/highlight} to connect to a running server",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Run {highlight}opencode upgrade{/highlight} to update to the latest version",`,
    replace: `  "Run {highlight}securecode upgrade{/highlight} to update to the latest version",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Run {highlight}opencode auth list{/highlight} to see all configured providers",`,
    replace: `  "Run {highlight}securecode auth list{/highlight} to see all configured providers",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Run {highlight}opencode agent create{/highlight} for guided agent creation",`,
    replace: `  "Run {highlight}securecode agent create{/highlight} for guided agent creation",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Run {highlight}opencode github install{/highlight} to set up the GitHub workflow",`,
    replace: `  "Run {highlight}securecode github install{/highlight} to set up the GitHub workflow",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx",
    find: `  "Run {highlight}opencode debug config{/highlight} to troubleshoot configuration",`,
    replace: `  "Run {highlight}securecode debug config{/highlight} to troubleshoot configuration",`,
  },

  {
    file: "packages/opencode/src/cli/cmd/tui/routes/session/index.tsx",
    find: "        `  ${weak(\"Continue\")}${UI.Style.TEXT_NORMAL_BOLD}opencode -s ${session()?.id}${UI.Style.TEXT_NORMAL}`,",
    replace:
      "        `  ${weak(\"Continue\")}${UI.Style.TEXT_NORMAL_BOLD}securecode -s ${session()?.id}${UI.Style.TEXT_NORMAL}`,",
  },

  {
    file: "packages/opencode/src/cli/cmd/tui/thread.ts",
    find: `  describe: "start opencode tui",`,
    replace: `  describe: "start securecode tui",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/tui/thread.ts",
    find: `        describe: "path to start opencode in",`,
    replace: `        describe: "path to start securecode in",`,
  },

  {
    file: "packages/opencode/src/cli/cmd/uninstall.ts",
    find: `  describe: "uninstall opencode and remove all related files",`,
    replace: `  describe: "uninstall securecode and remove all related files",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/uninstall.ts",
    find: `    prompts.intro("Uninstall OpenCode")`,
    replace: `    prompts.intro("Uninstall securecode")`,
  },
  {
    file: "packages/opencode/src/cli/cmd/uninstall.ts",
    find: `  prompts.log.success("Thank you for using OpenCode!")`,
    replace: `  prompts.log.success("Thank you for using securecode!")`,
  },

  {
    file: "packages/opencode/src/cli/cmd/upgrade.ts",
    find: `  describe: "upgrade opencode to the latest or a specific version",`,
    replace: `  describe: "upgrade securecode to the latest or a specific version",`,
  },
  {
    file: "packages/opencode/src/cli/cmd/upgrade.ts",
    find: "      prompts.log.error(`opencode is installed to ${process.execPath} and may be managed by a package manager`)",
    replace:
      "      prompts.log.error(`securecode is installed to ${process.execPath} and may be managed by a package manager`)",
  },
  {
    file: "packages/opencode/src/cli/cmd/upgrade.ts",
    find: "      prompts.log.warn(`opencode upgrade skipped: ${target} is already installed`)",
    replace: "      prompts.log.warn(`securecode upgrade skipped: ${target} is already installed`)",
  },

  {
    file: "packages/opencode/src/cli/cmd/web.ts",
    find: `  describe: "start opencode server and open web interface",`,
    replace: `  describe: "start securecode server and open web interface",`,
  },

  {
    file: "packages/opencode/src/cli/error.ts",
    find: "      `Try: \\`opencode models\\` to list available models`,",
    replace: '      "Try: `securecode models` to list available models",',
  },
  {
    file: "packages/opencode/src/cli/error.ts",
    find: "      `Or check your config (opencode.json) provider/model names`,",
    replace: "      `Or check your config (securecode.json / opencode.json) provider/model names`,",
  },

  {
    file: "packages/opencode/src/cli/cmd/providers.ts",
    find: `              "Configure via opencode.json options (profile, region, endpoint) or\\n" +`,
    replace: `              "Configure via securecode.json (or opencode.json) options (profile, region, endpoint) or\\n" +`,
  },

  {
    file: "packages/opencode/src/global/index.ts",
    find: `const app = "opencode"`,
    replace: `const app = "securecode"`,
  },

  {
    file: "packages/opencode/src/index.ts",
    find: `  .scriptName("opencode")`,
    replace: `  .scriptName("securecode")`,
  },
]

type Result =
  | { rule: Rule; status: "applied"; matched: number }
  | { rule: Rule; status: "already-applied" }
  | { rule: Rule; status: "missing" }
  | { rule: Rule; status: "count-mismatch"; matched: number }
  | { rule: Rule; status: "no-file" }

function count(haystack: string, needle: string): number {
  if (needle === "") return 0
  return haystack.split(needle).length - 1
}

async function run(rule: Rule, mode: "apply" | "check"): Promise<Result> {
  const fp = path.join(process.cwd(), rule.file)
  const file = Bun.file(fp)
  if (!(await file.exists())) return { rule, status: "no-file" }

  const text = await file.text()
  const expected = rule.count ?? 1
  const findCount = count(text, rule.find)

  if (findCount === 0) {
    const replaceCount = count(text, rule.replace)
    if (replaceCount >= expected) return { rule, status: "already-applied" }
    return { rule, status: "missing" }
  }

  if (findCount !== expected) return { rule, status: "count-mismatch", matched: findCount }

  if (mode === "apply") {
    const next = text.split(rule.find).join(rule.replace)
    await Bun.write(fp, next)
  }
  return { rule, status: "applied", matched: findCount }
}

async function main() {
  const mode = Bun.argv.includes("--check") ? "check" : "apply"
  const results: Result[] = []
  for (const rule of RULES) {
    results.push(await run(rule, mode))
  }

  const buckets = {
    applied: results.filter((r) => r.status === "applied"),
    already: results.filter((r) => r.status === "already-applied"),
    missing: results.filter((r) => r.status === "missing"),
    mismatch: results.filter((r) => r.status === "count-mismatch"),
    nofile: results.filter((r) => r.status === "no-file"),
  }

  console.log(`mode=${mode}`)
  console.log(`total=${RULES.length}`)
  console.log(`applied=${buckets.applied.length}`)
  console.log(`already-applied=${buckets.already.length}`)
  console.log(`missing=${buckets.missing.length}`)
  console.log(`count-mismatch=${buckets.mismatch.length}`)
  console.log(`no-file=${buckets.nofile.length}`)

  for (const r of buckets.missing) {
    console.error(`MISSING ${r.rule.file}`)
    console.error(`  find: ${JSON.stringify(r.rule.find.slice(0, 120))}`)
  }
  for (const r of buckets.mismatch) {
    if (r.status !== "count-mismatch") continue
    console.error(`MISMATCH ${r.rule.file} expected=${r.rule.count ?? 1} got=${r.matched}`)
    console.error(`  find: ${JSON.stringify(r.rule.find.slice(0, 120))}`)
  }
  for (const r of buckets.nofile) {
    console.error(`NO-FILE ${r.rule.file}`)
  }

  if (buckets.missing.length || buckets.mismatch.length || buckets.nofile.length) {
    process.exit(1)
  }
}

await main()
